import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useScope } from '@hivekitchen/ui';
import { FlavorPassportResponseSchema, ResetFlavorJourneyResponseSchema } from '@hivekitchen/contracts';
import type { FlavorPassportResponse } from '@hivekitchen/types';
import { hkFetch, HkApiError } from '@/lib/fetch.js';
import { useLumiContext } from '@/hooks/useLumiContext.js';
import { useAuthStore } from '@/stores/auth.store.js';
import { FlavorPassportView } from '@/features/flavor-passport/FlavorPassportView.js';
import { Dialog } from '@/components/Dialog.js';

type LoadState = 'loading' | 'ready' | 'error';

const COOLDOWN_MS = 365 * 24 * 60 * 60 * 1000;

// Parent-facing FlavorPassport at /app/children/:childId/flavor-passport.
// The passport response carries no child name (the contract is scope-neutral),
// so the name is fetched alongside it from the GetChild endpoint.
export default function ChildFlavorPassportPage() {
  useScope('app-scope');
  useLumiContext({ surface: 'general' });

  const { childId } = useParams<{ childId: string }>();
  const navigate = useNavigate();
  const accessToken = useAuthStore((s) => s.accessToken);
  const householdId = useAuthStore((s) => s.user?.current_household_id ?? null);
  const didLoad = useRef(false);

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [passport, setPassport] = useState<FlavorPassportResponse | null>(null);
  const [childName, setChildName] = useState<string>('');

  // Story 7-S7 — annual flavor-journey reset.
  const [showResetModal, setShowResetModal] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetAt, setResetAt] = useState<string | null>(null);
  const resetModalId = useId();
  const resetModalDescId = `${resetModalId}-desc`;

  useEffect(() => {
    const next = `/app/children/${childId}/flavor-passport`;
    if (!accessToken) {
      navigate(`/auth/login?next=${next}`, { replace: true });
      return;
    }
    if (childId === undefined || householdId === null || didLoad.current) return;
    didLoad.current = true;
    const controller = new AbortController();
    void (async () => {
      try {
        // The passport is the critical fetch; the child name is cosmetic (the
        // view falls back to "Your"), so a name-fetch failure must not blank an
        // otherwise-good passport.
        const [child, passportRaw] = await Promise.all([
          hkFetch<{ child: { name: string } }>(
            `/v1/households/${householdId}/children/${childId}`,
            { method: 'GET', signal: controller.signal },
          ).catch(() => null),
          hkFetch<unknown>(`/v1/children/${childId}/flavor-passport`, {
            method: 'GET',
            signal: controller.signal,
          }),
        ]);
        if (child) setChildName(child.child.name);
        setPassport(FlavorPassportResponseSchema.parse(passportRaw));
        setLoadState('ready');
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        if (err instanceof HkApiError && err.status === 401) {
          navigate(`/auth/login?next=${next}`, { replace: true });
          return;
        }
        didLoad.current = false;
        setLoadState('error');
      }
    })();
    return () => controller.abort();
  }, [accessToken, householdId, childId, navigate]);

  // Story 7-S7 — the route reuses this component instance across :childId
  // changes, so clear the reset banners on navigation; otherwise child A's
  // success/cooldown banner renders under child B's passport.
  useEffect(() => {
    setResetAt(null);
    setResetError(null);
  }, [childId]);

  async function handleResetConfirm() {
    if (childId === undefined || isResetting) return;
    setIsResetting(true);
    setResetError(null);
    try {
      const raw = await hkFetch<unknown>(`/v1/children/${childId}/reset-flavor-journey`, {
        method: 'POST',
      });
      const parsed = ResetFlavorJourneyResponseSchema.parse(raw);
      setResetAt(parsed.reset_at);
      setPassport((prev) => (prev === null ? null : { ...prev, stamps: [], state: 'empty' }));
      setShowResetModal(false);
    } catch (err) {
      // Clear any prior success banner so it never renders alongside an error.
      setResetAt(null);
      if (err instanceof HkApiError && err.status === 409) {
        // ConflictError detail: "flavor journey was already reset on <ISO>".
        const detail = typeof (err.problem as { detail?: unknown })?.detail === 'string'
          ? (err.problem as { detail: string }).detail
          : '';
        const match = detail.match(/reset on (.+)$/);
        const last = match ? new Date(match[1]) : null;
        const date = last && !Number.isNaN(last.getTime()) ? last.toLocaleDateString() : 'a recent date';
        const eligible = last && !Number.isNaN(last.getTime())
          ? new Date(last.getTime() + COOLDOWN_MS).toLocaleDateString()
          : 'a year from now';
        setResetError(`Already reset on ${date}. You can reset again after ${eligible}.`);
      } else {
        setResetError('Could not reset flavor journey. Please try again later.');
      }
      setShowResetModal(false);
    } finally {
      setIsResetting(false);
    }
  }

  if (loadState === 'loading') {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-grow items-center justify-center px-6 py-24">
        <p className="font-serif text-lg text-fg-muted">Loading the flavor passport…</p>
      </main>
    );
  }

  if (loadState === 'error' || passport === null) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-grow items-center justify-center px-6 py-24">
        <p role="alert" className="font-serif text-lg text-fg-muted">
          We couldn&apos;t load this flavor passport. Please try again later.
        </p>
      </main>
    );
  }

  const possessive = childName ? `${childName}'s` : "this child's";

  return (
    <>
      <FlavorPassportView
        childName={childName}
        state={passport.state}
        stamps={passport.stamps}
        availableFilters={passport.available_filters}
        scope="app"
      />

      {/* 7-S7 — annual reset */}
      <div className="mx-auto w-full max-w-2xl px-4 pb-16 sm:px-6">
        {resetAt !== null && (
          <p className="font-sans text-sm text-fg-muted">
            Flavor journey reset on {new Date(resetAt).toLocaleDateString()}
          </p>
        )}
        {resetError !== null && (
          <p role="alert" className="font-sans text-sm text-fg-muted">
            {resetError}
          </p>
        )}
        {/* Gate on a loaded name so the label is always the AC1 verbatim
            "Reset [child name]'s flavor journey" (never the "this child's" fallback). */}
        {childName && (
          <div className="mt-6 border-t border-border pt-6">
            <button
              type="button"
              onClick={() => {
                setResetError(null);
                setShowResetModal(true);
              }}
              className="rounded border border-warm-neutral-400 px-4 py-2 font-sans text-sm text-fg-muted transition-colors hover:text-fg"
            >
              Reset {possessive} flavor journey
            </button>
          </div>
        )}
      </div>

      <Dialog
        open={showResetModal}
        onClose={() => setShowResetModal(false)}
        titleId={resetModalId}
        descriptionId={resetModalDescId}
      >
        <h2 id={resetModalId} className="mb-3 font-serif text-xl text-fg">
          Reset {possessive} flavor journey
        </h2>
        <p id={resetModalDescId} className="mb-6 font-sans text-sm leading-relaxed text-fg-muted">
          All learned preferences, cultural priors, and FlavorPassport stamps will be
          soft-forgotten. This action takes 30 days to become permanent and can be done once
          per year.
        </p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => setShowResetModal(false)}
            className="px-4 py-2 font-sans text-sm text-fg-muted hover:underline"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              void handleResetConfirm();
            }}
            disabled={isResetting}
            aria-busy={isResetting}
            className="rounded border border-warm-neutral-400 px-4 py-2 font-sans text-sm text-fg transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isResetting ? 'Resetting…' : 'Reset journey'}
          </button>
        </div>
      </Dialog>
    </>
  );
}
