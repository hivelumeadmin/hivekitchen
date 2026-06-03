import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import type { Job } from 'bullmq';
import type {
  CommitPlanTreeInput,
  GuardrailResult,
  PlanComposeTreeOutput,
  Weekday,
} from '@hivekitchen/types';
import { buildCommitInputTree } from './plan-generation.job.js';
import {
  existingTreeToCommitInput,
  overlayDayScopeOntoFullTree,
} from './day-scope-merge.helper.js';
import { ChildAllergensRepository } from '../modules/children/child-allergens.repository.js';
import { ChildrenRepository } from '../modules/children/children.repository.js';
import { CulturalPriorRepository } from '../modules/cultural-priors/cultural-prior.repository.js';
import { CulturalCalendarService } from '../services/cultural-calendar.service.js';
import { MemoryContextService } from '../services/memory-context.service.js';
import { ExtraRulesRepository } from '../modules/children/extra-rules.repository.js';
import { ExtraLibraryRepository } from '../modules/households/extra-library.repository.js';
import { HouseholdsRepository } from '../modules/households/households.repository.js';
import { PlanDayContextRepository } from '../modules/plans/plan-day-context.repository.js';
import {
  loadBagCompositionsForHousehold,
  loadCulturalContextForHousehold,
  loadExtraLibraryForHousehold,
  loadExtraRulesForChildren,
  loadHighActivityExtraProposalsForHousehold,
  loadVariantEligibleChildrenForHousehold,
} from './planner-context.loader.js';
import { trySurgicalSwap } from './swap-retry.helper.js';

export const REGEN_QUEUE = 'plan-regeneration';

export interface PlanRegenerationJobData {
  plan_id: string;        // The plan row to regenerate (same id reused via commit upsert)
  household_id: string;
  week_of: string;        // ISO date string — needed by orchestrator.planWeek()
  current_revision: number; // Plan's revision at enqueue time; worker sets revision = current_revision + 1
  scope: 'week' | 'day';
  day?: string;           // Required when scope='day'
  request_id: string;
  // Story 3.23 — slot-scoped regen context. Omitted for 'bag_wide' or null;
  // present only for 'main' | 'snack' | 'extra'. The planner prompt uses this
  // to preserve non-target slots; the allergy guardrail evaluates every slot
  // regardless (bag-wide invariant — see allergy-rules.engine.test.ts).
  slot_scope?: 'main' | 'snack' | 'extra';
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
  if (!fastify.supabase) {
    throw new Error(
      'planRegenerationPlugin requires supabase decorator — register supabasePlugin first',
    );
  }

  // Story 3.18 — cultural context loaders shared with the generation job.
  // Day-scope and rejection-retry paths both reuse the snapshot captured at
  // job start so the planner sees a consistent view even if cultural priors
  // change mid-flight.
  const culturalPriorRepository = new CulturalPriorRepository(fastify.supabase);
  const culturalCalendarService = new CulturalCalendarService(fastify.supabase);
  const memoryContextService = new MemoryContextService(fastify.supabase);
  // Story 3.20 — kek=null is fine: findBagCompositionsByHousehold() does not
  // touch encrypted columns.
  // Slice 2.6-s8 — ChildrenRepository now requires ChildAllergensRepository
  // at construction (planner only uses findBagCompositionsByHousehold; the
  // allergens dep is never exercised on this hot path).
  const childAllergensRepository = new ChildAllergensRepository(fastify.supabase, null);
  const childrenRepository = new ChildrenRepository(
    fastify.supabase,
    null,
    fastify.log,
    childAllergensRepository,
  );
  const extraRulesRepository = new ExtraRulesRepository(fastify.supabase);
  const extraLibraryRepository = new ExtraLibraryRepository(fastify.supabase);
  const planDayContextRepository = new PlanDayContextRepository(fastify.supabase);
  const householdsRepository = new HouseholdsRepository(fastify.supabase, null);
  const regenWorker = fastify.bullmq.getWorker(
    REGEN_QUEUE,
    async (job: Job<PlanRegenerationJobData>) => {
      const { plan_id, household_id, week_of, current_revision, scope, day, request_id, slot_scope } = job.data;

      // Story 3.23 — when slot_scope is set, push a high-priority context
      // line into planWeek() so the planner regenerates only the target slot
      // and leaves the others intact. The allergy guardrail still evaluates
      // the full output bag-wide; slot_scope governs regen, not safety.
      let slotScopeContext: string | undefined;
      if (slot_scope !== undefined) {
        const slotLabel = slot_scope.charAt(0).toUpperCase() + slot_scope.slice(1);
        slotScopeContext =
          `SLOT-SCOPED REGENERATION: Regenerate ONLY the ${slotLabel} slot items. ` +
          `Keep ALL other slot items (Main/Snack/Extra as applicable) identical to the previous plan.`;
      }

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

      const [culturalContext, bagCompositions, extraLibraryItems, variantEligibleChildren, sovereigntyMode] = await Promise.all([
        loadCulturalContextForHousehold(household_id, week_of, culturalPriorRepository, culturalCalendarService, memoryContextService),
        loadBagCompositionsForHousehold(household_id, childrenRepository),
        loadExtraLibraryForHousehold(household_id, extraLibraryRepository),
        loadVariantEligibleChildrenForHousehold(household_id, childrenRepository),
        householdsRepository.getSovereigntyMode(household_id).catch((err: unknown) => {
          fastify.log.warn(
            { err, household_id },
            'getSovereigntyMode failed — falling back to unified mode',
          );
          return 'unified' as const;
        }),
      ]);
      // Story 3.22 — extra_rules read fans out per-child; depends on bagCompositions.
      // High-activity proposals also depend on bagCompositions, so both are loaded
      // in parallel after the initial batch (mirrors plan-generation.job.ts pattern).
      const [extraRules, extraProposals] = await Promise.all([
        loadExtraRulesForChildren(bagCompositions, extraRulesRepository),
        loadHighActivityExtraProposalsForHousehold(
          household_id,
          week_of,
          bagCompositions,
          planDayContextRepository,
        ),
      ]);

      // Run the planner. For scope='day', pass dayScope so the prompt instructs
      // the agent to only plan for that day. The compose output may include only
      // that day's items (agent-guided) or the full week (if the LLM doesn't
      // comply) — the worker filters to just the target day in the day-scope path.
      const composeOutput = await fastify.orchestrator.planWeek({
        householdId: household_id,
        weekOf: week_of,
        requestId: request_id,
        dayScope: scope === 'day' ? day : undefined,
        culturalContext,
        bagCompositions,
        extraRules,
        extraLibraryItems,
        extraProposals,
        slotScopeContext,
        variantEligibleChildren,
        sovereigntyMode,
      });

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

      let commitInput = buildCommitInputTree(filteredOutput, request_id);

      // 9b part 3 — day-scope regen overlays the planner-emitted target day
      // onto the existing plan tree so sibling days + plan-level
      // main_assignments survive the round-trip. Week-scope regen replaces
      // the whole tree and skips this branch.
      if (scope === 'day' && day !== undefined) {
        const existingTree = await fastify.plansService.getCurrentPlanTree(plan_id, household_id);
        const existingCommit = existingTreeToCommitInput({
          existing: existingTree,
          planId: plan_id,
          householdId: household_id,
          weekOf: week_of,
          revision: current_revision,
          promptVersion: filteredOutput.prompt_version,
          generatedAt: commitInput.generated_at,
          planBuildId: commitInput.plan_build_id,
        });
        commitInput = overlayDayScopeOntoFullTree({
          fullCommit: existingCommit,
          dayScopedCommit: commitInput,
          // RegeneratePlanQuerySchema constrains `day` to Weekday at route
          // validation; PlanRegenerationJobData.day is typed `string` for
          // historical reasons (predates this helper). Safe to narrow here.
          targetDay: day as Weekday,
        });
      }
      // Increment revision so brief.plan_revision bumps and BriefCanvas polling terminates.
      commitInput.revision = current_revision + 1;

      // Commit with full-week allergy guardrail. The regenerate callback first
      // tries the Slice E Swap Agent (mini-tier surgical retry) before falling
      // back to a full flagship-tier planWeek regen. lastAttemptCommit carries
      // the most recent commit input across retries.
      let lastAttemptCommit: CommitPlanTreeInput = commitInput;
      let lastAttemptComposeOutput: PlanComposeTreeOutput = filteredOutput;
      const committedPlanId = await fastify.plansService.commit(
        commitInput,
        request_id,
        async (rejections: GuardrailResult[]): Promise<CommitPlanTreeInput> => {
          const surgical = await trySurgicalSwap({
            orchestrator: fastify.orchestrator,
            previousCommit: lastAttemptCommit,
            rejections,
            weekOf: week_of,
            requestId: request_id,
            logger: fastify.log,
          });
          if (surgical !== null) {
            if (lastAttemptComposeOutput.variant_proposal !== undefined) {
              lastAttemptComposeOutput = { ...lastAttemptComposeOutput, variant_proposal: undefined };
            }
            const swapCommit = { ...surgical, revision: current_revision + 1 };
            lastAttemptCommit = swapCommit;
            return swapCommit;
          }

          const conflictLines = rejections
            .flatMap((r) => (r.verdict === 'blocked' ? r.conflicts : []))
            .map((c) => `allergen: ${c.allergen}, ingredient: ${c.ingredient}`);
          const rejectionContext = conflictLines.length > 0 ? conflictLines.join('; ') : undefined;

          // Story 3.24 — propagate compound-uncertain flagged items through the
          // dedicated uncertainContext channel so the planner picks single-
          // ingredient replacements on retry.
          const compoundFlagged = rejections.flatMap((r) =>
            r.verdict === 'uncertain' && r.reason === 'compound_ingredient_unverified'
              ? r.flagged_items ?? []
              : [],
          );
          const addressableCompound = slot_scope !== undefined
            ? compoundFlagged.filter((f) => f.slot === slot_scope)
            : compoundFlagged;
          const uncertainContext = (() => {
            if (addressableCompound.length === 0) return undefined;
            const seen = new Set<string>();
            const slots = addressableCompound
              .map((f) => `${f.child_id}|${f.day}|${f.slot}`)
              .filter((s) => { const fresh = !seen.has(s); seen.add(s); return fresh; })
              .join(', ');
            return `ALLERGEN-UNCERTAIN: Replace the following items — use only single-ingredient items of unambiguous provenance (no sauces, spice blends, pastes, or compound products): ${slots}`;
          })();

          const retryOutput = await fastify.orchestrator.planWeek({
            householdId: household_id,
            weekOf: week_of,
            requestId: request_id,
            rejectionContext,
            dayScope: scope === 'day' ? day : undefined,
            culturalContext,
            bagCompositions,
            extraRules,
            extraLibraryItems,
            extraProposals,
            slotScopeContext,
            uncertainContext,
            variantEligibleChildren,
            sovereigntyMode,
          });

          const filteredRetry =
            scope === 'day' && day !== undefined
              ? { ...retryOutput, days: retryOutput.days.filter((d) => d.day === day) }
              : retryOutput;

          let retryCommit = buildCommitInputTree(filteredRetry, request_id);

          // 9b part 3 — overlay the retry's planner-emitted day onto the
          // latest known full tree (lastAttemptCommit is the merged commit
          // from the prior attempt). Week-scope retry uses the planner's
          // full week directly.
          if (scope === 'day' && day !== undefined) {
            retryCommit = overlayDayScopeOntoFullTree({
              fullCommit: lastAttemptCommit,
              dayScopedCommit: retryCommit,
              targetDay: day as Weekday,
            });
          }
          retryCommit.revision = current_revision + 1;

          lastAttemptCommit = retryCommit;
          lastAttemptComposeOutput = filteredRetry;
          return retryCommit;
        },
      );

      // P4 (review) — persist any variant proposal the planner emitted during
      // regen. Failure must not surface as a regen failure.
      try {
        await fastify.variantProposalService.createFromTreePlanOutput({
          planOutput: lastAttemptComposeOutput,
          planId: committedPlanId,
          householdId: household_id,
          requestId: request_id,
        });
      } catch (err) {
        fastify.log.error(
          { err, household_id, plan_id: committedPlanId },
          'variant proposal persistence failed after regen — regen committed',
        );
      }

      // Audit successful regeneration. Failures here don't roll back the commit.
      try {
        await fastify.auditService.write({
          event_type: 'plan.regenerated',
          household_id,
          request_id,
          metadata: { plan_id, scope, day: day ?? null, week_of },
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
