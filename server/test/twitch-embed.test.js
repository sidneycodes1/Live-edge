import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// The pure embed builders are shared by the React components (TwitchChat /
// TwitchVideo). Testing them here proves the exact channel/parent params the
// iframes mount with — no browser or network needed. Doc shapes cited in the lib.
import {
  chatEmbedSrc,
  playerEmbedSrc,
  buildPlayerOptions,
  normalizeLogin,
  isValidTwitchLogin,
} from '../../web/src/lib/twitch.js';

describe('twitch embed param builders (Phase C)', () => {
  it('builds the documented chat iframe src', () => {
    const src = chatEmbedSrc('LofiGirl', 'localhost');
    assert.equal(src, 'https://www.twitch.tv/embed/lofigirl/chat?parent=localhost');
  });

  it('builds the documented player params (channel + parent + muted + autoplay)', () => {
    const src = playerEmbedSrc('some_channel', 'liveedge.example.com');
    const u = new URL(src);
    assert.equal(u.origin + u.pathname, 'https://player.twitch.tv/');
    assert.equal(u.searchParams.get('channel'), 'some_channel');
    assert.equal(u.searchParams.get('parent'), 'liveedge.example.com');
    assert.equal(u.searchParams.get('muted'), 'true');
    assert.equal(u.searchParams.get('autoplay'), 'true');
  });

  it('interactive player options carry channel + parent array + muted', () => {
    const opts = buildPlayerOptions('TwitchDev', 'localhost');
    assert.equal(opts.channel, 'twitchdev');
    assert.deepEqual(opts.parent, ['localhost']);
    assert.equal(opts.muted, true);
  });

  it('normalizes logins and rejects obvious garbage', () => {
    assert.equal(normalizeLogin('  LofiGirl  '), 'lofigirl');
    assert.equal(isValidTwitchLogin('gaddem_'), true);
    assert.equal(isValidTwitchLogin('bad name/x'), false);
    assert.equal(isValidTwitchLogin(''), false);
  });

  it('returns empty srcs when channel or parent is missing (renders nothing broken)', () => {
    assert.equal(chatEmbedSrc('afro', ''), '');
    assert.equal(chatEmbedSrc('', 'localhost'), '');
    assert.equal(playerEmbedSrc('afro', null), '');
  });
});
