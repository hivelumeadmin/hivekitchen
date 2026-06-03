import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useScope } from '@hivekitchen/ui';
import { FlavorPassportResponseSchema } from '@hivekitchen/contracts';
import type { FlavorPassportResponse } from '@hivekitchen/types';
import { hkFetch, HkApiError } from '@/lib/fetch.js';
import { useLumiContext } from '@/hooks/useLumiContext.js';
import { useAuthStore } from '@/stores/auth.store.js';
import { FlavorPassportView } from '@/features/flavor-passport/FlavorPassportView.js';

type LoadState = 'loading' | 'ready' | 'error';

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

  return (
    <FlavorPassportView
      childName={childName}
      state={passport.state}
      stamps={passport.stamps}
      availableFilters={passport.available_filters}
      scope="app"
    />
  );
}
