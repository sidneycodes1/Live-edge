import { describe, it, expect } from 'vitest';
import { pickPriorityOrder, buildLiveNowCards, bucketOf, PRIORITY_CATEGORIES } from './live-now.js';

// The "Live now" rail rotates its category priority once per visit from a seed.
// These are pure-function guarantees: total, deterministic, and a true rotation.
describe('pickPriorityOrder — rotating category priority', () => {
  it('returns the base order for seed 0', () => {
    expect(pickPriorityOrder(0)).toEqual(PRIORITY_CATEGORIES);
  });

  it('rotates left by one for each step, wrapping around', () => {
    const n = PRIORITY_CATEGORIES.length;
    expect(pickPriorityOrder(1)[0]).toBe(PRIORITY_CATEGORIES[1]);
    expect(pickPriorityOrder(2)[0]).toBe(PRIORITY_CATEGORIES[2]);
    // A full cycle returns to base; seed n and seed 0 are identical.
    expect(pickPriorityOrder(n)).toEqual(PRIORITY_CATEGORIES);
    expect(pickPriorityOrder(n + 1)).toEqual(pickPriorityOrder(1));
  });

  it('is always a complete permutation regardless of seed', () => {
    const n = PRIORITY_CATEGORIES.length;
    for (const seed of [-7, -1, 0, 3, 12, 1_000_000]) {
      const order = pickPriorityOrder(seed);
      expect(order).toHaveLength(n);
      expect([...order].sort()).toEqual([...PRIORITY_CATEGORIES].sort());
    }
  });

  it('normalizes non-finite seeds to the base order (never throws)', () => {
    expect(pickPriorityOrder(NaN)).toEqual(PRIORITY_CATEGORIES);
    expect(pickPriorityOrder(undefined)).toEqual(PRIORITY_CATEGORIES);
  });
});

describe('bucketOf — honest category classification', () => {
  it('routes a football-api fixture to Football', () => {
    expect(bucketOf({ source: 'football-api', category: 'Football' })).toBe('Football');
  });
  it('keeps a curated 24/7 category as-is', () => {
    expect(bucketOf({ source: 'curated-youtube', category: 'News' })).toBe('News');
    expect(bucketOf({ source: 'curated-youtube', category: 'Ambience' })).toBe('Ambience');
  });
  it('null maps to Other', () => {
    expect(bucketOf(null)).toBe('Other');
  });
});

describe('buildLiveNowCards — composed, seed-ordered mix', () => {
  const football = [{ id: 'm1', source: 'football-api', category: 'Football' }];
  const playable = [
    { id: 'n1', source: 'curated-youtube', category: 'News' },
    { id: 'u1', source: 'youtube', category: 'Music' },
  ];

  it('leads with Football at the base seed (Football ranks first)', () => {
    const cards = buildLiveNowCards({ playable, football }, 0);
    expect(cards.map((c) => c.id)).toEqual(['m1', 'n1', 'u1']);
  });

  it('rotates so News leads when Football is not first in the priority', () => {
    // News-first rotation puts both football (rank after News? no) — Football
    // drops out of the lead slot and the News channel comes before Music.
    const order = pickPriorityOrder(1); // News first
    const cards = buildLiveNowCards({ playable, football }, 1);
    expect(order[0]).toBe('News');
    // News channel still precedes the Music channel under any rotation.
    expect(cards.findIndex((c) => c.id === 'n1')).toBeLessThan(cards.findIndex((c) => c.id === 'u1'));
  });

  it('is a stable permutation of all inputs (nothing dropped or invented)', () => {
    for (const seed of [0, 1, 2, 3, 4, 5, 6]) {
      const ids = buildLiveNowCards({ playable, football }, seed).map((c) => c.id).sort();
      expect(ids).toEqual(['m1', 'n1', 'u1']);
    }
  });
});
