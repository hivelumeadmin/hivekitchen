import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OverridePicker } from './OverridePicker.js';

vi.mock('@/lib/fetch.js', async () => {
  const actual = (await vi.importActual('@/lib/fetch.js')) as Record<string, unknown>;
  return {
    ...actual,
    hkFetch: vi.fn(),
  };
});

const PLAN_ID = '99999999-9999-4999-8999-999999999999';
const ITEM_ID = '00000000-0000-4000-8000-000000000010';
const CHILD_ID = '11111111-1111-4111-8111-111111111111';
const OVERRIDE_DATE = '2026-05-06';

function renderPicker(overrides: { onConfirm?: () => void; onCancel?: () => void } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onConfirm = overrides.onConfirm ?? vi.fn();
  const onCancel = overrides.onCancel ?? vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const utils = render(
    <OverridePicker
      planId={PLAN_ID}
      planItemId={ITEM_ID}
      childId={CHILD_ID}
      overrideDate={OVERRIDE_DATE}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
    { wrapper },
  );
  return { ...utils, onConfirm, onCancel };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('OverridePicker', () => {
  it('renders all eight override options', () => {
    renderPicker();
    expect(screen.getByRole('button', { name: /No lunch needed/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Half-day/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Field trip/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Sick day/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Post-dentist/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Early release/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Sport practice/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Test day/i })).toBeDefined();
  });

  it('clicking an option POSTs the override and calls onConfirm', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValueOnce({
      override: {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        plan_item_id: ITEM_ID,
        child_id: CHILD_ID,
        household_id: '22222222-2222-4222-8222-222222222222',
        override_date: OVERRIDE_DATE,
        override_type: 'sport_practice',
        is_lumi_proposed: false,
        confirmed_at: '2026-05-06T08:00:00.000Z',
        reverted_at: null,
        created_at: '2026-05-06T08:00:00.000Z',
        updated_at: '2026-05-06T08:00:00.000Z',
      },
      regen_triggered: true,
    });
    const { onConfirm } = renderPicker();

    fireEvent.click(screen.getByRole('button', { name: /Sport practice/i }));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    expect(vi.mocked(hkFetch)).toHaveBeenCalledWith(
      `/v1/plans/${PLAN_ID}/items/${ITEM_ID}/override`,
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          override_type: 'sport_practice',
          override_date: OVERRIDE_DATE,
          child_id: CHILD_ID,
          is_lumi_proposed: false,
        }),
        headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String) }),
      }),
    );
  });

  it('renders an error message when the mutation rejects', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockRejectedValueOnce(new Error('boom'));
    const { onConfirm } = renderPicker();

    fireEvent.click(screen.getByRole('button', { name: /Field trip/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('Cancel button calls onCancel', () => {
    const { onCancel } = renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
