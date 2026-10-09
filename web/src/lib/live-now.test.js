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
  it('routes a football-labelled stream into Sports (display taxonomy)', () => {
    expect(bucketOf({ source: 'kick', category: 'Football' })).toBe('Sports');
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
  const playable = [
    { id: 'n1', source: 'curated-youtube', category: 'News' },
    { id: 's1', source: 'kick', category: 'Sports' },
    { id: 'u1', source: 'youtube', category: 'Music' },
  ];

  it('leads with News at the base seed (News ranks first)', () => {
    const cards = buildLiveNowCards({ playable }, 0);
    expect(cards.map((c) => c.id)).toEqual(['n1', 's1', 'u1']);
  });

  it('rotates so Ambience leads at the far end of the cycle', () => {
    const order = pickPriorityOrder(3); // Ambience first
    const cards = buildLiveNowCards({ playable: [...playable, { id: 'a1', source: 'youtube', category: 'Ambience' }] }, 3);
    expect(order[0]).toBe('Ambience');
    expect(cards[0].id).toBe('a1');
  });

  it('is a stable permutation of all inputs (nothing dropped or invented)', () => {
    for (const seed of [0, 1, 2, 3, 4, 5, 6]) {
      const ids = buildLiveNowCards({ playable }, seed).map((c) => c.id).sort();
      expect(ids).toEqual(['n1', 's1', 'u1']);
    }
  });
});
