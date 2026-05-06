import { createHash } from 'node:crypto';

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
