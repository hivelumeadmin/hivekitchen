import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { GetExtraRulesResponseSchema } from '@hivekitchen/contracts';
import type { ExtraRules } from '@hivekitchen/types';
import { ExtraRulesForm } from '@/features/children/ExtraRulesForm.js';
import { hkFetch, HkApiError } from '@/lib/fetch.js';
import { useAuthStore } from '@/stores/auth.store.js';

export default function ChildExtraRulesPage() {
  const { childId = '' } = useParams<{ childId: string }>();
  const [searchParams] = useSearchParams();
  const childName = searchParams.get('name') ?? 'your child';
  const householdId = useAuthStore((s) => s.user?.current_household_id ?? null);
  const [initialRules, setInitialRules] = useState<ExtraRules | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!childId) return;
    let cancelled = false;
    void (async () => {
      try {
        const raw = await hkFetch<unknown>(`/v1/children/${childId}/extra-rules`, {
          method: 'GET',
        });
        const parsed = GetExtraRulesResponseSchema.parse(raw);
        if (!cancelled) setInitialRules(parsed.extra_rules);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof HkApiError) {
          setLoadError("Couldn't load Extra rules. Please try again.");
        } else {
          setLoadError("Couldn't load Extra rules. Please try again.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [childId]);

  if (loadError !== null) {
    return (
      <div className="py-8 px-4">
        <p role="alert" className="text-sm text-red-700">
          {loadError}
        </p>
      </div>
    );
  }

  if (initialRules === undefined) {
    return (
      <div className="py-8 px-4">
        <p className="text-sm text-stone-600">Loading…</p>
      </div>
    );
  }

  return (
    <div className="py-8 px-4">
      <ExtraRulesForm
        childId={childId}
        childName={childName}
        householdId={householdId ?? ''}
        initialRules={initialRules}
      />
    </div>
  );
}
