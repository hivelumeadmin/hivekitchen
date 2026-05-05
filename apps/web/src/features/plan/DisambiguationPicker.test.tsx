import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PlanTileSummary } from '@hivekitchen/types';
import { DisambiguationPicker } from './DisambiguationPicker.js';
import { HkApiError } from '@/lib/fetch.js';

vi.mock('@/lib/fetch.js', async () => {
  const actual = (await vi.importActual('@/lib/fetch.js')) as Record<
    string,
    unknown
  >;
  return {
    ...actual,
    hkFetch: vi.fn(),
  };
});

const PLAN_ID = '99999999-9999-4999-8999-999999999999';
const ITEM_ID_A = '00000000-0000-4000-8000-000000000010';
const ITEM_ID_B = '00000000-0000-4000-8000-000000000011';
const CHILD_A = '11111111-1111-4111-8111-111111111111';
const CHILD_B = '22222222-2222-4222-8222-222222222222';

function singleItem(): PlanTileSummary['items'] {
  return [
    {
      plan_item_id: ITEM_ID_A,
      child_id: CHILD_A,
      slot: 'main',
      ingredients: ['rice'],
    },
  ];
}

function multipleItems(): PlanTileSummary['items'] {
  return [
    {
      plan_item_id: ITEM_ID_A,
      child_id: CHILD_A,
      slot: 'main',
      ingredients: ['rice', 'lentils'],
    },
    {
      plan_item_id: ITEM_ID_B,
      child_id: CHILD_B,
      slot: 'snack',
      ingredients: ['apple'],
    },
  ];
}

function renderPicker(
  props: Partial<ComponentProps<typeof DisambiguationPicker>> = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onDismiss = vi.fn();
  const onSwapStarted = vi.fn();
  const onSwapSettled = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const utils = render(
    <DisambiguationPicker
      planId={PLAN_ID}
      day="monday"
      items={props.items ?? singleItem()}
      clearedAllergens={props.clearedAllergens ?? []}
      onDismiss={props.onDismiss ?? onDismiss}
      onSwapStarted={props.onSwapStarted ?? onSwapStarted}
      onSwapSettled={props.onSwapSettled ?? onSwapSettled}
      onRegenDay={props.onRegenDay}
    />,
    { wrapper },
  );
  return { ...utils, onDismiss, onSwapStarted, onSwapSettled };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('DisambiguationPicker — L1', () => {
  it('renders both Sick day and Change an item buttons', () => {
    renderPicker();
    expect(screen.getByRole('button', { name: /Sick day/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Change an item/i })).toBeDefined();
  });

  it('clicking Sick day fires the pause mutation, then onSwapSettled and onDismiss', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValueOnce(undefined);
    const { onDismiss, onSwapSettled } = renderPicker();

    fireEvent.click(screen.getByRole('button', { name: /Sick day/i }));

    await waitFor(() => {
      expect(onSwapSettled).toHaveBeenCalled();
      expect(onDismiss).toHaveBeenCalled();
    });
    expect(vi.mocked(hkFetch)).toHaveBeenCalledWith(
      `/v1/plans/${PLAN_ID}/days/monday/pause`,
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String) }),
      }),
    );
  });

  it('Escape key calls onDismiss', () => {
    const { onDismiss } = renderPicker();
    fireEvent.keyDown(screen.getByRole('group', { name: 'Edit Monday' }), {
      key: 'Escape',
    });
    expect(onDismiss).toHaveBeenCalled();
  });

  it('Cancel button calls onDismiss', () => {
    const { onDismiss } = renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onDismiss).toHaveBeenCalled();
  });
});

describe('DisambiguationPicker — L1 onRegenDay', () => {
  it('renders "Ask Lumi to redo this day" button when onRegenDay is provided', () => {
    const onRegenDay = vi.fn();
    renderPicker({ onRegenDay });
    expect(screen.getByRole('button', { name: /Ask Lumi to redo this day/i })).toBeDefined();
  });

  it('does not render "Ask Lumi to redo this day" button when onRegenDay is undefined', () => {
    renderPicker();
    expect(screen.queryByRole('button', { name: /Ask Lumi to redo this day/i })).toBeNull();
  });

  it('clicking the button calls onRegenDay with the current day', () => {
    const onRegenDay = vi.fn();
    renderPicker({ onRegenDay });
    fireEvent.click(screen.getByRole('button', { name: /Ask Lumi to redo this day/i }));
    expect(onRegenDay).toHaveBeenCalledTimes(1);
    expect(onRegenDay).toHaveBeenCalledWith('monday');
  });
});

describe('DisambiguationPicker — Change an item flow', () => {
  it('with multiple items: advances from L1 → L2 (slot select)', () => {
    renderPicker({ items: multipleItems() });
    fireEvent.click(screen.getByRole('button', { name: /Change an item/i }));
    expect(screen.getByText('Which slot?')).toBeDefined();
    expect(screen.getByRole('button', { name: /^main/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /^snack/ })).toBeDefined();
  });

  it('with single item: advances directly from L1 → L3 (ingredient input)', () => {
    renderPicker({ items: singleItem() });
    fireEvent.click(screen.getByRole('button', { name: /Change an item/i }));
    expect(screen.getByLabelText('What should it be instead?')).toBeDefined();
  });

  it('L2: clicking a slot advances to L3 with that slot selected', () => {
    renderPicker({ items: multipleItems() });
    fireEvent.click(screen.getByRole('button', { name: /Change an item/i }));
    fireEvent.click(screen.getByRole('button', { name: /^main/ }));
    expect(screen.getByLabelText('What should it be instead?')).toBeDefined();
  });
});

describe('DisambiguationPicker — L3 swap submit', () => {
  it('shows validation error and does not fire mutation when input is empty', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    renderPicker({ items: singleItem() });
    fireEvent.click(screen.getByRole('button', { name: /Change an item/i }));
    const swapBtn = screen.getByRole('button', { name: /Swap|Checking/ });
    expect(swapBtn.hasAttribute('disabled')).toBe(true);
    expect(vi.mocked(hkFetch)).not.toHaveBeenCalled();
  });

  it('non-allergen swap: calls onSwapStarted + onDismiss BEFORE mutation resolves', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    let resolveFetch!: (v: unknown) => void;
    vi.mocked(hkFetch).mockImplementationOnce(
      () => new Promise((res) => { resolveFetch = res; }),
    );
    const { onDismiss, onSwapStarted } = renderPicker({ items: singleItem() });
    fireEvent.click(screen.getByRole('button', { name: /Change an item/i }));
    const input = screen.getByLabelText('What should it be instead?') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'hummus, crackers' } });
    fireEvent.click(screen.getByRole('button', { name: /Swap|Checking/ }));

    await waitFor(() => {
      expect(onSwapStarted).toHaveBeenCalledWith(ITEM_ID_A);
      expect(onDismiss).toHaveBeenCalled();
    });
    resolveFetch({ item: { id: ITEM_ID_A } });
  });

  it('allergen-affecting swap: never calls onSwapStarted (no optimistic tile)', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValueOnce({ item: { id: ITEM_ID_A } });
    const { onDismiss, onSwapStarted } = renderPicker({
      items: singleItem(),
      clearedAllergens: [{ child_id: CHILD_A, allergen: 'peanut' }],
    });
    fireEvent.click(screen.getByRole('button', { name: /Change an item/i }));
    const input = screen.getByLabelText('What should it be instead?') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'peanut butter' } });
    fireEvent.click(screen.getByRole('button', { name: /Swap|Checking/ }));

    await waitFor(() => {
      expect(onDismiss).toHaveBeenCalled();
    });
    // Allergen-affecting path skips the optimistic tile-update marker.
    expect(onSwapStarted).not.toHaveBeenCalled();
  });

  it('422 error from swap shows allergy-conflict copy in picker', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockRejectedValueOnce(new HkApiError(422, { type: '/errors/swap-guardrail-blocked' }));
    renderPicker({
      items: singleItem(),
      clearedAllergens: [{ child_id: CHILD_A, allergen: 'peanut' }],
    });
    fireEvent.click(screen.getByRole('button', { name: /Change an item/i }));
    const input = screen.getByLabelText('What should it be instead?') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'peanut butter' } });
    fireEvent.click(screen.getByRole('button', { name: /Swap|Checking/ }));

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toContain('declared allergy');
    });
  });

  it('non-422 error from swap shows generic retry copy', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockRejectedValueOnce(new HkApiError(500, null));
    renderPicker({
      items: singleItem(),
      clearedAllergens: [{ child_id: CHILD_A, allergen: 'peanut' }],
    });
    fireEvent.click(screen.getByRole('button', { name: /Change an item/i }));
    const input = screen.getByLabelText('What should it be instead?') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'peanut butter' } });
    fireEvent.click(screen.getByRole('button', { name: /Swap|Checking/ }));

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toMatch(/Swap failed/i);
    });
  });
});
