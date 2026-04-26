import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { RedeemInviteResponse } from '@hivekitchen/types';
import { hkFetch, HkApiError } from '@/lib/fetch.js';
import { useAuthStore } from '@/stores/auth.store.js';

type InviteState = 'loading' | 'expired' | 'error';

export default function InviteRedeemPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const didRun = useRef(false);
  const [state, setState] = useState<InviteState>('loading');

  useEffect(() => {
    if (didRun.current) return;
    didRun.current = true;

    if (!token) {
      setState('error');
      return;
    }

    const accessToken = useAuthStore.getState().accessToken;
    if (accessToken === null) {
      navigate(`/auth/login?next=${encodeURIComponent(`/invite/${token}`)}`, { replace: true });
      return;
    }

    void (async () => {
      try {
        const result = await hkFetch<RedeemInviteResponse>('/v1/auth/invites/redeem', {
          method: 'POST',
          body: { token },
        });
        if (/^\/[^/]/.test(result.scope_target)) {
          navigate(result.scope_target, { replace: true });
        } else {
          setState('error');
        }
      } catch (err) {
        if (err instanceof HkApiError && err.status === 410) {
          setState('expired');
        } else {
          setState('error');
        }
      }
    })();
  }, [token, navigate]);

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      {state === 'loading' && (
        <p className="font-serif text-lg text-warm-neutral-700">Checking your invite…</p>
      )}
      {state === 'expired' && (
        <p role="alert" className="font-serif text-lg text-warm-neutral-700">
          This invite link has expired or already been used.
        </p>
      )}
      {state === 'error' && (
        <p role="alert" className="font-serif text-lg text-warm-neutral-700">
          Something went wrong. Please try again later.
        </p>
      )}
    </main>
  );
}
