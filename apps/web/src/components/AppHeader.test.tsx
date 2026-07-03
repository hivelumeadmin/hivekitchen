import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { AppHeader } from './AppHeader.js';

function LocationDisplay() {
  const { pathname } = useLocation();
  return <p data-testid="location">{pathname}</p>;
}

function renderHeader() {
  return render(
    <MemoryRouter initialEntries={['/app']}>
      <AppHeader />
      <LocationDisplay />
    </MemoryRouter>,
  );
}

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: /user menu/i }));
}

describe('AppHeader user menu (Epic 13-s11 — Settings + Account)', () => {
  afterEach(() => cleanup());

  it('surfaces Settings and Account above Sign out in the user menu', () => {
    renderHeader();
    openMenu();

    expect(screen.getByRole('button', { name: 'Settings' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Account' })).toBeDefined();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeDefined();
  });

  it('navigates to household settings when Settings is chosen', () => {
    renderHeader();
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(screen.getByTestId('location').textContent).toBe('/app/household/settings');
  });

  it('navigates to the account page when Account is chosen', () => {
    renderHeader();
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Account' }));

    expect(screen.getByTestId('location').textContent).toBe('/account');
  });
});
