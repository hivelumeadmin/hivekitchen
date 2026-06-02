import type { FastifyBaseLogger } from 'fastify';
import type {
  CommitPlanTreeInput,
  GuardrailResult,
} from '@hivekitchen/types';
import type { DomainOrchestrator } from '../agents/orchestrator.js';

// =============================================================================
// Slice E — surgical swap-retry helper (tree-shape, Phase 9a degraded form)
// =============================================================================
// Wraps DomainOrchestrator.swapBlockedItems with the merge + coverage check
// the regenerate callbacks need. Used by both plan-generation.job.ts (initial
// commit retry) and plan-regeneration.job.ts (user-initiated regen retry).
//
// Phase 9a transitional shape: the tree-shape merge (replace specific
// variations within slots while preserving siblings) is non-trivial — the
// previous flat merge keyed off (child_id, day, slot) tuples that no longer
// exist on the input shape. For Phase 9a, this helper returns null on every
// call so the caller falls back to full planWeek. Implementing the proper
// tree-shape merge — walking previousCommit.days[].slots[].variations[],
// replacing only the blocked variation rows, preserving siblings — is a
// scoped follow-up for Phase 9b along with the full swap-path test sweep.
//
// Runtime impact: surgical-swap-eligible guardrail blocks pay one extra
// flagship-tier planWeek call until 9b. Safety is preserved (the full regen
// still applies the guardrail bag-wide); only cost-per-block is degraded.
// =============================================================================

export async function trySurgicalSwap(opts: {
  orchestrator: Pick<DomainOrchestrator, 'swapBlockedItems'>;
  previousCommit: CommitPlanTreeInput;
  rejections: readonly GuardrailResult[];
  weekOf: string;
  requestId: string;
  logger: FastifyBaseLogger;
}): Promise<CommitPlanTreeInput | null> {
  const hasActionableRejection = opts.rejections.some(
    (r) =>
      r.verdict === 'blocked' ||
      (r.verdict === 'uncertain' && r.reason === 'compound_ingredient_unverified'),
  );
  if (!hasActionableRejection) {
    return null;
  }
  opts.logger.info(
    {
      planId: opts.previousCommit.plan_id,
      rejectionCount: opts.rejections.length,
    },
    'trySurgicalSwap: tree-shape merge deferred to Phase 9b — falling back to full planWeek',
  );
  return null;
}
