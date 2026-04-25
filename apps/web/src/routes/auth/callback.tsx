import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useScope } from '@hivekitchen/ui';
import type { LoginResponse, OAuthProvider } from '@hivekitchen/types';
import { hkFetch } from '@/lib/fetch.js';
import { useAuthStore } from '@/stores/auth.store.js';

export default function AuthCallbackPage() {
  useScope('app-scope');
  const navigate = useNavigate();
  const [params] = useSearchParams();

  useEffect(() => {
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
        const destination = next && next.startsWith('/') ? next : '/app';
        navigate(result.is_first_login ? '/onboarding' : destination);
      } catch {
        navigate('/auth/login');
      }
    })();
  }, [params, navigate]);

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <p className="font-serif text-lg text-warm-neutral-700">Signing you in…</p>
    </main>
  );
}
