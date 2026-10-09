import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bucketForCategory, makeLiveChannel, LIVE_BUCKETS, isEnglishStream } from '../src/aggregator/schema.js';
import { normalizeKickStream } from '../src/kick/client.js';

// ---------------------------------------------------------------------------
// Agent B: deterministic Kick category -> bucket map (BUILD_CONTRACT sec 3).
// First match wins in the order news -> games -> sports -> irl -> other. Pure
// function, no network. Category stays source-native; only `bucket` is derived.
// ---------------------------------------------------------------------------
describe('bucketForCategory - deterministic keyword table (sec 3)', () => {
  const cases = [
    ['Newsroom', 'news'],
    ['Breaking News', 'news'],
    ['Politics', 'news'],
    ['Sporting News', 'news'],
    ['Journalism', 'news'],
    ['Gaming', 'games'],
    ['VALORANT', 'games'],
    ['Counter-Strike 2', 'games'],
    ['Rocket League', 'games'],
    ['Football', 'sports'],
    ['Soccer', 'sports'],
    ['NBA', 'sports'],
    ['UFC', 'sports'],
    ['Just Chatting', 'irl'],
    ['IRL', 'irl'],
    ['Music', 'irl'],
    ['Travel & Outdoors', 'irl'],
    ['Puzzles', 'other'],
    ['', 'other'],
    [null, 'other'],
    [undefined, 'other'],
  ];
  for (const [category, bucket] of cases) {
    it(`maps ${JSON.stringify(category)} -> ${bucket}`, () => {
      assert.equal(bucketForCategory(category), bucket);
    });
  }

  it('every bucket is inside the closed LIVE_BUCKETS set (no invented bucket)', () => {
    for (const [category] of cases) {
      assert.ok(LIVE_BUCKETS.includes(bucketForCategory(category)));
    }
  });

  it('is case-insensitive (compares on the lowercased category)', () => {
    assert.equal(bucketForCategory('FOOTBALL'), 'sports');
    assert.equal(bucketForCategory('Valorant'), 'games');
  });

  it('news wins before sports for the overlapping "Sporting News" label (first match)', () => {
    assert.equal(bucketForCategory('Sporting News'), 'news');
  });
});

describe('makeLiveChannel - bucket field (sec 2a)', () => {
  it("defaults bucket to 'other' when a source omits it (youtube/floor)", () => {
    const c = makeLiveChannel({ source: 'youtube', nativeId: 'v1', category: 'Music' });
    assert.equal(c.bucket, 'other');
  });
  it("clamps an unknown bucket to 'other' (honesty: never pass an invented bucket)", () => {
    const c = makeLiveChannel({ source: 'kick', nativeId: 'k1', bucket: 'politics' });
    assert.equal(c.bucket, 'other');
  });
  it('passes a valid bucket through', () => {
    const c = makeLiveChannel({ source: 'kick', nativeId: 'k1', bucket: 'games' });
    assert.equal(c.bucket, 'games');
  });
});

describe('normalizeKickStream - Kick rows carry a derived bucket, category unchanged', () => {
  it('sets bucket from the Kick category name and keeps category source-native', () => {
    const c = normalizeKickStream({ broadcaster_user_id: 'b1', slug: 'xqc', stream_title: 't', viewer_count: 10, category: { id: 'c1', name: 'Just Chatting' } });
    assert.equal(c.bucket, 'irl');
    assert.equal(c.category, 'Just Chatting', 'category is source-native, never rewritten to the bucket');
  });
  it('a gaming category maps to games', () => {
    const c = normalizeKickStream({ broadcaster_user_id: 'b2', slug: 's', category: { name: 'VALORANT' } });
    assert.equal(c.bucket, 'games');
  });
  it('a missing category stays source-native empty and buckets to other', () => {
    const c = normalizeKickStream({ broadcaster_user_id: 'b3', slug: 's' });
    assert.equal(c.category, '');
    assert.equal(c.bucket, 'other');
  });
});

// English-only filter (Phase 2, Oct 2026): drop provably-non-English Kick rows,
// keep untagged rows (YouTube/curated/floor carry no language) — never invent a
// field, never silently drop a real stream we cannot prove is non-English.
describe('isEnglishStream — honest English-only rule', () => {
  it('keeps English variants, drops provably-other languages', () => {
    assert.equal(isEnglishStream({ language: 'en' }), true);
    assert.equal(isEnglishStream({ language: 'en-GB' }), true);
    assert.equal(isEnglishStream({ language: 'EN' }), true);
    assert.equal(isEnglishStream({ language: 'pt' }), false);
    assert.equal(isEnglishStream({ language: 'es' }), false);
    assert.equal(isEnglishStream({ language: 'de-DE' }), false);
  });
  it('untagged rows pass (we only remove what we can PROVE non-English)', () => {
    assert.equal(isEnglishStream({ language: null }), true);
    assert.equal(isEnglishStream({ language: '' }), true);
    assert.equal(isEnglishStream({}), true);
    assert.equal(isEnglishStream(null), true);
  });
  it('a normalized Kick row respects its language tag', () => {
    assert.equal(isEnglishStream(normalizeKickStream({ broadcaster_user_id: 'x', slug: 's', language: 'pt' })), false);
    assert.equal(isEnglishStream(normalizeKickStream({ broadcaster_user_id: 'y', slug: 's', language: 'en' })), true);
  });
});