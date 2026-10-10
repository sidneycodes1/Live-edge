import { describe, it, expect } from 'vitest';
import {
  buildPersonalizedBets, streamKeyOf, MATCHED_TARGET, MIXED_TARGET, RAIL_TARGET,
} from './rails.js';

// s6 personalized bet rail — the selection rules proven WITHOUT a DOM:
// one bet per live stream, no repeats, 4 interest + 3 mixed, never padded
// past the real supply (honesty: fewer real bets ⇒ a shorter rail).

const room = (id, { volume = 0, category = 'gaming', channel = null, status = 'open' } = {}) => ({
  id,
  kick_channel: channel,
  category,
  heroMarket: { id: `${id}-m`, status, category, volume },
});

describe('streamKeyOf — one bet per live stream', () => {
  it('keys a Kick-bound room by its channel (case/space normalized)', () => {
    expect(streamKeyOf({ kick_channel: ' XQC ', id: 'r1' })).toBe('kick:xqc');
  });
  it('falls back to the room id when no channel is bound; nothing for neither', () => {
    expect(streamKeyOf({ kick_channel: null, id: 'r2' })).toBe('room:r2');
    expect(streamKeyOf({ kick_channel: '', id: '' })).toBe('');
  });
});

describe('buildPersonalizedBets', () => {
  it('collapses two bets on the SAME stream into one (the higher-volume bet wins)', () => {
    const rooms = [
      room('a', { channel: 'xqc', volume: 5 }),
      room('b', { channel: 'xqc', volume: 40 }), // same stream, louder
      room('c', { channel: 'kai', volume: 10 }),
    ];
    const picks = buildPersonalizedBets(rooms, []);
    const ids = picks.map((r) => r.id);
    expect(ids).not.toContain('a');
    expect(ids).toContain('b');
    expect(new Set(picks.map(streamKeyOf)).size).toBe(ids.length);
  });

  it('leads with interest-matched bets, then fills with mixed discovery', () => {
    const rooms = [
      room('s1', { category: 'NFL Football', channel: 'nfl', volume: 100 }),
      room('s2', { category: 'Basketball', channel: 'nba', volume: 90 }),
      room('g1', { category: 'gaming', channel: 'xqc', volume: 80 }),
      room('g2', { category: 'gaming', channel: 'kai', volume: 70 }),
      room('g3', { category: 'gaming', channel: 'shroud', volume: 60 }),
      room('g4', { category: 'gaming', channel: 'pokimane', volume: 50 }),
      room('g5', { category: 'gaming', channel: 'symf', volume: 40 }),
      room('g6', { category: 'gaming', channel: 'tim', volume: 30 }),
    ];
    const picks = buildPersonalizedBets(rooms, ['sports']);
    // Sports bets come first (the two interest matches), then mixed.
    expect(picks.slice(0, 2).map((r) => r.id).sort()).toEqual(['s1', 's2']);
    expect(picks.length).toBe(RAIL_TARGET); // 4 + 3 available ⇒ full rail
    expect(picks.map((r) => r.id)).toHaveLength(new Set(picks.map((r) => r.id)).size);
  });

  it('never pads: with fewer real bets than the target it returns fewer', () => {
    const rooms = [room('a', { channel: 'xqc', volume: 10 }), room('b', { channel: 'kai', volume: 5 })];
    expect(buildPersonalizedBets(rooms, []).length).toBe(2);
  });

  it('excludes closed / market-less rooms (nothing unbettable occupies a slot)', () => {
    const rooms = [
      room('open', { channel: 'xqc', volume: 10, status: 'open' }),
      room('closed', { channel: 'kai', volume: 20, status: 'closed' }),
      { id: 'nohero', kick_channel: 'shroud', category: 'gaming' },
    ];
    const ids = buildPersonalizedBets(rooms, []).map((r) => r.id);
    expect(ids).toEqual(['open']);
  });

  it('a logged-out user (no interests) gets the diverse discovery mix, one per stream', () => {
    const rooms = [
      room('a', { channel: 'xqc', category: 'gaming', volume: 100 }),
      room('b', { channel: 'kai', category: 'gaming', volume: 90 }),
      room('c', { channel: 'nfl', category: 'NFL Football', volume: 80 }),
      room('d', { channel: null, category: 'news', volume: 70 }),
    ];
    const picks = buildPersonalizedBets(rooms, []);
    expect(picks.length).toBeLessThanOrEqual(RAIL_TARGET);
    expect(picks.length).toBe(4);
    expect(new Set(picks.map(streamKeyOf)).size).toBe(4);
  });

  it('honours the "streams" interest — a bet riding a real bound channel', () => {
    const rooms = [
      room('real', { channel: 'xqc', category: 'irl', volume: 10 }),
      room('demo', { channel: null, category: 'irl', volume: 99 }),
    ];
    const picks = buildPersonalizedBets(rooms, ['streams'], { matchedTarget: 1, mixedTarget: 1 });
    expect(picks[0].id).toBe('real'); // the interest match leads despite lower volume
  });

  it('is total and safe on empty/garbage input (never throws, never fabricates)', () => {
    expect(buildPersonalizedBets([], [])).toEqual([]);
    expect(buildPersonalizedBets(null, null)).toEqual([]);
    expect(MATCHED_TARGET + MIXED_TARGET).toBe(RAIL_TARGET);
  });
});
