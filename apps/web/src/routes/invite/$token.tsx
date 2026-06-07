import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { RedeemInviteResponse, AcceptInviteResponse } from '@hivekitchen/types';
import { hkFetch, HkApiError } from '@/lib/fetch.js';
import { useAuthStore } from '@/stores/auth.store.js';

type InviteState = 'loading' | 'accept' | 'expired' | 'error';

// The invite URL path segment is base64url(rawJwt) — the whole signed JWT is
// re-encoded by InviteService.createInvite — so decoding the role is two steps:
// outer base64url → "header.payload.sig", then the payload segment → claims.
function base64UrlDecode(input: string): string {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  return atob(padded);
}

function decodeInviteRole(token: string): string | null {
  try {
    const rawJwt = base64UrlDecode(token);
    const payloadPart = rawJwt.split('.')[1];
    if (!payloadPart) return null;
    const payload = JSON.parse(base64UrlDecode(payloadPart)) as { role?: string };
    return payload.role ?? null;
  } catch {
    return null;
  }
}

export default function InviteRedeemPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const didRun = useRef(false);
  const [state, setState] = useState<InviteState>('loading');
  const [isAccepting, setIsAccepting] = useState(false);

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

    const role = decodeInviteRole(token);

    // Secondary-caregiver flow (5-S2): show a confirmation interstitial first
    // so the user explicitly accepts before the invite is consumed.
    if (role === 'secondary_caregiver') {
      setState('accept');
      return;
    }

    // Guest-author (and any non-decodable role) flow — unchanged from 4-S13:
    // the public redeem endpoint marks the invite and returns a scope_target.
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

  async function handleAccept() {
    if (!token) return;
    setIsAccepting(true);
    try {
      const result = await hkFetch<AcceptInviteResponse>('/v1/auth/invites/accept', {
        method: 'POST',
        body: { token },
      });
      useAuthStore.getState().setSession(result.access_token, result.user);
      if (/^\/[^/]/.test(result.scope_target)) {
        navigate(result.scope_target, { replace: true });
      } else {
        setState('error');
      }
    } catch (err) {
      if (err instanceof HkApiError && err.status === 410) {
        setState('expired');
      } else if (err instanceof HkApiError && err.status === 401) {
        navigate(`/auth/login?next=${encodeURIComponent(`/invite/${token}`)}`, { replace: true });
      } else {
        setState('error');
      }
    } finally {
      setIsAccepting(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-bg px-6 text-fg">
      {state === 'loading' && (
        <p className="font-serif text-lg text-fg-muted">Checking your invite…</p>
      )}
      {state === 'accept' && (
        <div className="w-full max-w-sm space-y-6 text-center">
          <h1 className="font-serif text-2xl text-fg">
            You&apos;ve been invited to join a household as a Caregiver
          </h1>
          <p className="font-sans text-base text-fg-muted">
            Once you accept, you&apos;ll be able to help plan meals together.
          </p>
          <button
            type="button"
            onClick={() => void handleAccept()}
            disabled={isAccepting}
            className="w-full rounded bg-amber-warm px-4 py-3 font-sans text-sm font-medium text-bg transition-colors hover:bg-amber motion-reduce:transition-none disabled:opacity-50"
          >
            {isAccepting ? 'Accepting…' : 'Accept invitation'}
          </button>
        </div>
      )}
      {state === 'expired' && (
        <p role="alert" className="font-serif text-lg text-fg-muted">
          This invite link has expired or already been used.
        </p>
      )}
      {state === 'error' && (
        <p role="alert" className="font-serif text-lg text-fg-muted">
          Something went wrong. Please try again later.
        </p>
      )}
    </main>
  );
}
