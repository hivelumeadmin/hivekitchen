import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useWeekSwap } from './useWeekSwap.js';

vi.mock('@/lib/fetch.js', () => ({ hkFetch: vi.fn() }));

const PLAN_ID = '99999999-9999-4999-8999-999999999999';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useWeekSwap', () => {
  it('starts with an idle picker and no in-flight swap', () => {
    const { result } = renderHook(() => useWeekSwap(PLAN_ID));
    expect(result.current.activeSwapDay).toBeNull();
    expect(result.current.swappingItemId).toBeNull();
    expect(result.current.pendingProposal).toBeNull();
  });

  it('opens then dismisses the picker for a day', () => {
    const { result } = renderHook(() => useWeekSwap(PLAN_ID));

    act(() => result.current.setActiveSwapDay('monday'));
    expect(result.current.activeSwapDay).toBe('monday');

    act(() => result.current.dismissPicker());
    expect(result.current.activeSwapDay).toBeNull();
  });

  it('onSwapStarted with a variation id locks the item and closes the picker', () => {
    const { result } = renderHook(() => useWeekSwap(PLAN_ID));

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
    const { result } = renderHook(() => useWeekSwap(PLAN_ID));

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

  it('handleProposeSwap throws when there is no plan', async () => {
    const { result } = renderHook(() => useWeekSwap(null));
    await expect(result.current.handleProposeSwap('monday', 'x')).rejects.toThrow('No plan');
  });
});
