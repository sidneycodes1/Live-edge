import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTwitchClient, fillThumbnail } from '../src/twitch/client.js';

// A fake Response with just the surface the client uses: status/ok/text/headers.get.
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

// Router mock: picks a response by URL substring, records every call.
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

const TOKEN = [{ match: 'id.twitch.tv/oauth2/token', res: makeRes({ access_token: 'AT-123', expires_in: 5000000, token_type: 'bearer' }) }];
const CID = 'my-client-id';
const SECRET = 'sup3r-secret-value-do-not-log';

function okStreamData() {
  return {
    data: [
      {
        id: '40952121085',
        user_id: '101051819',
        user_login: 'afro',
        user_name: 'Afro',
        game_id: '32982',
        game_name: 'Grand Theft Auto V',
        type: 'live',
        title: 'Jacob: Digital Den Laptops',
        tags: ['English'],
        viewer_count: 1490,
        started_at: '2021-03-10T03:18:11Z',
        language: 'en',
        thumbnail_url: 'https://static-cdn.jtvnw.net/previews-ttv/live_user_afro-{width}x{height}.jpg',
        is_mature: false,
      },
    ],
    pagination: {},
  };
}

describe('fillThumbnail', () => {
  it('replaces width/height placeholders', () => {
    assert.equal(
      fillThumbnail('https://cdn/x-{width}x{height}.jpg', 320, 180),
      'https://cdn/x-320x180.jpg',
    );
  });
  it('handles empty url', () => {
    assert.equal(fillThumbnail('', 1, 2), '');
    assert.equal(fillThumbnail(undefined, 1, 2), '');
  });
});

describe('twitch client — missing credentials (graceful, no throw)', () => {
  it('getTopLiveStreams returns [] and warns, no network', async () => {
    const warnings = [];
    const { fn, calls } = mockRouter([]);
    const c = createTwitchClient({ clientId: undefined, clientSecret: undefined, fetchImpl: fn, warn: (m) => warnings.push(m) });
    const r = await c.getTopLiveStreams();
    assert.deepEqual(r, []);
    assert.equal(calls.length, 0, 'must not call the network without creds');
    assert.ok(warnings.some((w) => /no credentials/i.test(w)));
  });

  it('getStreamByLogin returns null without creds', async () => {
    const { fn } = mockRouter([]);
    const c = createTwitchClient({ clientId: CID, clientSecret: undefined, fetchImpl: fn, warn: () => {} });
    assert.equal(await c.getStreamByLogin('afro'), null);
  });
});

describe('twitch client — app token (client credentials)', () => {
  it('POSTs the documented params and does not leak the secret in a thrown error on failure', async () => {
    const { fn, calls } = mockRouter(TOKEN);
    const c = createTwitchClient({ clientId: CID, clientSecret: SECRET, fetchImpl: fn });
    const t = await c._getAppToken();
    assert.equal(t, 'AT-123');
    assert.equal(calls[0].url, 'https://id.twitch.tv/oauth2/token');
    assert.equal(calls[0].method, 'POST');
    const form = new URLSearchParams(calls[0].body);
    assert.equal(form.get('grant_type'), 'client_credentials');
    assert.equal(form.get('client_id'), CID);
    assert.equal(form.get('client_secret'), SECRET);
  });

  it('caches the token (second streams call reuses it — only one token fetch)', async () => {
    const { fn, calls } = mockRouter([...TOKEN, { match: '/helix/streams', res: makeRes(okStreamData()) }]);
    const c = createTwitchClient({ clientId: CID, clientSecret: SECRET, fetchImpl: fn, cacheTtlMs: 0 });
    await c.getTopLiveStreams(5);
    await c.getTopLiveStreams(5);
    const tokenCalls = calls.filter((x) => x.url.includes('oauth2/token'));
    assert.equal(tokenCalls.length, 1, 'token should be cached across calls');
  });

  it('token failure degrades to [] (never throws) and never logs the secret', async () => {
    const warnings = [];
    const { fn } = mockRouter([{ match: 'oauth2/token', res: makeRes({ error: 'Unauthorized', status: 401 }, { status: 401 }) }]);
    const c = createTwitchClient({ clientId: CID, clientSecret: SECRET, fetchImpl: fn, warn: (m) => warnings.push(m) });
    const r = await c.getTopLiveStreams(10);
    assert.deepEqual(r, []);
    assert.ok(warnings.length > 0);
    for (const w of warnings) assert.ok(!w.includes(SECRET), 'secret must never appear in a warning');
  });
});

describe('twitch client — getTopLiveStreams', () => {
  it('normalizes the documented stream fields and fills the thumbnail', async () => {
    const { fn, calls } = mockRouter([...TOKEN, { match: '/helix/streams', res: makeRes(okStreamData()) }]);
    const c = createTwitchClient({ clientId: CID, clientSecret: SECRET, fetchImpl: fn });
    const list = await c.getTopLiveStreams(20);
    assert.equal(list.length, 1);
    const s = list[0];
    assert.equal(s.id, '40952121085');
    assert.equal(s.userLogin, 'afro');
    assert.equal(s.userName, 'Afro');
    assert.equal(s.gameName, 'Grand Theft Auto V');
    assert.equal(s.viewerCount, 1490);
    assert.equal(s.startedAt, '2021-03-10T03:18:11Z');
    assert.equal(s.thumbnailUrl, 'https://static-cdn.jtvnw.net/previews-ttv/live_user_afro-320x180.jpg');
    // correct endpoint + required headers per docs
    assert.ok(calls[1].url.startsWith('https://api.twitch.tv/helix/streams?first=20&type=live'));
    assert.equal(calls[1].headers['Client-Id'], CID);
    assert.equal(calls[1].headers.Authorization, 'Bearer AT-123');
  });

  it('clamps first to Helix max 100', async () => {
    const { fn, calls } = mockRouter([...TOKEN, { match: '/helix/streams', res: makeRes({ data: [] }) }]);
    const c = createTwitchClient({ clientId: CID, clientSecret: SECRET, fetchImpl: fn });
    await c.getTopLiveStreams(9999);
    assert.ok(calls[1].url.includes('first=100'), calls[1].url);
  });

  it('empty data returns []', async () => {
    const { fn } = mockRouter([...TOKEN, { match: '/helix/streams', res: makeRes({ data: [], pagination: {} }) }]);
    const c = createTwitchClient({ clientId: CID, clientSecret: SECRET, fetchImpl: fn });
    assert.deepEqual(await c.getTopLiveStreams(10), []);
  });

  it('helix 500 degrades to [] (never throws)', async () => {
    const warnings = [];
    const { fn } = mockRouter([...TOKEN, { match: '/helix/streams', res: makeRes({ error: 'Internal' }, { status: 500 }) }]);
    const c = createTwitchClient({ clientId: CID, clientSecret: SECRET, fetchImpl: fn, warn: (m) => warnings.push(m) });
    assert.deepEqual(await c.getTopLiveStreams(10), []);
    assert.ok(warnings.some((w) => /getTopLiveStreams failed/i.test(w)));
  });

  it('caches results within TTL (only one helix call) and refetches when expired', async () => {
    let nowVal = 1000;
    const { fn, calls } = mockRouter([...TOKEN, { match: '/helix/streams', res: makeRes(okStreamData()) }]);
    const c = createTwitchClient({
      clientId: CID, clientSecret: SECRET, fetchImpl: fn,
      cacheTtlMs: 45000, now: () => nowVal,
    });
    await c.getTopLiveStreams(20);
    await c.getTopLiveStreams(20);
    const streamCalls = calls.filter((x) => x.url.includes('/helix/streams'));
    assert.equal(streamCalls.length, 1, 'should be cached within TTL');
    nowVal += 46000; // beyond TTL
    await c.getTopLiveStreams(20);
    assert.equal(calls.filter((x) => x.url.includes('/helix/streams')).length, 2, 'should refetch after TTL');
  });

  it('warns when Ratelimit-Remaining is low', async () => {
    const warnings = [];
    const { fn } = mockRouter([
      ...TOKEN,
      { match: '/helix/streams', res: makeRes(okStreamData(), { headers: { 'Ratelimit-Remaining': '3' } }) },
    ]);
    const c = createTwitchClient({ clientId: CID, clientSecret: SECRET, fetchImpl: fn, warn: (m) => warnings.push(m) });
    await c.getTopLiveStreams(20);
    assert.ok(warnings.some((w) => /rate limit low/i.test(w)));
  });
});

describe('twitch client — getStreamByLogin', () => {
  it('returns the single live stream (offline → data empty → null)', async () => {
    const { fn, calls } = mockRouter([...TOKEN, { match: '/helix/streams', res: makeRes(okStreamData()) }]);
    const c = createTwitchClient({ clientId: CID, clientSecret: SECRET, fetchImpl: fn });
    const s = await c.getStreamByLogin('Afro');
    assert.equal(s.userLogin, 'afro');
    assert.ok(calls[1].url.includes('user_login=afro'), 'login lowercased + filtered');
  });

  it('null when channel is not live (empty data)', async () => {
    const { fn } = mockRouter([...TOKEN, { match: '/helix/streams', res: makeRes({ data: [], pagination: {} }) }]);
    const c = createTwitchClient({ clientId: CID, clientSecret: SECRET, fetchImpl: fn });
    assert.equal(await c.getStreamByLogin('nobody'), null);
  });

  it('null on helix error (never throws)', async () => {
    const { fn } = mockRouter([...TOKEN, { match: '/helix/streams', res: makeRes({ error: 'x' }, { status: 401 }) }]);
    const c = createTwitchClient({ clientId: CID, clientSecret: SECRET, fetchImpl: fn, warn: () => {} });
    assert.equal(await c.getStreamByLogin('afro'), null);
  });
});

describe('twitch client — getUserByLogin / validateChannel (Phase D)', () => {
  const USERS = [{ match: 'oauth2/token', res: makeRes({ access_token: 'AT-123', expires_in: 5000000, token_type: 'bearer' }) }];

  it('getUserByLogin returns the documented user fields (exists even if offline)', async () => {
    const { fn, calls } = mockRouter([...USERS, { match: '/helix/users', res: makeRes({ data: [{ id: '141981764', login: 'twitchdev', display_name: 'TwitchDev' }] }) }]);
    const c = createTwitchClient({ clientId: CID, clientSecret: SECRET, fetchImpl: fn });
    const u = await c.getUserByLogin('TwitchDev');
    assert.equal(u.id, '141981764');
    assert.equal(u.login, 'twitchdev');
    assert.equal(u.displayName, 'TwitchDev');
    assert.ok(calls.some((x) => x.url.includes('/helix/users?login=twitchdev')));
  });

  it('getUserByLogin → null when not found (empty data) and on error', async () => {
    const a = mockRouter([...USERS, { match: '/helix/users', res: makeRes({ data: [] }) }]);
    const cA = createTwitchClient({ clientId: CID, clientSecret: SECRET, fetchImpl: a.fn });
    assert.equal(await cA.getUserByLogin('nope'), null);
    const b = mockRouter([...USERS, { match: '/helix/users', res: makeRes({ error: 'x' }, { status: 500 }) }]);
    const cB = createTwitchClient({ clientId: CID, clientSecret: SECRET, fetchImpl: b.fn, warn: () => {} });
    assert.equal(await cB.getUserByLogin('nope'), null);
  });

  it('validateChannel: live channel → exists + isLive', async () => {
    const { fn } = mockRouter([
      ...USERS,
      { match: '/helix/users', res: makeRes({ data: [{ id: '1', login: 'afro', display_name: 'Afro' }] }) },
      { match: '/helix/streams', res: makeRes(okStreamData()) },
    ]);
    const c = createTwitchClient({ clientId: CID, clientSecret: SECRET, fetchImpl: fn });
    const v = await c.validateChannel('Afro');
    assert.equal(v.exists, true);
    assert.equal(v.isLive, true);
    assert.equal(v.verifiable, true);
    assert.equal(v.login, 'afro');
  });

  it('validateChannel: exists but offline → exists true, isLive false', async () => {
    const { fn } = mockRouter([
      ...USERS,
      { match: '/helix/users', res: makeRes({ data: [{ id: '1', login: 'nobody', display_name: 'Nobody' }] }) },
      { match: '/helix/streams', res: makeRes({ data: [] }) },
    ]);
    const c = createTwitchClient({ clientId: CID, clientSecret: SECRET, fetchImpl: fn });
    const v = await c.validateChannel('nobody');
    assert.equal(v.exists, true);
    assert.equal(v.isLive, false);
  });

  it('validateChannel: nonexistent → exists false', async () => {
    const { fn } = mockRouter([
      ...USERS,
      { match: '/helix/users', res: makeRes({ data: [] }) },
      { match: '/helix/streams', res: makeRes({ data: [] }) },
    ]);
    const c = createTwitchClient({ clientId: CID, clientSecret: SECRET, fetchImpl: fn });
    const v = await c.validateChannel('garbage-xyz');
    assert.equal(v.exists, false);
    assert.equal(v.verifiable, true);
  });

  it('validateChannel without creds → verifiable:false (never claims garbage is valid)', async () => {
    const { fn, calls } = mockRouter([]);
    const c = createTwitchClient({ clientId: undefined, clientSecret: undefined, fetchImpl: fn, warn: () => {} });
    const v = await c.validateChannel('lofigirl');
    assert.equal(v.verifiable, false);
    assert.equal(v.exists, false);
    assert.equal(calls.length, 0);
  });
});
