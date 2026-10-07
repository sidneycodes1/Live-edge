import { useEffect, useRef } from 'react';

// ---------------------------------------------------------------------------
// Modal — the shared OVERLAY shell (owner decision, Oct 2026). Sign-in was the
// first overlay; Portfolio and Create now follow the exact same pattern: a
// compact rectangle centered ON TOP of the current page, everything else dimmed
// and blurred (the app's dark-blue background shows through), dismissible by an
// ✕, Esc, or a backdrop click. One shell keeps every overlay visually identical
// and gives us one place for the focus-restore + dialog contract.
//
// `testId` drives the stable e2e hooks: `${testId}-backdrop`, `${testId}` (the
// panel), and `${testId}-close` — matching the frozen AuthModal contract.
// ---------------------------------------------------------------------------
export default function Modal({
  open,
  onClose,
  children,
  testId = 'modal',
  labelledBy,
  panelClassName = 'max-w-md p-6',
}) {
  const panelRef = useRef(null);
  const restoreRef = useRef(null);

  // Esc closes while open (role=dialog contract).
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Focus the panel on open; hand focus back to the trigger on close.
  useEffect(() => {
    if (!open) return undefined;
    restoreRef.current = document.activeElement;
    const raf = window.requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }));
    return () => {
      window.cancelAnimationFrame(raf);
      const prev = restoreRef.current;
      if (prev && typeof prev.focus === 'function') prev.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      data-testid={`${testId}-backdrop`}
      onClick={onClose}
    >
      {/* Dim + blur everything the panel does not cover */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" aria-hidden="true" />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onClick={(e) => e.stopPropagation()}
        className={`relative w-full max-h-[85vh] overflow-y-auto rounded-card border border-white/15 bg-surface focus:outline-none ${panelClassName}`}
        data-testid={testId}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          data-testid={`${testId}-close`}
          className="absolute top-2 right-2 z-10 w-11 h-11 grid place-items-center rounded-full text-white/60 hover:text-white hover:bg-white/10 cursor-pointer"
        >
          ✕
        </button>
        {children}
      </div>
    </div>
  );
}
