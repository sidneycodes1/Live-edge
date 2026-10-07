import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveSource, formatAgo, STALE_FALLBACK_MS } from './market-source.js';

// Honesty contract for the price-provenance chip (Door 1 / ToU §5 + §6). The
// label rules are pure (below); the data-testid/wording contract is asserted by
// reading the actual component source (no jsdom in this project — same spirit as
// the frozen-copy tests in lib/terms.test.js).

const NOW = Date.parse('2026-10-07T12:00:00.000Z');
const iso = (offsetMs) => new Date(NOW + offsetMs).toISOString();

describe('resolveSource — price provenance honesty', () => {
  it('a fresh panta_live quote reads as Live · Panta', () => {
    const r = resolveSource({ priceSource: 'panta_live', observedAt: iso(-1000), nowMs: NOW });
    expect(r).toMatchObject({ label: 'Live · Panta', tone: 'live', age: null });
  });
  it('panta_live OLDER than the TTL honestly degrades to Stale (never Live)', () => {
    const r = resolveSource({
      priceSource: 'panta_live',
      observedAt: iso(-(STALE_FALLBACK_MS + 5000)),
      nowMs: NOW,
    });
    expect(r.tone).toBe('stale');
    expect(r.label).toBe('Stale · Panta');
    expect(r.age).toMatch(/ago$/);
  });
  it('server-flagged stale_panta reads as Stale', () => {
    const r = resolveSource({ priceSource: 'stale_panta', observedAt: iso(-90000), nowMs: NOW });
    expect(r).toMatchObject({ label: 'Stale · Panta', tone: 'stale' });
  });
  it('simulated (and any unknown source) can NEVER read as a live Panta quote', () => {
    for (const ps of ['simulated', undefined, null, '']) {
      const r = resolveSource({ priceSource: ps, observedAt: iso(-1000), nowMs: NOW });
      expect(r).toEqual({ label: 'Simulated', tone: 'simulated', age: null });
    }
  });
  it('honors a custom staleAfterMs window', () => {
    const old = iso(-30000); // 30s ago
    expect(resolveSource({ priceSource: 'panta_live', observedAt: old, nowMs: NOW, staleAfterMs: 60000 }).tone).toBe('live');
    expect(resolveSource({ priceSource: 'panta_live', observedAt: old, nowMs: NOW, staleAfterMs: 10000 }).tone).toBe('stale');
  });
});

describe('formatAgo — never fabricates an age', () => {
  it('returns null for missing/invalid times', () => {
    expect(formatAgo(null, NOW)).toBeNull();
    expect(formatAgo('not-a-date', NOW)).toBeNull();
  });
  it('buckets seconds, minutes, hours', () => {
    expect(formatAgo(iso(-2000), NOW)).toBe('2s ago');
    expect(formatAgo(iso(-120000), NOW)).toBe('2m ago');
    expect(formatAgo(iso(-7200000), NOW)).toBe('2h ago');
  });
});

describe('data-testid + wording contract (ToU §6)', () => {
  const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  const chip = read('../components/MarketSourceChip.jsx');
  const panta = read('../components/PoweredByPanta.jsx');

  it('the chip carries its stable testid + provenance attributes', () => {
    expect(chip).toContain('data-testid="market-source-chip"');
    expect(chip).toContain('data-price-source=');
  });
  it('Powered by Panta is present, links to panta.market, and has NO dismiss control', () => {
    expect(panta).toContain('data-testid="powered-by-panta"');
    expect(panta).toContain('href="https://panta.market"');
    expect(panta).toContain('Powered by');
    expect(panta).toContain('Panta');
    // Mandatory + not user-dismissappable: it is a plain link, never a
    // button/overlay with a close control or open/closed state.
    expect(panta).not.toContain('<button');
    expect(panta).not.toMatch(/useState|onClose|isOpen/);
  });
});
