import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
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

describe('AppLayout (router integration)', () => {
  beforeEach(() => {
    useLumiStore.getState().reset();
  });

  afterEach(() => cleanup());

  it('mounts LumiOrb on routes wrapped by AppLayout (/app)', () => {
    render(<RouterProvider router={buildRouter('/app')} />);

    expect(screen.getByText(/app home stub/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /open lumi/i })).toBeDefined();
  });

  it('does NOT mount LumiOrb on flat routes outside AppLayout (/onboarding)', () => {
    render(<RouterProvider router={buildRouter('/onboarding')} />);

    expect(screen.getByText(/onboarding stub/i)).toBeDefined();
    expect(screen.queryByRole('button', { name: /open lumi/i })).toBeNull();
  });
});
