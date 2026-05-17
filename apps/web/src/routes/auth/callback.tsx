import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useScope } from '@hivekitchen/ui';
import type { LoginResponse, OAuthProvider } from '@hivekitchen/types';
import { hkFetch } from '@/lib/fetch.js';
import { useAuthStore } from '@/stores/auth.store.js';

export default function AuthCallbackPage() {
  useScope('app-scope');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const didRun = useRef(false);

  useEffect(() => {
    if (didRun.current) return;
    didRun.current = true;

    const code = params.get('code');
    const providerParam = params.get('provider');

    if (code === null || (providerParam !== 'google' && providerParam !== 'apple')) {
      navigate('/auth/login');
      return;
    }

    const provider: OAuthProvider = providerParam;

    void (async () => {
      try {
        const result = await hkFetch<LoginResponse>('/v1/auth/callback', {
          method: 'POST',
          body: { provider, code },
        });
        useAuthStore.getState().setSession(result.access_token, result.user);
        const next = params.get('next');
        const destination = next && /^\/[^/]/.test(next) ? next : '/app';
        // 2-S19: route to /onboarding whenever the user isn't fully onboarded,
        // not just on their first login. Catches resumed-after-abandon flows.
        navigate(result.is_onboarded ? destination : '/onboarding');
      } catch {
        navigate('/auth/login');
      }
    })();
  }, [params, navigate]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-bg px-6 text-fg">
      <p className="font-serif text-lg text-fg-muted">Signing you in…</p>
    </main>
  );
}
