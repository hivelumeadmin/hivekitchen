import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PresenceIndicator } from './PresenceIndicator.js';

afterEach(() => {
  cleanup();
});

describe('PresenceIndicator', () => {
  it('renders nothing when partnerName is undefined', () => {
    const { container } = render(
      <PresenceIndicator surface={{ kind: 'plan_tile', id: 'monday' }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when partnerName is empty string', () => {
    const { container } = render(
      <PresenceIndicator
        surface={{ kind: 'plan_tile', id: 'monday' }}
        partnerName=""
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the partner name with the editing label when provided', () => {
    render(
      <PresenceIndicator
        surface={{ kind: 'plan_tile', id: 'monday' }}
        partnerName="Priya"
      />,
    );
    expect(screen.getByText('Priya is editing')).toBeDefined();
  });

  it('exposes role="status" with aria-live=polite for screen readers', () => {
    render(
      <PresenceIndicator
        surface={{ kind: 'plan_tile', id: 'monday' }}
        partnerName="Raj"
      />,
    );
    const indicator = screen.getByRole('status');
    expect(indicator.getAttribute('aria-live')).toBe('polite');
  });

  it('appends the className prop to the root span', () => {
    const { container } = render(
      <PresenceIndicator
        surface={{ kind: 'plan_tile', id: 'monday' }}
        partnerName="Amelia"
        className="absolute top-2"
      />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain('absolute');
    expect(root.className).toContain('top-2');
  });
});
