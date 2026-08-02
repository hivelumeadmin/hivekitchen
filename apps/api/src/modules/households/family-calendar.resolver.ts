import type { CalendarException, CalendarTerm } from '@hivekitchen/types';
import type { Weekday } from '@hivekitchen/types';

// Story 15-s1 — derive the week's Lunch Days from the Family Calendar.
//
// Canonical model v2 §4.6: whether a date needs a lunch is a FUNCTION of terms
// and exceptions, never a stored column. This is the tier-2 (School & Calendar)
// half of the constraint hierarchy — a hard, pre-flight planning constraint.
//
// Scope notes for this slice:
//   - Terms UNION. Any child in school on a date means the household cooks that
//     day, so a per-child term widens the set rather than narrowing it.
//   - Only household-wide (child_id === null) exceptions remove a day. Per-child
//     absence stays with the existing pause flow (plan_slot_variations.paused_at);
//     child-scoped exception rows are stored for forward-compat but inert here.
//   - early_release and other never remove a day: the child is at school and
//     still eats lunch.

const REMOVING_KINDS = new Set(['no_lunch', 'school_meal', 'trip']);

// ISO weekday (1 = Monday) → the canonical long-form Weekday value. Sunday has
// no entry: the weekday enum stops at saturday, and CalendarWeekdaySchema
// rejects 7, so a Sunday can never reach this map.
const ISO_TO_WEEKDAY: Record<number, Weekday> = {
  1: 'monday',
  2: 'tuesday',
  3: 'wednesday',
  4: 'thursday',
  5: 'friday',
  6: 'saturday',
};

const WEEKDAY_ORDER: readonly Weekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

export interface ResolveLunchDaysInput {
  readonly terms: readonly CalendarTerm[];
  readonly exceptions: readonly CalendarException[];
  readonly weekOf: string;
}

// Date arithmetic on YYYY-MM-DD strings anchored at UTC midnight, so no local
// offset or DST shift can move a date across a day boundary (same discipline as
// deriveCompositionWindow in lib/derive-week-id.ts).
export function addDaysIso(isoDate: string, days: number): string {
  const ms = Date.parse(`${isoDate}T00:00:00.000Z`);
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

// The six candidate dates of a composition week, Monday-anchored.
export function weekDates(weekOf: string): string[] {
  return [0, 1, 2, 3, 4, 5].map((offset) => addDaysIso(weekOf, offset));
}

/**
 * Which weekdays of `weekOf` need a lunch.
 *
 * Returns `undefined` when no term covers the week — meaning "this household has
 * no calendar opinion", which leaves the planner's default behaviour untouched.
 * Returns `[]` when the calendar covers the week but every day is excepted (a
 * whole-week holiday); callers MUST distinguish the two.
 */
export function resolveLunchDays(input: ResolveLunchDaysInput): Weekday[] | undefined {
  const { terms, exceptions, weekOf } = input;
  if (terms.length === 0) return undefined;

  const covered = weekDates(weekOf)
    .map((date, index) => ({ date, isoWeekday: index + 1 }))
    .filter(({ date, isoWeekday }) =>
      terms.some(
        (term) =>
          term.start_date <= date &&
          term.end_date >= date &&
          term.weekdays.includes(isoWeekday),
      ),
    );

  // No term reaches into this week at all — treat it as no calendar opinion
  // rather than as a zero-lunch week, so an unrelated term for a future month
  // cannot silently suppress composition.
  if (covered.length === 0) return undefined;

  const removedDates = new Set(
    exceptions
      .filter((e) => e.child_id === null && REMOVING_KINDS.has(e.kind))
      .map((e) => e.on_date),
  );

  const lunchDays = new Set(
    covered
      .filter(({ date }) => !removedDates.has(date))
      .map(({ isoWeekday }) => ISO_TO_WEEKDAY[isoWeekday])
      .filter((day): day is Weekday => day !== undefined),
  );

  return WEEKDAY_ORDER.filter((day) => lunchDays.has(day));
}

/**
 * Intersect the calendar's day set with any window the caller already has (the
 * mid-week on-demand compose window). `undefined` on either side means "no
 * opinion from that source".
 */
export function intersectDaySets(
  a: readonly Weekday[] | undefined,
  b: readonly Weekday[] | undefined,
): Weekday[] | undefined {
  if (a === undefined) return b === undefined ? undefined : [...b];
  if (b === undefined) return [...a];
  return a.filter((day) => b.includes(day));
}
