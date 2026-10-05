import { Link, useNavigate } from 'react-router-dom';
import { TERMS_SECTIONS, TERMS_VERSION, PLAY_MONEY_LINE } from '../lib/terms.js';

// ---------------------------------------------------------------------------
// /legal — the full Terms & Conditions the cover-flow paragraph promises
// ("the full legal version is linked below"). Copy lives ONLY in
// lib/terms.js (mirrors docs/TERMS_DRAFT.md Part 2, DRAFT pending counsel).
// Reachable from the cover and from the normal shell; renders fine in both.
// ---------------------------------------------------------------------------

export default function Legal() {
  const navigate = useNavigate();
  return (
    <div className="max-w-2xl mx-auto px-4 py-8 pb-24">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-heading font-bold text-2xl">Terms &amp; Conditions</h1>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="shrink-0 min-h-[44px] px-4 rounded-full border border-white/15 bg-white/5 text-sm font-semibold text-white/80 hover:bg-white/10 cursor-pointer"
          data-testid="legal-back"
        >
          Back
        </button>
      </div>
      <p className="text-xs text-white/45 mt-1">
        Version {TERMS_VERSION} · DRAFT — pending attorney review · <span className="text-white/70">{PLAY_MONEY_LINE}</span>
      </p>

      <div className="mt-6 space-y-6">
        {TERMS_SECTIONS.map((s) => (
          <section key={s.n}>
            <h2 className="font-heading font-bold text-base text-white/90">{s.n}</h2>
            <p className="text-sm text-white/65 leading-relaxed mt-1.5">{s.body}</p>
          </section>
        ))}
      </div>

      <p className="text-xs text-white/40 mt-8">
        This page restates <Link to="/" className="underline text-white/60">docs/TERMS_DRAFT.md</Link> Part 2 in full.
        The short version you accepted during sign-up is the one paragraph in the setup flow.
      </p>
    </div>
  );
}
