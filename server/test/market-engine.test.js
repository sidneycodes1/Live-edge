import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setupTestEnv, teardownTestEnv, resetDb, makeApp } from './helpers/testApp.js';
import { createMarketEngine, ENGINE_USER, ENGINE_DEFAULTS, candidateFromItem } from '../src/services/marketEngine.js';
import { GeminiError } from '../src/gemini/errors.js';

// Fixed clock so budget-day + end_time math are deterministic.
const T0 = Date.UTC(2026, 9, 4, 12, 0, 0); // Oct 4 2026 12:00 UTC → day '2026-10-04'
const DAY = '2026-10-04';
const now = () => T0;

function liveItem(over = {}) {
  return {
    id: 'yt-vid1',
    source: 'curated-youtube',
    category: 'News',
    title: 'Al Jazeera News Feed',
    channelName: 'Al Jazeera English',
    owner: 'Al Jazeera English',
    videoUrl: 'https://www.youtube.com/watch?v=vid1',
    liveEmbedUrl: 'https://www.youtube.com/embed/live_stream?channel=UCx',
    thumbnailUrl: 'https://i.ytimg.com/vi/vid1/hqdefault.jpg',
    status: 'live-24-7',
    ...over,
  };
}

function fakeAggregator(items = [liveItem()]) {
  return {
    getChannels: async () => ({ items, generatedAt: T0 }),
  };
}

// Records whether generateJson was called and returns/throws a scripted value.
function fakeGemini(result, { enabled = true, throws = null } = {}) {
  const g = { calls: 0, isEnabled: () => enabled };
  g.generateJson = async () => {
    g.calls += 1;
    if (throws) throw throws;
    return result;
  };
  return g;
}

async function ensureUser(db) {
  await db.query(`insert into users(id, wallet, display_name) values($1,$2,$3) on conflict (id) do nothing`, [
    ENGINE_USER.id,
    ENGINE_USER.wallet,
    ENGINE_USER.displayName,
  ]);
}

async function seedMarket(db, { source = 'sim-engine', question, status = 'open', endMs = Date.UTC(2099, 0, 1), isSeed = false, image = null, engine = {} }) {
  await ensureUser(db);
  const id = randomUUID();
  await db.query(
    `insert into markets(id, creator_id, source, question, resolution_rule, sources_of_truth, category, image_url,
        start_time, end_time, resolution_time, status, is_seed, engine_live_item_id, engine_video_id, engine_channel_slug, engine_watch_url)
       values($1,$2,$3,$4,'rule',ARRAY['src'],'News',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [id, ENGINE_USER.id, source, question, image, new Date(T0 - 60000).toISOString(), new Date(endMs).toISOString(), new Date(endMs + 300000).toISOString(), status, isSeed, engine.liveItemId || null, engine.videoId || null, engine.channelSlug || null, engine.watchUrl || null],
  );
  return id;
}

function newEngine(db, gemini, aggregator) {
  return createMarketEngine({ db, gemini, aggregator, env: {}, now, warn: () => {} });
}

describe('marketEngine/candidateFromItem', () => {
  it('extracts the bare video id + thumbnail/watch for a curated yt- item', () => {
    const c = candidateFromItem(liveItem(), 'live');
    assert.equal(c.liveItemId, 'yt-vid1');
    assert.equal(c.videoId, 'vid1');
    assert.equal(c.thumbnailUrl, 'https://i.ytimg.com/vi/vid1/hqdefault.jpg');
    assert.equal(c.watchUrl, 'https://www.youtube.com/watch?v=vid1');
  });
  it('extracts video id from a provider youtube:<vid> id', () => {
    const c = candidateFromItem({ id: 'youtube:abc123', title: 'x', channelSlug: 'y' }, 'live');
    assert.equal(c.videoId, 'abc123');
  });
  it('leaves videoId null for a kick stream (no fabricated video id)', () => {
    const c = candidateFromItem({ id: 'kick:999', channelSlug: 'afro', title: 'play', thumbnailUrl: 't' }, 'live');
    assert.equal(c.videoId, null);
    assert.equal(c.channelSlug, 'afro');
  });
});

describe('marketEngine/tick', () => {
  before(setupTestEnv);
  beforeEach(resetDb);
  after(teardownTestEnv);

  it('DISABLE-SAFE: disabled gemini → skipped, no call, no writes', async () => {
    const { db } = await makeApp();
    const g = fakeGemini({ markets: [] }, { enabled: false });
    const res = await newEngine(db, g, fakeAggregator()).tick();
    assert.equal(res.skipped, 'disabled');
    assert.equal(g.calls, 0);
    const { rows } = await db.query(`select count(*)::int c from markets where source='sim-engine'`);
    assert.equal(rows[0].c, 0);
  });

  it('BUDGET: at/over the daily cap → skip, log-once path, gemini NOT called', async () => {
    const { db } = await makeApp();
    await db.query(`insert into engine_budget(day, calls) values($1,$2)`, [DAY, ENGINE_DEFAULTS.budgetPerDay]);
    const g = fakeGemini({ markets: [] });
    const res = await newEngine(db, g, fakeAggregator()).tick();
    assert.equal(res.skipped, 'budget');
    assert.equal(g.calls, 0);
  });

  it('ROTATION: stops creating when >= maxOpenEngineMarkets are open (no gemini call)', async () => {
    const { db } = await makeApp();
    for (let i = 0; i < ENGINE_DEFAULTS.maxOpenEngineMarkets; i += 1) await seedMarket(db, { question: `Existing open engine market number ${i}?` });
    const g = fakeGemini({ markets: [] });
    const res = await newEngine(db, g, fakeAggregator()).tick();
    assert.equal(res.skipped, 'rotation-full');
    assert.equal(res.openCount, ENGINE_DEFAULTS.maxOpenEngineMarkets);
    assert.equal(g.calls, 0);
  });

  it('CONTINUITY: a fresh batch is left OPEN after a tick (rails never empty)', async () => {
    const { db } = await makeApp();
    await ensureUser(db);
    const g = fakeGemini({
      markets: [
        { liveItemId: 'yt-vid1', question: 'Will this live stream still be running in ten minutes?', category: 'News' },
        { liveItemId: 'yt-vid1', question: 'Does this broadcast stay up until the next rotation window?', category: 'News' },
      ],
    });
    const res = await newEngine(db, g, fakeAggregator()).tick();
    assert.ok(res.created >= 1, 'tick created at least one market');
    const { rows } = await db.query(`select count(*)::int c from markets where source='sim-engine' and status='open'`);
    assert.ok(Number(rows[0].c) > 0, 'openCount > 0 immediately after rotation');
  });

  it('NO-LIVE: empty snapshot → keeps last batch, no gemini call, never wipes', async () => {
    const { db } = await makeApp();
    const g = fakeGemini({ markets: [] });
    const res = await newEngine(db, g, fakeAggregator([])).tick();
    assert.equal(res.skipped, 'no-live');
    assert.equal(g.calls, 0);
  });

  it('BROADCAST RULE: candidates without a watchable stream never reach the model', async () => {
    const { db } = await makeApp();
    // A data-only feed item (no watchUrl/thumbnail) is not a live BROADCAST,
    // so the pool is empty → skip 'no-live', model untouched.
    const agg = {
      getChannels: async () => ({
        items: [{ id: 'feed-x', title: 'Data-only feed', channelName: 'No Stream', viewers: 5, category: 'Sports', status: 'live' }],
      }),
    };
    const g = fakeGemini({ markets: [] });
    const res = await newEngine(db, g, agg).tick();
    assert.equal(res.skipped, 'no-live');
    assert.equal(g.calls, 0);
    const { rows } = await db.query(`select count(*)::int c from markets where source='sim-engine'`);
    assert.equal(rows[0].c, 0);
  });

  it('HAPPY: creates sim-engine markets tied to the live stream + stamps budget', async () => {
    const { db } = await makeApp();
    const g = fakeGemini({
      markets: [
        { liveItemId: 'yt-vid1', question: 'Will Al Jazeera break a major headline within 30 minutes?', resolutionRule: 'YES if a breaking banner appears.', category: 'News' },
        { liveItemId: 'yt-vid2', question: 'Will the anchor mention the summit before the hour?', category: 'News' },
      ],
    });
    const res = await newEngine(db, g, fakeAggregator([liveItem(), liveItem({ id: 'yt-vid2', videoUrl: 'https://www.youtube.com/watch?v=vid2', thumbnailUrl: 'https://i.ytimg.com/vi/vid2/hqdefault.jpg', title: 'Second Live Stream', channelName: 'Second Channel', owner: 'Second Channel' })])).tick();
    assert.equal(res.created, 2);
    assert.equal(res.calls, 1);
    const { rows } = await db.query(`select * from markets where source='sim-engine' order by created_at`);
    assert.equal(rows.length, 2);
    const m = rows[0];
    assert.equal(m.engine_video_id, 'vid1');
    assert.equal(m.engine_live_item_id, 'yt-vid1');
    assert.equal(m.image_url, 'https://i.ytimg.com/vi/vid1/hqdefault.jpg');
    assert.equal(m.is_seed, false);
    assert.equal(m.status, 'open');
    // end_time = now + 30 min
    assert.equal(new Date(m.end_time).getTime() - T0, ENGINE_DEFAULTS.marketTtlMs);
    // budget persisted
    const { rows: b } = await db.query(`select calls from engine_budget where day=$1`, [DAY]);
    assert.equal(Number(b[0].calls), 1);
  });

  it('DEDUP: a question already OPEN is not created twice', async () => {
    const { db } = await makeApp();
    await seedMarket(db, { source: 'sim', question: 'Will this exact question already exist?' });
    const g = fakeGemini({ markets: [{ liveItemId: 'yt-vid1', question: 'Will this exact question already exist?' }] });
    const res = await newEngine(db, g, fakeAggregator([liveItem()])).tick();
    assert.equal(res.created, 0);
    assert.equal(res.deduped, 1);
  });

  it('DIVERSITY: two markets on the SAME stream collapse to one per batch (no near-dup cards)', async () => {
    const { db } = await makeApp();
    const g = fakeGemini({
      markets: [
        { liveItemId: 'yt-vid1', question: 'Will this stream show a clip in the next 30 minutes?', category: 'News' },
        { liveItemId: 'yt-vid1', question: 'Will this stream show five clips before it ends?', category: 'News' },
      ],
    });
    const res = await newEngine(db, g, fakeAggregator([liveItem()])).tick();
    assert.equal(res.created, 1, 'only one market per live stream per batch');
    const { rows } = await db.query(`select count(*)::int c from markets where source='sim-engine'`);
    assert.equal(rows[0].c, 1);
  });

  it('B3: an engine market gets its OWN room (real stream title + watch url) so the rails surface it', async () => {
    const { db } = await makeApp();
    const g = fakeGemini({ markets: [{ liveItemId: 'yt-vid1', question: 'Will Al Jazeera break a headline in the next half hour?' }] });
    await newEngine(db, g, fakeAggregator([liveItem()])).tick();
    const { rows } = await db.query(
      `select m.room_id, r.title, r.video_url, r.owner_id from markets m join rooms r on r.id = m.room_id where m.source='sim-engine'`,
    );
    assert.equal(rows.length, 1);
    assert.ok(rows[0].room_id, 'market is NOT roomless');
    assert.equal(rows[0].title, 'Al Jazeera News Feed'); // the REAL stream title, not a label
    assert.equal(rows[0].video_url, 'https://www.youtube.com/watch?v=vid1');
    assert.equal(rows[0].owner_id, ENGINE_USER.id);
  });

  it('B3: rooms listing shows an OPEN engine room and hides it once its bet closes', async () => {
    const { db, fetchJson } = await makeApp();
    await ensureUser(db);
    const FAR = Date.UTC(2099, 0, 1);
    const roomId = randomUUID();
    const mId = randomUUID();
    await db.query(`insert into rooms(id, owner_id, title, video_url, status, is_seed) values($1,$2,'Live Test Broadcast',$3,'live',false)`, [
      roomId, ENGINE_USER.id, 'https://www.youtube.com/watch?v=vid1',
    ]);
    await db.query(
      `insert into markets(id, room_id, creator_id, source, question, resolution_rule, sources_of_truth, category, start_time, end_time, resolution_time, status, is_seed)
       values($1,$2,$3,'sim-engine','Open engine question about this stream?','rule',ARRAY['src'],'News',$4,$5,$6,'open',false)`,
      [mId, roomId, ENGINE_USER.id, new Date(T0 - 60000).toISOString(), new Date(FAR).toISOString(), new Date(FAR + 300000).toISOString()],
    );
    let { json } = await fetchJson('/api/rooms');
    assert.ok(json.some((r) => r.id === roomId), 'open engine room is listed');
    await db.query(`update markets set status='closed' where id=$1`, [mId]);
    ({ json } = await fetchJson('/api/rooms'));
    assert.ok(!json.some((r) => r.id === roomId), 'closed engine batch is hidden from the list (rows kept in DB)');
    const { rows } = await db.query(`select 1 from rooms where id=$1`, [roomId]);
    assert.equal(rows.length, 1, 'the room row is NOT deleted (ledger safety)');
  });

  it('drops a returned market whose liveItemId is NOT in the snapshot (never untethered)', async () => {
    const { db } = await makeApp();
    const g = fakeGemini({ markets: [{ liveItemId: 'yt-does-not-exist', question: 'Will a phantom stream do a thing?' }] });
    const res = await newEngine(db, g, fakeAggregator([liveItem()])).tick();
    assert.equal(res.created, 0);
    assert.equal(res.generated, 0);
  });

  it('GEMINI ERROR: keeps the last batch and NEVER wipes existing markets', async () => {
    const { db } = await makeApp();
    const ok = fakeGemini({ markets: [{ liveItemId: 'yt-vid1', question: 'First good engine question here?' }] });
    await newEngine(db, ok, fakeAggregator([liveItem()])).tick();
    const before = await db.query(`select count(*)::int c from markets where source='sim-engine'`);
    const bad = fakeGemini(null, { throws: new GeminiError('HTTP_ERROR', 'boom', { status: 500 }) });
    const res = await newEngine(db, bad, fakeAggregator([liveItem()])).tick();
    assert.equal(res.skipped, 'gemini-error');
    const after = await db.query(`select count(*)::int c from markets where source='sim-engine'`);
    assert.equal(after.rows[0].c, before.rows[0].c, 'existing markets untouched on a gemini failure');
  });

  it('force:true bypasses the open-gate (still respects dedup + budget)', async () => {
    const { db } = await makeApp();
    for (let i = 0; i < ENGINE_DEFAULTS.maxOpenEngineMarkets; i += 1) await seedMarket(db, { question: `Open engine filler ${i}?` });
    const g = fakeGemini({ markets: [{ liveItemId: 'yt-vid1', question: 'A brand-new forced engine question?' }] });
    const res = await newEngine(db, g, fakeAggregator([liveItem()])).tick({ force: true });
    assert.equal(res.created, 1);
    assert.equal(g.calls, 1);
  });

  it('status() reports running/lastBatch/budget counters', async () => {
    const { db } = await makeApp();
    const g = fakeGemini({ markets: [{ liveItemId: 'yt-vid1', question: 'A status-reportable question?' }] });
    const e = newEngine(db, g, fakeAggregator([liveItem()]));
    await e.tick();
    const s = e.status();
    assert.equal(s.budgetCalls, 1);
    assert.equal(s.totalCalls, 1);
    assert.equal(s.totalCreated, 1);
    assert.equal(s.lastBatch.created, 1);
  });

  it('start()/stop() schedules an unref\'d 30-min interval and stops it', async () => {
    const { db } = await makeApp();
    let scheduled = null;
    let cleared = false;
    const e = createMarketEngine({
      db,
      gemini: fakeGemini({ markets: [] }, { enabled: false }), // disabled → immediate tick skips, no db churn
      aggregator: fakeAggregator([]),
      env: {},
      now,
      warn: () => {},
      setIntervalImpl: (fn, ms) => { scheduled = { fn, ms }; return { unref() {} }; },
      clearIntervalImpl: () => { cleared = true; },
    });
    e.start();
    assert.ok(scheduled, 'start() must schedule a rotation');
    assert.equal(scheduled.ms, ENGINE_DEFAULTS.rotationMs);
    e.stop();
    assert.equal(cleared, true);
  });
});

// Polls a condition with REAL timers while the engine itself runs on fakes.
function waitFor(pred, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const step = () => {
      if (pred()) return resolve();
      if (Date.now() - t0 > timeoutMs) return reject(new Error('waitFor: condition never met'));
      setTimeout(step, 5);
    };
    step();
  });
}

describe('marketEngine/retry ladder (a failed boot tick must NOT wait the 30-min rotation)', () => {
  before(setupTestEnv);
  beforeEach(resetDb);
  after(teardownTestEnv);

  it('gemini-error → retries at retryMs, then 3×retryMs; stop() clears the pending retry', async () => {
    const { db } = await makeApp();
    const timers = [];
    const cleared = [];
    const g = fakeGemini(null, { throws: new GeminiError('RATE_LIMIT', 'rate limited (429)', { status: 429 }) });
    const e = createMarketEngine({
      db,
      gemini: g,
      aggregator: fakeAggregator([liveItem()]),
      env: {},
      now,
      warn: () => {},
      defaults: { retryMs: 1000, rotationMs: 60000 },
      setIntervalImpl: () => ({ unref() {} }),
      clearIntervalImpl: () => {},
      setTimeoutImpl: (cb, ms) => {
        const t = { cb, ms };
        timers.push(t);
        return t;
      },
      clearTimeoutImpl: (t) => cleared.push(t),
    });
    e.start(); // immediate kick → tick fails on Gemini → scheduleRetry
    await waitFor(() => timers.length >= 1);
    assert.equal(timers[0].ms, 1000, 'first retry waits ONE retryMs, not the 30-min rotation');
    assert.equal(e.status().retryAttempt, 1);
    timers[0].cb(); // fire retry #1 → fails again → ladder step 3×
    await waitFor(() => timers.length >= 2);
    assert.equal(timers[1].ms, 3000, 'backoff grows 3× per attempt');
    assert.equal(g.calls, 2, 'the retry actually re-ran generation (budget guarded it)');
    e.stop();
    assert.deepEqual(cleared, [timers[1]], 'stop() clears the pending retry timer');
  });

  it('a successful retry resets the ladder (no further timers scheduled)', async () => {
    const { db } = await makeApp();
    const timers = [];
    let items = [];
    const aggregator = {
      getChannels: async () => ({ items, generatedAt: T0 }),
    };
    const g = fakeGemini({ markets: [{ liveItemId: 'yt-vid1', question: 'A question that finally lands?' }] });
    const e = createMarketEngine({
      db,
      gemini: g,
      aggregator,
      env: {},
      now,
      warn: () => {},
      defaults: { retryMs: 1000, rotationMs: 60000 },
      setIntervalImpl: () => ({ unref() {} }),
      clearIntervalImpl: () => {},
      setTimeoutImpl: (cb, ms) => {
        const t = { cb, ms };
        timers.push(t);
        return t;
      },
      clearTimeoutImpl: () => {},
    });
    e.start(); // snapshot empty → skipped:'no-live' → retry scheduled
    await waitFor(() => timers.length >= 1);
    assert.equal(e.status().retryAttempt, 1);
    items = [liveItem()]; // the live stream shows up before the retry fires
    timers[0].cb();
    await waitFor(() => g.calls >= 1);
    assert.equal(e.status().retryAttempt, 0, 'success resets the backoff ladder');
    assert.equal(timers.length, 1, 'no further retry scheduled after success');
    const { rows } = await db.query(`select question from markets where source='sim-engine'`);
    assert.equal(rows.length, 1, 'the retry produced a real market');
    e.stop();
  });
});

// P1 (Oct 2026): a bet must be about a broadcast that is LIVE RIGHT NOW. Every tick
// re-proves each OPEN sim-engine market's OWN source and closes the ones PROVABLY
// over — running AHEAD of the generation gates so a dead bet is retired even when the
// LLM is disabled. Conservative: an UNKNOWN liveness keeps the bet (never over-closes).
describe('marketEngine — P1 liveness prune (retire bets on ended broadcasts)', () => {
  before(setupTestEnv);
  beforeEach(resetDb);
  after(teardownTestEnv);

  function engineWith(db, { youtube, kick }) {
    return createMarketEngine({
      db,
      // DISABLED gemini proves the prune runs independent of generation.
      gemini: fakeGemini({ markets: [] }, { enabled: false }),
      aggregator: fakeAggregator(),
      youtube,
      kick,
      env: {},
      now,
      warn: () => {},
    });
  }

  async function statusOf(db, id) {
    const { rows } = await db.query(`select status from markets where id=$1`, [id]);
    return rows[0]?.status;
  }

  it('closes an OPEN market whose YouTube video is PROVEN ended (isVideoLive=false)', async () => {
    const { db } = await makeApp();
    const id = await seedMarket(db, { question: 'Will this ended stream still be running in ten minutes?', engine: { videoId: 'vid1' } });
    const youtube = { isVideoLive: async (vid) => (vid === 'vid1' ? false : null) };
    const res = await engineWith(db, { youtube }).tick();
    assert.equal(res.skipped, 'disabled', 'generation was gated off — the prune still ran');
    assert.equal(await statusOf(db, id), 'closed');
  });

  it('KEEPS the bet when liveness is UNKNOWN (isVideoLive=null) — never over-closes', async () => {
    const { db } = await makeApp();
    const id = await seedMarket(db, { question: 'Is this ambiguous stream still happening in ten minutes?', engine: { videoId: 'vid2' } });
    const youtube = { isVideoLive: async () => null };
    await engineWith(db, { youtube }).tick();
    assert.equal(await statusOf(db, id), 'open');
  });

  it('KEEPS the bet while the source is still LIVE (isVideoLive=true)', async () => {
    const { db } = await makeApp();
    const id = await seedMarket(db, { question: 'Will this live stream hold for ten more minutes?', engine: { videoId: 'vid3' } });
    const youtube = { isVideoLive: async () => true };
    await engineWith(db, { youtube }).tick();
    assert.equal(await statusOf(db, id), 'open');
  });

  it('retires a Kick-bound market when getChannelBySlug reports the stream offline', async () => {
    const { db } = await makeApp();
    const id = await seedMarket(db, { question: 'Did this Kick channel end its live broadcast?', engine: { channelSlug: 'gonechannel' } });
    const kick = { getChannelBySlug: async () => ({ slug: 'gonechannel', isLive: false }) };
    await engineWith(db, { kick }).tick();
    assert.equal(await statusOf(db, id), 'closed');
  });

  it('no kick/youtube wired → OPEN markets are left untouched (fail-safe, no crash)', async () => {
    const { db } = await makeApp();
    const id = await seedMarket(db, { question: 'Does this bet survive a client-less rotation tick?', engine: { videoId: 'vid4' } });
    await engineWith(db, {}).tick();
    assert.equal(await statusOf(db, id), 'open');
  });
});

// Gemini now supplies each market's OPENING LINE (prior_yes). The engine must honor it
// into the prior_yes column AND the shown yes/no price, degrade a missing value to the
// historical flat 0.5, and clamp anything out of the prior_yes CHECK range.
describe('marketEngine — Gemini opening line (prior_yes)', () => {
  before(setupTestEnv);
  beforeEach(resetDb);
  after(teardownTestEnv);

  async function pricesOf(db, question) {
    const { rows } = await db.query(`select prior_yes, yes_price, no_price from markets where question=$1`, [question]);
    return rows[0];
  }

  it('honors a Gemini openingProbability into prior_yes + yes/no price', async () => {
    const { db } = await makeApp();
    const q = 'Will Al Jazeera lead with the summit in the next half hour?';
    const g = fakeGemini({ markets: [{ liveItemId: 'yt-vid1', question: q, openingProbability: 0.72 }] });
    const res = await newEngine(db, g, fakeAggregator([liveItem()])).tick();
    assert.equal(res.created, 1);
    const m = await pricesOf(db, q);
    assert.equal(Number(m.prior_yes), 0.72);
    assert.equal(Number(m.yes_price), 0.72);
    assert.ok(Math.abs(Number(m.no_price) - 0.28) < 1e-6, 'no_price = 1 - prior');
  });

  it('a missing openingProbability degrades to the flat 0.5 open (no regression)', async () => {
    const { db } = await makeApp();
    const q = 'Will this broadcast still be up in ten minutes?';
    const g = fakeGemini({ markets: [{ liveItemId: 'yt-vid1', question: q }] });
    await newEngine(db, g, fakeAggregator([liveItem()])).tick();
    const m = await pricesOf(db, q);
    assert.equal(Number(m.prior_yes), 0.5);
    assert.equal(Number(m.yes_price), 0.5);
    assert.equal(Number(m.no_price), 0.5);
  });

  it('clamps an out-of-range openingProbability into [0.05,0.95]', async () => {
    const { db } = await makeApp();
    const hiQ = 'An absurdly high opening line from the model?';
    const loQ = 'An absurdly low opening line from the model?';
    const g = fakeGemini({ markets: [
      { liveItemId: 'yt-vid1', question: hiQ, openingProbability: 5 },
      { liveItemId: 'yt-vid2', question: loQ, openingProbability: -3 },
    ] });
    const res = await newEngine(db, g, fakeAggregator([liveItem(), liveItem({ id: 'yt-vid2', videoUrl: 'https://www.youtube.com/watch?v=vid2', thumbnailUrl: 'https://i.ytimg.com/vi/vid2/hqdefault.jpg', title: 'Second Live Stream', channelName: 'Second Channel', owner: 'Second Channel' })])).tick();
    assert.equal(res.created, 2);
    const hi = await pricesOf(db, hiQ);
    const lo = await pricesOf(db, loQ);
    assert.equal(Number(hi.prior_yes), 0.95);
    assert.equal(Number(lo.prior_yes), 0.05);
  });
});

