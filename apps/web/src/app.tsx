// apps/web/src/app.tsx
import { useEffect } from 'react';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { QueryProvider } from './providers/query-provider.js';
import { DevDayDetailPage } from './routes/_dev-day-detail.js';
import { DevDayDetailMultiChildPage } from './routes/_dev-day-detail-multi-child.js';
import { DevEveningCheckinPage } from './routes/_dev-evening-checkin.js';
import { DevGroceryListPage } from './routes/_dev-grocery-list.js';
import { DevHeartNotePage } from './routes/_dev-heart-note.js';
import { DevKitchenInspirationPage } from './routes/_dev-kitchen-inspiration.js';
import { DevKitchenInterviewPage } from './routes/_dev-kitchen-interview.js';
import { DevKitchenProfilePage } from './routes/_dev-kitchen-profile.js';
import { DevLoginPage } from './routes/_dev-login.js';
import { DevLunchLinkPage } from './routes/_dev-lunch-link.js';
import { DevOnboardingPage } from './routes/_dev-onboarding.js';
import { DevTokensPage } from './routes/_dev-tokens.js';
import LoginPage from './routes/auth/login.js';
import AuthCallbackPage from './routes/auth/callback.js';
import ResetPasswordPage from './routes/auth/reset-password.js';
import InviteRedeemPage from './routes/invite/$token.js';
import GrandparentScopeLayout from './routes/(grandparent)/layout.js';
import GrandparentComposePage from './routes/(grandparent)/compose.js';
import AppLayout from './routes/(app)/layout.js';
import AppHomePage from './routes/(app)/index.js';
import OnboardingPage from './routes/(app)/onboarding.js';
import AccountPage from './routes/(app)/account.js';
import PlanRoute from './routes/(app)/plan.js';
import PlanHistoryRoute from './routes/(app)/plan-history.js';
import ChildSchoolPoliciesPage from './routes/(app)/child-school-policies.js';
import ChildBagCompositionPage from './routes/(app)/child-bag-composition.js';
import ChildExtraRulesPage from './routes/(app)/child-extra-rules.js';
import DayDetailRoute from './routes/(app)/day-detail.js';
import HeartNoteRoute from './routes/(app)/heart-note.js';
import HeartNotesRoute from './routes/(app)/heart-notes.js';
import EveningCheckinRoute from './routes/(app)/evening-checkin.js';
import GroceryListRoute from './routes/(app)/grocery-list.js';
import KitchenInspirationRoute from './routes/(app)/kitchen-inspiration.js';
import KitchenProfileRoute from './routes/(app)/kitchen-profile.js';
import SnackShelfRoute from './routes/(app)/snack-shelf.js';
import MemoryRoute from './routes/(app)/memory.js';
import HouseholdSettingsRoute from './routes/(app)/household-settings.js';
import MemoryDashboardRoute from './routes/(app)/memory-dashboard.js';
import ConsentHistoryRoute from './routes/(app)/consent-history.js';
import LunchLinkRoute from './routes/(app)/lunch-link.js';
import ChildFlavorPassportPage from './routes/(app)/child-flavor-passport.js';
import LunchPassportRoute from './routes/(app)/lunch-passport.js';

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
  // Grandparent composer — `.grandparent-scope` (single-column, no app shell,
  // no ambient Lumi). GrandparentScopeLayout sets the scope class and renders
  // its child directly, so the page is wrapped here rather than via an Outlet.
  {
    path: '/guest-author/compose',
    element: (
      <GrandparentScopeLayout>
        <GrandparentComposePage />
      </GrandparentScopeLayout>
    ),
  },
  // Onboarding owns its own Lumi surface — kept flat (no AppLayout, no ambient orb).
  { path: '/onboarding', element: <OnboardingPage /> },
  // Authenticated household routes get the ambient Lumi orb + panel via AppLayout.
  {
    element: <AppLayout />,
    children: [
      { path: '/app', element: <AppHomePage /> },
      { path: '/app/plan', element: <PlanRoute /> },
      { path: '/app/plan/:weekId', element: <PlanHistoryRoute /> },
      { path: '/app/children/:childId/school-policies', element: <ChildSchoolPoliciesPage /> },
      { path: '/app/children/:childId/bag-composition', element: <ChildBagCompositionPage /> },
      { path: '/app/children/:childId/extra-rules', element: <ChildExtraRulesPage /> },
      { path: '/app/children/:childId/flavor-passport', element: <ChildFlavorPassportPage /> },
      { path: '/app/day/:day', element: <DayDetailRoute /> },
      { path: '/app/heart-note', element: <HeartNoteRoute /> },
      { path: '/app/heart-notes', element: <HeartNotesRoute /> },
      { path: '/app/evening-checkin', element: <EveningCheckinRoute /> },
      { path: '/app/grocery-list', element: <GroceryListRoute /> },
      { path: '/app/inspiration', element: <KitchenInspirationRoute /> },
      { path: '/app/kitchen-profile', element: <KitchenProfileRoute /> },
      { path: '/app/kitchen/snacks', element: <SnackShelfRoute /> },
      { path: '/app/memory', element: <MemoryRoute /> },
      { path: '/app/household/settings', element: <HouseholdSettingsRoute /> },
      { path: '/app/memory/dashboard', element: <MemoryDashboardRoute /> },
      { path: '/app/memory/consent-history', element: <ConsentHistoryRoute /> },
      // Lunch Link — child-scope surface. AppLayout's useMatch('/lunch/*')
      // suppresses the parent LumiOrb/LumiPanel for these routes.
      { path: '/lunch/:linkId', element: <LunchLinkRoute /> },
      { path: '/lunch/:linkId/passport', element: <LunchPassportRoute /> },
      { path: '/account', element: <AccountPage /> },
    ],
  },
]);

import { useLumiStore } from './stores/lumi.store.js';
import { useAuthStore } from './stores/auth.store.js';
import { tryRefreshSession } from './lib/fetch.js';
import { DevTools } from './components/DevTools.js';

if (import.meta.env.VITE_E2E && typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__lumiStore = useLumiStore;
  (window as unknown as Record<string, unknown>).__authStore = useAuthStore;
}

export function App() {
  const isRestoring = useAuthStore((s) => s.isRestoring);

  // Restore session from the httpOnly refresh cookie on every page load.
  // isRestoring gates the router until tryRefreshSession settles — prevents
  // route guards from seeing accessToken:null and redirecting to login before
  // the refresh completes.
  useEffect(() => {
    void tryRefreshSession();
  }, []);

  if (isRestoring) return null;

  if (
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    window.location.pathname === '/_dev-tokens'
  ) {
    return <DevTokensPage />;
  }
  if (
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    window.location.pathname === '/_dev-day-detail'
  ) {
    return <DevDayDetailPage />;
  }
  if (
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    window.location.pathname === '/_dev-day-detail-multi-child'
  ) {
    return <DevDayDetailMultiChildPage />;
  }
  if (
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    window.location.pathname === '/_dev-heart-note'
  ) {
    return <DevHeartNotePage />;
  }
  if (
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    window.location.pathname === '/_dev-login'
  ) {
    return <DevLoginPage />;
  }
  if (
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    window.location.pathname === '/_dev-onboarding'
  ) {
    return <DevOnboardingPage />;
  }
  if (
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    window.location.pathname === '/_dev-kitchen-interview'
  ) {
    return <DevKitchenInterviewPage />;
  }
  if (
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    window.location.pathname === '/_dev-evening-checkin'
  ) {
    return <DevEveningCheckinPage />;
  }
  if (
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    window.location.pathname === '/_dev-grocery-list'
  ) {
    return <DevGroceryListPage />;
  }
  if (
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    window.location.pathname === '/_dev-kitchen-profile'
  ) {
    return <DevKitchenProfilePage />;
  }
  if (
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    window.location.pathname === '/_dev-kitchen-inspiration'
  ) {
    return <DevKitchenInspirationPage />;
  }
  if (
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    window.location.pathname === '/_dev-lunch-link'
  ) {
    return <DevLunchLinkPage />;
  }
  return (
    <QueryProvider>
      <RouterProvider router={router} />
      {import.meta.env.DEV && <DevTools />}
    </QueryProvider>
  );
}
