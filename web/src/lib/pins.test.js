import { describe, it, expect } from 'vitest';
import { MAX_PINS, pinBodyFromCard, pinToCard, mergePinnedFirst } from './pins.js';

// ---------------------------------------------------------------------------
// "Pin a live stream I'm watching/plating with them → it leads Live now,
// max 4." The ordering/merge rules live in lib/pins.js (pure); the server
// enforces the cap authoritatively (see server/test/pins.test.js).
// ---------------------------------------------------------------------------

const card = (id, over = {}) => ({ id, source: 'youtube', title: `Stream ${id}`, viewerCount: 10, ...over });
const pin = (id, over = {}) => ({ stream_id: id, source: 'youtube', title: `Pinned ${id}`, payload: card(id, over), created_at: 'x', ...over });

describe('pinBodyFromCard', () => {
  it('maps a card to the POST body and refuses id-less cards', () => {
    const body = pinBodyFromCard(card('youtube:v1'));
    expect(body.streamId).toBe('youtube:v1');
    expect(body.source).toBe('youtube');
    expect(body.payload.title).toBe('Stream youtube:v1');
    expect(pinBodyFromCard({ title: 'no id' })).toBeNull();
    expect(pinBodyFromCard(null)).toBeNull();
  });
});

describe('mergePinnedFirst', () => {
  it('pinned cards lead in pin order; the rest keep their exact order', () => {
    const cards = [card('a'), card('b'), card('c')];
    const out = mergePinnedFirst(cards, [pin('c'), pin('a')]);
    expect(out.map((x) => x.id)).toEqual(['c', 'a', 'b']);
  });

  it('a pinned card still in the grid uses the FRESH card (live counts win)', () => {
    const fresh = card('a', { viewerCount: 999 });
    const stalePin = { stream_id: 'a', source: 'youtube', title: 'a', payload: card('a', { viewerCount: 1 }) };
    const out = mergePinnedFirst([card('z'), fresh], [stalePin]);
    expect(out[0]).toBe(fresh);
    expect(out[0].viewerCount).toBe(999);
  });

  it('a pin no longer in the grid renders from its snapshot — never dropped, never duplicated', () => {
    const out = mergePinnedFirst([card('z')], [pin('gone')]);
    expect(out.map((x) => x.id)).toEqual(['gone', 'z']);
    expect(out[0].title).toBe('Pinned gone'); // authoritative pin title wins over the snapshot
    expect(out[0].viewerCount).toBe(10); // remaining fields come from the payload snapshot
  });

  it('honours the MAX_PINS cap client-side too (server is still authoritative)', () => {
    const pins = ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => pin(id));
    const out = mergePinnedFirst([], pins);
    expect(out).toHaveLength(MAX_PINS);
  });

  it('empty pins → grid unchanged; empty everything → []', () => {
    const cards = [card('a'), card('b')];
    expect(mergePinnedFirst(cards, [])).toEqual(cards);
    expect(mergePinnedFirst([], [])).toEqual([]);
  });
});

describe('pinToCard', () => {
  it('backfills authoritative id/source/title over the snapshot', () => {
    const c = pinToCard({ stream_id: 's', source: 'twitch', title: 'Authoritative', payload: { id: 'old', source: 'x', title: 'old' } });
    expect(c.id).toBe('s');
    expect(c.source).toBe('twitch');
    expect(c.title).toBe('Authoritative');
  });
});
