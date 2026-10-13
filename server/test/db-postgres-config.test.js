import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePgSsl, pgConnectTimeoutMs, pgBootAttempts, pgRetryDelayMs } from '../src/db/index.js';

// A Neon URI copied WITHOUT its query string is the failure this guards: the pg
// driver then negotiates no TLS at all, and a production boot dies on the very
// first `select 1` probe.
const NEON = 'postgresql://neondb_owner:pw@ep-cool-darkness-123-pooler.us-east-2.aws.neon.tech/neondb';

test('resolvePgSsl infers verified TLS for managed hosts but never for a local database', () => {
  assert.equal(resolvePgSsl(NEON), true);
  assert.equal(resolvePgSsl('postgresql://u:p@host.supabase.co/db'), true);
  // An explicit sslmode belongs to the URL: pg-connection-string parses it and
  // overrides whatever we pass, so we must not fight it (sslmode=disable stays off).
  assert.equal(resolvePgSsl(`${NEON}?sslmode=require`), undefined);
  assert.equal(resolvePgSsl(`${NEON}?sslmode=disable`), undefined);
  assert.equal(resolvePgSsl(`${NEON}?sslmode=no-verify`), undefined);
  assert.equal(resolvePgSsl('postgresql://u:p@localhost:5432/db'), undefined);
  assert.equal(resolvePgSsl('postgres://u:p@db:5432/liveedge'), undefined);
  assert.equal(resolvePgSsl('not a url at all'), undefined);
});

test('a suspended Neon compute gets boot patience instead of a 2.5s timeout', () => {
  assert.equal(pgConnectTimeoutMs({ NODE_ENV: 'production' }), 10000);
  assert.equal(pgConnectTimeoutMs({ NODE_ENV: 'development' }), 2500);
  assert.equal(pgBootAttempts({ NODE_ENV: 'production' }), 3);
  assert.equal(pgBootAttempts({ NODE_ENV: 'development' }), 1);
  assert.deepEqual([1, 2, 3, 9].map(pgRetryDelayMs), [500, 1000, 1500, 2000]);
});

test('operator overrides win, and garbage degrades to the default instead of crashing boot', () => {
  assert.equal(pgConnectTimeoutMs({ NODE_ENV: 'production', PG_CONNECT_TIMEOUT_MS: '15000' }), 15000);
  assert.equal(pgBootAttempts({ NODE_ENV: 'production', PG_CONNECT_ATTEMPTS: '5' }), 5);
  assert.equal(pgBootAttempts({ NODE_ENV: 'production', PG_CONNECT_ATTEMPTS: '99' }), 5); // clamped
  assert.equal(pgConnectTimeoutMs({ NODE_ENV: 'production', PG_CONNECT_TIMEOUT_MS: 'soon' }), 10000);
  assert.equal(pgBootAttempts({ NODE_ENV: 'production', PG_CONNECT_ATTEMPTS: 'soon' }), 3);
  assert.equal(pgBootAttempts({ NODE_ENV: 'production', PG_CONNECT_ATTEMPTS: '0' }), 3);
});
