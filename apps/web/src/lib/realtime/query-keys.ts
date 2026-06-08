// apps/web/src/lib/realtime/query-keys.ts

/**
 * Centralized query key factory for all TanStack Query keys used by the SSE dispatcher.
 * Every Epic 2+ feature that needs SSE-driven invalidation must add its key here.
 * Consumers import from '@/lib/realtime' (the barrel).
 */
export const QueryKeys = {
  /** @example QueryKeys.plan('week-uuid') → ['plan', 'week-uuid'] */
  plan: (weekId: string): ['plan', string] => ['plan', weekId],

  /**
   * Story 3.14 — current/next week tab cache key for the brief surface.
   * Distinct from `plan(weekId)` which is keyed by SSE-emitted week_id; this
   * one is keyed by the user-facing tab so the same response shape can be
   * reused across the two tabs without colliding with SSE invalidation.
   * @example QueryKeys.planByWeek('next') → ['plan', 'by-week', 'next']
   */
  planByWeek: (week: 'current' | 'next'): ['plan', 'by-week', 'current' | 'next'] =>
    ['plan', 'by-week', week],

  /**
   * Story 3.15 — historical plan + outcomes view (FR25).
   * Keyed by week_id so each historical week gets its own cache entry; we don't
   * subscribe these to SSE since past plans are immutable.
   * @example QueryKeys.planHistory('week-uuid') → ['plan', 'history', 'week-uuid']
   */
  planHistory: (weekId: string): ['plan', 'history', string] => ['plan', 'history', weekId],

  /** @example QueryKeys.thread('thread-uuid') → ['thread', 'thread-uuid'] */
  thread: (threadId: string): ['thread', string] => ['thread', threadId],

  /** @example QueryKeys.memory('node-uuid') → ['memory', 'node-uuid'] */
  memory: (nodeId: string): ['memory', string] => ['memory', nodeId],

  /** @example QueryKeys.packer('2026-04-24') → ['packer', '2026-04-24'] */
  packer: (date: string): ['packer', string] => ['packer', date],

  /**
   * Slice 5-S3 — household-level PackerOfTheDay assignments (one shared query
   * for the whole Brief canvas). Distinct from the per-date `packer` key above.
   * @example QueryKeys.packers('household-uuid') → ['packers', 'household-uuid']
   */
  packers: (householdId: string): ['packers', string] => ['packers', householdId],

  /** @example QueryKeys.pantry() → ['pantry'] */
  pantry: (): ['pantry'] => ['pantry'],

  /** @example QueryKeys.presence('thread-uuid') → ['presence', 'thread-uuid'] */
  presence: (threadId: string): ['presence', string] => ['presence', threadId],

  /** @example QueryKeys.brief('household-uuid') → ['brief', 'household-uuid'] */
  brief: (householdId: string): ['brief', string] => ['brief', householdId],

  /**
   * Slice 4-S15 — pending child requests for the parent's planning page.
   * Invalidated by the `child_request.received` / `child_request.resolved`
   * SSE events.
   * @example QueryKeys.childRequests('household-uuid') → ['child-requests', 'household-uuid']
   */
  childRequests: (householdId: string): ['child-requests', string] =>
    ['child-requests', householdId],

  /**
   * Slice 5-S10 (review patch) — household family-language terms. Read by the
   * Lumi panel to suppress already-resolved ratification cards on re-hydration.
   * @example QueryKeys.familyLanguage('household-uuid') → ['family-language', 'household-uuid']
   */
  familyLanguage: (householdId: string): ['family-language', string] =>
    ['family-language', householdId],
} as const;
