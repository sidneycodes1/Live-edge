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

describe('env.loadEnv — per-source live enablement', () => {
  it('flags every source off when creds are absent (no crash)', () => {
    const env = withLive({});
    assert.deepEqual(env.liveSources, { twitch: false, kick: false, youtube: false, floor: false });
  });

  it('enables a source only when BOTH its flag is true AND creds exist', () => {
    const env = withLive({
      TWITCH_CLIENT_ID: 'a',
      TWITCH_CLIENT_SECRET: 'b',
      KICK_CLIENT_ID: 'c',
      KICK_CLIENT_SECRET: 'd',
      YOUTUBE_API_KEY: 'e',
      FLOOR_LIVEPEER_URL: 'https://cdn/floor.m3u8',
    });
    assert.deepEqual(env.liveSources, { twitch: true, kick: true, youtube: true, floor: true });
  });

  it('the kill-switch flag turns a credentialed source OFF', () => {
    const env = withLive({
      LIVE_KICK_ENABLED: 'false',
      KICK_CLIENT_ID: 'c',
      KICK_CLIENT_SECRET: 'd',
    });
    assert.equal(env.liveSources.kick, false, 'flag=false overrides present creds');
  });

  it('strict booleans: an invalid flag value is rejected (no loose truthiness)', () => {
    assert.throws(() => withLive({ LIVE_KICK_ENABLED: 'yes' }));
  });

  it('floor can be enabled by a Livepeer discovery key alone (no fallback url)', () => {
    const env = withLive({ LIVEPEER_API_KEY: 'lp' });
    assert.equal(env.liveSources.floor, true);
  });

  it('warns (non-fatally) when a source is flagged on but under-configured', () => {
    const env = withLive({});
    assert.ok(env.warnings.some((w) => /Kick contributes no live channels/i.test(w)));
    assert.ok(env.warnings.some((w) => /YouTube contributes no live channels/i.test(w)));
    assert.ok(env.warnings.some((w) => /never-empty floor cannot guarantee/i.test(w)));
  });

  it('exposes the cosmetic floor fallback fields for the aggregator', () => {
    const env = withLive({ FLOOR_LIVEPEER_URL: 'https://cdn/f.m3u8', FLOOR_TITLE: 'Always Live', FLOOR_CATEGORY: '24/7' });
    assert.equal(env.floorFallback.url, 'https://cdn/f.m3u8');
    assert.equal(env.floorFallback.title, 'Always Live');
    assert.equal(env.floorFallback.category, '24/7');
  });
});

describe('GET /api/config — live block', () => {
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

  it('reports per-source live status + the ladder, with no secrets', async () => {
    const env = withLive({ YOUTUBE_API_KEY: 'super-secret-key' });
    const json = await getConfig(env);
    assert.deepEqual(json.live.sources, { twitch: false, kick: false, youtube: true, floor: false });
    assert.deepEqual(json.live.ladder, ['twitch', 'kick', 'youtube', 'stale', 'floor']);
    const raw = JSON.stringify(json);
    assert.ok(!raw.includes('super-secret-key'), 'config must never echo the API key');
  });
});
