import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createKickClient, normalizeKickStream } from '../src/kick/client.js';

// -----------------------------------------------------------------------------
// Agent D (QA) contract tests for the Kick client (docs/live-aggregation-spec.md
// §6, row "Kick — client DONE"; frozen). These tests PROVE the shipped module
// honors the spec's non-negotiables; they do not exercise the network: fetch is
// injected so every URL/header/body/status path is observable, matching the
// mocked-fetch style already used for the sibling twitch.test.js. Prior green is
// never trusted — every assertion here was run (see commit body for the run).
// -----------------------------------------------------------------------------

// Fake Response with the surface the client actually reads (status/ok/text/headers.get).
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

// URL-substring router; records every call so tests can assert "no network" cases.
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

const CID = 'kick-client-id';
const SECRET = 'kick-test-secret-never-log'; // fake; see scripts/check-secrets.mjs patterns
const TOKEN = [
  {
    match: 'id.kick.com/oauth/token',
    res: makeRes({ access_token: 'AT-KICK-1', expires_in: 5000000, token_type: 'Bearer' }),
  },
];

function okList() {
  return {
    data: [
      {
        broadcaster_user_id: 'bu-1',
        slug: 'xqc',
        stream_title: 'reacting to the finals',
        viewer_count: 25102,
        started_at: '2026-09-30T18:00:00Z',
        language: 'en',
        has_mature_content: false,
        category: { id: 'cat-1', name: 'Just Chatting' },
        custom_tags: ['English'],
      },
      {
        broadcaster_user_id: 'bu-2',
        slug: 'kickbasic',
        stream_title: 'football watch party',
        viewer_count: 1200,
        started_at: '2026-09-30T18:30:00Z',
        language: 'en',
        has_mature_content: true,
        category: { id: 'cat-2', name: 'Sports' },
      },
    ],
  };
}

describe('normalizeKickStream → LiveChannel (spec §1 + §4 honesty)', () => {
  it('maps every documented field and namespaces the id as "kick:<broadcaster_user_id>"', () => {
    const c = normalizeKickStream(okList().data[0]);
    assert.equal(c.id, 'kick:bu-1', 'id must be source-namespaced so cross-provider dedupe is stable');
    assert.equal(c.source, 'kick');
    assert.equal(c.title, 'reacting to the finals');
    assert.equal(c.channelName, 'xqc');
    assert.equal(c.channelSlug, 'xqc');
    assert.equal(c.category, 'Just Chatting', 'category is SOURCE-NATIVE, never an invented bucket (§1, §2)');
    assert.equal(c.viewerCount, 25102);
    assert.equal(c.startedAt, '2026-09-30T18:00:00Z');
    assert.equal(c.isLive, true);
    assert.equal(c.isMature, false);
    assert.equal(c.language, 'en');
    assert.equal(c.watchUrl, 'https://kick.com/xqc');
  });

  it('leaves thumbnailUrl EMPTY rather than fabricating one (§4: no guessed image URLs)', () => {
    const c = normalizeKickStream(okList().data[0]);
    assert.equal(c.thumbnailUrl, '', 'Kick livestreams response carries no thumbnail; we must not invent a URL that could 404');
  });

  it('isMature reflects has_mature_content strictly (undefined / false → false, true → true)', () => {
    assert.equal(normalizeKickStream({ ...okList().data[0], has_mature_content: true }).isMature, true);
    assert.equal(normalizeKickStream({ ...okList().data[0], has_mature_content: false }).isMature, false);
    const noFlag = { ...okList().data[0] };
    delete noFlag.has_mature_content;
    assert.equal(normalizeKickStream(noFlag).isMature, false);
  });

  it('empty slug → watchUrl null, id falls back to broadcaster_user_id, and shape still fully defined', () => {
    const c = normalizeKickStream({ broadcaster_user_id: 'bu-x', slug: '', stream_title: 'x', viewer_count: 0 });
    assert.equal(c.watchUrl, null, 'never build a broken kick.com/ URL');
    assert.equal(c.id, 'kick:bu-x');
    assert.equal(c.channelSlug, '');
    // Every field still present (grid never sees undefined — spec §1 rule).
    for (const k of ['id', 'source', 'title', 'channelName', 'channelSlug', 'category', 'viewerCount', 'startedAt', 'thumbnailUrl', 'isLive', 'isMature', 'watchUrl', 'language']) {
      assert.ok(k in c, `field ${k} must be present even when the provider row is partial`);
    }
  });

  it('missing category object still yields a safe (empty) source-native category', () => {
    const c = normalizeKickStream({ broadcaster_user_id: 'bu-y', slug: 'y', stream_title: 't' });
    assert.equal(c.category, '');
  });
});

describe('kick client — missing credentials (spec §6: never throws, no network)', () => {
  it('getTopLiveChannels returns [] and warns, ZERO fetch calls made', async () => {
    const warnings = [];
    const { fn, calls } = mockRouter([]);
    const c = createKickClient({ clientId: undefined, clientSecret: undefined, fetchImpl: fn, warn: (m) => warnings.push(m) });
    const r = await c.getTopLiveChannels(20);
    assert.deepEqual(r, []);
    assert.equal(calls.length, 0, 'MUST NOT touch the network without creds');
    assert.ok(warnings.some((w) => /no credentials/i.test(w)));
  });

  it('hasCreds() is false when either half is missing', () => {
    const { fn } = mockRouter([]);
    assert.equal(createKickClient({ clientId: CID, clientSecret: undefined, fetchImpl: fn }).hasCreds(), false);
    assert.equal(createKickClient({ clientId: undefined, clientSecret: SECRET, fetchImpl: fn }).hasCreds(), false);
    assert.equal(createKickClient({ clientId: CID, clientSecret: SECRET, fetchImpl: fn }).hasCreds(), true);
  });
});

describe('kick client — app token (client-credentials, mirrors twitch flow)', () => {
  it('POSTs the documented urlencoded body (client_id, client_secret, grant_type)', async () => {
    const { fn, calls } = mockRouter(TOKEN);
    const c = createKickClient({ clientId: CID, clientSecret: SECRET, fetchImpl: fn });
    const t = await c._getAppToken();
    assert.equal(t, 'AT-KICK-1');
    assert.equal(calls[0].url, 'https://id.kick.com/oauth/token');
    assert.equal(calls[0].method, 'POST');
    const form = new URLSearchParams(calls[0].body);
    assert.equal(form.get('grant_type'), 'client_credentials');
    assert.equal(form.get('client_id'), CID);
    assert.equal(form.get('client_secret'), SECRET);
  });

  it('caches the token; second list call reuses it (exactly one token POST)', async () => {
    const { fn, calls } = mockRouter([...TOKEN, { match: '/public/v1/livestreams', res: makeRes(okList()) }]);
    const c = createKickClient({ clientId: CID, clientSecret: SECRET, fetchImpl: fn, cacheTtlMs: 0 });
    await c.getTopLiveChannels(5);
    await c.getTopLiveChannels(5);
    const tokenPosts = calls.filter((x) => x.url.includes('oauth/token'));
    assert.equal(tokenPosts.length, 1, 'token must be cached across list calls');
  });

  it('token 401 → public boundary degrades to [] and NEVER logs the secret', async () => {
    const warnings = [];
    const { fn } = mockRouter([{ match: 'oauth/token', res: makeRes({ error: 'unauthorized' }, { status: 401 }) }]);
    const c = createKickClient({ clientId: CID, clientSecret: SECRET, fetchImpl: fn, warn: (m) => warnings.push(m) });
    const r = await c.getTopLiveChannels(10);
    assert.deepEqual(r, []);
    assert.ok(warnings.length >= 1, 'at least one warn emitted');
    for (const w of warnings) {
      assert.ok(!w.includes(SECRET), `warning must not leak the secret: ${w}`);
      assert.ok(!w.includes(CID) || !w.includes(SECRET), 'must not pair id+secret');
    }
  });
});

describe('kick client — getTopLiveChannels (contract + resilience boundary)', () => {
  it('GETs /public/v1/livestreams with limit + sort=viewer_count and the Bearer header', async () => {
    const { fn, calls } = mockRouter([...TOKEN, { match: '/public/v1/livestreams', res: makeRes(okList()) }]);
    const c = createKickClient({ clientId: CID, clientSecret: SECRET, fetchImpl: fn });
    const list = await c.getTopLiveChannels(20);
    assert.equal(list.length, 2);
    const get = calls.find((x) => x.url.includes('/public/v1/livestreams'));
    assert.ok(get.url.startsWith('https://api.kick.com/public/v1/livestreams?limit=20&sort=viewer_count'), get.url);
    assert.equal(get.headers.Authorization, 'Bearer AT-KICK-1');
  });

  it('clamps limit to [1..100] — a 9999 request never hits the API as-is', async () => {
    const { fn, calls } = mockRouter([...TOKEN, { match: '/public/v1/livestreams', res: makeRes({ data: [] }) }]);
    const c = createKickClient({ clientId: CID, clientSecret: SECRET, fetchImpl: fn });
    await c.getTopLiveChannels(9999);
    assert.ok(calls[1].url.includes('limit=100'), calls[1].url);
    await c.getTopLiveChannels(-5);
    assert.ok(calls[2].url.includes('limit=1'), calls[2].url);
  });

  it('empty data → [] (never throws)', async () => {
    const { fn } = mockRouter([...TOKEN, { match: '/public/v1/livestreams', res: makeRes({ data: [] }) }]);
    const c = createKickClient({ clientId: CID, clientSecret: SECRET, fetchImpl: fn });
    assert.deepEqual(await c.getTopLiveChannels(10), []);
  });

  it('upstream 5xx → [] and warns (spec §6: never-throws boundary)', async () => {
    const warnings = [];
    const { fn } = mockRouter([...TOKEN, { match: '/public/v1/livestreams', res: makeRes({ error: 'boom' }, { status: 503 }) }]);
    const c = createKickClient({ clientId: CID, clientSecret: SECRET, fetchImpl: fn, warn: (m) => warnings.push(m) });
    assert.deepEqual(await c.getTopLiveChannels(10), []);
    assert.ok(warnings.some((w) => /getTopLiveChannels failed/i.test(w)));
  });

  it('stale cache is preserved on a subsequent upstream failure (§3 ladder fuel)', async () => {
    let t = 1000;
    let failMode = false;
    const { fn } = mockRouter([
      ...TOKEN,
      {
        match: '/public/v1/livestreams',
        res: () => (failMode ? makeRes({ error: 'boom' }, { status: 500 }) : makeRes(okList())),
      },
    ]);
    const c = createKickClient({
      clientId: CID, clientSecret: SECRET, fetchImpl: fn, cacheTtlMs: 45000,
      now: () => t, warn: () => {},
    });
    const first = await c.getTopLiveChannels(10);
    assert.equal(first.length, 2, 'first call serves fresh data');
    failMode = true;
    t += 46000; // past TTL so we actually try again
    const second = await c.getTopLiveChannels(10);
    assert.equal(second.length, 2, 'failed refresh must serve the last-good cache, not []');
    assert.equal(second[0].id, 'kick:bu-1');
  });

  it('caches within TTL (single HTTP GET) and refetches after expiry', async () => {
    let t = 1000;
    const { fn, calls } = mockRouter([...TOKEN, { match: '/public/v1/livestreams', res: makeRes(okList()) }]);
    const c = createKickClient({
      clientId: CID, clientSecret: SECRET, fetchImpl: fn, cacheTtlMs: 45000, now: () => t,
    });
    await c.getTopLiveChannels(20);
    await c.getTopLiveChannels(20);
    const gets = calls.filter((x) => x.url.includes('/public/v1/livestreams'));
    assert.equal(gets.length, 1, 'within TTL must be a single HTTP GET');
    t += 46000;
    await c.getTopLiveChannels(20);
    assert.equal(calls.filter((x) => x.url.includes('/public/v1/livestreams')).length, 2, 'past TTL must refetch');
  });

  it('single-flight: concurrent getTopLiveChannels fires exactly one HTTP GET', async () => {
    const { fn, calls } = mockRouter([...TOKEN, { match: '/public/v1/livestreams', res: makeRes(okList()) }]);
    const c = createKickClient({ clientId: CID, clientSecret: SECRET, fetchImpl: fn });
    const [a, b, d] = await Promise.all([c.getTopLiveChannels(10), c.getTopLiveChannels(10), c.getTopLiveChannels(10)]);
    assert.deepEqual(a, b);
    assert.deepEqual(b, d);
    assert.equal(calls.filter((x) => x.url.includes('/public/v1/livestreams')).length, 1, 'must coalesce inflight calls');
  });
});
