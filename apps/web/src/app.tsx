// apps/web/src/app.tsx
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { QueryProvider } from './providers/query-provider.js';
import { DevTokensPage } from './routes/_dev-tokens.js';
import LoginPage from './routes/auth/login.js';
import AuthCallbackPage from './routes/auth/callback.js';
import ResetPasswordPage from './routes/auth/reset-password.js';
import InviteRedeemPage from './routes/invite/$token.js';
import AppHomePage from './routes/(app)/index.js';
import OnboardingPage from './routes/(app)/onboarding.js';
import AccountPage from './routes/(app)/account.js';

function RootRedirect() {
  const hash = typeof window !== 'undefined' ? window.location.hash : '';
  if (hash) {
    const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
    if (params.get('type') === 'recovery') {
      return <Navigate to={`/auth/reset-password${hash}`} replace />;
    }
  }
  return <Navigate to="/auth/login" replace />;
}

const router = createBrowserRouter([
  { path: '/', element: <RootRedirect /> },
  { path: '/auth/login', element: <LoginPage /> },
  { path: '/auth/callback', element: <AuthCallbackPage /> },
  { path: '/auth/reset-password', element: <ResetPasswordPage /> },
  { path: '/invite/:token', element: <InviteRedeemPage /> },
  { path: '/app', element: <AppHomePage /> },
  { path: '/account', element: <AccountPage /> },
  { path: '/onboarding', element: <OnboardingPage /> },
]);

export function App() {
  if (
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    window.location.pathname === '/_dev-tokens'
  ) {
    return <DevTokensPage />;
  }
  return (
    <QueryProvider>
      <RouterProvider router={router} />
    </QueryProvider>
  );
}
