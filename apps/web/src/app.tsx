// apps/web/src/app.tsx
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { QueryProvider } from './providers/query-provider.js';
import { DevTokensPage } from './routes/_dev-tokens.js';
import LoginPage from './routes/auth/login.js';
import AuthCallbackPage from './routes/auth/callback.js';
import AppHomePage from './routes/(app)/index.js';
import OnboardingPage from './routes/(app)/onboarding.js';

const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/auth/login" replace /> },
  { path: '/auth/login', element: <LoginPage /> },
  { path: '/auth/callback', element: <AuthCallbackPage /> },
  { path: '/app', element: <AppHomePage /> },
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
