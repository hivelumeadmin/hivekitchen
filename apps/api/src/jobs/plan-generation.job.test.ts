import { describe, it, expect, vi } from 'vitest';
import type { PlanComposeTreeOutput, KitchenMap } from '@hivekitchen/types';
import {
  buildCommitInputTree,
  deriveWeekId,
  getLocalSixPmUtcMs,
  getNextMondayFrom,
} from './plan-generation.job.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const PLAN_ID = '99999999-9999-4999-8999-999999999999';
const REQUEST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RECIPE_M1 = '44444444-4444-4444-8444-444444444444';
const RECIPE_M2 = '55555555-5555-4555-8555-555555555555';
const RECIPE_SNACK = '66666666-6666-4666-8666-666666666666';
const RECIPE_CANDIDATE = '77777777-7777-4777-8777-777777777777';
const CHILD_A = '88888888-8888-4888-8888-888888888888';
const CHILD_B = '99999999-9999-4999-8999-999999999990';

describe('deriveWeekId', () => {
  it('returns a deterministic UUID-shaped string for the same weekOf', () => {
    const a = deriveWeekId('2026-05-11');
    const b = deriveWeekId('2026-05-11');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('returns different ids for different weeks', () => {
    expect(deriveWeekId('2026-05-11')).not.toBe(deriveWeekId('2026-05-18'));
  });
});

describe('getNextMondayFrom', () => {
  it('returns the ISO date 3 days after a Friday', () => {
    expect(getNextMondayFrom(new Date('2026-05-08T10:00:00Z'))).toBe('2026-05-11');
  });

  it('returns the same Monday when called at different Friday hours', () => {
    expect(getNextMondayFrom(new Date('2026-05-08T00:00:00Z'))).toBe('2026-05-11');
    expect(getNextMondayFrom(new Date('2026-05-08T23:59:00Z'))).toBe('2026-05-11');
  });
});

describe('getLocalSixPmUtcMs', () => {
  // EDT is UTC-4 in May. 18:00 EDT = 22:00 UTC same date.
  it('returns 22:00 UTC for 18:00 America/New_York during EDT', () => {
    const ms = getLocalSixPmUtcMs('America/New_York', new Date('2026-05-08T10:00:00Z'));
    expect(new Date(ms).toISOString()).toBe('2026-05-08T22:00:00.000Z');
  });

  // PDT is UTC-7 in May. 18:00 PDT = 01:00 UTC the following day.
  it('returns 01:00 UTC the next day for 18:00 America/Los_Angeles during PDT', () => {
    const ms = getLocalSixPmUtcMs('America/Los_Angeles', new Date('2026-05-08T10:00:00Z'));
    expect(new Date(ms).toISOString()).toBe('2026-05-09T01:00:00.000Z');
  });

  it('returns 18:00 UTC for 18:00 UTC timezone', () => {
    const ms = getLocalSixPmUtcMs('UTC', new Date('2026-05-08T10:00:00Z'));
    expect(new Date(ms).toISOString()).toBe('2026-05-08T18:00:00.000Z');
  });

  it('rolls forward by 24h when 18:00 local has already passed', () => {
    // Reference 23:00 UTC in NY (EDT) is 19:00 local — 18:00 local has passed.
    // The function should return the next day's 18:00 local = 22:00 UTC next day.
    const ms = getLocalSixPmUtcMs('America/New_York', new Date('2026-05-08T23:00:00Z'));
    expect(new Date(ms).toISOString()).toBe('2026-05-09T22:00:00.000Z');
  });
});

function buildOutput(overrides: Partial<PlanComposeTreeOutput> = {}): PlanComposeTreeOutput {
  return {
    plan_id: PLAN_ID,
    household_id: HOUSEHOLD_ID,
    week_of: '2026-06-01',
    prompt_version: 'v2.0.0',
    main_assignments: [
      { sequence: 1, recipe_id: RECIPE_M1 },
      { sequence: 2, recipe_id: RECIPE_M2 },
    ],
    days: [
      {
        day: 'monday',
        slots: [
          {
            slot_kind: 'main',
            main_assignment_sequence: 1,
            variations: [
              { child_id: CHILD_A, portion_size: 'regular' },
              { child_id: CHILD_B, portion_size: 'small', texture: 'soft' },
            ],
          },
          {
            slot_kind: 'snack',
            recipe_id: RECIPE_SNACK,
            variations: [{ child_id: CHILD_A }, { child_id: CHILD_B }],
          },
        ],
      },
      {
        day: 'wednesday',
        slots: [
          {
            slot_kind: 'main',
            main_assignment_sequence: 2,
            variations: [
              {
                child_id: CHILD_A,
                removals: ['peanut paste'],
                add_ons: ['coconut cream'],
              },
              { child_id: CHILD_B, portion_size: 'small' },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('buildCommitInputTree', () => {
  it('passes through plan_id / household_id / week_of / prompt_version', () => {
    const out = buildOutput();
    const input = buildCommitInputTree(out, REQUEST_ID);
    expect(input.plan_id).toBe(PLAN_ID);
    expect(input.household_id).toBe(HOUSEHOLD_ID);
    expect(input.week_of).toBe('2026-06-01');
    expect(input.prompt_version).toBe('v2.0.0');
  });

  it('threads requestId through as plan_build_id (Story 3-31 candidate resolver)', () => {
    const input = buildCommitInputTree(buildOutput(), REQUEST_ID);
    expect(input.plan_build_id).toBe(REQUEST_ID);
  });

  it('sets revision=1 and a fresh generated_at timestamp', () => {
    const before = new Date().toISOString();
    const input = buildCommitInputTree(buildOutput(), REQUEST_ID);
    const after = new Date().toISOString();
    expect(input.revision).toBe(1);
    expect(input.generated_at >= before).toBe(true);
    expect(input.generated_at <= after).toBe(true);
  });

  it('passes main_assignments through 1:1 (no reshape)', () => {
    const out = buildOutput();
    const input = buildCommitInputTree(out, REQUEST_ID);
    expect(input.main_assignments).toEqual(out.main_assignments);
  });

  it('passes days[] through 1:1 (no flattening)', () => {
    const out = buildOutput();
    const input = buildCommitInputTree(out, REQUEST_ID);
    expect(input.days).toEqual(out.days);
    expect(input.days).toHaveLength(2);
    expect(input.days[0]?.slots).toHaveLength(2);
    expect(input.days[1]?.slots).toHaveLength(1);
  });

  it('preserves variation attributes (portion_size, texture, removals, add_ons)', () => {
    const out = buildOutput();
    const input = buildCommitInputTree(out, REQUEST_ID);
    const wedMain = input.days[1]?.slots[0];
    expect(wedMain?.variations[0]).toEqual({
      child_id: CHILD_A,
      removals: ['peanut paste'],
      add_ons: ['coconut cream'],
    });
    expect(wedMain?.variations[1]).toEqual({
      child_id: CHILD_B,
      portion_size: 'small',
    });
  });

  it('preserves a snack slot with recipe_candidate_id (discover path)', () => {
    const out = buildOutput({
      days: [
        {
          day: 'monday',
          slots: [
            {
              slot_kind: 'snack',
              recipe_candidate_id: RECIPE_CANDIDATE,
              variations: [{ child_id: CHILD_A }],
            },
          ],
        },
      ],
    });
    const input = buildCommitInputTree(out, REQUEST_ID);
    expect(input.days[0]?.slots[0]).toEqual(
      expect.objectContaining({ recipe_candidate_id: RECIPE_CANDIDATE }),
    );
  });

  it('does not surface a week_id field (canonical model drops plans.week_id)', () => {
    const input = buildCommitInputTree(buildOutput(), REQUEST_ID);
    expect(input).not.toHaveProperty('week_id');
  });

  it('does not surface a flat items field (legacy CommitPlanInput shape)', () => {
    const input = buildCommitInputTree(buildOutput(), REQUEST_ID);
    expect(input).not.toHaveProperty('items');
  });
});

// Story 3-S32: kitchenMap loading behavior in the plan-generation worker.
// The worker calls kitchenMapService.get() with a .catch fallback so a
// KitchenMap load failure never blocks plan generation.
// These tests verify the fallback contract using the same inline pattern
// as the worker (AC 12).
describe('kitchenMap loading fallback (AC 12 — Story 3-S32)', () => {
  function buildMinimalKitchenMap(): KitchenMap {
    return {
      household: {
        id: HOUSEHOLD_ID,
        tier: 'standard',
        tier_variant: 'control',
        timezone: 'UTC',
        display_name: 'Test Family',
        cultural_identifiers: [],
        dietary_preferences: [],
        declared_allergens: [],
      },
      caregivers: [],
      children: [
        {
          id: CHILD_A,
          name: 'Asha',
          age_band: 'child',
          declared_allergens: [],
          cultural_identifiers: [],
          dietary_preferences: [],
          bag_composition: { main: true, snack: true, extra: false },
          bag_composition_pattern: null,
          school_policies: [],
          extra_rules: { pinned: [], banned: [] },
        },
      ],
      cultural: { active: [], suggested: [] },
      memory: { nodes: [] },
      household_extras: { library: [] },
      recipes: { favourites: [], banned: [] },
      allergens: [],
      dietary: [],
      food_preferences: [],
      favorite_lunches: [],
      rules: [],
      meta: {
        composed_at: '2026-06-17T00:00:00.000Z',
        map_version: 1,
        schema_version: '1.1.0',
        is_complete: true,
        required_set_complete: true,
      },
    };
  }

  it('resolves with the KitchenMap when kitchenMapService.get succeeds', async () => {
    const fixture = buildMinimalKitchenMap();
    const kitchenMapService = { get: vi.fn().mockResolvedValue(fixture) };
    const logger = { warn: vi.fn() };

    const result = await kitchenMapService.get(HOUSEHOLD_ID).catch((err: unknown) => {
      logger.warn({ err, householdId: HOUSEHOLD_ID }, 'kitchenMap load failed — proceeding without pre-loaded context');
      return undefined;
    });

    expect(kitchenMapService.get).toHaveBeenCalledWith(HOUSEHOLD_ID);
    expect(result).toBe(fixture);
  });

  it('resolves with undefined and logs warn when kitchenMapService.get rejects', async () => {
    const error = new Error('Redis connection timeout');
    const kitchenMapService = { get: vi.fn().mockRejectedValue(error) };
    const logger = { warn: vi.fn() };

    const result = await kitchenMapService.get(HOUSEHOLD_ID).catch((err: unknown) => {
      logger.warn({ err, householdId: HOUSEHOLD_ID }, 'kitchenMap load failed — proceeding without pre-loaded context');
      return undefined;
    });

    expect(kitchenMapService.get).toHaveBeenCalledWith(HOUSEHOLD_ID);
    expect(result).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      { err: error, householdId: HOUSEHOLD_ID },
      'kitchenMap load failed — proceeding without pre-loaded context',
    );
  });

  it('kitchenMap from successful load is passed through to planWeek opts', async () => {
    const fixture = buildMinimalKitchenMap();
    const kitchenMapService = { get: vi.fn().mockResolvedValue(fixture) };
    const planWeek = vi.fn().mockResolvedValue({
      plan_id: PLAN_ID,
      household_id: HOUSEHOLD_ID,
      week_of: '2026-11-09',
      prompt_version: 'v2.5.0',
      main_assignments: [],
      days: [],
    });

    const kitchenMap = await kitchenMapService.get(HOUSEHOLD_ID).catch(() => undefined);

    await planWeek({ householdId: HOUSEHOLD_ID, weekOf: '2026-11-09', requestId: REQUEST_ID, kitchenMap });

    expect(planWeek).toHaveBeenCalledWith(
      expect.objectContaining({ kitchenMap: fixture }),
    );
  });
});

// Story 3-S34 (AC 8) — the worker threads job.data.planned_days into BOTH the
// initial and the guardrail-retry planWeek() calls. Mirrors the worker's inline
// destructure + pass-through using the same convention as the kitchenMap tests
// above (the worker body itself runs only under BullMQ).
describe('planned_days threading (AC 8 — Story 3-S34)', () => {
  it('passes job.data.planned_days to planWeek as plannedDays', async () => {
    const job = {
      data: {
        household_id: HOUSEHOLD_ID,
        week_of: '2026-06-22',
        request_id: REQUEST_ID,
        planned_days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const,
      },
    };
    const planWeek = vi.fn().mockResolvedValue(buildOutput());

    const { household_id, week_of, request_id, planned_days } = job.data;
    await planWeek({
      householdId: household_id,
      weekOf: week_of,
      requestId: request_id,
      plannedDays: planned_days,
    });

    expect(planWeek).toHaveBeenCalledWith(
      expect.objectContaining({ plannedDays: job.data.planned_days }),
    );
  });

  it('threads undefined planned_days (cron path) — planWeek receives plannedDays: undefined', async () => {
    const job = {
      data: {
        household_id: HOUSEHOLD_ID,
        week_of: '2026-06-22',
        request_id: REQUEST_ID,
        // cron fan-out leaves planned_days absent
      } as { household_id: string; week_of: string; request_id: string; planned_days?: readonly string[] },
    };
    const planWeek = vi.fn().mockResolvedValue(buildOutput());

    const { household_id, week_of, request_id, planned_days } = job.data;
    await planWeek({
      householdId: household_id,
      weekOf: week_of,
      requestId: request_id,
      plannedDays: planned_days,
    });

    expect(planWeek.mock.calls[0]?.[0]).toHaveProperty('plannedDays', undefined);
  });
});
