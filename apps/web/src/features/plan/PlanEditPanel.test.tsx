import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { GetPlansResponse } from '@hivekitchen/types';
import { PlanEditPanel } from './PlanEditPanel.js';
import { QueryKeys } from '@/lib/realtime/query-keys.js';
import { useLumiStore, type PlanEditScope } from '@/stores/lumi.store.js';

vi.mock('@/lib/fetch.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, hkFetch: vi.fn() };
});

const SCOPE: PlanEditScope = {
  planId: 'plan-1',
  weekOf: '2026-06-29',
  day: 'thu',
  dayLabel: 'Thursday',
  dishes: ['Veggie wraps'],
  days: ['mon', 'thu'],
  children: [{ id: 'c1', name: 'Maya' }],
};

function makeWrapper() {
  const client = new QueryClient({
    // gcTime: Infinity — the cache-write test seeds an observer-less plan entry.
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return { client, wrapper };
}

function renderPanel(scope: PlanEditScope = SCOPE) {
  const { client, wrapper } = makeWrapper();
  render(createElement(PlanEditPanel, { scope }), { wrapper });
  return { client };
}

async function typeAndSend(text: string) {
  const textarea = screen.getByLabelText('Tell Lumi what to change');
  fireEvent.change(textarea, { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  useLumiStore.getState().reset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PlanEditPanel', () => {
  it('renders the tapped-day context line', () => {
    renderPanel();
    expect(screen.getByText(/Thursday · Veggie wraps/)).toBeTruthy();
  });

  it('sends a typed utterance to /edit and renders the applied reply (AC2)', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({
      intent: { intent: 'swap_slot', confidence: 0.9, day: 'thu' },
      tier: 'T1',
      // main_assignment is optional on the applied arm — omit it here (this test
      // asserts the reply copy, not the cache write).
      result: { status: 'applied', action: 'swap_main' },
    });
    renderPanel();

    await typeAndSend('swap thursday main');

    await waitFor(() => {
      expect(hkFetch).toHaveBeenCalledWith(
        '/v1/plans/plan-1/edit',
        expect.objectContaining({ method: 'POST', body: { utterance: 'swap thursday main' } }),
      );
    });
    await waitFor(() => expect(screen.getByText(/Done — swapped the main/)).toBeTruthy());
  });

  it('writes an applied delta into the plan cache (AC3)', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    const MAIN_ID = '11111111-1111-4111-8111-111111111111';
    const NEW_RECIPE = '44444444-4444-4444-8444-444444444444';
    vi.mocked(hkFetch).mockResolvedValue({
      intent: { intent: 'swap_slot', confidence: 0.9 },
      tier: 'T1',
      result: {
        status: 'applied',
        action: 'swap_main',
        main_assignment: {
          id: MAIN_ID,
          plan_id: '22222222-2222-4222-8222-222222222222',
          sequence: 1,
          recipe_id: NEW_RECIPE,
          created_at: '2026-06-01T00:00:00.000Z',
        },
      },
    });
    const { client } = renderPanel();
    client.setQueryData(QueryKeys.planByWeek('current'), {
      plan: { id: 'plan-1' },
      main_assignments: [
        { id: MAIN_ID, plan_id: 'p', sequence: 1, recipe_id: 'old', created_at: 'x' },
      ],
      days: [],
      slots: [],
      variations: [],
      is_draft: false,
      week_of: '2026-06-29',
    } as unknown as GetPlansResponse);

    await typeAndSend('swap it');

    await waitFor(() => {
      const cached = client.getQueryData<GetPlansResponse>(QueryKeys.planByWeek('current'));
      expect(cached?.main_assignments[0]?.recipe_id).toBe(NEW_RECIPE);
    });
  });

  it('renders day chips on a day_required clarify; a chip tap re-submits { intent } with NO utterance (AC4)', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch)
      .mockResolvedValueOnce({
        intent: { intent: 'swap_slot', confidence: 0.9 },
        tier: 'T1',
        result: { status: 'clarify', reason: 'day_required' },
      })
      .mockResolvedValueOnce({
        intent: { intent: 'swap_slot', confidence: 1, day: 'mon' },
        tier: 'T0',
        result: { status: 'applied', action: 'swap_main' },
      });
    renderPanel();

    await typeAndSend('swap the main');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Monday' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Monday' }));

    await waitFor(() => expect(hkFetch).toHaveBeenCalledTimes(2));
    const secondBody = vi.mocked(hkFetch).mock.calls[1]?.[1]?.body as Record<string, unknown>;
    expect(secondBody).not.toHaveProperty('utterance');
    expect(secondBody.intent).toMatchObject({ day: 'mon', confidence: 1 });
  });

  it('gates escalation behind an explicit confirm — no T2 call before the tap (AC5)', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockImplementation((url: string) => {
      if (url.includes('/edit')) {
        return Promise.resolve({
          intent: { intent: 'recompose', confidence: 0.9 },
          tier: 'T2',
          result: { status: 'escalate', reason: 'recompose' },
        });
      }
      return Promise.resolve({ job_id: 'r1', rate_limit_remaining: 4 });
    });
    renderPanel();

    await typeAndSend('redo the whole week');
    await waitFor(() => expect(screen.getByRole('button', { name: /redraft the week/i })).toBeTruthy());

    // No regenerate call has fired yet — only the /edit classify.
    expect(vi.mocked(hkFetch).mock.calls.every((c) => (c[0] as string).includes('/edit'))).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /redraft the week/i }));

    await waitFor(() =>
      expect(hkFetch).toHaveBeenCalledWith(
        '/v1/plans/plan-1/regenerate?scope=week',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('declining an escalation recedes the sheet (AC5)', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({
      intent: { intent: 'recompose', confidence: 0.9 },
      tier: 'T2',
      result: { status: 'escalate', reason: 'recompose' },
    });
    useLumiStore.getState().setPlanEditScope(SCOPE);
    useLumiStore.getState().summon('text');
    renderPanel();

    await typeAndSend('redo the week');
    await waitFor(() => expect(screen.getByRole('button', { name: /not now/i })).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /not now/i }));
    });

    expect(useLumiStore.getState().presenceState).toBe('atRest');
    expect(useLumiStore.getState().planEditScope).toBeNull();
  });

  it('a compose_next offer opens on the confirm gate and fires /generate only on confirm (AC9)', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({
      job_id: 'gen-1',
      week_of: '2026-07-06',
      planned_days: ['monday'],
      basis: 'next_week_full',
    });
    renderPanel({ ...SCOPE, offer: 'compose_next' });

    const confirm = screen.getByRole('button', { name: /draft next week/i });
    expect(confirm).toBeTruthy();
    expect(hkFetch).not.toHaveBeenCalled(); // nothing fires on open

    fireEvent.click(confirm);

    await waitFor(() =>
      expect(hkFetch).toHaveBeenCalledWith(
        '/v1/plans/generate',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('renders a graceful failure line when the edit turn errors (AC2)', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockRejectedValue(new Error('boom'));
    renderPanel();

    await typeAndSend('swap it');

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });
});
