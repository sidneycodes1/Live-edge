import { describe, it, expect } from 'vitest';
import { buildRailEntries } from './rail.js';

// ---------------------------------------------------------------------------
// The side rail used to show "No live channels right now" while the landing
// grid was full — it only knew about Twitch + platform rooms. It now also
// lists the REAL /api/live channels. These tests lock the merge rules that
// make that safe: seeds never pollute, the same broadcast is not listed twice,
// ordering stays twitch → rooms → live, and the rail caps at 14 like before.
// ---------------------------------------------------------------------------

const twitch = [{ id: 's1', userLogin: 'pro_gg', userName: 'Pro GG', gameName: 'Just Chatting', viewerCount: 500 }];
const rooms = [
  { id: 'r1', title: '49ers vs Broncos — engine room', isSeed: false, owner: { displayName: 'Live Engine' }, viewers: 3 },
  { id: 'seed1', title: 'Sunrise Sketch & Chat', isSeed: true },
];
const live = [
  { id: 'youtube:v1', source: 'youtube', channelSlug: 'UCx', title: '49ers vs Broncos — engine room', channelName: 'Chat Sports', viewerCount: 2400 },
  { id: 'youtube:v2', source: 'youtube', channelSlug: 'UCy', title: 'Lofi live radio', channelName: 'Lofi Girl', viewerCount: 24000 },
];

describe('buildRailEntries — three sources, one honest list', () => {
  it('demo seed rooms NEVER appear in the rail', () => {
    const out = buildRailEntries({ twitch: [], rooms, live: [] });
    expect(out.map((e) => e.key)).toEqual(['r-r1']);
  });

  it('a live channel already covered by a room (same title, any case/padding) is not duplicated', () => {
    const out = buildRailEntries({ twitch: [], rooms, live });
    const names = out.map((e) => e.name);
    expect(names.filter((n) => n === '49ers vs Broncos — engine room')).toHaveLength(1);
    expect(names).toContain('Lofi live radio');
  });

  it('order is twitch → rooms → live, and entries carry the right link shape', () => {
    const out = buildRailEntries({ twitch, rooms, live });
    expect(out.map((e) => e.key)).toEqual(['t-s1', 'r-r1', 'l-youtube:v2']);
    expect(out[0].to).toBe('/twitch/pro_gg');
    expect(out[1].to).toBe('/room/r1');
    expect(out[1].real).toBe(false);
    expect(out[2].real).toBe(true);
  });

  it('live channels fall back to /watch/<source>/<slug> when no href is provided', () => {
    const out = buildRailEntries({ twitch: [], rooms: [], live });
    expect(out[1].to).toBe('/watch/youtube/UCy');
  });

  it('an injected liveHref wins over the fallback (SideRail passes liveCardHref)', () => {
    const out = buildRailEntries({ twitch: [], rooms: [], live, liveHref: (c) => `/watch/${c.source}/${c.id}` });
    expect(out[0].to).toBe('/watch/youtube/youtube:v1');
  });

  it('caps at 14 entries regardless of source sizes', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, title: `Stream ${i}`, channelName: `Ch ${i}` }));
    const out = buildRailEntries({ twitch: [], rooms: [], live: many });
    expect(out).toHaveLength(14);
  });

  it('missing display fields degrade honestly (never undefined names/NaN viewers)', () => {
    const out = buildRailEntries({ twitch: [], rooms: [], live: [{ id: 'x', source: 'kick' }] });
    expect(out[0].name).toBe('Live stream');
    expect(out[0].sub).toBe('Live');
    expect(out[0].viewers).toBe(0);
  });
});
