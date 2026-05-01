import { StrictMode } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { OnboardingMentalModel } from './OnboardingMentalModel.js';

const originalFetch = globalThis.fetch;

const SENTENCE_ONE =
  "The plan is always ready. Change anything, anytime. You don't need to approve it.";
const SENTENCE_TWO = 'Changes save as you go. No button needed.';

function noopFetchOk(): Response {
  return new Response(null, { status: 204 });
}

describe('OnboardingMentalModel', () => {
  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('renders both mental-model sentences verbatim', () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(noopFetchOk()) as unknown as typeof fetch;

    render(<OnboardingMentalModel onComplete={() => undefined} />);

    expect(screen.getByText(SENTENCE_ONE)).toBeDefined();
    expect(screen.getByText(SENTENCE_TWO)).toBeDefined();
  });

  it('renders a single "Get started" button and no progress / coachmark chrome', () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(noopFetchOk()) as unknown as typeof fetch;

    const { container } = render(<OnboardingMentalModel onComplete={() => undefined} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toBe('Get started');

    // Anti-pattern guard: no tooltips, no role=alert, no progressbar, no list
    // chrome, no checkmark icons. The screen is two paragraphs and a button.
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(container.querySelectorAll('p')).toHaveLength(2);
  });

  it('"Get started" button calls onComplete', () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(noopFetchOk()) as unknown as typeof fetch;
    const onComplete = vi.fn();

    render(<OnboardingMentalModel onComplete={onComplete} />);

    fireEvent.click(screen.getByRole('button', { name: /Get started/i }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('fires POST /v1/onboarding/mental-model-shown on mount', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(noopFetchOk()) as unknown as ReturnType<typeof vi.fn>;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    render(<OnboardingMentalModel onComplete={() => undefined} />);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    const [calledUrl, calledInit] = (
      fetchSpy as unknown as { mock: { calls: [string, RequestInit][] } }
    ).mock.calls[0]!;
    expect(calledUrl).toContain('/v1/onboarding/mental-model-shown');
    expect(calledInit?.method).toBe('POST');
  });

  it('fires the audit beacon exactly once under React StrictMode double-invoke', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(noopFetchOk()) as unknown as ReturnType<typeof vi.fn>;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    render(
      <StrictMode>
        <OnboardingMentalModel onComplete={() => undefined} />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('swallows audit-endpoint failures (fire-and-forget) so the user is never blocked', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ type: '/errors/internal' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
    const onComplete = vi.fn();

    render(<OnboardingMentalModel onComplete={onComplete} />);

    // Both sentences and the button render; clicking the button still completes.
    expect(screen.getByText(SENTENCE_ONE)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /Get started/i }));
    expect(onComplete).toHaveBeenCalled();
    // No alert / error UI surfaces — the failure is silent by design.
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
