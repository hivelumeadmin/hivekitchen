import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppSidebar } from './AppSidebar.js';

function renderSidebar(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppSidebar mobileOpen={false} onMobileClose={() => {}} />
    </MemoryRouter>,
  );
}

const ANCHORS = ['Brief', 'Kitchen', 'People', 'Lumi'];

describe('AppSidebar (Epic 13-s11 — 4-anchor collapse)', () => {
  afterEach(() => cleanup());

  it('renders exactly the four anchors and nothing else in the nav', () => {
    renderSidebar('/app');

    const nav = screen.getByRole('navigation', { name: /main navigation/i });
    const links = within(nav).getAllByRole('link');
    expect(links).toHaveLength(ANCHORS.length);
    for (const label of ANCHORS) {
      expect(within(nav).getByRole('link', { name: label })).toBeDefined();
    }
  });

  it('does not surface the removed Grocery / Snacks / Memory / Settings / Account links', () => {
    renderSidebar('/app');

    for (const gone of ['Grocery List', 'My Snacks', 'Memory', 'Settings', 'Account']) {
      expect(screen.queryByRole('link', { name: gone })).toBeNull();
    }
  });

  it('maps each anchor to its canonical path', () => {
    renderSidebar('/app');
    const nav = screen.getByRole('navigation', { name: /main navigation/i });

    expect(within(nav).getByRole('link', { name: 'Brief' }).getAttribute('href')).toBe('/app');
    expect(within(nav).getByRole('link', { name: 'Kitchen' }).getAttribute('href')).toBe(
      '/app/kitchen-profile',
    );
    expect(within(nav).getByRole('link', { name: 'People' }).getAttribute('href')).toBe(
      '/app/heart-notes',
    );
    expect(within(nav).getByRole('link', { name: 'Lumi' }).getAttribute('href')).toBe('/app/lumi');
  });

  it('marks Brief active at /app', () => {
    renderSidebar('/app');
    const nav = screen.getByRole('navigation', { name: /main navigation/i });
    expect(within(nav).getByRole('link', { name: 'Brief' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });

  // The Brief anchor stays visually highlighted (the active token class) while an
  // artifact is summoned over it. NavLink's aria-current tracks only the exact
  // /app match (as the old Plan link did), so the highlight is asserted via the
  // active class — that is the "highlights Brief" the AC calls for.
  it.each(['/app/day/tue', '/app/grocery-list', '/app/evening-checkin', '/app/plan/2026-05-04'])(
    'keeps Brief highlighted on the artifact URL %s',
    (path) => {
      renderSidebar(path);
      const nav = screen.getByRole('navigation', { name: /main navigation/i });
      expect(within(nav).getByRole('link', { name: 'Brief' }).className).toContain('text-amber-warm');
    },
  );

  it('does not highlight Brief on another anchor (Kitchen)', () => {
    renderSidebar('/app/kitchen-profile');
    const nav = screen.getByRole('navigation', { name: /main navigation/i });

    expect(within(nav).getByRole('link', { name: 'Brief' }).className).not.toContain(
      'text-amber-warm',
    );
    expect(within(nav).getByRole('link', { name: 'Kitchen' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });
});
