import type { FastifyBaseLogger } from 'fastify';
import type { Weekday } from '@hivekitchen/types';
import { getCurrentWeekMonday } from '../../lib/derive-week-id.js';
import type { PlansRepository } from '../plans/plans.repository.js';
import type { SignalsService } from '../signals/signals.service.js';
import type { ChildPreferencesRepository } from './child-preferences.repository.js';

// 0=Sun..6=Sat → plan_days.day enum. Sunday has no plan_day (plans run Mon-Sat),
// so a Sunday rating resolves to undefined and is skipped.
const WEEKDAY_BY_INDEX: Record<number, Weekday | undefined> = {
  0: undefined,
  1: 'monday',
  2: 'tuesday',
  3: 'wednesday',
  4: 'thursday',
  5: 'friday',
  6: 'saturday',
};

export interface RecordRatingSignalsOptions {
  householdId: string;
  childId: string;
  rating: 'loved' | 'ok' | 'not-really';
  signalDate: string; // 'YYYY-MM-DD' from the lunch_link_sessions row
}

// Story 4-S11 — Layer 2 signal write. Translates one emoji rating into per-slot
// child_preferences rows by resolving the committed plan for the rating's week,
// the plan_day for the rating's weekday, and each slot's recipe.
//
// This is invoked fire-and-forget from POST /v1/lunch-link/:token/rate AFTER the
// rating is persisted. It MUST NOT throw back into the rating response path —
// every failure mode (no plan yet, missing day, per-slot resolution errors) is
// caught and logged, never propagated. "No committed plan for the week" is a
// normal state (the plan may not be generated yet) and logs at debug.
export class ChildPreferencesService {
  // signalsService is optional so non-rating constructions stay untouched;
  // when present, each per-slot upsert is dual-written to the append-only
  // signals log (Story 15-s2). This seam — not the session-level route — is
  // where signals are written because 15-s3's projection must reproduce
  // child_preferences, which is per-slot.
  constructor(
    private readonly childPrefsRepo: ChildPreferencesRepository,
    private readonly plansRepo: PlansRepository,
    private readonly logger: FastifyBaseLogger,
    private readonly signalsService?: Pick<SignalsService, 'record'>,
  ) {}

  async recordRatingSignals(opts: RecordRatingSignalsOptions): Promise<void> {
    try {
      const weekOf = getCurrentWeekMonday(new Date(`${opts.signalDate}T00:00:00Z`));
      const weekday = WEEKDAY_BY_INDEX[new Date(`${opts.signalDate}T00:00:00Z`).getUTCDay()];
      if (weekday === undefined) return; // Sunday — no plan_day

      const planId = await this.plansRepo.findCommittedPlanIdByWeekOf({
        householdId: opts.householdId,
        weekOf,
      });
      if (planId === null) {
        this.logger.debug(
          { householdId: opts.householdId, weekOf },
          'child_preferences: no committed plan for rating week — skipping signal write',
        );
        return;
      }

      const days = await this.plansRepo.findDaysByPlanId(planId);
      const planDay = days.find((d) => d.day === weekday);
      if (planDay === undefined) {
        this.logger.debug(
          { householdId: opts.householdId, weekOf, weekday },
          'child_preferences: no plan_day for rating weekday — skipping',
        );
        return;
      }

      const slots = await this.plansRepo.findSlotsByDayId(planDay.id);
      if (slots.length === 0) return;

      // Main-slot recipes resolve through plan_main_assignments; load them lazily
      // only when a main slot is present on the day.
      const hasMainSlot = slots.some((s) => s.slot_kind === 'main');
      const mainAssignments = hasMainSlot
        ? await this.plansRepo.findMainAssignmentsByPlanId(planId)
        : [];

      for (const slot of slots) {
        let recipeId: string | null;
        if (slot.slot_kind === 'main') {
          // plan_slots(main).recipe_id is NULL — the recipe lives on the
          // referenced plan_main_assignment.
          const assignment = mainAssignments.find((a) => a.id === slot.main_assignment_id);
          recipeId = assignment?.recipe_id ?? null;
        } else {
          recipeId = slot.recipe_id;
        }
        if (recipeId === null) continue;

        try {
          await this.childPrefsRepo.upsertSignal({
            household_id: opts.householdId,
            child_id: opts.childId,
            recipe_id: recipeId,
            slot_kind: slot.slot_kind,
            signal_type: opts.rating,
            signal_date: opts.signalDate,
          });
        } catch (err) {
          this.logger.warn(
            { err, householdId: opts.householdId, slot_kind: slot.slot_kind },
            'child_preferences: upsertSignal failed for slot — continuing',
          );
        }

        // Story 15-s2 — dual-write to the signals log. record() never throws;
        // a re-rating APPENDS a new signal (append-only: a correction is a new
        // row) even though upsertSignal above overwrites by dedup key.
        await this.signalsService?.record({
          household_id: opts.householdId,
          child_id: opts.childId,
          subject_ref: { recipe_id: recipeId, slot_kind: slot.slot_kind },
          payload: { kind: 'lunch_rating', rating: opts.rating, date: opts.signalDate },
          occurred_at: new Date().toISOString(),
          source: 'lunch_link',
        });
      }
    } catch (err) {
      this.logger.warn(
        { err, householdId: opts.householdId },
        'child_preferences: recordRatingSignals failed',
      );
    }
  }
}
