import { describe, it, expect } from 'vitest';
import { extractYouTubeChannelId, buildChatEmbed, buildVideoEmbed } from './embed.js';

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

describe('buildChatEmbed', () => {
  it('Twitch → real embed chat keyed by channel + parent', () => {
    const c = buildChatEmbed({ source: 'twitch', channelSlug: 'lofigirl' }, 'example.com');
    expect(c.provider).toBe('twitch');
    expect(c.src).toBe('https://www.twitch.tv/embed/lofigirl/chat?parent=example.com');
  });

  it('YouTube with a video id → official live_chat iframe', () => {
    const c = buildChatEmbed(
      { source: 'youtube', watchUrl: 'https://www.youtube.com/watch?v=urZuCbudWz8' },
      'example.com',
    );
    expect(c.provider).toBe('youtube');
    expect(c.videoId).toBe('urZuCbudWz8');
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

  it('Kick chat is not embeddable here → null (§4)', () => {
    expect(buildChatEmbed({ source: 'kick', channelSlug: 'x' }, 'example.com')).toBeNull();
  });
});
