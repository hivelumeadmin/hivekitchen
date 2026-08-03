import { describe, it, expect, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ChildPreferencesService } from './child-preferences.service.js';
import type { ChildPreferencesRepository } from './child-preferences.repository.js';
import type { PlansRepository } from '../plans/plans.repository.js';
import { SignalsService } from '../signals/signals.service.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = '22222222-2222-4222-8222-222222222222';
const PLAN_ID = '33333333-3333-4333-8333-333333333333';
const DAY_ID = '44444444-4444-4444-8444-444444444444';
const MAIN_ASSIGNMENT_ID = '55555555-5555-4555-8555-555555555555';
const RECIPE_MAIN = '66666666-6666-4666-8666-666666666666';
const RECIPE_SNACK = '77777777-7777-4777-8777-777777777777';
const RECIPE_EXTRA = '88888888-8888-4888-8888-888888888888';

const WED = '2026-06-03'; // Wednesday — Monday-of is 2026-06-01
const SUN = '2026-06-07'; // Sunday — no plan_day

function buildLogger(): FastifyBaseLogger {
  const noop = vi.fn();
  const logger = {
    fatal: noop, error: noop, warn: noop, info: noop, debug: noop, trace: noop,
    silent: noop, level: 'info', child: () => logger,
  };
  return logger as unknown as FastifyBaseLogger;
}

function buildPlansRepo(overrides: Partial<PlansRepository> = {}) {
  return {
    findCommittedPlanIdByWeekOf: vi.fn().mockResolvedValue(PLAN_ID),
    findDaysByPlanId: vi.fn().mockResolvedValue([{ id: DAY_ID, plan_id: PLAN_ID, day: 'wednesday' }]),
    findSlotsByDayId: vi.fn().mockResolvedValue([]),
    findMainAssignmentsByPlanId: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as PlansRepository;
}

function buildChildPrefsRepo() {
  return {
    upsertSignal: vi.fn().mockResolvedValue(undefined),
  } as unknown as ChildPreferencesRepository & { upsertSignal: ReturnType<typeof vi.fn> };
}

// Story 15-s3 — the seam projects FROM the landed row, so a stub record() must
// echo back the SignalRow the DB would have returned.
let signalSeq = 0;
function buildSignals() {
  return vi.fn().mockImplementation(async (input: Record<string, unknown>) => {
    signalSeq += 1;
    return {
      id: `99999999-9999-4999-8999-${String(signalSeq).padStart(12, '0')}`,
      kind: 'lunch_rating',
      created_at: input.occurred_at,
      ...input,
    };
  });
}

function mainSlot() {
  return { id: 's-main', plan_day_id: DAY_ID, slot_kind: 'main', main_assignment_id: MAIN_ASSIGNMENT_ID, recipe_id: null, extra_kind: null };
}
function snackSlot() {
  return { id: 's-snack', plan_day_id: DAY_ID, slot_kind: 'snack', main_assignment_id: null, recipe_id: RECIPE_SNACK, extra_kind: null };
}
function extraSlot() {
  return { id: 's-extra', plan_day_id: DAY_ID, slot_kind: 'extra', main_assignment_id: null, recipe_id: RECIPE_EXTRA, extra_kind: 'protein_boost' };
}

describe('ChildPreferencesService.recordRatingSignals', () => {
  it('writes one signal per slot, resolving the main recipe via plan_main_assignments', async () => {
    const childPrefs = buildChildPrefsRepo();
    const plans = buildPlansRepo({
      findSlotsByDayId: vi.fn().mockResolvedValue([mainSlot(), snackSlot(), extraSlot()]),
      findMainAssignmentsByPlanId: vi.fn().mockResolvedValue([
        { id: MAIN_ASSIGNMENT_ID, plan_id: PLAN_ID, sequence: 2, recipe_id: RECIPE_MAIN },
      ]),
    } as unknown as Partial<PlansRepository>);
    const service = new ChildPreferencesService(childPrefs, plans, buildLogger(), { record: buildSignals() });

    await service.recordRatingSignals({
      householdId: HOUSEHOLD_ID,
      childId: CHILD_ID,
      rating: 'loved',
      signalDate: WED,
    });

    expect((plans.findCommittedPlanIdByWeekOf as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith({
      householdId: HOUSEHOLD_ID,
      weekOf: '2026-06-01',
    });
    expect(childPrefs.upsertSignal).toHaveBeenCalledTimes(3);
    const recipeIds = childPrefs.upsertSignal.mock.calls.map((c) => (c[0] as { recipe_id: string }).recipe_id);
    expect(recipeIds).toEqual(expect.arrayContaining([RECIPE_MAIN, RECIPE_SNACK, RECIPE_EXTRA]));
    // Main slot carries the assignment's recipe and slot_kind=main.
    const mainCall = childPrefs.upsertSignal.mock.calls.find((c) => (c[0] as { slot_kind: string }).slot_kind === 'main');
    expect(mainCall?.[0]).toMatchObject({
      recipe_id: RECIPE_MAIN,
      slot_kind: 'main',
      signal_type: 'loved',
      signal_date: WED,
      child_id: CHILD_ID,
      household_id: HOUSEHOLD_ID,
    });
  });

  it('skips silently (no upsert) when no committed plan exists for the week', async () => {
    const childPrefs = buildChildPrefsRepo();
    const plans = buildPlansRepo({
      findCommittedPlanIdByWeekOf: vi.fn().mockResolvedValue(null),
    } as unknown as Partial<PlansRepository>);
    const service = new ChildPreferencesService(childPrefs, plans, buildLogger(), { record: buildSignals() });

    await service.recordRatingSignals({ householdId: HOUSEHOLD_ID, childId: CHILD_ID, rating: 'ok', signalDate: WED });

    expect(childPrefs.upsertSignal).not.toHaveBeenCalled();
    expect((plans.findDaysByPlanId as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('skips a Sunday rating without even looking up a plan', async () => {
    const childPrefs = buildChildPrefsRepo();
    const plans = buildPlansRepo();
    const service = new ChildPreferencesService(childPrefs, plans, buildLogger(), { record: buildSignals() });

    await service.recordRatingSignals({ householdId: HOUSEHOLD_ID, childId: CHILD_ID, rating: 'loved', signalDate: SUN });

    expect((plans.findCommittedPlanIdByWeekOf as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect(childPrefs.upsertSignal).not.toHaveBeenCalled();
  });

  it('skips a main slot whose assignment cannot be resolved but still writes other slots', async () => {
    const childPrefs = buildChildPrefsRepo();
    const plans = buildPlansRepo({
      findSlotsByDayId: vi.fn().mockResolvedValue([mainSlot(), snackSlot()]),
      findMainAssignmentsByPlanId: vi.fn().mockResolvedValue([]), // no matching assignment
    } as unknown as Partial<PlansRepository>);
    const service = new ChildPreferencesService(childPrefs, plans, buildLogger(), { record: buildSignals() });

    await service.recordRatingSignals({ householdId: HOUSEHOLD_ID, childId: CHILD_ID, rating: 'ok', signalDate: WED });

    expect(childPrefs.upsertSignal).toHaveBeenCalledTimes(1);
    expect(childPrefs.upsertSignal.mock.calls[0]?.[0]).toMatchObject({ recipe_id: RECIPE_SNACK, slot_kind: 'snack' });
  });

  it('never throws when a per-slot upsert fails — other slots still attempt', async () => {
    const childPrefs = buildChildPrefsRepo();
    childPrefs.upsertSignal
      .mockRejectedValueOnce(new Error('slot write failed'))
      .mockResolvedValueOnce(undefined);
    const plans = buildPlansRepo({
      findSlotsByDayId: vi.fn().mockResolvedValue([snackSlot(), extraSlot()]),
    } as unknown as Partial<PlansRepository>);
    const service = new ChildPreferencesService(childPrefs, plans, buildLogger(), { record: buildSignals() });

    await expect(
      service.recordRatingSignals({ householdId: HOUSEHOLD_ID, childId: CHILD_ID, rating: 'not-really', signalDate: WED }),
    ).resolves.toBeUndefined();
    expect(childPrefs.upsertSignal).toHaveBeenCalledTimes(2);
  });

  // ---- Story 15-s3: signals are the system of record; child_preferences is
  // the projection applied FROM the landed row (was 15-s2 dual-write) ----

  it('writes one signals row per slot with recipe-level subject_ref', async () => {
    const childPrefs = buildChildPrefsRepo();
    const plans = buildPlansRepo({
      findSlotsByDayId: vi.fn().mockResolvedValue([mainSlot(), snackSlot(), extraSlot()]),
      findMainAssignmentsByPlanId: vi.fn().mockResolvedValue([
        { id: MAIN_ASSIGNMENT_ID, plan_id: PLAN_ID, sequence: 2, recipe_id: RECIPE_MAIN },
      ]),
    } as unknown as Partial<PlansRepository>);
    const record = buildSignals();
    const service = new ChildPreferencesService(childPrefs, plans, buildLogger(), { record });

    await service.recordRatingSignals({
      householdId: HOUSEHOLD_ID,
      childId: CHILD_ID,
      rating: 'loved',
      signalDate: WED,
    });

    expect(record).toHaveBeenCalledTimes(3);
    expect(record.mock.calls.map((c) => (c[0] as { subject_ref: unknown }).subject_ref)).toEqual([
      { recipe_id: RECIPE_MAIN, slot_kind: 'main' },
      { recipe_id: RECIPE_SNACK, slot_kind: 'snack' },
      { recipe_id: RECIPE_EXTRA, slot_kind: 'extra' },
    ]);
    expect(record.mock.calls[0]?.[0]).toMatchObject({
      household_id: HOUSEHOLD_ID,
      child_id: CHILD_ID,
      payload: { kind: 'lunch_rating', rating: 'loved', date: WED },
      source: 'lunch_link',
    });
  });

  it('re-rating appends a signal AND the projection overwrites the same row (both stores)', async () => {
    const childPrefs = buildChildPrefsRepo();
    const plans = buildPlansRepo({
      findSlotsByDayId: vi.fn().mockResolvedValue([snackSlot()]),
    } as unknown as Partial<PlansRepository>);
    const record = buildSignals();
    const service = new ChildPreferencesService(childPrefs, plans, buildLogger(), { record });

    await service.recordRatingSignals({ householdId: HOUSEHOLD_ID, childId: CHILD_ID, rating: 'loved', signalDate: WED });
    await service.recordRatingSignals({ householdId: HOUSEHOLD_ID, childId: CHILD_ID, rating: 'not-really', signalDate: WED });

    // Log: two appended rows (a correction is a new signal).
    expect(record).toHaveBeenCalledTimes(2);
    expect((record.mock.calls[1]?.[0] as { payload: { rating: string } }).payload.rating).toBe('not-really');
    // Projection: two upserts on the SAME dedup key — the later one wins.
    expect(childPrefs.upsertSignal).toHaveBeenCalledTimes(2);
    expect(childPrefs.upsertSignal.mock.calls.map((c) => (c[0] as { signal_type: string }).signal_type)).toEqual([
      'loved',
      'not-really',
    ]);
    const [first, second] = childPrefs.upsertSignal.mock.calls.map((c) => c[0] as Record<string, unknown>);
    expect(second).toMatchObject({
      child_id: first?.child_id,
      recipe_id: first?.recipe_id,
      slot_kind: first?.slot_kind,
      signal_date: first?.signal_date,
    });
  });

  it('projects from the landed signal — the row the log returned, not seam-local data', async () => {
    const childPrefs = buildChildPrefsRepo();
    const plans = buildPlansRepo({
      findSlotsByDayId: vi.fn().mockResolvedValue([snackSlot()]),
    } as unknown as Partial<PlansRepository>);
    // The DB is the authority on what landed: this row carries a different
    // recipe than the seam asked for, and the projection must follow the row.
    const record = vi.fn().mockImplementation(async (input: Record<string, unknown>) => ({
      ...input,
      id: '99999999-9999-4999-8999-999999999999',
      kind: 'lunch_rating',
      created_at: input.occurred_at,
      subject_ref: { recipe_id: RECIPE_EXTRA, slot_kind: 'extra' },
    }));
    const service = new ChildPreferencesService(childPrefs, plans, buildLogger(), { record });

    await service.recordRatingSignals({ householdId: HOUSEHOLD_ID, childId: CHILD_ID, rating: 'ok', signalDate: WED });

    expect(childPrefs.upsertSignal.mock.calls[0]?.[0]).toMatchObject({
      recipe_id: RECIPE_EXTRA,
      slot_kind: 'extra',
      source: 'layer1_emoji',
    });
  });

  it('writes NOTHING to child_preferences when the signals write FAILS through the real SignalsService (15-s3 flip)', async () => {
    // Inverts the 15-s2 AC#9 test for this seam: the projection derives from
    // the log, so `log ⊇ stores` now holds by construction here. A rating whose
    // signal never landed lands nowhere.
    const warn = vi.fn();
    const failingClient = {
      from: (table: string) => {
        if (table !== 'signals') throw new Error(`unexpected table: ${table}`);
        return {
          insert: () => ({
            select: () => ({
              single: async () => ({ data: null, error: { code: '57014', message: 'insert failed' } }),
            }),
          }),
        };
      },
    } as unknown as SupabaseClient;
    const childPrefs = buildChildPrefsRepo();
    const plans = buildPlansRepo({
      findSlotsByDayId: vi.fn().mockResolvedValue([snackSlot(), extraSlot()]),
    } as unknown as Partial<PlansRepository>);
    const service = new ChildPreferencesService(
      childPrefs,
      plans,
      buildLogger(),
      new SignalsService(failingClient, null, { warn }),
    );

    await expect(
      service.recordRatingSignals({ householdId: HOUSEHOLD_ID, childId: CHILD_ID, rating: 'loved', signalDate: WED }),
    ).resolves.toBeUndefined();
    expect(childPrefs.upsertSignal).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(2); // one swallowed failure per slot
  });

  it('never throws when the plan lookup itself errors', async () => {
    const childPrefs = buildChildPrefsRepo();
    const plans = buildPlansRepo({
      findCommittedPlanIdByWeekOf: vi.fn().mockRejectedValue(new Error('db down')),
    } as unknown as Partial<PlansRepository>);
    const service = new ChildPreferencesService(childPrefs, plans, buildLogger(), { record: buildSignals() });

    await expect(
      service.recordRatingSignals({ householdId: HOUSEHOLD_ID, childId: CHILD_ID, rating: 'loved', signalDate: WED }),
    ).resolves.toBeUndefined();
    expect(childPrefs.upsertSignal).not.toHaveBeenCalled();
  });
});
