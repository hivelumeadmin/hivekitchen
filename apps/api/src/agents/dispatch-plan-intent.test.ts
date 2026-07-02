import { describe, it, expect } from 'vitest';
import { dispatchPlanIntent, type DispatchDeps, type DispatchContext } from './dispatch-plan-intent.js';
import type { PlanIntentResult } from './route-plan-intent.js';
import type { CatalogCandidate } from '../services/catalog-pick.service.js';

const CANDIDATE: CatalogCandidate = { id: 'r1', kind: 'recipe', title: 'Teriyaki rice bowls' };

interface PickCall {
  householdId: string;
  slot: string;
  excludeRecipeIds?: readonly string[];
  constraint?: string | null;
}

function deps(candidate: CatalogCandidate | null, capture?: (c: PickCall) => void): DispatchDeps {
  return {
    catalog: {
      pickRecipe: (args) => {
        capture?.(args);
        return Promise.resolve(candidate);
      },
    },
  };
}

const ctx: DispatchContext = { householdId: 'hh', weekExcludeRecipeIds: ['used-1'] };
const noCatalog: DispatchDeps = { catalog: { pickRecipe: () => Promise.reject(new Error('should not be called')) } };

const intent = (o: Partial<PlanIntentResult> & { intent: PlanIntentResult['intent'] }): PlanIntentResult => ({
  confidence: 0.9,
  ...o,
});

describe('dispatchPlanIntent — non-catalog intents (no catalog call)', () => {
  it('inspect/explain → T0 read with target', async () => {
    const r = await dispatchPlanIntent(intent({ intent: 'inspect', day: 'tue' }), ctx, noCatalog);
    expect(r).toEqual({ tier: 'T0', action: 'read', intent: 'inspect', target: { day: 'tue' } });
  });

  it('affirm → T0 noop', async () => {
    expect(await dispatchPlanIntent(intent({ intent: 'affirm' }), ctx, noCatalog)).toEqual({
      tier: 'T0',
      action: 'noop',
    });
  });

  it('commit → T0 commit', async () => {
    expect(await dispatchPlanIntent(intent({ intent: 'commit' }), ctx, noCatalog)).toEqual({
      tier: 'T0',
      action: 'commit',
    });
  });

  it('vary_slot with a variation → T0 vary', async () => {
    const r = await dispatchPlanIntent(
      intent({ intent: 'vary_slot', variation: 'spice:down', childId: 'c1', day: 'mon' }),
      ctx,
      noCatalog,
    );
    expect(r).toEqual({
      tier: 'T0',
      action: 'vary',
      intent: 'vary_slot',
      variation: 'spice:down',
      target: { day: 'mon', childId: 'c1' },
    });
  });

  it('vary_slot WITHOUT a variation → T1 clarify', async () => {
    const r = await dispatchPlanIntent(intent({ intent: 'vary_slot' }), ctx, noCatalog);
    expect(r).toEqual({ tier: 'T1', action: 'reply', intent: 'vary_slot' });
  });

  it('safety_write → T0 safety_write', async () => {
    const r = await dispatchPlanIntent(intent({ intent: 'safety_write', childId: 'c1' }), ctx, noCatalog);
    expect(r).toEqual({ tier: 'T0', action: 'safety_write', intent: 'safety_write', target: { childId: 'c1' } });
  });

  it('fallback → T1 reply', async () => {
    expect(await dispatchPlanIntent(intent({ intent: 'fallback' }), ctx, noCatalog)).toEqual({
      tier: 'T1',
      action: 'reply',
      intent: 'fallback',
    });
  });
});

describe('dispatchPlanIntent — swaps (catalog-resolved)', () => {
  it('swap_slot main with a candidate → T0 swap; queries catalog with main + dedup', async () => {
    let call: PickCall | undefined;
    const r = await dispatchPlanIntent(
      intent({ intent: 'swap_slot', day: 'fri', slotKind: 'main' }),
      ctx,
      deps(CANDIDATE, (c) => {
        call = c;
      }),
    );
    expect(r).toEqual({
      tier: 'T0',
      action: 'swap',
      intent: 'swap_slot',
      candidate: CANDIDATE,
      target: { day: 'fri', slotKind: 'main' },
    });
    expect(call).toEqual({
      householdId: 'hh',
      slot: 'main',
      excludeRecipeIds: ['used-1'],
      constraint: undefined,
    });
  });

  it('defaults a slotKind-less swap to the main', async () => {
    let call: PickCall | undefined;
    await dispatchPlanIntent(
      intent({ intent: 'swap_slot' }),
      ctx,
      deps(CANDIDATE, (c) => {
        call = c;
      }),
    );
    expect(call?.slot).toBe('main');
  });

  it('exclude_filter passes the normalized constraint to the catalog', async () => {
    let call: PickCall | undefined;
    await dispatchPlanIntent(
      intent({ intent: 'exclude_filter', constraint: 'exclude:fish' }),
      ctx,
      deps(CANDIDATE, (c) => {
        call = c;
      }),
    );
    expect(call?.constraint).toBe('exclude:fish');
  });

  it('catalog MISS → T2 escalate (catalog_miss), never auto-spends', async () => {
    const r = await dispatchPlanIntent(intent({ intent: 'swap_slot', slotKind: 'extra' }), ctx, deps(null));
    expect(r).toEqual({ tier: 'T2', action: 'escalate', intent: 'swap_slot', reason: 'catalog_miss' });
  });

  it('snack swap → T0 swap_snack WITHOUT calling the recipe catalog', async () => {
    const r = await dispatchPlanIntent(
      intent({ intent: 'swap_slot', slotKind: 'snack', day: 'wed' }),
      ctx,
      noCatalog, // rejects if called
    );
    expect(r).toEqual({ tier: 'T0', action: 'swap_snack', intent: 'swap_slot', target: { day: 'wed', slotKind: 'snack' } });
  });
});

describe('dispatchPlanIntent — escalation (T2, confirm-gated)', () => {
  it('add_dish → escalate with dishQuery', async () => {
    const r = await dispatchPlanIntent(intent({ intent: 'add_dish', dishQuery: 'bibimbap' }), ctx, noCatalog);
    expect(r).toEqual({ tier: 'T2', action: 'escalate', intent: 'add_dish', reason: 'add_dish', dishQuery: 'bibimbap' });
  });

  it('recompose → escalate', async () => {
    expect(await dispatchPlanIntent(intent({ intent: 'recompose' }), ctx, noCatalog)).toMatchObject({
      tier: 'T2',
      reason: 'recompose',
    });
  });

  it('compose_next → escalate', async () => {
    expect(await dispatchPlanIntent(intent({ intent: 'compose_next' }), ctx, noCatalog)).toMatchObject({
      tier: 'T2',
      reason: 'compose_next',
    });
  });
});
