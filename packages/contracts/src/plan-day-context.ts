import { z } from 'zod';

// Story 3-DM-E1 — plan_day_context (formerly the day-overrides table).
// FR118, FR119 — day-level context hints for composition-changing events.
// Pause semantics (bag_suspended, sick_day) live on plan_days.paused_at +
// paused_reason, not here.
//
// Each row is a one-off context hint on a single (plan_slot, child, date). It
// auto-reverts after override_date via the nightly job
// (apps/api/src/jobs/day-override-revert.job.ts) — the row remains for audit
// with reverted_at populated.
//
// Mirrors:
//   - supabase/migrations/20261012000000_plan_day_context_rename.sql
//   - apps/api/src/modules/plans/plan-day-context.repository.ts

export const PlanDayContextTypeSchema = z.enum([
  'half_day',
  'field_trip',
  'post_dentist',
  'early_release',
  'sport_practice',
  'test_day',
]);

export const PlanDayContextSchema = z.object({
  id: z.string().uuid(),
  plan_slot_id: z.string().uuid(),
  child_id: z.string().uuid(),
  household_id: z.string().uuid(),
  override_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD
  context_type: PlanDayContextTypeSchema,
  is_lumi_proposed: z.boolean(),
  confirmed_at: z.string().datetime({ offset: true }).nullable(),
  reverted_at: z.string().datetime({ offset: true }).nullable(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

// POST /v1/plans/:planId/slots/:planSlotId/override body.
// is_lumi_proposed defaults to false; parent-initiated overrides confirm
// immediately (confirmed_at = now()). Lumi-proposed overrides start unconfirmed
// and require a follow-up call to confirm — wiring is deferred (see Dev Notes).
// .strict() rejects unknown keys so a stale client cannot smuggle in fields.
export const SetPlanDayContextInputSchema = z
  .object({
    context_type: PlanDayContextTypeSchema,
    override_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    child_id: z.string().uuid(),
    is_lumi_proposed: z.boolean().default(false),
  })
  .strict()
  .refine(
    (data) => data.override_date >= new Date().toISOString().slice(0, 10),
    { message: 'override_date must be today or in the future', path: ['override_date'] },
  );

export const SetPlanDayContextResponseSchema = z.object({
  override: PlanDayContextSchema,
  regen_triggered: z.boolean(),
});
