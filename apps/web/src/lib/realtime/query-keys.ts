// apps/web/src/lib/realtime/query-keys.ts

/**
 * Centralized query key factory for all TanStack Query keys used by the SSE dispatcher.
 * Every Epic 2+ feature that needs SSE-driven invalidation must add its key here.
 * Consumers import from '@/lib/realtime' (the barrel).
 */
export const QueryKeys = {
  /** @example QueryKeys.plan('week-uuid') → ['plan', 'week-uuid'] */
  plan: (weekId: string): ['plan', string] => ['plan', weekId],

  /** @example QueryKeys.thread('thread-uuid') → ['thread', 'thread-uuid'] */
  thread: (threadId: string): ['thread', string] => ['thread', threadId],

  /** @example QueryKeys.memory('node-uuid') → ['memory', 'node-uuid'] */
  memory: (nodeId: string): ['memory', string] => ['memory', nodeId],

  /** @example QueryKeys.packer('2026-04-24') → ['packer', '2026-04-24'] */
  packer: (date: string): ['packer', string] => ['packer', date],

  /** @example QueryKeys.pantry() → ['pantry'] */
  pantry: (): ['pantry'] => ['pantry'],

  /** @example QueryKeys.presence('thread-uuid') → ['presence', 'thread-uuid'] */
  presence: (threadId: string): ['presence', string] => ['presence', threadId],
} as const;
