import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useLumiStore } from '@/stores/lumi.store.js';
import AppLayout from './layout.js';

function buildRouter(initialPath: string) {
  return createMemoryRouter(
    [
      { path: '/onboarding', element: <p>onboarding stub</p> },
      {
        element: <AppLayout />,
        children: [{ path: '/app', element: <p>app home stub</p> }],
      },
    ],
    { initialEntries: [initialPath] },
  );
}

// AppLayout mounts the LumiPanel, which reads family-language terms via TanStack
// Query (5-S10 review patch) — the real app wraps everything in QueryProvider, so
// these router-integration renders need a QueryClientProvider too.
function renderWithProviders(router: ReturnType<typeof buildRouter>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('AppLayout (router integration)', () => {
  beforeEach(() => {
    useLumiStore.getState().reset();
  });

  afterEach(() => cleanup());

  it('mounts LumiOrb on routes wrapped by AppLayout (/app)', () => {
    renderWithProviders(buildRouter('/app'));

    expect(screen.getByText(/app home stub/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /open lumi/i })).toBeDefined();
  });

  it('does NOT mount LumiOrb on flat routes outside AppLayout (/onboarding)', () => {
    renderWithProviders(buildRouter('/onboarding'));

    expect(screen.getByText(/onboarding stub/i)).toBeDefined();
    expect(screen.queryByRole('button', { name: /open lumi/i })).toBeNull();
  });
});
