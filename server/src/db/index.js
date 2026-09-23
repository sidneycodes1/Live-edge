import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';

export async function createDb(env) {
  if (env.DATABASE_URL) {
    const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: env.DATABASE_URL.includes('sslmode') ? { rejectUnauthorized: false } : undefined });
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
  } else {
    // PGlite
    // In test, use in-memory; in dev, use .data/pglite
    const isTest = env.NODE_ENV === 'test';
    const dataDir = isTest ? undefined : path.join(process.cwd(), '.data', 'pglite');
    if (dataDir) fs.mkdirSync(path.dirname(dataDir), { recursive: true });
    const db = isTest ? new PGlite() : new PGlite(dataDir);
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
}
