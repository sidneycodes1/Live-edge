import { describe, it, expect, vi } from 'vitest';
import { composerMode, validateChatBody, postChat, mergeOptimistic, CHAT_MAX } from './chatComposer.js';

// ChatComposer behaviour as pure logic (no jsdom in this suite). These assert the
// two acceptance-critical paths the contract calls out for Agent A:
//   * "posts via api.chat"  -> postChat calls api.chat(roomId, trimmedBody) verbatim;
//   * "guest shows sign-in"  -> composerMode returns 'signin' for a signed-out user
//     on a real room, and never a ready/dead-button state.

describe('composerMode', () => {
  it('guest on a real room -> sign-in affordance (never a dead send)', () => {
    expect(composerMode({ user: null, roomId: 'r1' })).toBe('signin');
  });
  it('signed-in on a real room -> ready', () => {
    expect(composerMode({ user: { id: 'u1' }, roomId: 'r1' })).toBe('ready');
  });
  it('room-less watch page -> honest no-room state for everyone (section 5a)', () => {
    expect(composerMode({ user: { id: 'u1' }, roomId: undefined })).toBe('no-room');
    expect(composerMode({ user: null, roomId: '' })).toBe('no-room');
  });
});

describe('validateChatBody', () => {
  it('rejects empty / whitespace', () => {
    expect(validateChatBody('').ok).toBe(false);
    expect(validateChatBody('   ').ok).toBe(false);
  });
  it('trims a valid body', () => {
    expect(validateChatBody('  hello  ')).toEqual({ ok: true, body: 'hello' });
  });
  it('rejects over the server cap (280)', () => {
    const long = 'a'.repeat(CHAT_MAX + 1);
    expect(validateChatBody(long).ok).toBe(false);
  });
});

describe('postChat', () => {
  it('posts via api.chat(roomId, trimmedBody) and returns a feed-shaped message', async () => {
    const api = { chat: vi.fn(async (roomId, body) => ({ kind: 'chat', display_name: 'You', body })) };
    const res = await postChat({ api, roomId: 'r1', body: '  gg  ' });
    expect(api.chat).toHaveBeenCalledWith('r1', 'gg');
    expect(res.ok).toBe(true);
    expect(res.message).toEqual({ kind: 'chat', name: 'You', body: 'gg' });
  });

  it('does not call api.chat when the body is invalid', async () => {
    const api = { chat: vi.fn() };
    const res = await postChat({ api, roomId: 'r1', body: '   ' });
    expect(api.chat).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
  });

  it('falls back to the sent body when the row omits one', async () => {
    const api = { chat: vi.fn(async () => ({ display_name: 'Ana' })) };
    const res = await postChat({ api, roomId: 'r1', body: 'hi' });
    expect(res.message).toEqual({ kind: 'chat', name: 'Ana', body: 'hi' });
  });
});

describe('mergeOptimistic', () => {
  it('appends a pending post that is not yet in the feed', () => {
    const base = [{ kind: 'chat', name: 'Bo', body: 'hello' }];
    const out = mergeOptimistic(base, [{ kind: 'chat', name: 'Me', body: 'sup' }]);
    expect(out).toHaveLength(2);
    expect(out[1].body).toBe('sup');
  });
  it('drops the optimistic copy once the server echoes the same body (no duplicate)', () => {
    const pending = [{ kind: 'chat', name: 'Me', body: 'sup' }];
    const afterSse = [{ kind: 'chat', name: 'Me', body: 'sup' }];
    expect(mergeOptimistic(afterSse, pending)).toHaveLength(1);
  });
});