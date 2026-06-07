import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PackerAssignmentDialog } from './PackerAssignmentDialog.js';

vi.mock('@/lib/fetch.js', () => ({
  hkFetch: vi.fn(),
}));

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const ALEX_ID = '22222222-2222-4222-8222-222222222222';
const DEVON_ID = '55555555-5555-4555-8555-555555555555';
const DATE = '2026-06-16';

const members = [
  { user_id: ALEX_ID, display_name: 'Alex', role: 'primary_parent' },
  { user_id: DEVON_ID, display_name: 'Devon', role: 'secondary_caregiver' },
];

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

describe('PackerAssignmentDialog (5-S3)', () => {
  it('renders the member list from GET /members', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({ household_display_name: null, members });

    renderWithClient(
      <PackerAssignmentDialog
        day="tuesday"
        date={DATE}
        householdId={HOUSEHOLD_ID}
        open
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText('Alex')).toBeDefined();
    expect(screen.getByText('Devon')).toBeDefined();
    expect(screen.getByText('Nobody')).toBeDefined();
  });

  it('PATCHes the selected packer_user_id on Assign', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockImplementation((path: string, init?: { method?: string }) => {
      if (init?.method === 'PATCH') return Promise.resolve(undefined);
      return Promise.resolve({ household_display_name: null, members });
    });
    const onClose = vi.fn();

    renderWithClient(
      <PackerAssignmentDialog
        day="tuesday"
        date={DATE}
        householdId={HOUSEHOLD_ID}
        open
        onClose={onClose}
      />,
    );

    fireEvent.click(await screen.findByLabelText('Devon'));
    fireEvent.click(screen.getByRole('button', { name: 'Assign' }));

    await waitFor(() => {
      expect(vi.mocked(hkFetch)).toHaveBeenCalledWith(
        `/v1/households/${HOUSEHOLD_ID}/days/${DATE}/packer`,
        { method: 'PATCH', body: { packer_user_id: DEVON_ID } },
      );
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('PATCHes packer_user_id: null when "Nobody" is selected', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockImplementation((path: string, init?: { method?: string }) => {
      if (init?.method === 'PATCH') return Promise.resolve(undefined);
      return Promise.resolve({ household_display_name: null, members });
    });

    renderWithClient(
      <PackerAssignmentDialog
        day="tuesday"
        date={DATE}
        householdId={HOUSEHOLD_ID}
        open
        onClose={vi.fn()}
      />,
    );

    // "Nobody" is selected by default (selectedUserId starts null).
    await screen.findByText('Devon');
    fireEvent.click(screen.getByRole('button', { name: 'Assign' }));

    await waitFor(() => {
      expect(vi.mocked(hkFetch)).toHaveBeenCalledWith(
        `/v1/households/${HOUSEHOLD_ID}/days/${DATE}/packer`,
        { method: 'PATCH', body: { packer_user_id: null } },
      );
    });
  });
});
