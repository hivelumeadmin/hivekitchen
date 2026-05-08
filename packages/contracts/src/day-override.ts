import { z } from 'zod';

// Story 3.19 — Day-level context overrides (FR118, FR119).
// Each row is a one-off override on a single (plan_item, child, date). The
// override auto-reverts after override_date via the nightly job
// (apps/api/src/jobs/day-override-revert.job.ts) — the row remains for audit
// with reverted_at populated.
//
// Mirrors:
//   - supabase/migrations/.../create_day_overrides.sql
//   - apps/api/src/modules/plans/day-overrides.repository.ts

export const DayOverrideTypeSchema = z.enum([
  'bag_suspended',
  'half_day',
  'field_trip',
  'sick_day',
  'post_dentist',
  'early_release',
  'sport_practice',
  'test_day',
]);

export const DayOverrideSchema = z.object({
  id: z.string().uuid(),
  plan_item_id: z.string().uuid(),
  child_id: z.string().uuid(),
  household_id: z.string().uuid(),
  override_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD
  override_type: DayOverrideTypeSchema,
  is_lumi_proposed: z.boolean(),
  confirmed_at: z.string().datetime().nullable(),
  reverted_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

// POST /v1/plans/:planId/items/:itemId/override body.
// is_lumi_proposed defaults to false; parent-initiated overrides confirm
// immediately (confirmed_at = now()). Lumi-proposed overrides start unconfirmed
// and require a follow-up call to confirm — wiring is deferred (see Dev Notes).
// .strict() rejects unknown keys so a stale client cannot smuggle in fields.
export const SetDayOverrideInputSchema = z
  .object({
    override_type: DayOverrideTypeSchema,
    override_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    child_id: z.string().uuid(),
    is_lumi_proposed: z.boolean().default(false),
  })
  .strict()
  .refine(
    (data) => data.override_date >= new Date().toISOString().slice(0, 10),
    { message: 'override_date must be today or in the future', path: ['override_date'] },
  );

export const SetDayOverrideResponseSchema = z.object({
  override: DayOverrideSchema,
  regen_triggered: z.boolean(),
});

// Path params for the override routes — kept as separate schemas so route
// declarations can reuse them via fastify-type-provider-zod.
export const DayOverridePlanItemParamSchema = z.object({
  planId: z.string().uuid(),
  itemId: z.string().uuid(),
});

export const DayOverrideRevertParamSchema = z.object({
  planId: z.string().uuid(),
  itemId: z.string().uuid(),
  overrideId: z.string().uuid(),
});
