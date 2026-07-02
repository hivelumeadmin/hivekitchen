import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DisambiguationPicker } from './DisambiguationPicker.js';
import { HkApiError } from '@/lib/fetch.js';
import type { DaySlotView, DayTreeView } from './tree-adapter.js';

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
const SLOT_MAIN = '00000000-0000-4000-8000-000000000010';
const SLOT_SNACK = '00000000-0000-4000-8000-000000000011';
const MAIN_ASSIGNMENT_ID = '00000000-0000-4000-8000-000000000020';
const VARIATION_A = '00000000-0000-4000-8000-000000000030';
const VARIATION_B = '00000000-0000-4000-8000-000000000031';
const CHILD_A = '11111111-1111-4111-8111-111111111111';
const CHILD_B = '22222222-2222-4222-8222-222222222222';

const TS = '2026-05-06T08:00:00.000Z';

// Story 3-DM-C1 Phase 9b part 4 step 4 — fixture helpers for the tree-shape
// picker. The picker dispatches against DayTreeView (slots + variations); the
// previous flat items[] prop is retired.

function makeSlot(overrides: Partial<DaySlotView> = {}): DaySlotView {
  return {
    slot_kind: 'main',
    plan_slot_id: SLOT_MAIN,
    recipe_id: null,
    snack_sku_id: null,
    main_assignment_id: MAIN_ASSIGNMENT_ID,
    extra_kind: null,
    variations: [
      {
        id: VARIATION_A,
        plan_slot_id: SLOT_MAIN,
        child_id: CHILD_A,
        portion_size: 'regular',
        texture: 'normal',
        spice_level: 'mild',
        cutting_style: null,
        container: null,
        add_ons: [],
        removals: [],
        notes: null,
        paused_at: null,
        created_at: TS,
        updated_at: TS,
      },
    ],
    ...overrides,
  };
}

function singleSlotDayView(): DayTreeView {
  const mainSlot = makeSlot();
  return {
    day: 'monday',
    plan_day_id: '00000000-0000-4000-8000-000000000099',
    paused: false,
    slots: [mainSlot],
    mainSlot,
    snackSlot: null,
    extraSlot: null,
  };
}

function multiSlotDayView(): DayTreeView {
  const mainSlot = makeSlot({
    variations: [
      {
        id: VARIATION_A,
        plan_slot_id: SLOT_MAIN,
        child_id: CHILD_A,
        portion_size: 'regular',
        texture: 'normal',
        spice_level: 'mild',
        cutting_style: null,
        container: null,
        add_ons: [],
        removals: [],
        notes: null,
        paused_at: null,
        created_at: TS,
        updated_at: TS,
      },
    ],
  });
  const snackSlot: DaySlotView = {
    slot_kind: 'snack',
    plan_slot_id: SLOT_SNACK,
    recipe_id: '00000000-0000-4000-8000-000000000040',
    snack_sku_id: null,
    main_assignment_id: null,
    extra_kind: null,
    variations: [
      {
        id: VARIATION_B,
        plan_slot_id: SLOT_SNACK,
        child_id: CHILD_B,
        portion_size: 'small',
        texture: 'normal',
        spice_level: 'mild',
        cutting_style: null,
        container: null,
        add_ons: [],
        removals: [],
        notes: null,
        paused_at: null,
        created_at: TS,
        updated_at: TS,
      },
    ],
  };
  return {
    day: 'monday',
    plan_day_id: '00000000-0000-4000-8000-000000000099',
    paused: false,
    slots: [mainSlot, snackSlot],
    mainSlot,
    snackSlot,
    extraSlot: null,
  };
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
      dayView={props.dayView ?? singleSlotDayView()}
      clearedAllergens={props.clearedAllergens ?? []}
      onDismiss={props.onDismiss ?? onDismiss}
      onSwapStarted={props.onSwapStarted ?? onSwapStarted}
      onSwapSettled={props.onSwapSettled ?? onSwapSettled}
      onRegenDay={props.onRegenDay}
      onProposeSwap={props.onProposeSwap}
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

describe('DisambiguationPicker — L1 (tree shape)', () => {
  it('renders Sick day and Change an item buttons', () => {
    renderPicker();
    expect(screen.getByRole('button', { name: /Sick day/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Change an item/i })).toBeDefined();
  });

  it('clicking Sick day PATCHes /pause with the new PauseReason enum, then dismisses', async () => {
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
        body: expect.objectContaining({ reason: 'sick_day' }),
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

  it('does not render the redo button when onRegenDay is undefined', () => {
    renderPicker();
    expect(screen.queryByRole('button', { name: /Ask Lumi to redo this day/i })).toBeNull();
  });

  it('clicking redo calls onRegenDay with the current day', () => {
    const onRegenDay = vi.fn();
    renderPicker({ onRegenDay });
    fireEvent.click(screen.getByRole('button', { name: /Ask Lumi to redo this day/i }));
    expect(onRegenDay).toHaveBeenCalledTimes(1);
    expect(onRegenDay).toHaveBeenCalledWith('monday');
  });
});

describe('DisambiguationPicker — Change an item flow', () => {
  it('with multiple variations: advances from L1 → L2 (variation select)', () => {
    renderPicker({ dayView: multiSlotDayView() });
    fireEvent.click(screen.getByRole('button', { name: /Change an item/i }));
    expect(screen.getByText('Which child / slot?')).toBeDefined();
    expect(screen.getByRole('button', { name: /^main/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /^snack/ })).toBeDefined();
  });

  it('with single variation: advances directly from L1 → L3 (ingredient input)', () => {
    renderPicker({ dayView: singleSlotDayView() });
    fireEvent.click(screen.getByRole('button', { name: /Change an item/i }));
    expect(screen.getByLabelText('What should it be instead?')).toBeDefined();
  });

  it('L2: clicking a variation advances to L3 with that variation selected', () => {
    renderPicker({ dayView: multiSlotDayView() });
    fireEvent.click(screen.getByRole('button', { name: /Change an item/i }));
    fireEvent.click(screen.getByRole('button', { name: /^main/ }));
    expect(screen.getByLabelText('What should it be instead?')).toBeDefined();
  });
});

describe('DisambiguationPicker — L3 variation submit', () => {
  it('shows disabled state when input is empty', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    renderPicker({ dayView: singleSlotDayView() });
    fireEvent.click(screen.getByRole('button', { name: /Change an item/i }));
    const swapBtn = screen.getByRole('button', { name: /Swap|Checking/ });
    expect(swapBtn.hasAttribute('disabled')).toBe(true);
    expect(vi.mocked(hkFetch)).not.toHaveBeenCalled();
  });

  it('non-allergen variation edit: calls onSwapStarted + onDismiss BEFORE mutation resolves, then PATCHes /variations/:id with add_ons', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    let resolveFetch!: (v: unknown) => void;
    vi.mocked(hkFetch).mockImplementationOnce(
      () => new Promise((res) => { resolveFetch = res; }),
    );
    const { onDismiss, onSwapStarted } = renderPicker({ dayView: singleSlotDayView() });
    fireEvent.click(screen.getByRole('button', { name: /Change an item/i }));
    const input = screen.getByLabelText('What should it be instead?') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'hummus, crackers' } });
    fireEvent.click(screen.getByRole('button', { name: /Swap|Checking/ }));

    await waitFor(() => {
      expect(onSwapStarted).toHaveBeenCalledWith(VARIATION_A);
      expect(onDismiss).toHaveBeenCalled();
    });
    expect(vi.mocked(hkFetch)).toHaveBeenCalledWith(
      `/v1/plans/${PLAN_ID}/variations/${VARIATION_A}`,
      expect.objectContaining({
        method: 'PATCH',
        body: expect.objectContaining({ add_ons: ['hummus', 'crackers'] }),
        headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String) }),
      }),
    );
    resolveFetch({ variation: { id: VARIATION_A } });
  });

  it('allergen-affecting edit: never calls onSwapStarted (no optimistic tile)', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValueOnce({ variation: { id: VARIATION_A } });
    const { onDismiss, onSwapStarted } = renderPicker({
      dayView: singleSlotDayView(),
      clearedAllergens: [{ child_id: CHILD_A, allergen: 'peanut' }],
    });
    fireEvent.click(screen.getByRole('button', { name: /Change an item/i }));
    const input = screen.getByLabelText('What should it be instead?') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'peanut butter' } });
    fireEvent.click(screen.getByRole('button', { name: /Swap|Checking/ }));

    await waitFor(() => {
      expect(onDismiss).toHaveBeenCalled();
    });
    expect(onSwapStarted).not.toHaveBeenCalled();
  });

  it('422 error from updateVariation shows allergy-conflict copy in picker', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockRejectedValueOnce(
      new HkApiError(422, { type: '/errors/swap-guardrail-blocked' }),
    );
    renderPicker({
      dayView: singleSlotDayView(),
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

  it('non-422 error from updateVariation shows generic retry copy', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockRejectedValueOnce(new HkApiError(500, null));
    renderPicker({
      dayView: singleSlotDayView(),
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

describe('DisambiguationPicker — Swap Main / L3 proposal flow', () => {
  it('shows Swap Main when a main slot is present and onProposeSwap is provided', () => {
    renderPicker({ dayView: singleSlotDayView(), onProposeSwap: vi.fn() });
    expect(screen.getByRole('button', { name: /Swap Main/i })).toBeDefined();
  });

  it('hides Swap Main when onProposeSwap is not provided', () => {
    renderPicker({ dayView: singleSlotDayView() });
    expect(screen.queryByRole('button', { name: /Swap Main/i })).toBeNull();
  });

  it('hides Swap Main when the day has no main slot', () => {
    const view = singleSlotDayView();
    const snackOnly: DayTreeView = {
      ...view,
      slots: [
        {
          slot_kind: 'snack',
          plan_slot_id: SLOT_SNACK,
          recipe_id: '00000000-0000-4000-8000-000000000040',
          snack_sku_id: null,
          main_assignment_id: null,
          extra_kind: null,
          variations: [],
        },
      ],
      mainSlot: null,
    };
    renderPicker({ dayView: snackOnly, onProposeSwap: vi.fn() });
    expect(screen.queryByRole('button', { name: /Swap Main/i })).toBeNull();
  });

  it('transitions to L3 (breadcrumb + focused input) on Swap Main click', () => {
    renderPicker({ dayView: singleSlotDayView(), onProposeSwap: vi.fn() });
    fireEvent.click(screen.getByRole('button', { name: /Swap Main/i }));
    expect(screen.getByText(/Continuing from Monday/i)).toBeDefined();
    const input = screen.getByLabelText('What should Lumi swap it for?');
    expect(input).toBeDefined();
    expect(document.activeElement).toBe(input);
  });

  it('submits the proposal and fires onSwapStarted + onDismiss', async () => {
    const onProposeSwap = vi.fn().mockResolvedValue('proposal-uuid');
    const { onSwapStarted, onDismiss } = renderPicker({
      dayView: singleSlotDayView(),
      onProposeSwap,
    });
    fireEvent.click(screen.getByRole('button', { name: /Swap Main/i }));
    const input = screen.getByLabelText('What should Lumi swap it for?') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'something lighter' } });
    fireEvent.click(screen.getByRole('button', { name: /Ask Lumi/i }));

    await waitFor(() => {
      expect(onSwapStarted).toHaveBeenCalledWith('proposal-uuid');
      expect(onDismiss).toHaveBeenCalled();
    });
    expect(onProposeSwap).toHaveBeenCalledWith('monday', 'something lighter');
  });

  it('submits on Enter key', async () => {
    const onProposeSwap = vi.fn().mockResolvedValue('proposal-uuid');
    renderPicker({ dayView: singleSlotDayView(), onProposeSwap });
    fireEvent.click(screen.getByRole('button', { name: /Swap Main/i }));
    const input = screen.getByLabelText('What should Lumi swap it for?') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'a wrap' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(onProposeSwap).toHaveBeenCalledWith('monday', 'a wrap');
    });
  });

  it('shows an error and stays on L3 when the proposal fails', async () => {
    const onProposeSwap = vi.fn().mockRejectedValue(new Error('boom'));
    const { onDismiss } = renderPicker({
      dayView: singleSlotDayView(),
      onProposeSwap,
    });
    fireEvent.click(screen.getByRole('button', { name: /Swap Main/i }));
    const input = screen.getByLabelText('What should Lumi swap it for?') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'something lighter' } });
    fireEvent.click(screen.getByRole('button', { name: /Ask Lumi/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/Could not send/i);
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('Back on L3 returns to L1', () => {
    renderPicker({ dayView: singleSlotDayView(), onProposeSwap: vi.fn() });
    fireEvent.click(screen.getByRole('button', { name: /Swap Main/i }));
    expect(screen.getByLabelText('What should Lumi swap it for?')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('What would you like to do?')).toBeDefined();
  });
});

describe('DisambiguationPicker — Pause one child flow', () => {
  it('appears only when the day has more than one distinct child', () => {
    renderPicker({ dayView: singleSlotDayView() });
    expect(screen.queryByRole('button', { name: /Pause one child/i })).toBeNull();
    cleanup();
    renderPicker({ dayView: multiSlotDayView() });
    expect(screen.getByRole('button', { name: /Pause one child/i })).toBeDefined();
  });

  it('selecting a child PATCHes /pause-child with child_id', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValueOnce(undefined);
    const { onDismiss } = renderPicker({ dayView: multiSlotDayView() });
    fireEvent.click(screen.getByRole('button', { name: /Pause one child/i }));
    // Two child variations: pick the first.
    const firstChildBtn = screen.getAllByRole('button')[0]!;
    fireEvent.click(firstChildBtn);
    await waitFor(() => {
      expect(onDismiss).toHaveBeenCalled();
    });
    expect(vi.mocked(hkFetch)).toHaveBeenCalledWith(
      `/v1/plans/${PLAN_ID}/days/monday/pause-child`,
      expect.objectContaining({
        method: 'PATCH',
        body: expect.objectContaining({ child_id: expect.any(String) }),
      }),
    );
  });
});
