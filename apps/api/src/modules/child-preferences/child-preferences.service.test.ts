import { describe, it, expect, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { ChildPreferencesService } from './child-preferences.service.js';
import type { ChildPreferencesRepository } from './child-preferences.repository.js';
import type { PlansRepository } from '../plans/plans.repository.js';

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
    const service = new ChildPreferencesService(childPrefs, plans, buildLogger());

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
    const service = new ChildPreferencesService(childPrefs, plans, buildLogger());

    await service.recordRatingSignals({ householdId: HOUSEHOLD_ID, childId: CHILD_ID, rating: 'ok', signalDate: WED });

    expect(childPrefs.upsertSignal).not.toHaveBeenCalled();
    expect((plans.findDaysByPlanId as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('skips a Sunday rating without even looking up a plan', async () => {
    const childPrefs = buildChildPrefsRepo();
    const plans = buildPlansRepo();
    const service = new ChildPreferencesService(childPrefs, plans, buildLogger());

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
    const service = new ChildPreferencesService(childPrefs, plans, buildLogger());

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
    const service = new ChildPreferencesService(childPrefs, plans, buildLogger());

    await expect(
      service.recordRatingSignals({ householdId: HOUSEHOLD_ID, childId: CHILD_ID, rating: 'not-really', signalDate: WED }),
    ).resolves.toBeUndefined();
    expect(childPrefs.upsertSignal).toHaveBeenCalledTimes(2);
  });

  it('never throws when the plan lookup itself errors', async () => {
    const childPrefs = buildChildPrefsRepo();
    const plans = buildPlansRepo({
      findCommittedPlanIdByWeekOf: vi.fn().mockRejectedValue(new Error('db down')),
    } as unknown as Partial<PlansRepository>);
    const service = new ChildPreferencesService(childPrefs, plans, buildLogger());

    await expect(
      service.recordRatingSignals({ householdId: HOUSEHOLD_ID, childId: CHILD_ID, rating: 'loved', signalDate: WED }),
    ).resolves.toBeUndefined();
    expect(childPrefs.upsertSignal).not.toHaveBeenCalled();
  });
});
