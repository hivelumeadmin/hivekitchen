import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { FreshnessState, formatEstimatedRecovery } from './FreshnessState.js';

afterEach(() => {
  cleanup();
});

describe('FreshnessState', () => {
  it('renders nothing when variant is fresh', () => {
    const { container } = render(<FreshnessState variant="fresh" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the standard error message when variant is failed', () => {
    render(<FreshnessState variant="failed" />);
    expect(
      screen.getByText("Lumi couldn't reach the plan right now."),
    ).toBeDefined();
  });

  it('renders drafting copy when variant is loading', () => {
    render(<FreshnessState variant="loading" />);
    expect(
      screen.getByText("Lumi is drafting this week's plan. About 30 seconds."),
    ).toBeDefined();
  });

  it('renders offline fallback copy when variant is offline', () => {
    render(<FreshnessState variant="offline" />);
    expect(
      screen.getByText("You're offline. Yesterday's plan below."),
    ).toBeDefined();
  });

  it('renders text containing "last synced" when variant is stale and lastSyncedAt is provided', () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    render(<FreshnessState variant="stale" lastSyncedAt={fiveMinutesAgo} />);
    expect(screen.getByText(/last synced/)).toBeDefined();
  });

  it('renders generic "Checking…" when variant is stale and lastSyncedAt is missing', () => {
    render(<FreshnessState variant="stale" />);
    expect(screen.getByText('Checking…')).toBeDefined();
  });

  it('stale variant renders a foliage dot', () => {
    const { container } = render(<FreshnessState variant="stale" />);
    const dot = container.querySelector('span[aria-hidden="true"]');
    expect(dot).not.toBeNull();
    expect(dot?.className).toContain('bg-foliage');
  });

  it('stale variant uses motion-safe:animate-pulse on the foliage dot', () => {
    const { container } = render(<FreshnessState variant="stale" />);
    const dot = container.querySelector('span[aria-hidden="true"]');
    expect(dot?.className).toContain('motion-safe:animate-pulse');
  });

  it('non-fresh variants expose role="status" on the rendered <p>', () => {
    render(<FreshnessState variant="failed" />);
    expect(screen.getByRole('status')).toBeDefined();
    cleanup();
    render(<FreshnessState variant="loading" />);
    expect(screen.getByRole('status')).toBeDefined();
    cleanup();
    render(<FreshnessState variant="offline" />);
    expect(screen.getByRole('status')).toBeDefined();
    cleanup();
    render(<FreshnessState variant="stale" />);
    expect(screen.getByRole('status')).toBeDefined();
    cleanup();
    render(<FreshnessState variant="reworking" />);
    expect(screen.getByRole('status')).toBeDefined();
  });
});

describe('FreshnessState — reworking variant (Story 3.26)', () => {
  it('renders the reworking copy fragment', () => {
    render(<FreshnessState variant="reworking" />);
    expect(screen.getByText(/Lumi is reworking this week's plan/)).toBeDefined();
  });

  it('falls back to "within the hour" when failedAt is absent', () => {
    render(<FreshnessState variant="reworking" />);
    expect(screen.getByText(/within the hour/)).toBeDefined();
  });

  it('shows "soon" when failedAt + 1h is already past', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
    render(<FreshnessState variant="reworking" failedAt={twoHoursAgo} />);
    expect(screen.getByText(/soon/)).toBeDefined();
  });

  it('shows a locale time string when failedAt + 1h is in the future', () => {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60_000).toISOString();
    render(<FreshnessState variant="reworking" failedAt={thirtyMinutesAgo} />);
    const p = screen.getByRole('status');
    expect(p.textContent).not.toContain('soon');
    expect(p.textContent).not.toContain('within the hour');
    // ETA (~30 min from now) is some locale-formatted time string — just assert
    // it landed somewhere in the rendered text.
    expect((p.textContent ?? '').length).toBeGreaterThan(0);
  });

  it('exposes role="status" and aria-live="polite"', () => {
    render(<FreshnessState variant="reworking" />);
    const node = screen.getByRole('status');
    expect(node.getAttribute('aria-live')).toBe('polite');
  });

  it('uses warm-neutral token, no error/red/destructive tokens', () => {
    const { container } = render(<FreshnessState variant="reworking" />);
    const p = container.querySelector('p');
    expect(p?.className).toContain('text-fg-muted');
    expect(p?.className).not.toContain('red');
    expect(p?.className).not.toContain('destructive');
    expect(p?.className).not.toContain('error');
  });
});

describe('formatEstimatedRecovery (Story 3.26)', () => {
  it('returns "within the hour" when failedAt is undefined', () => {
    expect(formatEstimatedRecovery(undefined)).toBe('within the hour');
  });

  it('returns "within the hour" when failedAt is an invalid date string', () => {
    expect(formatEstimatedRecovery('not-a-date')).toBe('within the hour');
  });

  it('returns "soon" when failedAt + 1h is in the past', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
    expect(formatEstimatedRecovery(twoHoursAgo)).toBe('soon');
  });

  it('returns a non-empty time string when failedAt + 1h is in the future', () => {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60_000).toISOString();
    const result = formatEstimatedRecovery(thirtyMinutesAgo);
    expect(result).not.toBe('soon');
    expect(result).not.toBe('within the hour');
    expect(result.length).toBeGreaterThan(0);
  });
});
