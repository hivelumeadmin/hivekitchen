import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { CulturalPrior } from '@hivekitchen/types';
import { CulturalRatificationCard } from './CulturalRatificationCard.js';

const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const PRIOR_ID = '44444444-4444-4444-8444-444444444444';

const SAMPLE_PRIOR: CulturalPrior = {
  id: PRIOR_ID,
  household_id: HOUSEHOLD_ID,
  key: 'south_asian',
  label: 'South Asian',
  tier: 'L1',
  state: 'detected',
  presence: 80,
  confidence: 90,
  opted_in_at: null,
  opted_out_at: null,
  last_signal_at: '2026-04-28T10:00:00.000Z',
  created_at: '2026-04-28T10:00:00.000Z',
  updated_at: '2026-04-28T10:00:00.000Z',
};

const originalFetch = globalThis.fetch;

function mockOkResponse(action: 'opt_in' | 'forget' | 'tell_lumi_more'): Response {
  const updatedState =
    action === 'opt_in'
      ? 'opt_in_confirmed'
      : action === 'forget'
        ? 'forgotten'
        : 'detected';
  const body: { prior: CulturalPrior; lumi_response?: string } = {
    prior: { ...SAMPLE_PRIOR, state: updatedState },
  };
  if (action === 'tell_lumi_more') {
    body.lumi_response = 'Tell me more about how that shows up at the table.';
  }
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockProblemResponse(status: number, type: string): Response {
  return new Response(
    JSON.stringify({ type, status, title: 'error', detail: 'gate' }),
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  );
}

describe('CulturalRatificationCard', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function setup() {
    const onResolved = vi.fn();
    render(
      <CulturalRatificationCard
        prior={SAMPLE_PRIOR}
        householdId={HOUSEHOLD_ID}
        onResolved={onResolved}
      />,
    );
    return { onResolved };
  }

  it('renders the label, the prompt copy, and the three action buttons', () => {
    setup();
    expect(screen.getByText(/I noticed South Asian comes up/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /yes, keep it in mind/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /not quite — tell Lumi more/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /not for us/i })).toBeDefined();
  });

  it('opt_in tap PATCHes with action=opt_in and calls onResolved on success', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(mockOkResponse('opt_in')) as unknown as typeof fetch;
    const { onResolved } = setup();

    fireEvent.click(screen.getByRole('button', { name: /yes, keep it in mind/i }));

    await waitFor(() => {
      expect(onResolved).toHaveBeenCalledWith(PRIOR_ID, 'opt_in');
    });
    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>;
    const [, init] = fetchSpy.mock.calls[0]!;
    expect((init as RequestInit).method).toBe('PATCH');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ action: 'opt_in' });
  });

  it('forget tap PATCHes with action=forget and calls onResolved on success', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(mockOkResponse('forget')) as unknown as typeof fetch;
    const { onResolved } = setup();

    fireEvent.click(screen.getByRole('button', { name: /not for us/i }));

    await waitFor(() => {
      expect(onResolved).toHaveBeenCalledWith(PRIOR_ID, 'forget');
    });
  });

  it('tell_lumi_more shows Lumi follow-up inline and does NOT resolve the card', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(mockOkResponse('tell_lumi_more')) as unknown as typeof fetch;
    const { onResolved } = setup();

    fireEvent.click(screen.getByRole('button', { name: /not quite — tell Lumi more/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/tell me more about how that shows up at the table/i),
      ).toBeDefined();
    });
    expect(onResolved).not.toHaveBeenCalled();
  });

  it('disables buttons while in flight (resolves a slow PATCH on demand)', async () => {
    let resolveFetch: (response: Response) => void = () => {};
    const slowResponse = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    globalThis.fetch = vi.fn().mockReturnValue(slowResponse) as unknown as typeof fetch;
    setup();

    fireEvent.click(screen.getByRole('button', { name: /yes, keep it in mind/i }));

    await waitFor(() => {
      expect(
        (screen.getByRole('button', { name: /yes, keep it in mind/i }) as HTMLButtonElement).disabled,
      ).toBe(true);
    });
    expect(
      (screen.getByRole('button', { name: /not quite — tell Lumi more/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: /not for us/i }) as HTMLButtonElement).disabled,
    ).toBe(true);

    // Cleanly resolve the in-flight request before unmount.
    resolveFetch(mockOkResponse('opt_in'));
  });

  it('shows inline error on a 500 response and does NOT resolve the card', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(mockProblemResponse(500, '/errors/internal')) as unknown as typeof fetch;
    const { onResolved } = setup();

    fireEvent.click(screen.getByRole('button', { name: /yes, keep it in mind/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBeTruthy();
    });
    expect(onResolved).not.toHaveBeenCalled();
  });

  it('treats 404 as "no longer applies" and removes the card', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(mockProblemResponse(404, '/errors/not-found')) as unknown as typeof fetch;
    const { onResolved } = setup();

    fireEvent.click(screen.getByRole('button', { name: /not for us/i }));

    await waitFor(() => {
      expect(onResolved).toHaveBeenCalledWith(PRIOR_ID, 'forget');
    });
  });
});
