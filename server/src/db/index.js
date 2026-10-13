import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export async function createDb(env) {
  if (env.DATABASE_URL) {
    const attempts = pgBootAttempts(env);
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const db = await createPgDb(env);
      // F-017: a committed/placeholder DATABASE_URL (e.g. host "db") otherwise
      // crashes `node src/server.js` with ENOTFOUND and no way to boot locally.
      // Probe reachability once before committing to the pg path.
      try {
        await db.query('select 1 as ok');
        return db;
      } catch (e) {
        lastError = e;
        // Release the pool so a retry gets a fresh socket instead of a leaked one.
        await db.close().catch(() => {});
        if (attempt < attempts) await sleep(pgRetryDelayMs(attempt));
      }
    }
    // In production, a configured DB that is unreachable is a hard error — never
    // silently fall back (that would route real money/state to a throwaway store).
    if (env.NODE_ENV === 'production') throw lastError;
    console.warn(
      `DATABASE_URL unreachable (${lastError.code || lastError.message}); falling back to embedded PGlite for local dev. ` +
        'Set a reachable DB (or omit DATABASE_URL) as intended. See .env.example.',
    );
    return createPgliteDb(env);
  }
  return createPgliteDb(env);
}

// ---------------------------------------------------------------------------
// Managed Postgres (Neon) plumbing. These are exported pure functions so the
// deploy-critical decisions are testable without a network or a live database.

// Neon and Supabase refuse plaintext: with no `sslmode` in the URI the pg driver
// negotiates NO TLS (verified against pg 8.12: ssl resolves to false) and the boot
// probe dies, so a URI pasted without its query string would crash a production
// boot. Infer TLS for hosts known to require it — VERIFIED TLS, using Node's
// bundled CA store, the same guarantee `sslmode=require` already gives. An
// operator who truly needs to skip verification opts in explicitly with
// `?sslmode=no-verify`; a local or self-hosted database keeps no-TLS untouched.
const TLS_ONLY_HOSTS = /(?:\.neon\.tech|\.supabase\.co)$/i;

export function resolvePgSsl(url) {
  // An explicit sslmode always wins: pg-connection-string parses it and overrides
  // whatever we pass here (verified), so stay out of its way.
  if (/sslmode=/i.test(url)) return undefined;
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    return undefined; // not a parsable URL — change nothing
  }
  return TLS_ONLY_HOSTS.test(host) ? true : undefined;
}

// A Neon compute that has been suspended takes several seconds to wake and accept
// its first connection. 2.5s was a local-dev number; in production it turned a
// routine cold start into a crash loop.
export function pgConnectTimeoutMs(env) {
  const configured = Number(env.PG_CONNECT_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return env.NODE_ENV === 'production' ? 10000 : 2500;
}

export function pgBootAttempts(env) {
  const configured = Number(env.PG_CONNECT_ATTEMPTS);
  if (Number.isInteger(configured) && configured >= 1) return Math.min(configured, 5);
  return env.NODE_ENV === 'production' ? 3 : 1;
}

export function pgRetryDelayMs(attempt) {
  return Math.min(500 * attempt, 2000);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function createPgDb(env) {
  const pool = new pg.Pool({
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: pgConnectTimeoutMs(env),
    ssl: resolvePgSsl(env.DATABASE_URL),
  });

  // simple wrapper
  return {
    kind: 'pg',
    pool,
    async query(text, params) {
      const r = await pool.query(text, params);
      return { rows: r.rows, rowCount: r.rowCount };
    },
    async tx(fn) {
      // Lock order for money operations: market row first, then balance/position rows
      // This prevents deadlocks when multiple transactions touch the same market
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const q = async (text, params) => {
          const r = await client.query(text, params);
          return { rows: r.rows, rowCount: r.rowCount };
        };
        const result = await fn({ query: q });
        await client.query('COMMIT');
        return result;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

async function createPgliteDb(env) {
    // PGlite
    // In test, use in-memory; in dev, use .data/pglite
    const isTest = env.NODE_ENV === 'test';
    // An explicit directory makes local recovery safe when a checked-out path is
    // problematic for embedded Postgres. It is intentionally ignored in test.
    const configuredDir = isTest ? undefined : (env.PGLITE_DATA_DIR || path.join(process.cwd(), '.data', 'pglite'));
    const tempDir = path.join(os.tmpdir(), 'liveedge-pglite');
    let dataDir = configuredDir;
    let db;
    try {
      if (dataDir) fs.mkdirSync(path.dirname(dataDir), { recursive: true });
      db = isTest ? new PGlite() : new PGlite(dataDir);
      await db.waitReady;
    } catch (error) {
      if (isTest || env.NODE_ENV === 'production') throw error;
      console.warn(`PGlite could not open ${dataDir}; using temporary local data at ${tempDir}.`);
      dataDir = tempDir;
      fs.mkdirSync(path.dirname(dataDir), { recursive: true });
      db = new PGlite(dataDir);
      await db.waitReady;
    }
    // Add gen_random_uuid support: pglite doesn't have pgcrypto by default; we emulate via JS or use randomUUID in inserts.
    // We'll rely on uuid generated in app side if needed, but schema uses gen_random_uuid() -> we need extension or workaround.
    // PGlite supports uuid extension? We'll create table without default and fill via JS where needed, but migration uses gen_random_uuid fallback.
    // We'll register a function? simplest: pre-create extension if available, else override.
    try {
      await db.exec(`create extension if not exists "pgcrypto";`);
    } catch {
      // pgcrypto may not be available in PGlite, will use fallback
    }
    // fallback: ensure gen_random_uuid exists for pglite without pgcrypto
    try {
      await db.exec(`create or replace function gen_random_uuid() returns uuid language sql as $$ select ('00000000-0000-4000-a000-' || substr(md5(random()::text),1,12))::uuid $$;`);
    } catch {
      // Fallback function may already exist or fail silently
    }
    // wrapper for pg-like API: need to handle $1 params -> ? maybe pglite supports $1? Check: pglite uses same as pg.
    // It does support parameterized queries via .query
    // PGlite is a single-connection embedded DB: concurrent BEGIN/COMMIT interleave
    // and fail. Serialize transactions through a promise-chain mutex so parallel
    // submits queue correctly (real pg Pool uses separate clients and needs no mutex).
    let txQueue = Promise.resolve();
    return {
      kind: 'pglite',
      db,
      async query(text, params) {
        // translate gen_random_uuid() calls for pglite if pgcrypto not available: replace with random string?
        // We'll just execute; if fails due to function not existing, fallback to generating uuid in JS is handled at app layer.
        const r = await db.query(text, params);
        return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
      },
      async tx(fn) {
        // Lock order for money operations: market row first, then balance/position rows
        // This prevents deadlocks when multiple transactions touch the same market
        let release;
        const prev = txQueue;
        txQueue = new Promise((r) => {
          release = r;
        });
        await prev;
        try {
          await db.exec('BEGIN');
          try {
            const q = async (text, params) => {
              const r = await db.query(text, params);
              return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
            };
            const result = await fn({ query: q });
            await db.exec('COMMIT');
            return result;
          } catch (e) {
            await db.exec('ROLLBACK');
            throw e;
          }
        } finally {
          release();
        }
      },
      async close() {
        await db.close();
      },
    };
}
