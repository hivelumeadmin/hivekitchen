import { useEffect, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { FlavorPassportResponseSchema } from '@hivekitchen/contracts';
import type { FlavorPassportResponse } from '@hivekitchen/types';
import { publicGet } from '@/lib/fetch.js';
import { FlavorPassportView } from '@/features/flavor-passport/FlavorPassportView.js';

type LoadState = 'loading' | 'ready' | 'expired' | 'error';

// Child-facing FlavorPassport at /lunch/:linkId/passport. Public — no auth.
// The child name is not in the public response; the lunch-link page passes it
// via router state when navigating, with a graceful second-person fallback.
// AppLayout's useMatch('/lunch/*') already suppresses the parent LumiOrb/Panel.
export default function LunchPassportRoute() {
  const { linkId } = useParams<{ linkId: string }>();
  const location = useLocation();
  const childName = (location.state as { childName?: string } | null)?.childName;

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [passport, setPassport] = useState<FlavorPassportResponse | null>(null);

  useEffect(() => {
    if (linkId === undefined) {
      setLoadState('expired');
      return;
    }
    let mounted = true;
    setLoadState('loading');
    void publicGet(`/v1/lunch-link/${linkId}/passport`)
      .then(({ status, body }) => {
        if (!mounted) return;
        if (status === 200) {
          try {
            setPassport(FlavorPassportResponseSchema.parse(body));
            setLoadState('ready');
          } catch {
            setLoadState('error');
          }
        } else if (status === 404) {
          // Oracle prevention: invalid / expired / suppressed all arrive as 404.
          setLoadState('expired');
        } else {
          setLoadState('error');
        }
      })
      .catch(() => {
        if (mounted) setLoadState('error');
      });
    return () => {
      mounted = false;
    };
  }, [linkId]);

  if (loadState === 'loading') {
    return (
      <main className="flex w-full flex-grow items-center justify-center px-4 py-12">
        <div className="w-full max-w-2xl space-y-4">
          <div className="h-8 w-48 animate-pulse rounded bg-surface-2" />
          <div className="h-24 animate-pulse rounded-lg bg-surface-2" />
          <div className="h-24 animate-pulse rounded-lg bg-surface-2" />
        </div>
      </main>
    );
  }

  if (loadState === 'expired') {
    return (
      <main className="flex w-full flex-grow items-center justify-center px-4 py-12">
        <p className="text-center text-sm text-fg-muted">This link has expired.</p>
      </main>
    );
  }

  if (loadState === 'error' || passport === null) {
    return (
      <main className="flex w-full flex-grow items-center justify-center px-4 py-12">
        <p className="text-center text-sm text-fg-muted">
          Couldn&apos;t load this flavor passport. Please try again.
        </p>
      </main>
    );
  }

  return (
    <FlavorPassportView
      childName={childName}
      state={passport.state}
      stamps={passport.stamps}
      scope="child"
    />
  );
}
