import { z } from 'zod';

// Story 15-s1 (Epic 15, Canonical Data Model v2 §4.6) — the Family Calendar.
// Mirrors supabase/migrations/20261035000000_create_family_calendar.sql and
// apps/api/src/modules/households/family-calendar.repository.ts.
//
// Terms carry the recurring rhythm, exceptions the one-off overrides. Whether a
// date is a Lunch Day is DERIVED from both (family-calendar.resolver.ts), never
// stored — see §4.6 "Derived, not stored".

export const CalendarSourceSchema = z.enum(['manual', 'google_readonly', 'school_import']);

export const CalendarExceptionKindSchema = z.enum([
  'no_lunch',
  'early_release',
  'school_meal',
  'trip',
  'other',
]);

// ISO weekday numbers: 1 = Monday … 6 = Saturday. Sunday (7) is deliberately
// absent — the weekday enum stops at saturday, so a Sunday term could never map
// onto a plan day.
export const CalendarWeekdaySchema = z.number().int().min(1).max(6);

export const CalendarTermSchema = z.object({
  id: z.string().uuid(),
  household_id: z.string().uuid(),
  child_id: z.string().uuid().nullable(),
  label: z.string().min(1).max(80),
  start_date: z.string().date(),
  end_date: z.string().date(),
  weekdays: z.array(CalendarWeekdaySchema).min(1),
  source: CalendarSourceSchema,
  created_at: z.string().datetime({ offset: true }),
});

export const CalendarExceptionSchema = z.object({
  id: z.string().uuid(),
  household_id: z.string().uuid(),
  child_id: z.string().uuid().nullable(),
  on_date: z.string().date(),
  kind: CalendarExceptionKindSchema,
  note: z.string().max(200).nullable(),
  source: CalendarSourceSchema,
  created_at: z.string().datetime({ offset: true }),
});

// POST /v1/households/:id/calendar/terms
// .strict() rejects unknown keys so a stale client cannot smuggle in fields
// outside this contract (matches UpdateSchoolPolicyInputSchema).
export const CreateCalendarTermInputSchema = z
  .object({
    child_id: z.string().uuid().nullable().default(null),
    label: z.string().min(1).max(80),
    start_date: z.string().date(),
    end_date: z.string().date(),
    weekdays: z.array(CalendarWeekdaySchema).min(1).default([1, 2, 3, 4, 5]),
    source: CalendarSourceSchema.default('manual'),
  })
  .strict()
  .refine((v) => v.end_date >= v.start_date, {
    message: 'end_date must be on or after start_date',
    path: ['end_date'],
  });

// POST /v1/households/:id/calendar/exceptions
export const CreateCalendarExceptionInputSchema = z
  .object({
    child_id: z.string().uuid().nullable().default(null),
    on_date: z.string().date(),
    kind: CalendarExceptionKindSchema,
    note: z.string().max(200).nullable().default(null),
    source: CalendarSourceSchema.default('manual'),
  })
  .strict();

// GET /v1/households/:id/calendar
export const FamilyCalendarResponseSchema = z.object({
  terms: z.array(CalendarTermSchema),
  exceptions: z.array(CalendarExceptionSchema),
});

export const CreateCalendarTermResponseSchema = z.object({ term: CalendarTermSchema });
export const CreateCalendarExceptionResponseSchema = z.object({
  exception: CalendarExceptionSchema,
});

// Path params — name-prefixed to avoid colliding with the other :id shapes
// already exported from this package.
export const CalendarHouseholdIdParamSchema = z.object({ id: z.string().uuid() });
export const CalendarTermIdParamSchema = z.object({
  id: z.string().uuid(),
  termId: z.string().uuid(),
});
export const CalendarExceptionIdParamSchema = z.object({
  id: z.string().uuid(),
  exceptionId: z.string().uuid(),
});

export type CalendarSource = z.infer<typeof CalendarSourceSchema>;
export type CalendarExceptionKind = z.infer<typeof CalendarExceptionKindSchema>;
export type CalendarTerm = z.infer<typeof CalendarTermSchema>;
export type CalendarException = z.infer<typeof CalendarExceptionSchema>;
export type CreateCalendarTermInput = z.infer<typeof CreateCalendarTermInputSchema>;
export type CreateCalendarExceptionInput = z.infer<typeof CreateCalendarExceptionInputSchema>;
export type FamilyCalendarResponse = z.infer<typeof FamilyCalendarResponseSchema>;
