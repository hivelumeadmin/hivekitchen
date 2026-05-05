import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import type { Job } from 'bullmq';
import type {
  CommitPlanInput,
  GuardrailResult,
  PlanItemWrite,
} from '@hivekitchen/types';
import { buildCommitInput } from './plan-generation.job.js';

export const REGEN_QUEUE = 'plan-regeneration';

export interface PlanRegenerationJobData {
  plan_id: string;        // The plan row to regenerate (same id reused via commit upsert)
  household_id: string;
  week_of: string;        // ISO date string — needed by orchestrator.planWeek()
  week_id: string;        // Derived from week_of; stored to avoid recomputing
  current_revision: number; // Plan's revision at enqueue time; worker sets revision = current_revision + 1
  scope: 'week' | 'day';
  day?: string;           // Required when scope='day'
  request_id: string;
}

// Per-job BullMQ options: 2 attempts (regeneration is user-initiated;
// fewer retries than automatic generation to conserve rate limit budget).
const REGEN_JOB_OPTS = {
  attempts: 2,
  backoff: { type: 'exponential' as const, delay: 60_000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 50 },
};

const planRegenerationPlugin: FastifyPluginAsync = async (fastify) => {
  if (!fastify.orchestrator) {
    throw new Error(
      'planRegenerationPlugin requires orchestrator decorator — register orchestratorHook first',
    );
  }
  if (!fastify.plansService) {
    throw new Error(
      'planRegenerationPlugin requires plansService decorator — register plansHook first',
    );
  }
  if (!fastify.auditService) {
    throw new Error(
      'planRegenerationPlugin requires auditService decorator — register auditHook first',
    );
  }

  const regenWorker = fastify.bullmq.getWorker(
    REGEN_QUEUE,
    async (job: Job<PlanRegenerationJobData>) => {
      const { plan_id, household_id, week_of, week_id, current_revision, scope, day, request_id } = job.data;

      fastify.log.info(
        {
          module: 'plan-regeneration',
          action: 'regen.start',
          plan_id,
          household_id,
          scope,
          day,
          attempt: job.attemptsMade,
        },
        'plan-regeneration job started',
      );

      // Run the planner. For scope='day', pass dayScope so the prompt instructs
      // the agent to only plan for that day. The compose output may include only
      // that day's items (agent-guided) or the full week (if the LLM doesn't
      // comply) — the worker filters to just the target day in the day-scope path.
      const composeOutput = await fastify.orchestrator.planWeek(
        household_id,
        week_of,
        request_id,
        undefined,
        scope === 'day' ? day : undefined,
      );

      // For day-scope: filter the output to only include items for the target day.
      // Guards against LLM non-compliance with the day-scope prompt instruction.
      const filteredOutput =
        scope === 'day' && day !== undefined
          ? { ...composeOutput, days: composeOutput.days.filter((d) => d.day === day) }
          : composeOutput;

      if (scope === 'day' && filteredOutput.days.length === 0) {
        throw new Error(
          `Day-scope regeneration for '${day ?? ''}' returned no days from the planner`,
        );
      }

      const commitInput = buildCommitInput(filteredOutput, week_id, request_id);
      // Increment revision so brief.plan_revision bumps and BriefCanvas polling terminates.
      commitInput.revision = current_revision + 1;

      // Capture existing items once for day-scope so both the initial merge and
      // the guardrail-retry callback use the same snapshot. Fetching twice creates
      // a TOCTOU window where a concurrent swap could cause the retry to overwrite
      // the swap with stale pre-swap ingredients.
      const existingItems =
        scope === 'day' && day !== undefined
          ? await fastify.plansService.getCurrentPlanItems(plan_id, household_id)
          : [];

      // For day-scope regeneration: merge with existing current items for other
      // days so commit_plan() keeps the other days' items as-is (archives the
      // previous set, re-inserts other-day items + new day items as current).
      if (scope === 'day' && day !== undefined) {
        const otherDayItems: PlanItemWrite[] = existingItems
          .filter((item) => item.day !== day)
          .map((item) => ({
            child_id: item.child_id,
            day: item.day,
            slot: item.slot,
            ingredients: item.ingredients,
            ...(item.recipe_id != null ? { recipe_id: item.recipe_id } : {}),
            ...(item.item_id != null ? { item_id: item.item_id } : {}),
          }));
        commitInput.items = [...otherDayItems, ...commitInput.items];
      }

      // Commit with full-week allergy guardrail. For day-scope, the merged
      // items set covers all days so the guardrail evaluates the full plan.
      await fastify.plansService.commit(
        commitInput,
        request_id,
        async (rejections: GuardrailResult[]): Promise<CommitPlanInput> => {
          const conflictLines = rejections
            .flatMap((r) => (r.verdict === 'blocked' ? r.conflicts : []))
            .map((c) => `allergen: ${c.allergen}, ingredient: ${c.ingredient}`);
          // Pass undefined rather than "" so planWeek doesn't inject the
          // "first generation attempt" context line when no blocked verdicts exist.
          const rejectionContext = conflictLines.length > 0 ? conflictLines.join('; ') : undefined;

          const retryOutput = await fastify.orchestrator.planWeek(
            household_id,
            week_of,
            request_id,
            rejectionContext,
            scope === 'day' ? day : undefined,
          );

          const filteredRetry =
            scope === 'day' && day !== undefined
              ? { ...retryOutput, days: retryOutput.days.filter((d) => d.day === day) }
              : retryOutput;

          const retryCommit = buildCommitInput(filteredRetry, week_id, request_id);
          retryCommit.revision = current_revision + 1;

          if (scope === 'day' && day !== undefined) {
            const otherDayItems: PlanItemWrite[] = existingItems
              .filter((item) => item.day !== day)
              .map((item) => ({
                child_id: item.child_id,
                day: item.day,
                slot: item.slot,
                ingredients: item.ingredients,
                ...(item.recipe_id != null ? { recipe_id: item.recipe_id } : {}),
                ...(item.item_id != null ? { item_id: item.item_id } : {}),
              }));
            retryCommit.items = [...otherDayItems, ...retryCommit.items];
          }

          return retryCommit;
        },
      );

      // Audit successful regeneration. Failures here don't roll back the commit.
      try {
        await fastify.auditService.write({
          event_type: 'plan.regenerated',
          household_id,
          request_id,
          metadata: { plan_id, scope, day: day ?? null, week_of, week_id },
        });
      } catch (auditErr) {
        fastify.log.error(
          { auditErr, plan_id },
          'audit write failed after plan regeneration — regen committed',
        );
      }

      // SSE fan-out is deferred to Story 5.2. brief_state is refreshed inside
      // PlansService.commit() → BriefStateComposer.refresh(). Client polls via
      // TanStack Query stale-time or manual invalidation.
      fastify.log.debug(
        { module: 'plan-regeneration', action: 'sse.deferred', household_id, plan_id },
        'plan.updated SSE emission deferred to Story 5.2',
      );

      fastify.log.info(
        {
          module: 'plan-regeneration',
          action: 'regen.complete',
          plan_id,
          household_id,
          scope,
        },
        'plan-regeneration job completed — brief_state updated',
      );
    },
    { concurrency: 2 },
  );

  // Permanent failure audit. BullMQ emits 'failed' on every failed attempt;
  // only write the audit event after all attempts are exhausted.
  regenWorker.on('failed', (job: Job<PlanRegenerationJobData> | undefined, err: Error) => {
    if (!job) return;
    const maxAttempts = (job.opts?.attempts as number | undefined) ?? REGEN_JOB_OPTS.attempts;
    if (job.attemptsMade < maxAttempts) return;

    const { plan_id, household_id, request_id, scope, week_of } = job.data;
    fastify.log.error(
      { module: 'plan-regeneration', action: 'regen.permanent_failure', plan_id, err },
      'plan-regeneration job permanently failed',
    );

    fastify.auditService
      .write({
        event_type: 'plan.generation.failed',
        household_id,
        request_id,
        metadata: {
          plan_id,
          scope,
          week_of,
          error: err.message,
          attempts: job.attemptsMade,
        },
      })
      .catch((auditErr: unknown) => {
        fastify.log.error(
          { err: auditErr, plan_id },
          'failed to write plan.generation.failed audit event after regen failure',
        );
      });
  });
};

export const planRegenerationJobPlugin = fp(planRegenerationPlugin, {
  name: 'plan-regeneration-job',
});
