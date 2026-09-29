// Installs the versioned git hooks in .githooks/ into this clone's real hooks
// directory. Deliberately does NOT touch git config (no core.hooksPath); it
// copies files instead, so the guard works with any tooling and leaves config
// untouched. Run manually (`node scripts/install-hooks.mjs`) or automatically
// on `pnpm install` via the root package.json "prepare" script.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, copyFileSync, chmodSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
const srcDir = join(repoRoot, '.githooks');

let hooksDir;
try {
  hooksDir = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
  if (!hooksDir.startsWith(resolve.sep)) hooksDir = join(repoRoot, hooksDir);
} catch {
  console.error('install-hooks: not inside a git repository; skipping.');
  process.exit(0);
}

if (!existsSync(srcDir)) {
  console.error(`install-hooks: no .githooks directory at ${srcDir}; skipping.`);
  process.exit(0);
}

let installed = 0;
for (const name of readdirSync(srcDir)) {
  const from = join(srcDir, name);
  if (!statSync(from).isFile()) continue;
  const to = join(hooksDir, name);
  copyFileSync(from, to);
  try {
    chmodSync(to, 0o755);
  } catch {
    /* chmod is a no-op on some Windows setups; git for Windows runs sh hooks anyway */
  }
  installed++;
  console.log(`install-hooks: installed ${name}`);
}
console.log(`install-hooks: ${installed} hook(s) -> ${hooksDir}`);
