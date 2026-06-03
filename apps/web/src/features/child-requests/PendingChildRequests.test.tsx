import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PendingChildRequests } from './PendingChildRequests.js';

vi.mock('@/lib/fetch.js', () => ({
  hkFetch: vi.fn(),
}));

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '44444444-4444-4444-8444-444444444444';
const CHILD_ID = '22222222-2222-4222-8222-222222222222';

function sampleRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: REQUEST_ID,
    child_id: CHILD_ID,
    child_name: 'Layla',
    request_text: 'I want pizza on Friday!',
    status: 'pending',
    created_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    ...overrides,
  };
}

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  document.documentElement.classList.add('app-scope');
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('app-scope');
  vi.restoreAllMocks();
});

describe('PendingChildRequests', () => {
  it('renders nothing when there are no pending requests', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({ requests: [] });

    renderWithClient(<PendingChildRequests householdId={HOUSEHOLD_ID} />);

    // No section, no label — the component returns null.
    await waitFor(() => {
      expect(screen.queryByText('From your kids')).toBeNull();
    });
  });

  it('renders a card with the child name, request text, and actions', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({ requests: [sampleRequest()] });

    renderWithClient(<PendingChildRequests householdId={HOUSEHOLD_ID} />);

    expect(await screen.findByText('From your kids')).toBeDefined();
    expect(screen.getByText('Layla')).toBeDefined();
    expect(screen.getByText('I want pizza on Friday!')).toBeDefined();
    expect(screen.getByLabelText("Approve Layla's request")).toBeDefined();
    expect(screen.getByLabelText("Decline Layla's request")).toBeDefined();
  });

  it('optimistically removes the card and POSTs to /approve', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    let pending = [sampleRequest()];
    vi.mocked(hkFetch).mockImplementation((path: string, init?: { method?: string }) => {
      if (init?.method === 'POST' && path.endsWith('/approve')) {
        pending = [];
        return Promise.resolve(undefined);
      }
      return Promise.resolve({ requests: pending });
    });

    renderWithClient(<PendingChildRequests householdId={HOUSEHOLD_ID} />);

    const approve = await screen.findByLabelText("Approve Layla's request");
    fireEvent.click(approve);

    await waitFor(() => {
      expect(screen.queryByText('I want pizza on Friday!')).toBeNull();
    });
    expect(vi.mocked(hkFetch)).toHaveBeenCalledWith(
      `/v1/child-requests/${REQUEST_ID}/approve`,
      { method: 'POST' },
    );
  });

  it('POSTs to /decline when Decline is clicked', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    let pending = [sampleRequest()];
    vi.mocked(hkFetch).mockImplementation((path: string, init?: { method?: string }) => {
      if (init?.method === 'POST' && path.endsWith('/decline')) {
        pending = [];
        return Promise.resolve(undefined);
      }
      return Promise.resolve({ requests: pending });
    });

    renderWithClient(<PendingChildRequests householdId={HOUSEHOLD_ID} />);

    const decline = await screen.findByLabelText("Decline Layla's request");
    fireEvent.click(decline);

    await waitFor(() => {
      expect(vi.mocked(hkFetch)).toHaveBeenCalledWith(
        `/v1/child-requests/${REQUEST_ID}/decline`,
        { method: 'POST' },
      );
    });
  });
});
