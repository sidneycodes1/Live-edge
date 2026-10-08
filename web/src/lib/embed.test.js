import { describe, it, expect } from 'vitest';
import { extractYouTubeChannelId, buildChatEmbed, buildVideoEmbed, detectEmbedFromUrl } from './embed.js';

// These pure helpers are the backbone of the room-identity + YouTube-chat fix
// (Tasks A/B): a YouTube room is keyed by its VIDEO id, a curated 24/7 room by its
// UC CHANNEL id, and live chat is only ever produced from a REAL video id — never a
// fabricated box (§4). All URL construction is asserted literally (no network).

describe('extractYouTubeChannelId', () => {
  it('reads the UC id from a curated liveEmbedUrl', () => {
    const ch = { liveEmbedUrl: 'https://www.youtube.com/embed/live_stream?channel=UCtbo6_eDG7zEtaOtcSltJkA' };
    expect(extractYouTubeChannelId(ch)).toBe('UCtbo6_eDG7zEtaOtcSltJkA');
  });
  it('falls back to a UC-shaped channelSlug', () => {
    expect(extractYouTubeChannelId({ channelSlug: 'UCtbo6_eDG7zEtaOtcSltJkA' })).toBe('UCtbo6_eDG7zEtaOtcSltJkA');
  });
  it('returns empty for a non-channel slug (never a guess)', () => {
    expect(extractYouTubeChannelId({ channelSlug: 'lofigirl' })).toBe('');
    expect(extractYouTubeChannelId({})).toBe('');
    expect(extractYouTubeChannelId(null)).toBe('');
  });
});

describe('buildVideoEmbed — curated 24/7 channel plays by channel id', () => {
  it('mounts the live_stream?channel embed verbatim', () => {
    const src = 'https://www.youtube.com/embed/live_stream?channel=UCtbo6_eDG7zEtaOtcSltJkA';
    const e = buildVideoEmbed({ source: 'curated-youtube', liveEmbedUrl: src }, 'example.com');
    expect(e).toMatchObject({ provider: 'youtube', verified: true, kind: 'iframe', src });
  });
});

describe('buildVideoEmbed — Kick is the primary real-stream embed', () => {
  it('mounts the official player.kick.com iframe (no parent handshake needed)', () => {
    const e = buildVideoEmbed({ source: 'kick', channelSlug: 'Amouranth', watchUrl: 'https://kick.com/amouranth' }, 'example.com');
    expect(e).toMatchObject({
      provider: 'kick',
      verified: true,
      kind: 'iframe',
      src: 'https://player.kick.com/amouranth?autoplay=true&muted=true',
    });
  });
});

describe('buildChatEmbed', () => {
  it('retired twitch rows produce NO chat embed (source removed from the grid)', () => {
    expect(buildChatEmbed({ source: 'twitch', channelSlug: 'lofigirl' }, 'example.com')).toBeNull();
  });

  it('YouTube with a video id → official live_chat iframe', () => {
    const c = buildChatEmbed(
      { source: 'youtube', watchUrl: 'https://www.youtube.com/watch?v=urZuCbudWz8' },
      'example.com',
    );
    expect(c.provider).toBe('youtube');
    expect(c.videoId).toBe('urZuCbudWz8');
    // embed_domain is YouTube's documented framing handshake (bare hosting domain).
    expect(c.src).toBe('https://www.youtube.com/live_chat?v=urZuCbudWz8&is_framed=true&embed_domain=example.com');
  });

  it('YouTube chat without a parent → no embed_domain param', () => {
    const c = buildChatEmbed({ source: 'youtube', watchUrl: 'https://www.youtube.com/watch?v=urZuCbudWz8' });
    expect(c.src).toBe('https://www.youtube.com/live_chat?v=urZuCbudWz8&is_framed=true');
  });

  it('YouTube with NO video id → null (honest, never a fake box)', () => {
    expect(buildChatEmbed({ source: 'youtube', channelSlug: 'UCtbo6_eDG7zEtaOtcSltJkA' }, 'example.com')).toBeNull();
  });

  it('Curated 24/7 channel-level embed → null (chat is not tied to one video)', () => {
    const ch = {
      source: 'curated-youtube',
      liveEmbedUrl: 'https://www.youtube.com/embed/live_stream?channel=UCtbo6_eDG7zEtaOtcSltJkA',
      videoUrl: '',
    };
    expect(buildChatEmbed(ch, 'example.com')).toBeNull();
  });

  it('Kick chat is not embeddable here → null (§4: the UI links out instead)', () => {
    expect(buildChatEmbed({ source: 'kick', channelSlug: 'x' }, 'example.com')).toBeNull();
  });
});

describe('detectEmbedFromUrl — bring-your-own-feed', () => {
  it('kick.com channel URL → official player iframe', () => {
    const e = detectEmbedFromUrl('https://kick.com/amouranth', 'example.com');
    expect(e).toMatchObject({ provider: 'kick', verified: true, kind: 'iframe', src: 'https://player.kick.com/amouranth?autoplay=true&muted=true' });
  });
  it('retired twitch.tv URL degrades to the honest external link (no embed we can stand behind)', () => {
    const e = detectEmbedFromUrl('https://www.twitch.tv/somechannel', 'example.com');
    expect(e.kind).toBe('external');
    expect(e.src).toBe('');
  });
});
