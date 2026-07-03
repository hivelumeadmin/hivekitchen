import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { createMemoryRouter, Navigate, RouterProvider } from 'react-router-dom';

// Epic 13-s11 (AC5) — mirrors the redirect + catch-all wiring in app.tsx: the
// duplicate `/app/plan` planner surface and any unknown `/app/*` path resolve to
// the Brief instead of 404ing. The route table is replicated here (app.tsx does
// not export its router) to pin the intended behavior; the full wired config is
// covered by the 13-s11 e2e spec.
function buildRouter(path: string) {
  return createMemoryRouter(
    [
      { path: '/app', element: <p>brief anchor</p> },
      { path: '/app/plan', element: <Navigate to="/app" replace /> },
      { path: '/app/*', element: <Navigate to="/app" replace /> },
    ],
    { initialEntries: [path] },
  );
}

describe('app routing redirects (Epic 13-s11)', () => {
  afterEach(() => cleanup());

  it('redirects /app/plan to the Brief', () => {
    render(<RouterProvider router={buildRouter('/app/plan')} />);
    expect(screen.getByText('brief anchor')).toBeDefined();
  });

  it('redirects an unknown /app/* path to the Brief', () => {
    render(<RouterProvider router={buildRouter('/app/does-not-exist')} />);
    expect(screen.getByText('brief anchor')).toBeDefined();
  });
});
