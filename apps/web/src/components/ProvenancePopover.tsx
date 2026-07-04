import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { GetProvenanceResponseSchema } from '@hivekitchen/contracts';
import type { MemoryProvenance } from '@hivekitchen/types';
import { hkFetch, HkApiError } from '@/lib/fetch.js';

type Status = 'idle' | 'loading' | 'ready' | 'error';

const SOURCE_LABELS: Record<MemoryProvenance['source_type'], string> = {
  onboarding: 'from your setup conversation',
  turn: 'from a conversation on',
  tool: 'Lumi inferred this on',
  user_edit: 'you edited this on',
  plan_outcome: 'from a plan outcome on',
  import: 'imported on',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function buildSourceLabel(p: MemoryProvenance): string {
  const base = SOURCE_LABELS[p.source_type];
  if (p.source_type === 'onboarding') return base;
  return `${base} ${formatDate(p.captured_at)}`;
}

// Story 7-S2 — provenance popover. Follows SwapHistoryPopover accessibility
// pattern: button trigger + non-modal sibling region, Escape closes + restores
// focus, no focus trap. Fetch is lazy — fires on first open only.
export function ProvenancePopover({
  nodeId,
  onEdit,
  onForget,
  showHelper,
}: {
  nodeId: string;
  onEdit?: () => void;
  onForget?: () => void;
  showHelper?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [provenance, setProvenance] = useState<MemoryProvenance[]>([]);
  // 7-S6 — first-time helper pulse. Initialized from the prop (stable after mount).
  const [helperVisible, setHelperVisible] = useState(!!showHelper);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLSpanElement>(null);
  const hasFetched = useRef(false);
  const regionId = useId();
  const labelId = useId();
  const helperId = useId();

  async function fetchProvenance() {
    setStatus('loading');
    try {
      const raw = await hkFetch<unknown>(`/v1/memory/${nodeId}/provenance`, { method: 'GET' });
      const parsed = GetProvenanceResponseSchema.parse(raw);
      setProvenance(parsed.provenance);
      setStatus('ready');
      hasFetched.current = true; // cache only on success — errors stay retryable
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      if (err instanceof HkApiError && err.status === 401) return;
      setStatus('error');
    }
  }

  function handleOpen() {
    const next = !open;
    setOpen(next);
    if (next && !hasFetched.current && status !== 'loading') {
      void fetchProvenance();
    }
  }

  function handleKeyDown(e: ReactKeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
  }

  // AC3 — clicking outside the trigger+region closes the popover. Non-modal:
  // no backdrop, no focus restore (the click already moved focus elsewhere).
  // The listener attaches after the opening render, so the opening click never
  // self-closes it.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  // 7-S6 — the helper dismisses on a 4s timer OR the first pointerdown anywhere,
  // whichever fires first. Both run the same `dismiss` closure, so the seen-at
  // key is written exactly once. Cleanup covers an early unmount.
  useEffect(() => {
    if (!helperVisible) return;
    function dismiss() {
      setHelperVisible(false);
      try {
        localStorage.setItem('memory_helper_seen_at', new Date().toISOString());
      } catch {
        // storage unavailable (e.g. private-browsing quota) — helper may re-show next visit
      }
    }
    const timer = setTimeout(dismiss, 4000);
    document.addEventListener('pointerdown', dismiss, { once: true });
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', dismiss);
    };
  }, [helperVisible]);

  // Most recent non-superseded provenance record.
  const primary = provenance.find((p) => p.superseded_by === null) ?? provenance[0] ?? null;

  return (
    <span ref={containerRef} className="relative inline-block shrink-0">
      <button
        ref={triggerRef}
        id={labelId}
        type="button"
        aria-label="More options"
        aria-expanded={open}
        aria-controls={regionId}
        aria-describedby={helperVisible ? helperId : undefined}
        onClick={handleOpen}
        onKeyDown={handleKeyDown}
        className={
          'mt-0.5 font-sans text-sm hover:text-fg transition-colors motion-reduce:transition-none focus:outline-none focus:ring-2 focus:ring-foliage rounded' +
          (helperVisible
            ? ' text-honey-amber-500 animate-pulse motion-reduce:animate-none'
            : ' text-fg-muted')
        }
      >
        ···
      </button>

      {helperVisible && (
        <span
          id={helperId}
          role="tooltip"
          aria-live="polite"
          className="absolute end-full top-0 me-2 w-48 rounded-lg border border-border bg-surface px-3 py-2 font-sans text-xs text-fg shadow-sm pointer-events-none motion-reduce:animate-none"
        >
          Tap ⋯ to see where this came from or ask Lumi to forget it
        </span>
      )}

      {open && (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- keyboard-only Escape-to-dismiss on the popover container; all activation is on native buttons inside
        <div
          id={regionId}
          role="region"
          aria-labelledby={labelId}
          onKeyDown={handleKeyDown}
          className="absolute end-0 z-30 mt-2 w-64 rounded-lg border border-border bg-surface p-4 shadow-sm font-sans text-sm text-fg"
        >
          {status === 'loading' && (
            <p className="text-fg-muted">Loading…</p>
          )}

          {status === 'error' && (
            <p className="text-fg-muted">Couldn&apos;t load provenance. Try again.</p>
          )}

          {status === 'ready' && (
            <>
              <div className="space-y-1">
                <p className="text-fg-muted text-xs leading-snug">
                  {primary ? buildSourceLabel(primary) : 'Source unknown'}
                </p>
                {primary && (
                  <p className="text-fg-muted text-xs">
                    {Math.round(primary.confidence * 100)}% confident
                  </p>
                )}
              </div>

              <div className="flex gap-2 mt-3">
                {onEdit ? (
                  <button
                    type="button"
                    aria-label="Edit this memory"
                    onClick={() => {
                      setOpen(false);
                      onEdit();
                    }}
                    className="px-3 py-1 rounded-full font-sans text-xs text-fg border border-border hover:bg-surface focus:outline-none focus:ring-2 focus:ring-foliage"
                  >
                    Edit
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled
                    aria-label="Edit (available in a future update)"
                    className="px-3 py-1 rounded-full font-sans text-xs text-fg-muted border border-border cursor-not-allowed opacity-50"
                  >
                    Edit
                  </button>
                )}
                {onForget ? (
                  <button
                    type="button"
                    aria-label="Forget this memory"
                    onClick={() => {
                      setOpen(false);
                      onForget();
                    }}
                    className="px-3 py-1 rounded-full font-sans text-xs text-fg border border-border hover:bg-surface focus:outline-none focus:ring-2 focus:ring-foliage"
                  >
                    Forget
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled
                    aria-label="Forget (available in a future update)"
                    className="px-3 py-1 rounded-full font-sans text-xs text-fg-muted border border-border cursor-not-allowed opacity-50"
                  >
                    Forget
                  </button>
                )}
                <button
                  type="button"
                  disabled
                  aria-label="Adjust (available in a future update)"
                  className="px-3 py-1 rounded-full font-sans text-xs text-fg-muted border border-border cursor-not-allowed opacity-50"
                >
                  Adjust
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </span>
  );
}
