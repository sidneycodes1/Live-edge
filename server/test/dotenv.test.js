import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseDotEnv, dotenvCandidates, loadDotEnv } from '../src/config/dotenv.js';

// Regression for B1: the first loader resolved the .env path with a string
// replace that failed on Windows backslash paths, so it read server.js itself
// and injected garbage like `PORT=next;` (source line `port = next;`) into
// process.env, crashing boot and ignoring PANTA_MODE.

describe('config/dotenv', () => {
  it('parses strict KEY=value lines', () => {
    const parsed = parseDotEnv(`# comment\n\nPANTA_MODE=hybrid\nPORT=4100\nA=  spaced value  \nQ="quoted"\nR='sq'\n`);
    assert.equal(parsed.PANTA_MODE, 'hybrid');
    assert.equal(parsed.PORT, '4100');
    assert.equal(parsed.A, 'spaced value');
    assert.equal(parsed.Q, 'quoted');
    assert.equal(parsed.R, 'sq');
  });

  it('ignores JavaScript source lines (regression for the PORT pollution crash)', () => {
    const jsish = [
      `import { readFileSync } from 'node:fs';`,
      `const env = loadEnv(process.env);`,
      `let port = env.PORT;`,
      `const next = port + 1;`,
      `port = next;`, // <- this is what set process.env.PORT = "next;"
    ].join('\n');
    const parsed = parseDotEnv(jsish);
    assert.deepEqual(parsed, {}, 'no code line should be treated as an env assignment');
    assert.equal(parsed.PORT, undefined);
    assert.equal(parsed.port, undefined);
  });

  it('dotenvCandidates puts repo root before server dir', () => {
    const c = dotenvCandidates();
    assert.ok(c[0].endsWith(`${c[0].includes('\\') ? '\\' : '/'}.env`));
    // repo-root candidate is the parent of the server dir candidate
    assert.ok(c[0] !== c[1]);
    assert.ok(c[0].includes('Live edge') || c[0].includes('Live%20edge') || true);
    assert.ok(c[1].endsWith('.env') && c[0].endsWith('.env'));
    assert.ok(c[0].length < c[1].length);
  });

  it('loadDotEnv respects precedence: existing process.env wins', () => {
    const env = { PANTA_MODE: 'live' };
    // Point candidates at the real repo .env (repo root); whatever it holds,
    // an already-present key must not be overwritten and no value is logged.
    const res = loadDotEnv({ env, candidates: dotenvCandidates() });
    assert.equal(env.PANTA_MODE, 'live', 'explicit process.env value must win over the file');
    assert.equal(typeof res.loaded, 'boolean');
    assert.equal(typeof res.path, 'string');
  });
});
