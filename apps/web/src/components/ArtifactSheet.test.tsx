import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ArtifactSheet } from './ArtifactSheet.js';

function LocationDisplay() {
  const { pathname } = useLocation();
  return <p data-testid="location">{pathname}</p>;
}

function renderArtifact(startPath = '/app/grocery-list') {
  return render(
    <MemoryRouter initialEntries={[startPath]}>
      <ArtifactSheet label="Grocery list">
        <p>hosted grocery content</p>
      </ArtifactSheet>
      <LocationDisplay />
    </MemoryRouter>,
  );
}

describe('ArtifactSheet (Epic 13-s11 — artifact over the Brief)', () => {
  afterEach(() => cleanup());

  it('renders a modal dialog labelled by the artifact name, hosting the content', () => {
    renderArtifact();

    const dialog = screen.getByRole('dialog', { name: /grocery list/i });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('hosted grocery content')).toBeDefined();
  });

  it('navigates to /app when the close affordance is used', () => {
    renderArtifact();

    fireEvent.click(screen.getByRole('button', { name: /close grocery list/i }));
    expect(screen.getByTestId('location').textContent).toBe('/app');
  });

  it('navigates to /app on Escape (Dialog a11y contract)', () => {
    renderArtifact();
    expect(screen.getByRole('dialog', { name: /grocery list/i })).toBeDefined();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByTestId('location').textContent).toBe('/app');
  });

  it('navigates to /app when the scrim is clicked', () => {
    renderArtifact();

    const scrim = document.querySelector('[aria-hidden="true"]')!;
    fireEvent.click(scrim);
    expect(screen.getByTestId('location').textContent).toBe('/app');
  });
});
