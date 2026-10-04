import { describe, it, expect } from 'vitest';
import { deriveChatItems } from './chat.js';

// The AI spectator feature is only honest if the 'ai' label survives BOTH feed
// paths into ChatFeed: server history rows and live SSE events. These are pure
// data-shape assertions (no DOM, no network).

describe('deriveChatItems', () => {
  it('maps history rows and keeps the persona name for ai kinds', () => {
    const msgs = [
      { kind: 'chat', body: 'hello', user: { display_name: 'Ada' } },
      { kind: 'ai', body: '73% YES on the board', user: { display_name: 'Odds-Owl' } },
    ];
    const out = deriveChatItems(msgs, []);
    expect(out[0]).toEqual({ kind: 'chat', name: 'Ada', body: 'hello' });
    expect(out[1].kind).toBe('ai');
    expect(out[1].name).toBe('Odds-Owl');
  });
  it('history rows without a user still render (name null, kind defaults chat)', () => {
    const out = deriveChatItems([{ body: 'system-ish' }], []);
    expect(out[0]).toEqual({ kind: 'chat', name: null, body: 'system-ish' });
  });
  it('keeps ai kind + name coming over SSE, not just the type', () => {
    const events = [
      { type: 'chat', data: { kind: 'ai', name: 'Spectra-7', body: 'the countdown is the main character' } },
      { type: 'chat', data: { kind: 'chat', name: 'Ada', body: 'gm' } },
    ];
    const out = deriveChatItems([], events);
    expect(out[0].kind).toBe('ai');
    expect(out[0].name).toBe('Spectra-7');
    expect(out[1].kind).toBe('chat');
  });
  it('trade events without body get the constructed line', () => {
    const out = deriveChatItems([], [{ type: 'trade', data: { name: 'Ada', side: 'YES', amount: 5 } }]);
    expect(out[0].kind).toBe('trade');
    expect(out[0].body).toBe('Ada backed YES for $5');
  });
  it('ignores non-chat SSE types', () => {
    const out = deriveChatItems([], [{ type: 'odds', data: { yesPrice: 0.5 } }]);
    expect(out).toEqual([]);
  });
});
