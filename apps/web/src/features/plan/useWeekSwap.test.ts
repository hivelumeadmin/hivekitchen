import { createElement } from 'react';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useWeekSwap } from './useWeekSwap.js';

vi.mock('@/lib/fetch.js', () => ({
  hkFetch: vi.fn(),
  HkApiError: class HkApiError extends Error {},
}));

const PLAN_ID = '99999999-9999-4999-8999-999999999999';

// The proposal channel is a React Query mutation (14-s6 / D-14S1-1), so the
// hook needs a client in scope. One client per renderHook call.
function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useWeekSwap', () => {
  it('starts with an idle picker and no in-flight swap', () => {
    const { result } = renderHook(() => useWeekSwap(PLAN_ID), { wrapper: makeWrapper() });
    expect(result.current.activeSwapDay).toBeNull();
    expect(result.current.swappingItemId).toBeNull();
    expect(result.current.pendingProposal).toBeNull();
  });

  it('opens then dismisses the picker for a day', () => {
    const { result } = renderHook(() => useWeekSwap(PLAN_ID), { wrapper: makeWrapper() });

    act(() => result.current.setActiveSwapDay('monday'));
    expect(result.current.activeSwapDay).toBe('monday');

    act(() => result.current.dismissPicker());
    expect(result.current.activeSwapDay).toBeNull();
  });

  it('onSwapStarted with a variation id locks the item and closes the picker', () => {
    const { result } = renderHook(() => useWeekSwap(PLAN_ID), { wrapper: makeWrapper() });

    act(() => result.current.setActiveSwapDay('monday'));
    act(() => result.current.onSwapStarted('item-1'));

    expect(result.current.swappingItemId).toBe('item-1');
    expect(result.current.activeSwapDay).toBeNull();
    expect(result.current.pendingProposal).toBeNull();

    act(() => result.current.onSwapSettled());
    expect(result.current.swappingItemId).toBeNull();
  });

  it('a proposal flow pulses the tile (pendingProposal) without locking the canvas', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({ proposal_id: 'prop-1' } as never);
    const { result } = renderHook(() => useWeekSwap(PLAN_ID), { wrapper: makeWrapper() });

    let proposalId = '';
    await act(async () => {
      proposalId = await result.current.handleProposeSwap('monday', 'something lighter');
    });
    expect(proposalId).toBe('prop-1');

    act(() => result.current.onSwapStarted('prop-1'));

    // Proposal path: tile pulses, but swappingItemId stays null (canvas unlocked).
    expect(result.current.pendingProposal).toEqual({ id: 'prop-1', day: 'monday' });
    expect(result.current.swappingItemId).toBeNull();
    expect(result.current.activeSwapDay).toBeNull();
  });

  it('returns focus to the element that opened the picker on dismiss (WCAG 2.4.3)', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const { result } = renderHook(() => useWeekSwap(PLAN_ID), { wrapper: makeWrapper() });
    act(() => result.current.setActiveSwapDay('monday'));

    // The picker takes focus once it mounts.
    trigger.blur();
    expect(document.activeElement).not.toBe(trigger);

    act(() => result.current.dismissPicker());
    expect(document.activeElement).toBe(trigger);

    trigger.remove();
  });

  it('does not steal focus when the picker is opened with nothing focused', () => {
    const other = document.createElement('button');
    document.body.appendChild(other);

    const { result } = renderHook(() => useWeekSwap(PLAN_ID), { wrapper: makeWrapper() });
    act(() => result.current.setActiveSwapDay('monday')); // nothing focused → nothing captured

    other.focus();
    act(() => result.current.dismissPicker());

    // No trigger was captured, so dismiss must leave focus exactly where it is
    // rather than yanking it to <body>.
    expect(document.activeElement).toBe(other);

    other.remove();
  });

  it('keeps the original trigger when the picker is retargeted to another day', () => {
    const trigger = document.createElement('button');
    const insidePicker = document.createElement('button');
    document.body.append(trigger, insidePicker);
    trigger.focus();

    const { result } = renderHook(() => useWeekSwap(PLAN_ID), { wrapper: makeWrapper() });
    act(() => result.current.setActiveSwapDay('monday'));

    // Retargeting happens while focus sits inside the open picker; that node is
    // destroyed by key={activeSwapDay}, so it must not become the trigger.
    insidePicker.focus();
    act(() => result.current.setActiveSwapDay('tuesday'));
    insidePicker.remove();

    act(() => result.current.dismissPicker());
    expect(document.activeElement).toBe(trigger);

    trigger.remove();
  });

  it('does not focus a trigger that was unmounted while the picker was open', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const { result } = renderHook(() => useWeekSwap(PLAN_ID), { wrapper: makeWrapper() });
    act(() => result.current.setActiveSwapDay('monday'));

    // e.g. an SSE plan.updated clears canSwap and removes the "Swap a day" button.
    trigger.remove();

    expect(() => act(() => result.current.dismissPicker())).not.toThrow();
    expect(result.current.activeSwapDay).toBeNull();
  });

  it('handleProposeSwap throws when there is no plan', async () => {
    const { result } = renderHook(() => useWeekSwap(null), { wrapper: makeWrapper() });
    await expect(result.current.handleProposeSwap('monday', 'x')).rejects.toThrow('No plan');
  });
});
