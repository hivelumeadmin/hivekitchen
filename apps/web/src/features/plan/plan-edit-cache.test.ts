import { describe, it, expect } from 'vitest';
import type { GetPlansResponse, PlanEditResult } from '@hivekitchen/types';
import { collectDeltaRows, hasDeltaRows, mergePlanEditDelta } from './plan-edit-cache.js';

// Epic 13-s10 (AC3) — the applied-delta cache merge is pure; fixture-tested.

const MAIN = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  plan_id: 'p1',
  sequence: 1,
  recipe_id: 'old-recipe',
  created_at: '2026-06-01T00:00:00Z',
};
const SLOT = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  plan_day_id: 'd1',
  slot_kind: 'snack' as const,
  main_assignment_id: null,
  recipe_id: null,
  extra_kind: null,
  snack_sku_id: 'old-sku',
  paused_at: null,
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
};

function baseResponse(): GetPlansResponse {
  return {
    plan: { id: 'plan-1' } as GetPlansResponse['plan'],
    main_assignments: [MAIN],
    days: [],
    slots: [SLOT],
    variations: [],
    is_draft: false,
    week_of: '2026-06-29',
  } as GetPlansResponse;
}

describe('collectDeltaRows', () => {
  it('gathers the primary applied row', () => {
    const result: PlanEditResult = {
      status: 'applied',
      action: 'swap_main',
      main_assignment: { ...MAIN, recipe_id: 'new-recipe' },
    };
    const rows = collectDeltaRows(result);
    expect(rows.mains).toHaveLength(1);
    expect(rows.mains[0]!.recipe_id).toBe('new-recipe');
  });

  it('gathers safety_write fixed_slots rows', () => {
    const result: PlanEditResult = {
      status: 'applied',
      action: 'safety_write',
      allergen: 'peanut',
      inserted: true,
      fixed_slots: [{ main_assignment: { ...MAIN, recipe_id: 'safe-recipe' } }, { slot: SLOT }],
    };
    const rows = collectDeltaRows(result);
    expect(rows.mains).toHaveLength(1);
    expect(rows.slots).toHaveLength(1);
  });

  it('returns nothing for non-applied results', () => {
    expect(hasDeltaRows(collectDeltaRows({ status: 'clarify', reason: 'day_required' }))).toBe(false);
    expect(hasDeltaRows(collectDeltaRows({ status: 'escalate', reason: 'recompose' }))).toBe(false);
  });
});

describe('mergePlanEditDelta', () => {
  it('replaces a main assignment by id', () => {
    const merged = mergePlanEditDelta(baseResponse(), {
      status: 'applied',
      action: 'swap_main',
      main_assignment: { ...MAIN, recipe_id: 'new-recipe' },
    });
    expect(merged.main_assignments[0]!.recipe_id).toBe('new-recipe');
  });

  it('replaces a slot by id', () => {
    const merged = mergePlanEditDelta(baseResponse(), {
      status: 'applied',
      action: 'swap_snack',
      slot: { ...SLOT, snack_sku_id: 'new-sku' },
    });
    expect(merged.slots[0]!.snack_sku_id).toBe('new-sku');
  });

  it('leaves the response untouched when the result carries no rows', () => {
    const prev = baseResponse();
    expect(mergePlanEditDelta(prev, { status: 'clarify', reason: 'unclear' })).toBe(prev);
  });

  it('never appends a row that is not already in the cache', () => {
    const merged = mergePlanEditDelta(baseResponse(), {
      status: 'applied',
      action: 'swap_main',
      main_assignment: { ...MAIN, id: 'not-in-cache', recipe_id: 'x' },
    });
    expect(merged.main_assignments).toHaveLength(1);
    expect(merged.main_assignments[0]!.id).toBe(MAIN.id);
  });
});
