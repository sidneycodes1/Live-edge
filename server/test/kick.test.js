import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createKickClient, normalizeKickStream } from '../src/kick/client.js';

// Fake Response + router mock, same surface as twitch.test.js (status/ok/text/
// headers.get), so the client contract is proven identically across providers.
function makeRes(body, { status = 200, headers = {} } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => text,
    headers: { get: (n) => (n ? lower[String(n).toLowerCase()] ?? null : null) },
  };
}

function mockRouter(routes) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, method: opts.method, headers: opts.headers || {}, body: opts.body });
    for (const r of routes) {
      if (url.includes(r.match)) return typeof r.res === 'function' ? r.res(url, opts) : r.res;
    }
    throw new Error(`unmocked URL: ${url}`);
  };
  return { fn, calls };
}

const TOKEN = [{ match: 'id.kick.com/oauth/token', res: makeRes({ access_token: 'KT-1', expires_in: 3600, token_type: 'Bearer' }) }];
const CID = 'kick-client-id';
const SECRET = 'kick-sup3r-secret-do-not-log';

function okLivestreams() {
  return {
    data: [
      {
        broadcaster_user_id: 123,
        slug: 'john-doe',
        stream_title: 'Late night gaming',
        viewer_count: 1500,
        started_at: '2026-01-31T22:00:00Z',
        language: 'en',
        has_mature_content: false,
        category: { id: 101, name: 'Rust' },
        custom_tags: ['chill'],
      },
    ],
    message: 'OK',
  };
}

describe('normalizeKickStream → LiveChannel', () => {
  it('maps documented fields into the shared LiveChannel shape', () => {
    const ch = normalizeKickStream(okLivestreams().data[0]);
    assert.equal(ch.source, 'kick');
    assert.equal(ch.id, 'kick:123');
    assert.equal(ch.title, 'Late night gaming');
    assert.equal(ch.channelName, 'john-doe');
    assert.equal(ch.category, 'Rust'); // source-native label, not invented
    assert.equal(ch.viewerCount, 1500);
    assert.equal(ch.watchUrl, 'https://kick.com/john-doe');
    assert.equal(ch.thumbnailUrl, ''); // public API exposes none — not fabricated
  });
});

describe('kick client — missing credentials (graceful, no throw, no network)', () => {
  it('getTopLiveChannels returns [] and warns', async () => {
    const warnings = [];
    const { fn, calls } = mockRouter([]);
    const c = createKickClient({ clientId: undefined, clientSecret: undefined, fetchImpl: fn, warn: (m) => warnings.push(m) });
    const r = await c.getTopLiveChannels();
    assert.deepEqual(r, []);
    assert.equal(calls.length, 0, 'must not touch the network without creds');
    assert.ok(warnings.some((w) => /no credentials/i.test(w)));
  });
});

describe('kick client — app token + list', () => {
  it('POSTs client-credentials and never leaks the secret in a warning on failure', async () => {
    const warnings = [];
    const { fn, calls } = mockRouter([{ match: 'oauth/token', res: makeRes({ error: 'bad' }, { status: 401 }) }]);
    const c = createKickClient({ clientId: CID, clientSecret: SECRET, fetchImpl: fn, warn: (m) => warnings.push(m) });
    const r = await c.getTopLiveChannels(10);
    assert.deepEqual(r, []);
    const form = new URLSearchParams(calls[0].body);
    assert.equal(form.get('grant_type'), 'client_credentials');
    assert.equal(form.get('client_id'), CID);
    for (const w of warnings) assert.ok(!w.includes(SECRET), 'secret must never be logged');
  });

  it('normalizes livestreams and sends the documented endpoint + bearer header', async () => {
    const { fn, calls } = mockRouter([...TOKEN, { match: '/public/v1/livestreams', res: makeRes(okLivestreams()) }]);
    const c = createKickClient({ clientId: CID, clientSecret: SECRET, fetchImpl: fn });
    const list = await c.getTopLiveChannels(20);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, 'kick:123');
    assert.ok(calls[1].url.startsWith('https://api.kick.com/public/v1/livestreams?limit=20&sort=viewer_count'));
    assert.equal(calls[1].headers.Authorization, 'Bearer KT-1');
  });

  it('caches the token across calls (one token fetch)', async () => {
    const { fn, calls } = mockRouter([...TOKEN, { match: '/public/v1/livestreams', res: makeRes(okLivestreams()) }]);
    const c = createKickClient({ clientId: CID, clientSecret: SECRET, fetchImpl: fn, cacheTtlMs: 0 });
    await c.getTopLiveChannels(5);
    await c.getTopLiveChannels(5);
    assert.equal(calls.filter((x) => x.url.includes('oauth/token')).length, 1);
  });

  it('single-flight: concurrent calls share one inflight fetch', async () => {
    const { fn, calls } = mockRouter([...TOKEN, { match: '/public/v1/livestreams', res: makeRes(okLivestreams()) }]);
    const c = createKickClient({ clientId: CID, clientSecret: SECRET, fetchImpl: fn, cacheTtlMs: 0 });
    await Promise.all([c.getTopLiveChannels(10), c.getTopLiveChannels(10), c.getTopLiveChannels(10)]);
    assert.equal(calls.filter((x) => x.url.includes('/public/v1/livestreams')).length, 1);
  });

  it('5xx degrades to [] and serves the last good cache (stale fallback)', async () => {
    let fail = false;
    const warnings = [];
    const { fn } = mockRouter([
      ...TOKEN,
      {
        match: '/public/v1/livestreams',
        res: () => (fail ? makeRes({ error: 'x' }, { status: 500 }) : makeRes(okLivestreams())),
      },
    ]);
    const c = createKickClient({ clientId: CID, clientSecret: SECRET, fetchImpl: fn, cacheTtlMs: 0, warn: (m) => warnings.push(m) });
    await c.getTopLiveChannels(10); // populate cache
    fail = true;
    const stale = await c.getTopLiveChannels(10);
    assert.equal(stale.length, 1, 'stale cache served on failure');
    assert.ok(warnings.some((w) => /stale/i.test(w)));
  });
});
