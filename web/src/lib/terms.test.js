import { describe, it, expect } from 'vitest';
import {
  TERMS_VERSION,
  TERMS_SUMMARY_PARAGRAPH,
  TERMS_CHECKBOX_LABEL,
  PLAY_MONEY_LINE,
  FUNDED_LINE,
  TERMS_SECTIONS,
} from './terms.js';

// The mandatory product copy, PINNED. These strings are the frozen contract
// between docs/TERMS_DRAFT.md Part 3 / the task spec and every screen that
// renders them — if a revision is intentional, change BOTH the doc and here.

describe('frozen onboarding copy', () => {
  it('setup version matches the plan §4 contract', () => {
    expect(TERMS_VERSION).toBe('2026-10-draft-1');
  });
  it('funded + play-money lines are the exact spec sentences', () => {
    expect(FUNDED_LINE).toBe('Congratulations! Your account has been funded with $100 in play money.');
    expect(PLAY_MONEY_LINE).toBe('Play money for predictions. Not real money.');
  });
  it('checkbox label is the exact 18+/agree sentence', () => {
    expect(TERMS_CHECKBOX_LABEL).toBe("I'm 18 or older and I agree to the Terms & Conditions.");
  });
  it('Part-3 summary keeps the three honesty anchors', () => {
    expect(TERMS_SUMMARY_PARAGRAPH).toContain('play-money');
    expect(TERMS_SUMMARY_PARAGRAPH).toContain('no cash value');
    expect(TERMS_SUMMARY_PARAGRAPH).toContain('18+');
    // The paragraph links its promise: /legal renders TERMS_SECTIONS below it.
    expect(TERMS_SUMMARY_PARAGRAPH).toContain('the full legal version is linked below');
  });
  it('the full legal text is present for the /legal promise (14 sections)', () => {
    expect(TERMS_SECTIONS.length).toBe(14);
    expect(TERMS_SECTIONS.every((s) => s.n && s.body)).toBe(true);
  });
});
