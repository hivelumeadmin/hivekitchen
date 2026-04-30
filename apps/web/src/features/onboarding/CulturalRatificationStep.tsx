import { useEffect, useState } from 'react';
import { CulturalPriorListResponseSchema } from '@hivekitchen/contracts';
import type { CulturalPrior, RatifyAction } from '@hivekitchen/types';
import { hkFetch } from '@/lib/fetch.js';
import { CulturalRatificationCard } from './CulturalRatificationCard.js';

interface CulturalRatificationStepProps {
  householdId: string;
  // Called when there is nothing left for the parent to ratify (either zero
  // detected priors or all detected priors resolved).
  onComplete: () => void;
}

// Renders one card per detected prior. Cards disappear as the parent resolves
// each one. When the queue empties, calls onComplete so the outer flow can
// proceed (typically navigate to /app).
export function CulturalRatificationStep({
  householdId,
  onComplete,
}: CulturalRatificationStepProps) {
  const [priors, setPriors] = useState<CulturalPrior[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const raw = await hkFetch<unknown>(
          `/v1/households/${householdId}/cultural-priors`,
          { method: 'GET', signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        const parsed = CulturalPriorListResponseSchema.parse(raw);
        const detected = parsed.priors.filter((p) => p.state === 'detected');
        setPriors(detected);
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setLoadError("Couldn't load Lumi's notes just now.");
      }
    }
    void load();
    return () => controller.abort();
  }, [householdId]);

  // Auto-skip when nothing is detectable (silence-mode, UX-DR46).
  useEffect(() => {
    if (priors !== null && priors.length === 0 && loadError === null) {
      onComplete();
    }
  }, [priors, loadError, onComplete]);

  if (loadError !== null) {
    // Soft-fail: load error should not strand the user — let them proceed.
    return (
      <div className="flex flex-col items-center gap-4">
        <p className="font-sans text-stone-600 text-center">{loadError}</p>
        <button
          type="button"
          onClick={onComplete}
          className="font-sans text-sm text-stone-500 underline underline-offset-2 hover:text-stone-700 transition-colors"
        >
          Continue
        </button>
      </div>
    );
  }

  if (priors === null) {
    return (
      <p className="font-sans text-stone-500 text-center">One moment…</p>
    );
  }

  if (priors.length === 0) {
    return null;
  }

  function handleResolved(priorId: string, _action: RatifyAction): void {
    setPriors((prev) => {
      if (prev === null) return prev;
      return prev.filter((p) => p.id !== priorId);
    });
  }

  return (
    <div className="flex flex-col gap-6 items-center">
      <p className="font-sans text-stone-500 text-center max-w-md">
        A few things stood out from our chat. Let me check before I keep them in mind.
      </p>
      {priors.map((prior) => (
        <CulturalRatificationCard
          key={prior.id}
          prior={prior}
          householdId={householdId}
          onResolved={handleResolved}
        />
      ))}
    </div>
  );
}
