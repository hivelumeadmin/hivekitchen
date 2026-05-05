import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { FreshnessState } from './FreshnessState.js';

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

  it('stale variant renders a foliage-400 dot', () => {
    const { container } = render(<FreshnessState variant="stale" />);
    const dot = container.querySelector('span[aria-hidden="true"]');
    expect(dot).not.toBeNull();
    expect(dot?.className).toContain('bg-foliage-400');
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
  });
});
