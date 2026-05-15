import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import type { OnboardingStateResponse } from '@hivekitchen/contracts';
import { OnboardingResume, formatRelative } from './OnboardingResume.js';

function makeInProgressState(
  overrides: Partial<OnboardingStateResponse> = {},
): OnboardingStateResponse {
  return {
    status: 'in_progress',
    thread_id: '11111111-1111-4111-8111-111111111111',
    modality: 'text',
    started_at: '2026-05-14T10:00:00.000Z',
    last_activity_at: '2026-05-14T10:05:00.000Z',
    turns: [],
    ...overrides,
  };
}

describe('OnboardingResume', () => {
  afterEach(() => cleanup());

  it('renders headline with first name and modality', () => {
    render(
      <OnboardingResume
        state={makeInProgressState({ modality: 'text' })}
        firstName="Menon"
        onContinue={() => {}}
        onStartOver={async () => {}}
      />,
    );
    expect(screen.getByText(/Welcome back, Menon/)).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: /You started a text interview/ }),
    ).toBeTruthy();
  });

  it('omits the first name when not provided', () => {
    render(
      <OnboardingResume
        state={makeInProgressState()}
        onContinue={() => {}}
        onStartOver={async () => {}}
      />,
    );
    expect(screen.getByText('Welcome back')).toBeTruthy();
  });

  it('Continue button fires onContinue', () => {
    const onContinue = vi.fn();
    render(
      <OnboardingResume
        state={makeInProgressState()}
        firstName="A"
        onContinue={onContinue}
        onStartOver={async () => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('voice-modality variant labels the primary button "Switch to text"', () => {
    render(
      <OnboardingResume
        state={makeInProgressState({ modality: 'voice' })}
        onContinue={() => {}}
        onStartOver={async () => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /Switch to text/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Continue$/ })).toBeNull();
  });

  it('Start over button fires onStartOver and shows in-flight label', async () => {
    let resolvePromise: () => void = () => {};
    const onStartOver = vi.fn(
      () => new Promise<void>((resolve) => (resolvePromise = resolve)),
    );
    render(
      <OnboardingResume
        state={makeInProgressState()}
        onContinue={() => {}}
        onStartOver={onStartOver}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Start over/ }));
    expect(onStartOver).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      const startingOver = screen.getByRole('button', { name: /Starting over/ });
      expect(startingOver.hasAttribute('disabled')).toBe(true);
    });
    resolvePromise();
  });
});

describe('formatRelative', () => {
  const NOW = new Date('2026-05-15T12:00:00.000Z');

  it('returns "earlier today" for a few minutes ago', () => {
    expect(formatRelative(new Date('2026-05-15T11:50:00.000Z'), NOW)).toBe('earlier today');
  });

  it('returns "today" for ≥60 min within the same UTC day', () => {
    expect(formatRelative(new Date('2026-05-15T08:00:00.000Z'), NOW)).toBe('today');
  });

  it('returns "yesterday" for one calendar day ago', () => {
    expect(formatRelative(new Date('2026-05-14T11:00:00.000Z'), NOW)).toBe('yesterday');
  });

  it('returns "N days ago" for 2–13 days', () => {
    expect(formatRelative(new Date('2026-05-10T12:00:00.000Z'), NOW)).toBe('5 days ago');
  });

  it('returns "a couple of weeks ago" for ≥14 days', () => {
    expect(formatRelative(new Date('2026-05-01T12:00:00.000Z'), NOW)).toBe(
      'a couple of weeks ago',
    );
  });

  it('returns "recently" for future timestamps (clock skew)', () => {
    expect(formatRelative(new Date('2026-05-15T13:00:00.000Z'), NOW)).toBe('recently');
  });
});
