import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Strict dotenv line: KEY immediately followed by '=' (no space before '='),
// KEY is a bare identifier. This intentionally rejects JavaScript source lines
// such as `port = next;` or `const env = loadEnv(...)` so a mis-resolved path
// can never pollute process.env (the bug that shipped in the first loader).
const LINE_RE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

/**
 * Parse dotenv-formatted text into a plain object.
 * Ignores blank lines and `#` comments; only accepts strict KEY=value lines.
 * Values are trimmed; a single pair of surrounding quotes is stripped.
 */
export function parseDotEnv(text) {
  const out = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = LINE_RE.exec(line);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
      (val.startsWith("'") && val.endsWith("'") && val.length >= 2)
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/**
 * Candidate .env locations, repo root first, then the server package dir.
 * Resolved from this module's own location (server/src/config) so it works
 * regardless of the process working directory or OS path separators.
 */
export function dotenvCandidates(startDir = dirname(fileURLToPath(import.meta.url))) {
  const serverRoot = resolve(startDir, '..', '..'); // .../server
  const repoRoot = resolve(startDir, '..', '..', '..'); // repo root
  return [join(repoRoot, '.env'), join(serverRoot, '.env')];
}

/**
 * Load a .env file into the given env object (default process.env), respecting
 * precedence (existing process.env values win, matching dotenv semantics).
 * Returns { loaded, path, parsed } for boot logging. Never logs values.
 */
export function loadDotEnv({ env = process.env, candidates = dotenvCandidates() } = {}) {
  for (const p of candidates) {
    let text;
    try {
      text = readFileSync(p, 'utf8');
    } catch {
      continue;
    }
    const parsed = parseDotEnv(text);
    let applied = 0;
    for (const [key, val] of Object.entries(parsed)) {
      if (!(key in env)) {
        env[key] = val;
        applied++;
      }
    }
    return { loaded: true, path: p, parsed: applied };
  }
  return { loaded: false, path: candidates[0] || null, parsed: 0 };
}
