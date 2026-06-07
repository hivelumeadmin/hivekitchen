import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PackerChip } from './PackerChip.js';

vi.mock('@/lib/fetch.js', () => ({
  hkFetch: vi.fn(),
}));

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const DEVON_ID = '55555555-5555-4555-8555-555555555555';
const DATE = '2026-06-16';

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

describe('PackerChip (5-S3)', () => {
  it('renders "Devon packs tuesday" when an assignment exists for the date', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({
      assignments: [{ date: DATE, packer_user_id: DEVON_ID, packer_display_name: 'Devon' }],
    });

    renderWithClient(<PackerChip day="tuesday" date={DATE} householdId={HOUSEHOLD_ID} />);

    expect(await screen.findByText('Devon packs tuesday')).toBeDefined();
  });

  it('renders "Nobody\'s claimed tuesday" when there is no assignment for the date', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({ assignments: [] });

    renderWithClient(<PackerChip day="tuesday" date={DATE} householdId={HOUSEHOLD_ID} />);

    expect(await screen.findByText("Nobody's claimed tuesday")).toBeDefined();
  });

  it('opens the assignment dialog on click', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockImplementation((path: string) => {
      if (path.endsWith('/packers')) return Promise.resolve({ assignments: [] });
      if (path.endsWith('/members')) {
        return Promise.resolve({ household_display_name: null, members: [] });
      }
      throw new Error(`unexpected path ${path}`);
    });

    renderWithClient(<PackerChip day="tuesday" date={DATE} householdId={HOUSEHOLD_ID} />);

    fireEvent.click(await screen.findByText("Nobody's claimed tuesday"));

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: "Who's packing tuesday?" })).toBeDefined();
    });
  });
});
