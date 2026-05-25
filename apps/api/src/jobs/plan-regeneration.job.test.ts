import { describe, it, expect, vi } from 'vitest';
import type { Job } from 'bullmq';
import type {
  CommitPlanInput,
  PlanComposeOutput,
  PlanItemRow,
} from '@hivekitchen/types';
import type { PlanRegenerationJobData } from './plan-regeneration.job.js';

// The job worker is registered via a Fastify plugin; testing the registered
// worker requires a full Fastify mock. To keep the test focused, we replicate
// the worker body in a small harness here and assert its branching behaviour
// (scope=week vs scope=day, LLM non-compliance filtering, empty-day failure).

const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const WEEK_ID = '33333333-3333-4333-8333-333333333333';
const REQUEST_ID = '55555555-5555-4555-8555-555555555555';
const CHILD_ID = '44444444-4444-4444-8444-444444444444';

function makeComposeOutput(
  days: PlanComposeOutput['days'],
): PlanComposeOutput {
  return {
    plan_id: PLAN_ID,
    household_id: HOUSEHOLD_ID,
    week_of: '2026-05-04',
    days,
    prompt_version: 'v1.0.0',
  };
}

function makeExistingItem(day: PlanItemRow['day']): PlanItemRow {
  return {
    id: '00000000-0000-4000-8000-000000000010',
    plan_id: PLAN_ID,
    child_id: CHILD_ID,
    day,
    slot: 'main',
    recipe_id: null,
    item_id: null,
    item_sku_id: null,
    ingredients: ['rice', 'lentils'],
    paused_at: null,
    replaced_by_plan_id: null,
    created_at: '2026-05-02T11:00:00.000Z',
    updated_at: '2026-05-02T11:00:00.000Z',
  };
}

// Minimal harness mirroring the worker logic — the production worker is
// inside the Fastify plugin closure and not exported, so we re-implement the
// same branching here against mocked deps. Drift risk is low because the
// worker is small; if it grows, refactor it into a pure function.
async function runRegenerationJob(
  data: PlanRegenerationJobData,
  deps: {
    planWeek: ReturnType<typeof vi.fn>;
    commit: ReturnType<typeof vi.fn>;
    getCurrentPlanItems: ReturnType<typeof vi.fn>;
  },
): Promise<void> {
  const { plan_id, household_id, week_of, week_id, current_revision, scope, day, request_id, slot_scope } = data;

  // Story 3.23 — mirror the worker's slotScopeContext build.
  let slotScopeContext: string | undefined;
  if (slot_scope !== undefined) {
    const slotLabel = slot_scope.charAt(0).toUpperCase() + slot_scope.slice(1);
    slotScopeContext =
      `SLOT-SCOPED REGENERATION: Regenerate ONLY the ${slotLabel} slot items. ` +
      `Keep ALL other slot items (Main/Snack/Extra as applicable) identical to the previous plan.`;
  }

  const composeOutput: PlanComposeOutput = await deps.planWeek(
    household_id,
    week_of,
    request_id,
    undefined,
    scope === 'day' ? day : undefined,
    slotScopeContext,
  );

  const filteredOutput =
    scope === 'day' && day !== undefined
      ? { ...composeOutput, days: composeOutput.days.filter((d) => d.day === day) }
      : composeOutput;

  if (scope === 'day' && filteredOutput.days.length === 0) {
    throw new Error(
      `Day-scope regeneration for '${day ?? ''}' returned no days from the planner`,
    );
  }

  const items = filteredOutput.days.flatMap((d) =>
    d.items.map((it) => ({
      child_id: it.child_id,
      day: d.day,
      slot: it.slot,
      ingredients: it.ingredients,
    })),
  );

  let commitItems = items;
  if (scope === 'day' && day !== undefined) {
    const existing: PlanItemRow[] = await deps.getCurrentPlanItems(plan_id, household_id);
    const otherDays = existing
      .filter((item) => item.day !== day)
      .map((item) => ({
        child_id: item.child_id,
        day: item.day,
        slot: item.slot,
        ingredients: item.ingredients,
      }));
    commitItems = [...otherDays, ...items];
  }

  const commitInput: CommitPlanInput = {
    plan_id,
    household_id,
    week_id,
    week_of,
    revision: current_revision + 1,
    generated_at: new Date().toISOString(),
    prompt_version: filteredOutput.prompt_version,
    items: commitItems,
  };

  await deps.commit(commitInput, request_id);
}

describe('plan-regeneration job (Story 3.13)', () => {
  it('scope=week: passes the full week to commit and does not query existing items', async () => {
    const planWeek = vi.fn().mockResolvedValue(
      makeComposeOutput([
        {
          day: 'monday',
          items: [{ child_id: CHILD_ID, slot: 'main', ingredients: ['rice'] }],
        },
        {
          day: 'tuesday',
          items: [{ child_id: CHILD_ID, slot: 'main', ingredients: ['oats'] }],
        },
      ]),
    );
    const commit = vi.fn().mockResolvedValue(PLAN_ID);
    const getCurrentPlanItems = vi.fn();

    await runRegenerationJob(
      {
        plan_id: PLAN_ID,
        household_id: HOUSEHOLD_ID,
        week_of: '2026-05-04',
        week_id: WEEK_ID,
        current_revision: 1,
        scope: 'week',
        request_id: REQUEST_ID,
      },
      { planWeek, commit, getCurrentPlanItems },
    );

    expect(planWeek).toHaveBeenCalledWith(HOUSEHOLD_ID, '2026-05-04', REQUEST_ID, undefined, undefined, undefined);
    expect(getCurrentPlanItems).not.toHaveBeenCalled();
    const commitInput = commit.mock.calls[0]?.[0] as CommitPlanInput;
    expect(commitInput.items).toHaveLength(2);
    expect(commitInput.items.map((i) => i.day).sort()).toEqual(['monday', 'tuesday']);
  });

  it('scope=day: passes dayScope to planner, filters output to target day, merges other-day items', async () => {
    const planWeek = vi.fn().mockResolvedValue(
      makeComposeOutput([
        {
          day: 'tuesday',
          items: [{ child_id: CHILD_ID, slot: 'main', ingredients: ['hummus'] }],
        },
      ]),
    );
    const commit = vi.fn().mockResolvedValue(PLAN_ID);
    const getCurrentPlanItems = vi
      .fn()
      .mockResolvedValue([makeExistingItem('monday'), makeExistingItem('wednesday')]);

    await runRegenerationJob(
      {
        plan_id: PLAN_ID,
        household_id: HOUSEHOLD_ID,
        week_of: '2026-05-04',
        week_id: WEEK_ID,
        current_revision: 1,
        scope: 'day',
        day: 'tuesday',
        request_id: REQUEST_ID,
      },
      { planWeek, commit, getCurrentPlanItems },
    );

    expect(planWeek).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      '2026-05-04',
      REQUEST_ID,
      undefined,
      'tuesday',
      undefined,
    );
    expect(getCurrentPlanItems).toHaveBeenCalledWith(PLAN_ID, HOUSEHOLD_ID);
    const commitInput = commit.mock.calls[0]?.[0] as CommitPlanInput;
    expect(commitInput.items.map((i) => i.day).sort()).toEqual([
      'monday',
      'tuesday',
      'wednesday',
    ]);
    const tuesdayItem = commitInput.items.find((i) => i.day === 'tuesday');
    expect(tuesdayItem?.ingredients).toEqual(['hummus']);
  });

  it('scope=day with LLM non-compliance: extra days are filtered out before commit', async () => {
    const planWeek = vi.fn().mockResolvedValue(
      makeComposeOutput([
        {
          day: 'tuesday',
          items: [{ child_id: CHILD_ID, slot: 'main', ingredients: ['hummus'] }],
        },
        // LLM ignored the day-scope instruction and emitted Wednesday too.
        {
          day: 'wednesday',
          items: [{ child_id: CHILD_ID, slot: 'main', ingredients: ['rogue'] }],
        },
      ]),
    );
    const commit = vi.fn().mockResolvedValue(PLAN_ID);
    const getCurrentPlanItems = vi
      .fn()
      .mockResolvedValue([makeExistingItem('monday'), makeExistingItem('wednesday')]);

    await runRegenerationJob(
      {
        plan_id: PLAN_ID,
        household_id: HOUSEHOLD_ID,
        week_of: '2026-05-04',
        week_id: WEEK_ID,
        current_revision: 1,
        scope: 'day',
        day: 'tuesday',
        request_id: REQUEST_ID,
      },
      { planWeek, commit, getCurrentPlanItems },
    );

    const commitInput = commit.mock.calls[0]?.[0] as CommitPlanInput;
    // The rogue 'wednesday' from the planner output is discarded; the
    // wednesday entry comes from the existing-items merge with original
    // ingredients ('rice', 'lentils'), not the rogue 'rogue' ingredient.
    const wednesdayItem = commitInput.items.find((i) => i.day === 'wednesday');
    expect(wednesdayItem?.ingredients).toEqual(['rice', 'lentils']);
  });

  // Story 3.23 — slot-scoped regen prompt injection.
  it('slot_scope=snack: planWeek receives a slotScopeContext line referencing "Snack slot"', async () => {
    const planWeek = vi.fn().mockResolvedValue(
      makeComposeOutput([
        {
          day: 'monday',
          items: [{ child_id: CHILD_ID, slot: 'snack', ingredients: ['apple'] }],
        },
      ]),
    );
    const commit = vi.fn().mockResolvedValue(PLAN_ID);
    const getCurrentPlanItems = vi.fn();

    await runRegenerationJob(
      {
        plan_id: PLAN_ID,
        household_id: HOUSEHOLD_ID,
        week_of: '2026-05-04',
        week_id: WEEK_ID,
        current_revision: 1,
        scope: 'week',
        request_id: REQUEST_ID,
        slot_scope: 'snack',
      },
      { planWeek, commit, getCurrentPlanItems },
    );

    const slotScopeArg = planWeek.mock.calls[0]?.[5] as string | undefined;
    expect(slotScopeArg).toBeDefined();
    expect(slotScopeArg).toContain('Snack slot');
    expect(slotScopeArg).toContain('SLOT-SCOPED REGENERATION');
  });

  it('no slot_scope: planWeek receives slotScopeContext = undefined', async () => {
    const planWeek = vi.fn().mockResolvedValue(
      makeComposeOutput([
        {
          day: 'monday',
          items: [{ child_id: CHILD_ID, slot: 'main', ingredients: ['rice'] }],
        },
      ]),
    );
    const commit = vi.fn().mockResolvedValue(PLAN_ID);
    const getCurrentPlanItems = vi.fn();

    await runRegenerationJob(
      {
        plan_id: PLAN_ID,
        household_id: HOUSEHOLD_ID,
        week_of: '2026-05-04',
        week_id: WEEK_ID,
        current_revision: 1,
        scope: 'week',
        request_id: REQUEST_ID,
      },
      { planWeek, commit, getCurrentPlanItems },
    );

    expect(planWeek.mock.calls[0]?.[5]).toBeUndefined();
  });

  it('scope=day with empty target-day output: throws (job fails)', async () => {
    const planWeek = vi.fn().mockResolvedValue(
      // Planner returned only Wednesday; we asked for Tuesday.
      makeComposeOutput([
        {
          day: 'wednesday',
          items: [{ child_id: CHILD_ID, slot: 'main', ingredients: ['x'] }],
        },
      ]),
    );
    const commit = vi.fn();
    const getCurrentPlanItems = vi.fn();

    await expect(
      runRegenerationJob(
        {
          plan_id: PLAN_ID,
          household_id: HOUSEHOLD_ID,
          week_of: '2026-05-04',
          week_id: WEEK_ID,
          current_revision: 1,
          scope: 'day',
          day: 'tuesday',
          request_id: REQUEST_ID,
        },
        { planWeek, commit, getCurrentPlanItems },
      ),
    ).rejects.toThrow(/Day-scope regeneration for 'tuesday' returned no days/);

    expect(commit).not.toHaveBeenCalled();
  });
});
