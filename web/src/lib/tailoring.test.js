import { describe, it, expect } from 'vitest';
import { tailorByInterests, matchesInterest, sanitizeInterests, INTEREST_VALUES } from './tailoring.js';

// Pure re-rank tests (no jsdom). Cards are REAL-shaped fixtures: the fields
// matchesInterest reads (source/category) are exactly what lib/live.js
// normalizes from server responses.
const card = (id, over = {}) => ({ id, title: `card ${id}`, source: 'youtube', category: '', thumbnailUrl: 'x.jpg', ...over });
const ids = (list) => list.map((c) => c.id);

describe('sanitizeInterests', () => {
  it('keeps only the frozen vocabulary, unique', () => {
    expect(sanitizeInterests(['sports', 'sports', 'crypto', null])).toEqual(['sports']);
    expect(sanitizeInterests(undefined)).toEqual([]);
    expect(INTEREST_VALUES).toEqual(['trading', 'sports', 'streams']);
  });
});

describe('matchesInterest (REAL fields only — category/source)', () => {
  it('trading matches News-bucketed cards only', () => {
    expect(matchesInterest(card('n', { source: 'curated-youtube', category: 'News' }), 'trading')).toBe(true);
    expect(matchesInterest(card('m', { category: 'Politics' }), 'trading')).toBe(false);
  });
  it('sports matches Football + Sports buckets', () => {
    expect(matchesInterest(card('f', { source: 'football-api', category: 'Football' }), 'sports')).toBe(true);
    expect(matchesInterest(card('s', { source: 'twitch', category: 'NFL' }), 'sports')).toBe(true);
    expect(matchesInterest(card('g', { source: 'twitch', category: 'Gaming' }), 'sports')).toBe(false);
  });
  it('streams matches real broadcast rows, never bare data rows', () => {
    expect(matchesInterest(card('y', { source: 'youtube' }), 'streams')).toBe(true);
    expect(matchesInterest(card('f', { source: 'football-api' }), 'streams')).toBe(false);
    expect(matchesInterest(card('x', { source: '' }), 'streams')).toBe(false);
  });
  it('null/garbage cards match nothing (never throws, never fabricates)', () => {
    expect(matchesInterest(null, 'sports')).toBe(false);
    expect(matchesInterest('nope', 'sports')).toBe(false);
    expect(matchesInterest(card('a'), 'unknown-interest')).toBe(false);
  });
});

describe('tailorByInterests', () => {
  const grid = [
    card('music', { source: 'curated-youtube', category: 'Music' }),
    card('news1', { source: 'curated-youtube', category: 'News' }),
    card('game', { source: 'twitch', category: 'Gaming' }),
    card('football', { source: 'football-api', category: 'Football' }),
  ];

  it('EMPTY interests preserve the current order exactly', () => {
    expect(ids(tailorByInterests(grid, []))).toEqual(ids(grid));
    expect(ids(tailorByInterests(grid, undefined))).toEqual(ids(grid));
    expect(ids(tailorByInterests(grid, ['crypto']))).toEqual(ids(grid)); // all-invalid = empty
  });

  it('matched REAL cards float up (stable), the rest keeps its order', () => {
    expect(ids(tailorByInterests(grid, ['sports']))).toEqual(['football', 'music', 'news1', 'game']);
    expect(ids(tailorByInterests(grid, ['trading']))).toEqual(['news1', 'music', 'game', 'football']);
    // union of interests: matched-by-either keeps original relative order
    expect(ids(tailorByInterests(grid, ['trading', 'sports']))).toEqual(['news1', 'football', 'music', 'game']);
  });

  it('PINS ALWAYS LEAD: the pinned prefix (leadCount) is never re-ranked', () => {
    const pinnedFirst = [card('pin1', { category: 'Music' }), card('pin2', { category: 'Ambience' }), ...grid];
    const out = tailorByInterests(pinnedFirst, ['sports'], { leadCount: 2 });
    expect(ids(out).slice(0, 2)).toEqual(['pin1', 'pin2']);
    expect(out[2].id).toBe('football'); // first matched AFTER the pins
  });

  it('NO duplication and NO fabrication: output is a permutation of the input', () => {
    const out = tailorByInterests(grid, ['streams']);
    expect(out.length).toBe(grid.length);
    expect(new Set(ids(out)).size).toBe(grid.length);
    // every output entry is the SAME object reference from the input (nothing invented)
    for (const c of out) expect(grid).toContain(c);
  });

  it('garbage inputs return a safe copy without throwing', () => {
    expect(tailorByInterests(undefined, ['sports'])).toEqual([]);
    expect(tailorByInterests([null, undefined], ['sports']).length).toBe(2); // passed through untouched, never dropped
  });

  it('leadCount larger than the list cannot invent a prefix', () => {
    const out = tailorByInterests(grid, ['sports'], { leadCount: 99 });
    expect(ids(out)).toEqual(ids(grid));
  });
});
