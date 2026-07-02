import { createHash } from 'node:crypto';
import type { Weekday } from '@hivekitchen/types';

// Produces a deterministic UUID-v4-shaped identifier from the week's Monday
// date. The same weekOf string always yields the same week_id, which prevents
// duplicate (household_id, week_id) plan rows on job retries and lets
// PlansService.commit() find an existing plan row to update.
//
// Mirrored on the client at apps/web/src/lib/derive-week-id.ts (SubtleCrypto).
export function deriveWeekId(weekOf: string): string {
  const hash = createHash('sha256').update(`hivekitchen-week:${weekOf}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x40;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const h = hash.subarray(0, 16).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

// Monday-anchored week helpers shared between PlansService and PlansRepository.
// UTC-based to match deriveWeekId's input. Sunday is treated as the last day
// of the prior week (day === 0 → daysBack = 6).
export function getCurrentWeekMonday(now: Date = new Date()): string {
  const day = now.getUTCDay();
  const daysBack = day === 0 ? 6 : day - 1;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - daysBack);
  return monday.toISOString().slice(0, 10);
}

export function getNextWeekMonday(now: Date = new Date()): string {
  const day = now.getUTCDay();
  const daysUntilNextMon = day === 0 ? 1 : 8 - day;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() + daysUntilNextMon);
  return monday.toISOString().slice(0, 10);
}

// Story 3-S34 — on-demand ("compose now") plan composition window. The decision
// is driven by the household-LOCAL day-of-week (NOT UTC), so a late-evening
// request in a behind-UTC timezone still composes for the correct calendar
// week. Whole-day arithmetic on a UTC-midnight anchor of the local date keeps
// DST transitions out of the math entirely (we never add sub-day offsets).
//
//   Mon/Tue/Wed (local) → current week, tomorrow → Friday
//   Thu/Fri/Sat/Sun     → next week, full Mon–Fri
//
// Saturday is intentionally never composed (Mon–Fri windows only).
const MON_TO_FRI: readonly Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
const MON_TO_SAT: readonly Weekday[] = [...MON_TO_FRI, 'saturday'];

export function deriveCompositionWindow(
  now: Date,
  timezone: string,
): {
  weekOf: string;
  plannedDays: Weekday[];
  basis: 'current_week_remaining' | 'next_week_full';
} {
  // Local calendar date (YYYY-MM-DD) in the household timezone. en-CA renders
  // ISO order; same Intl.DateTimeFormat tz approach as getLocalSixPmUtcMs.
  const localDateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

  // Anchor the local date at UTC midnight so day-of-week + Monday math is pure
  // date arithmetic.
  const localMidnightUtc = new Date(`${localDateStr}T00:00:00Z`);
  const dow = localMidnightUtc.getUTCDay(); // 0=Sun .. 6=Sat

  const daysBackToMonday = dow === 0 ? 6 : dow - 1;
  const currentMonday = new Date(localMidnightUtc);
  currentMonday.setUTCDate(localMidnightUtc.getUTCDate() - daysBackToMonday);

  // Mon(1)/Tue(2)/Wed(3) → compose the rest of THIS week (tomorrow → Friday).
  if (dow === 1 || dow === 2 || dow === 3) {
    // MON_TO_SAT index of "today" is dow-1; "tomorrow" is dow. Slicing to 5
    // stops at Friday and never includes Saturday.
    return {
      weekOf: currentMonday.toISOString().slice(0, 10),
      plannedDays: MON_TO_SAT.slice(dow, 5),
      basis: 'current_week_remaining',
    };
  }

  // Thu/Fri/Sat/Sun → compose all of NEXT week (Mon–Fri).
  const nextMonday = new Date(currentMonday);
  nextMonday.setUTCDate(currentMonday.getUTCDate() + 7);
  return {
    weekOf: nextMonday.toISOString().slice(0, 10),
    plannedDays: [...MON_TO_FRI],
    basis: 'next_week_full',
  };
}
