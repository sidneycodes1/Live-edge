import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
const tokens = Object.fromEntries([...css.matchAll(/--c-([\w-]+):(\d+) (\d+) (\d+)/g)].map(([, k, r, g, b]) => [k, `#${[r, g, b].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`]));
function lum(hex) { return hex.slice(1).match(/../g).map((s) => parseInt(s, 16) / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0); }
function ratio(a, b) { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + .05) / (lo + .05); }

describe('Night Garden tokens', () => {
  it('keeps readable pairs and visible boundaries above their WCAG thresholds', () => {
    for (const bg of ['canvas', 'surface', 'surface-soft']) {
      expect(ratio(tokens.ink, tokens[bg])).toBeGreaterThanOrEqual(4.5);
      expect(ratio(tokens['ink-muted'], tokens[bg])).toBeGreaterThanOrEqual(4.5);
      expect(ratio(tokens['ink-subtle'], tokens[bg])).toBeGreaterThanOrEqual(4.5);
    }
    expect(ratio(tokens['brand-ink'], tokens.brand)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(tokens['on-yes'], tokens.yes)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(tokens['on-no'], tokens.no)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(tokens['on-warn'], tokens.warn)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(tokens.border, tokens.surface)).toBeGreaterThanOrEqual(1.3);
    expect(ratio(tokens.focus, tokens.canvas)).toBeGreaterThanOrEqual(3);
  });

  it('contains one theme only', () => {
    expect(css).not.toContain('[data-theme');
    expect(css).not.toContain('prefers-color-scheme');
  });
});

// ---------------------------------------------------------------------------
// Permanent anti-regression guard. The Night Garden theme is dark-only, so the
// legacy light utilities (bg-white / text-black / border-white / bg-black) render
// invisible (dark-on-dark) or as a jarring white block. The redesign migrated
// every control to semantic tokens; this scan keeps it that way. It targets the
// EXACT class token only — opacity variants (bg-white/10, border-white/15) are
// legitimate translucent overlays and are intentionally NOT flagged.
const LEGACY = /(^|[\s"'`])(bg-white|text-black|border-white|bg-black)(?![\w/-])/;

function walkJs(dirUrl) {
  const out = [];
  for (const ent of readdirSync(dirUrl, { withFileTypes: true })) {
    const child = new URL(ent.name + (ent.isDirectory() ? '/' : ''), dirUrl);
    if (ent.isDirectory()) out.push(...walkJs(child));
    else if (/\.(jsx|js)$/.test(ent.name) && !/\.test\.(js|jsx)$/.test(ent.name)) out.push(child);
  }
  return out;
}

// A doc comment may name a legacy class to explain why it is banned; only live
// markup/style strings count as an offender.
const isComment = (line) => /^(\s*)(\/\/|\/\*|\*)/.test(line);

describe('no invisible legacy controls', () => {
  it('the whole src tree uses no raw bg-white/text-black/border-white/bg-black tokens', () => {
    const offenders = [];
    for (const f of walkJs(new URL('../', import.meta.url))) {
      const rel = decodeURIComponent(f.pathname).replace(/^\//, '').replace(/\//g, '\\');
      readFileSync(f, 'utf8').split('\n').forEach((ln, i) => {
        if (!isComment(ln) && LEGACY.test(ln)) offenders.push(`${rel}:${i + 1}: ${ln.trim().slice(0, 90)}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Document shell. The SPA cannot paint before its stylesheet arrives, so
// index.html carries an inline background/color. If those literals drift from
// the tokens the app flashes the wrong colour, and if a theme boot script ever
// returns it reintroduces the light/dark split this build deliberately abandoned.
describe('document shell', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

  it('pre-paint body colours equal the canvas and ink tokens', () => {
    const body = html.match(/<body[^>]*style="([^"]*)"/);
    expect(body, 'index.html must keep an inline pre-paint body style').not.toBeNull();
    expect(body[1].toLowerCase()).toContain(`background:${tokens.canvas}`);
    expect(body[1].toLowerCase()).toContain(`color:${tokens.ink}`);
  });

  it('is dark-only: no theme boot script, fixed color-scheme, safe-area viewport', () => {
    expect(html).not.toMatch(/data-theme|liveedge-theme|prefers-color-scheme/);
    expect(html).toMatch(/<meta name="color-scheme" content="dark"/);
    expect(html).toMatch(/viewport-fit=cover/);
  });

  it('declares shareable metadata without a relative og:image', () => {
    expect(html).toMatch(/<meta name="description" content="[^"]{40,}"/);
    for (const tag of ['og:type', 'og:title', 'og:description', 'twitter:card']) {
      expect(html, `missing ${tag}`).toContain(`"${tag}"`);
    }
    // Crawlers resolve og:image against an absolute URL; a site-rooted SVG path
    // renders as a blank preview, so it must not ship until a raster exists.
    const image = html.match(/property="og:image" content="([^"]*)"/);
    if (image) expect(image[1]).toMatch(/^https?:\/\//);
  });
});
