import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function migrate(db) {
  // ensure schema_migrations exists (may already via 001)
  const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const name = file;
    const exists = await db.query('select 1 from schema_migrations where name=$1', [name]).catch(async () => {
      // table may not exist yet; create it
      await db.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz default now())');
      return { rows: [] };
    });
    if (exists.rows.length > 0) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    // split naively by statement? just exec whole file
    // For pg we can send whole sql; for pglite exec handles multiple statements via exec
    if (db.kind === 'pglite') {
      await db.db.exec(sql);
    } else {
      await db.query(sql);
    }
    // record
    await db.query('insert into schema_migrations(name) values($1) on conflict do nothing', [name]);
  }
}
