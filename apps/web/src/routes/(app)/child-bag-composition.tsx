import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { GetChildResponseSchema, bagCompositionFromPattern } from '@hivekitchen/contracts';
import type { ChildResponse } from '@hivekitchen/types';
import { BagCompositionForm } from '@/features/children/BagCompositionForm.js';
import { hkFetch, HkApiError } from '@/lib/fetch.js';
import { useAuthStore } from '@/stores/auth.store.js';

export default function ChildBagCompositionPage() {
  const { childId = '' } = useParams<{ childId: string }>();
  const householdId = useAuthStore((s) => s.user?.current_household_id ?? null);
  const [child, setChild] = useState<ChildResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!householdId || !childId) return;
    let cancelled = false;
    void (async () => {
      try {
        const raw = await hkFetch<unknown>(
          `/v1/households/${householdId}/children/${childId}`,
          { method: 'GET' },
        );
        const parsed = GetChildResponseSchema.parse(raw);
        if (!cancelled) setChild(parsed.child);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof HkApiError) {
          setLoadError("Couldn't load this child. Please try again.");
        } else {
          setLoadError("Couldn't load this child. Please try again.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [householdId, childId]);

  if (loadError !== null) {
    return (
      <main className="mx-auto w-full max-w-7xl flex-grow px-6 pt-12 pb-24">
        <p role="alert" className="text-sm text-safety-red">
          {loadError}
        </p>
      </main>
    );
  }

  if (child === null) {
    return (
      <main className="mx-auto w-full max-w-7xl flex-grow px-6 pt-12 pb-24">
        <p className="text-sm text-fg-muted">Loading…</p>
      </main>
    );
  }

  const childName = child.name;
  const bagComposition = bagCompositionFromPattern(child.bag_composition_pattern);
  return (
    <main className="mx-auto w-full max-w-7xl flex-grow px-6 pt-12 pb-24">
      <BagCompositionForm
        childId={child.id}
        childName={childName}
        initialSnack={bagComposition.snack}
        initialExtra={bagComposition.extra}
      />
    </main>
  );
}
