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
    const provider: OAuthProvider = providerParam === 'apple' ? 'apple' : 'google';

    if (code === null) {
      navigate('/auth/login');
      return;
    }

    void (async () => {
      const result = await hkFetch<LoginResponse>('/v1/auth/callback', {
        method: 'POST',
        body: { provider, code },
      });
      useAuthStore.getState().setSession(result.access_token, result.user);
      const next = params.get('next');
      navigate(result.is_first_login ? '/onboarding' : (next ?? '/app'));
    })();
  }, [params, navigate]);

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <p className="font-serif text-lg text-warm-neutral-700">Signing you in…</p>
    </main>
  );
}
