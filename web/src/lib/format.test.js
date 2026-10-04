import { describe, it, expect } from 'vitest';
import { fmtTimeLeft } from './format.js';

// fmtTimeLeft carries the landing countdown clamp (docs §4 honesty): an absurd or
// invalid end time must NEVER render garbage like "38522164m", and a past market
// must never count negative. These lock that contract.
const HOUR = 60 * 60 * 1000;

describe('fmtTimeLeft — display clamp', () => {
  it('returns an em-dash for an invalid/absent end time', () => {
    expect(fmtTimeLeft(undefined)).toBe('—');
    expect(fmtTimeLeft(null)).toBe('—');
    expect(fmtTimeLeft('not a date')).toBe('—');
    expect(fmtTimeLeft('')).toBe('—');
  });

  it('returns an em-dash when the market is more than 48h away', () => {
    const far = new Date(Date.now() + 49 * HOUR).toISOString();
    expect(fmtTimeLeft(far)).toBe('—');
    // Years out (the "38522164m" class of bug) is also clamped.
    const absurd = new Date(Date.now() + 4000 * 24 * HOUR).toISOString();
    expect(fmtTimeLeft(absurd)).toBe('—');
  });

  it('renders a real minute/second countdown inside the 48h window', () => {
    const soon = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // ~5m out
    expect(fmtTimeLeft(soon)).toMatch(/^\d+m \d+s$/);
  });

  it('renders an em-dash for a past end time and never counts negative', () => {
    const past = new Date(Date.now() - 60 * 1000).toISOString();
    expect(fmtTimeLeft(past)).toBe('—');
    expect(fmtTimeLeft(past)).not.toMatch(/-/);
  });
});
