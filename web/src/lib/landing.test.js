import { describe, it, expect } from 'vitest';
import {
  groupKickByBucket, orderLandingRows, visibleItems, canExpand, isEmptySection, emptyStateLabel,
  slugHash, tileGradient, channelInitial, pickTopKickChannel, ladderLabel,
  COLLAPSED_COUNT, EXPANDED_COUNT,
} from './landing.js';
import { normalizeChannel } from './live.js';

// The bucket→section routing of the Kick-first landing (contract §4), the
// placeholder-tile gradient (deterministic, no randomness), the collapse
// slice (3 → 9), and the honest empty state — ALL as pure functions, so the
// rules hold without a DOM (hermetic, machine-agnostic).

const kick = (id, bucket, viewerCount = null, extra = {}) => ({
  id, source: 'kick', bucket, viewerCount, channelSlug: `ch-${id}`, ...extra,
});

describe('groupKickByBucket — bucket → landing section', () => {
  it('routes Kick rows into news/irl/games by their bucket', () => {
    const g = groupKickByBucket([
      kick('1', 'news'), kick('2', 'irl'), kick('3', 'games'),
      kick('4', 'news'), kick('5', 'irl'), kick('6', 'games'),
    ]);
    expect(g.news.map((c) => c.id)).toEqual(['1', '4']);
    expect(g.irl.map((c) => c.id)).toEqual(['2', '5']);
    expect(g.games.map((c) => c.id)).toEqual(['3', '6']);
    expect(g.other).toEqual([]);
  });

  it('keeps relative order (pins-first from the caller survives grouping)', () => {
    const g = groupKickByBucket([kick('p', 'games'), kick('a', 'news'), kick('q', 'games')]);
    expect(g.games.map((c) => c.id)).toEqual(['p', 'q']);
  });

  it('excludes plain YouTube/floor rows — only s4 LABELLED fallback rows may join', () => {
    const g = groupKickByBucket([
      kick('k', 'news'),
      { id: 'y', source: 'youtube', bucket: 'news' },
      { id: 'f', source: 'floor', bucket: 'irl' },
    ]);
    expect(g.news).toHaveLength(1);
    expect(g.news[0].id).toBe('k');
    expect(g.irl).toEqual([]);
  });

  it('admits s4 fallback rows (fallback:true) into their server-assigned section', () => {
    const g = groupKickByBucket([
      kick('k', 'news'),
      { id: 'y1', source: 'youtube', bucket: 'sports', fallback: true, sourceLabel: 'YouTube' },
      { id: 'y2', source: 'youtube', bucket: 'games', fallback: true, sourceLabel: 'YouTube' },
      // A fallback row without a section bucket goes nowhere (§4 clamp).
      { id: 'y3', source: 'youtube', bucket: 'other', fallback: true },
    ]);
    expect(g.sports.map((c) => c.id)).toEqual(['y1']);
    expect(g.games.map((c) => c.id)).toEqual(['y2']);
    expect(g.other).toEqual([]);
  });

  it('routes a Kick row with the sports bucket into the Sports section', () => {
    const g = groupKickByBucket([kick('b', 'sports')]);
    expect(g.sports.map((c) => c.id)).toEqual(['b']);
    expect(g.other).toEqual([]);
  });

  it('is tolerant of missing/unknown buckets (route to other, never crash)', () => {
    const g = groupKickByBucket([kick('a', undefined), kick('c', 'wat'), null]);
    expect(g.other.map((c) => c.id).sort()).toEqual(['a', 'c']);
    expect(g.news).toEqual([]);
  });
});

describe('normalizeChannel — bucket passthrough (§2a)', () => {
  it('passes a known bucket through unchanged', () => {
    for (const b of ['news', 'sports', 'irl', 'games', 'other']) {
      expect(normalizeChannel({ id: 'x', source: 'kick', bucket: b }).bucket).toBe(b);
    }
  });
  it('defaults to "other" when absent, null, or not in the enum', () => {
    expect(normalizeChannel({ id: 'x', source: 'kick' }).bucket).toBe('other');
    expect(normalizeChannel({ id: 'x', source: 'kick', bucket: null }).bucket).toBe('other');
    expect(normalizeChannel({ id: 'x', source: 'kick', bucket: 'politics' }).bucket).toBe('other');
  });
});

describe('tileGradient / slugHash — deterministic placeholder tile', () => {
  it('is a fixed, machine-agnostic value for a fixed slug', () => {
    // Frozen exact outputs: the SAME gradient must render on every visit and
    // every machine — this is what replaces the missing Kick thumbnail.
    expect(slugHash('xqc')).toBe(2911780083);
    expect(tileGradient('xqc')).toBe('linear-gradient(3deg, hsl(150 72% 42%) 0%, hsl(278 78% 22%) 100%)');
    expect(tileGradient('kai-censor')).toBe('linear-gradient(337deg, hsl(169 72% 42%) 0%, hsl(236 78% 22%) 100%)');
  });

  it('repeats exactly across calls (pure, no randomness)', () => {
    for (let i = 0; i < 8; i += 1) {
      expect(tileGradient('somechannel')).toBe(tileGradient('somechannel'));
    }
  });

  it('different slugs derive different gradients', () => {
    expect(tileGradient('alpha')).not.toBe(tileGradient('beta'));
  });

  it('an empty/missing slug still yields a stable gradient (never throws)', () => {
    const a = tileGradient('');
    expect(a).toBe(tileGradient(undefined));
    expect(a).toMatch(/^linear-gradient\(\d+deg,/);
  });
});

describe('channelInitial — real letter or nothing', () => {
  it('takes the first letter of the channel name, uppercased', () => {
    expect(channelInitial({ channelName: 'newsone' })).toBe('N');
    expect(channelInitial({ channelSlug: 'xqc' })).toBe('X');
  });
  it('empty name/slug renders NOTHING (no invented letter)', () => {
    expect(channelInitial({ channelName: '', channelSlug: '' })).toBe('');
    expect(channelInitial(null)).toBe('');
  });
});

describe('visibleItems / canExpand — collapse 3 → expand 9', () => {
  const ten = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}` }));

  it('collapses to exactly 3 cards', () => {
    expect(visibleItems(ten, false)).toHaveLength(COLLAPSED_COUNT);
    expect(visibleItems(ten, false).map((c) => c.id)).toEqual(['c0', 'c1', 'c2']);
  });

  it('expands to exactly 9 (3×3), sliced from the fetched rows only', () => {
    expect(visibleItems(ten, true)).toHaveLength(EXPANDED_COUNT);
    expect(visibleItems(ten, true).map((c) => c.id)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8']);
  });

  it('short lists are shown whole (slice never pads)', () => {
    expect(visibleItems([{ id: 'a' }], true)).toHaveLength(1);
    expect(visibleItems([], true)).toEqual([]);
  });

  it('"Show more" only exists when there is genuinely more (4+ rows)', () => {
    expect(canExpand(ten)).toBe(true);
    expect(canExpand([{ id: '1' }, { id: '2' }, { id: '3' }])).toBe(false);
  });
});

describe('empty state — honest, never backfilled', () => {
  it('isEmptySection flags an empty bucket', () => {
    expect(isEmptySection([])).toBe(true);
    expect(isEmptySection([kick('1', 'news')])).toBe(false);
  });

  it('each section has its own honest sentence (s4: after Kick AND the YouTube fallback)', () => {
    expect(emptyStateLabel('news')).toBe('No live News streams on Kick or the YouTube fallback right now.');
    expect(emptyStateLabel('irl')).toBe('No live IRL streams on Kick or the YouTube fallback right now.');
    expect(emptyStateLabel('games')).toBe('No live Games streams on Kick or the YouTube fallback right now.');
    expect(emptyStateLabel('sports')).toBe('No live Sports streams on Kick or the YouTube fallback right now.');
  });
});

describe('orderLandingRows — per-section order law (pins first, no cross-fill)', () => {
  const rows = [kick('a', 'games'), kick('b', 'games', 50), kick('c', 'games')];

  it('leads with a pin that IS in the section and keeps the rest intact', () => {
    const pins = [{ stream_id: 'b', title: 'b', source: 'kick', channel_slug: 'ch-b' }];
    const out = orderLandingRows(rows, pins, []);
    expect(out.map((c) => c.id)).toEqual(['b', 'a', 'c']);
    expect(out).toHaveLength(3);
  });

  it('NEVER injects an out-of-section pin as a snapshot (bucket cross-fill is §1 lying)', () => {
    const pins = [{ stream_id: 'zz', title: 'elsewhere', source: 'kick', channel_slug: 'ch-zz' }];
    const out = orderLandingRows(rows, pins, []);
    expect(out.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(out).toHaveLength(3);
  });

  it('tailors by interest without adding or dropping rows', () => {
    const input = [kick('n', 'games'), kick('g', 'games', 1, { category: 'VALORANT' })];
    const out = orderLandingRows(input, [], ['streams']);
    expect(out).toHaveLength(2);
    expect(new Set(out)).toEqual(new Set(input));
  });
});

describe('pickTopKickChannel — hero by REAL viewer count', () => {
  it('picks the highest viewerCount among Kick rows', () => {
    const hero = pickTopKickChannel([
      kick('a', 'irl', 100), kick('b', 'games', 4200), kick('c', 'news', 900),
    ]);
    expect(hero.id).toBe('b');
  });

  it('null viewer counts never out-rank real ones', () => {
    const hero = pickTopKickChannel([kick('a', 'irl', null), kick('b', 'games', 5)]);
    expect(hero.id).toBe('b');
  });

  it('all-null counts still yield a hero (the first row) — the UI shows no number', () => {
    const hero = pickTopKickChannel([kick('a', 'irl', null), kick('b', 'games', null)]);
    expect(hero.id).toBe('a');
    expect(hero.viewerCount).toBeNull();
  });

  it('no Kick rows (or empty list) → null hero, never a fake one', () => {
    expect(pickTopKickChannel([])).toBeNull();
    expect(pickTopKickChannel([{ id: 'y', source: 'youtube', viewerCount: 10 }])).toBeNull();
  });
});

describe('ladderLabel — stale/floor stay labeled (§1)', () => {
  it('returns an honest caption for stale/floor, nothing for live/empty', () => {
    expect(ladderLabel('stale')).toMatch(/recent snapshot/i);
    expect(ladderLabel('floor')).toMatch(/fallback floor/i);
    expect(ladderLabel('live')).toBeNull();
    expect(ladderLabel('empty')).toBeNull();
  });
});
