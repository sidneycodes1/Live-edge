import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadEnv } from '../src/config/env.js';
import { configRouter } from '../src/routes/config.js';
import express from 'express';

const BASE = {
  NODE_ENV: 'development',
  JWT_SECRET: 'dev-only-secret-change-me-dev-only-secret',
};

function withLive(extra) {
  return loadEnv({ ...BASE, ...extra });
}

describe('env.loadEnv — per-source live enablement (§7: derived from creds only)', () => {
  it('disables every source when no creds are present (no crash)', () => {
    const env = withLive({});
    assert.deepEqual(env.liveSources, { twitch: false, kick: false, youtube: false, floor: false });
  });

  it('enables a source iff its creds/config exist', () => {
    const env = withLive({
      TWITCH_CLIENT_ID: 'a',
      TWITCH_CLIENT_SECRET: 'b',
      KICK_CLIENT_ID: 'c',
      KICK_CLIENT_SECRET: 'd',
      YOUTUBE_API_KEY: 'e',
      FLOOR_FALLBACK_URL: 'https://cdn/floor.m3u8',
    });
    assert.deepEqual(env.liveSources, { twitch: true, kick: true, youtube: true, floor: true });
  });

  it('twitch needs BOTH id and secret; a lone cred leaves it disabled', () => {
    const env = withLive({ TWITCH_CLIENT_ID: 'a' });
    assert.equal(env.liveSources.twitch, false);
  });

  it('kick needs BOTH id and secret; a lone cred leaves it disabled', () => {
    const env = withLive({ KICK_CLIENT_ID: 'c' });
    assert.equal(env.liveSources.kick, false);
  });

  it('floor can be enabled by a Livepeer discovery key alone (no fallback url)', () => {
    const env = withLive({ LIVEPEER_API_KEY: 'lp' });
    assert.equal(env.liveSources.floor, true);
  });

  it('floor can be enabled by the guaranteed fallback url alone (no key)', () => {
    const env = withLive({ FLOOR_FALLBACK_URL: 'https://cdn/floor.m3u8' });
    assert.equal(env.liveSources.floor, true);
  });

  it('warns (non-fatally) when a source is under-configured so the grid stays honest', () => {
    const env = withLive({});
    assert.ok(env.warnings.some((w) => /Kick contributes no live channels/i.test(w)));
    assert.ok(env.warnings.some((w) => /YouTube contributes no live channels/i.test(w)));
    assert.ok(env.warnings.some((w) => /never-empty floor cannot guarantee/i.test(w)));
  });

  it('exposes the cosmetic floor fallback fields (and never a fabricated thumbnail)', () => {
    const env = withLive({
      FLOOR_FALLBACK_URL: 'https://cdn/f.m3u8',
      FLOOR_FALLBACK_TITLE: 'Always Live',
      FLOOR_FALLBACK_CATEGORY: '24/7',
    });
    assert.equal(env.floorFallback.url, 'https://cdn/f.m3u8');
    assert.equal(env.floorFallback.title, 'Always Live');
    assert.equal(env.floorFallback.category, '24/7');
    // §1/§4: thumbnailUrl stays empty — we never fabricate a preview URL.
    assert.equal(env.floorFallback.thumbnailUrl, '');
  });

  it('defaults FLOOR_PROVIDER + LIVE_CACHE_TTL_MS per §7', () => {
    const env = withLive({});
    assert.equal(env.FLOOR_PROVIDER, 'livepeer');
    assert.equal(env.LIVE_CACHE_TTL_MS, 30000);
  });
});

describe('GET /api/config — per-source flags (§7 shape)', () => {
  async function getConfig(env) {
    const app = express();
    app.use('/api/config', configRouter(env));
    const server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    try {
      return await (await fetch(`http://127.0.0.1:${server.address().port}/api/config`)).json();
    } finally {
      await new Promise((r) => server.close(r));
    }
  }

  it('reports features.{twitch,kick,youtube,floor}Live from creds and never echoes a secret', async () => {
    const env = withLive({ YOUTUBE_API_KEY: 'super-secret-key' });
    const json = await getConfig(env);
    assert.deepEqual(json.features.twitchLive, false);
    assert.equal(json.features.kickLive, false);
    assert.equal(json.features.youtubeLive, true);
    assert.equal(json.features.floorLive, false);
    // §7 per-source blocks.
    assert.deepEqual(json.youtube, { enabled: true });
    assert.equal(json.floor.enabled, false);
    assert.equal(json.floor.hlsBase, 'https://stream.livepeer.com');
    // Back-compat twitch block survives.
    assert.equal(typeof json.twitch.enabled, 'boolean');
    // No secret anywhere.
    const raw = JSON.stringify(json);
    assert.ok(!raw.includes('super-secret-key'), 'config must never echo the API key');
  });
});
