import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { LearningMomentCallout } from '@hivekitchen/types';
import { LumiCallout } from './LumiCallout.js';

vi.mock('@/lib/fetch.js', () => ({
  hkFetch: vi.fn(),
}));

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const NODE_ID = '22222222-2222-4222-8222-222222222222';

const callout: LearningMomentCallout = {
  prose: "I've noticed your family loves spicy food — want me to keep that in mind?",
  node_ids: [NODE_ID],
  surfaced_at: '2026-06-07T12:00:00.000Z',
};

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('LumiCallout (5-S8)', () => {
  it('renders the prose from the callout', () => {
    renderWithClient(<LumiCallout callout={callout} householdId={HOUSEHOLD_ID} />);
    expect(screen.getByText(callout.prose)).toBeDefined();
  });

  it('POSTs action=confirm on [Yes, keep it in mind]', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue(undefined);

    renderWithClient(<LumiCallout callout={callout} householdId={HOUSEHOLD_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Yes, keep it in mind' }));

    await waitFor(() => {
      expect(vi.mocked(hkFetch)).toHaveBeenCalledWith(
        `/v1/households/${HOUSEHOLD_ID}/brief/learning-moment`,
        { method: 'POST', body: { action: 'confirm' } },
      );
    });
  });

  it('POSTs action=dismiss on [Not for us]', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue(undefined);

    renderWithClient(<LumiCallout callout={callout} householdId={HOUSEHOLD_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Not for us' }));

    await waitFor(() => {
      expect(vi.mocked(hkFetch)).toHaveBeenCalledWith(
        `/v1/households/${HOUSEHOLD_ID}/brief/learning-moment`,
        { method: 'POST', body: { action: 'dismiss' } },
      );
    });
  });

  it('POSTs action=tell_more and invokes onTellMore on [Tell me more]', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue(undefined);
    const onTellMore = vi.fn();

    renderWithClient(
      <LumiCallout callout={callout} householdId={HOUSEHOLD_ID} onTellMore={onTellMore} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Tell me more' }));

    await waitFor(() => {
      expect(vi.mocked(hkFetch)).toHaveBeenCalledWith(
        `/v1/households/${HOUSEHOLD_ID}/brief/learning-moment`,
        { method: 'POST', body: { action: 'tell_more' } },
      );
    });
    await waitFor(() => expect(onTellMore).toHaveBeenCalled());
  });

  it('disables the action buttons while a request is in flight', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    let resolve: (() => void) | undefined;
    vi.mocked(hkFetch).mockImplementation(
      () => new Promise<undefined>((r) => { resolve = () => r(undefined); }),
    );

    renderWithClient(<LumiCallout callout={callout} householdId={HOUSEHOLD_ID} />);
    const confirmBtn = screen.getByRole('button', { name: 'Yes, keep it in mind' });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect((confirmBtn as HTMLButtonElement).disabled).toBe(true);
    });
    expect((screen.getByRole('button', { name: 'Not for us' }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    resolve?.();
  });

  it('shows an error message and re-enables buttons when the request fails', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockRejectedValue(new Error('network error'));

    renderWithClient(<LumiCallout callout={callout} householdId={HOUSEHOLD_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Yes, keep it in mind' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });
    expect(
      (screen.getByRole('button', { name: 'Yes, keep it in mind' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});
