// Mirrors apps/api/src/jobs/plan-generation.job.ts:deriveWeekId(). The server
// keys plans by SHA-256(`hivekitchen-week:${weekOf}`) shaped as a UUID v4.
// The web client needs the same derivation to build deep links to historical
// plan pages (Story 3.15) without a round-trip to the API.
//
// SubtleCrypto.digest is async, so this helper is too. Callers should compute
// once per session and cache; week_ids are stable for a given weekOf.
export async function deriveWeekId(weekOf: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(`hivekitchen-week:${weekOf}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(buf);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes.subarray(0, 16))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// Returns the ISO date string for the Monday of the current UTC week.
// Mirrors apps/api/src/lib/derive-week-id.ts:getCurrentWeekMonday().
// Sunday is treated as the last day of the prior week (6 days back), matching server logic.
export function getCurrentWeekMonday(now: Date = new Date()): string {
  const day = now.getUTCDay();
  const daysBack = day === 0 ? 6 : day - 1;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - daysBack);
  return monday.toISOString().slice(0, 10);
}

