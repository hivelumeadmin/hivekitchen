import type { Redis } from 'ioredis';
import { ChildSignalInputSchema, ChildSignalOutputSchema } from '@hivekitchen/contracts';
import { recordToolLatency } from '../../observability/tool-latency.histogram.js';
import type { ToolSpec } from '../tools.manifest.js';
import type { ChildPreferencesRepository } from '../../modules/child-preferences/child-preferences.repository.js';
import type { ChildrenRepository } from '../../modules/children/children.repository.js';
import { loadChildSignal } from '../../modules/child-preferences/child-signal.assembler.js';

/** @public consumed dynamically by scripts/check-tool-manifest.ts */
export const MANIFESTED_TOOL_NAMES = ['child_signal'] as const;

// Story 4-S11 — child_signal planner tool. Surfaces per-child recipe preference
// signals from recent emoji ratings so the planner can bias toward liked
// recipes. Read-only; the write path is the fire-and-forget signal write on the
// rating route. The description below is verbatim the agent-facing copy from
// AC5 — absence-neutrality (FR125) is stated explicitly.
export function createChildSignalSpec(
  childPrefsRepo: ChildPreferencesRepository,
  childrenRepo: ChildrenRepository,
  redis: Redis,
): ToolSpec {
  return {
    name: 'child_signal',
    description:
      'Get per-child recipe preference signals from recent emoji ratings. Call once at the start of each planning run. Liked recipes should be preferred in the same slot kind. Disliked recipes should be avoided. Absence of a signal = no data — never infer dislike from absence.',
    inputSchema: ChildSignalInputSchema,
    outputSchema: ChildSignalOutputSchema,
    maxLatencyMs: 200,
    fn: async (input: unknown) => {
      const start = Date.now();
      try {
        const parsed = ChildSignalInputSchema.parse(input);
        const result = await loadChildSignal({
          childPrefsRepo,
          childrenRepo,
          householdId: parsed.household_id,
          lookbackDays: parsed.lookback_days,
        });
        return ChildSignalOutputSchema.parse(result);
      } finally {
        try {
          await recordToolLatency(redis, 'child_signal', Date.now() - start);
        } catch {
          // latency recording is observability-only; do not mask the tool result
        }
      }
    },
  };
}
