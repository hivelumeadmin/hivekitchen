import { randomUUID } from 'node:crypto';
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import type { Job } from 'bullmq';
import type {
  CommitPlanTreeInput,
  GuardrailResult,
  PlanComposeTreeOutput,
} from '@hivekitchen/types';
import { GuardrailRejectionError } from '../common/errors.js';
import { HouseholdsRepository } from '../modules/households/households.repository.js';
import { ChildAllergensRepository } from '../modules/children/child-allergens.repository.js';
import { ChildrenRepository } from '../modules/children/children.repository.js';
import { CulturalPriorRepository } from '../modules/cultural-priors/cultural-prior.repository.js';
import { CulturalCalendarService } from '../services/cultural-calendar.service.js';
import { MemoryContextService } from '../services/memory-context.service.js';
import { ExtraRulesRepository } from '../modules/children/extra-rules.repository.js';
import { ExtraLibraryRepository } from '../modules/households/extra-library.repository.js';
import { DayOverridesRepository } from '../modules/plans/day-overrides.repository.js';
import { deriveWeekId } from '../lib/derive-week-id.js';
import {
  loadBagCompositionsForHousehold,
  loadCulturalContextForHousehold,
  loadExtraLibraryForHousehold,
  loadExtraRulesForChildren,
  loadHighActivityExtraProposalsForHousehold,
  loadVariantEligibleChildrenForHousehold,
} from './planner-context.loader.js';
import { trySurgicalSwap } from './swap-retry.helper.js';

export { deriveWeekId };

const SCHEDULE_QUEUE = 'plan-generation-schedule';
const GENERATE_QUEUE = 'plan-generation';
const SCHEDULE_JOB_ID = 'weekly-plan-generation-fanout';

// Per-job BullMQ options for household plan generation: 3 attempts with
// exponential backoff (5m → 10m → 20m). attempts:3 satisfies the AC #3
// "3 retries on transient failure" — one initial attempt plus two retries
// would be attempts:3 BullMQ semantics; AC text reads "3 retries", which we
// implement as attempts:3 (initial + 2 retries) per BullMQ's count of
// attemptsMade incrementing on each try.
const GENERATION_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 300_000 },
  removeOnComplete: { count: 200 },
  removeOnFail: { count: 48 },
};

export interface PlanGenerationJobData {
  household_id: string;
  week_of: string;
  request_id: string;
}

// Given a Friday date at fan-out time, returns the ISO date of the following
// Monday. "Following Monday" = 3 days after Friday.
export function getNextMondayFrom(fridayDate: Date): string {
  const d = new Date(fridayDate);
  d.setUTCDate(d.getUTCDate() + 3);
  return d.toISOString().slice(0, 10);
}

// Returns the UTC timestamp (ms) when 18:00 local time arrives in the given
// IANA timezone on the same calendar day as `referenceDate`. If 18:00 local
// has already passed, returns the timestamp for 18:00 local on the NEXT day.
//
// Uses UTC noon of the local date as a stable probe point — noon is well
// clear of DST midnight transitions and works for all IANA timezones.
// Whole-hour-offset zones are exact; half-hour-offset zones (IST, NPT) land
// within an hour, which is acceptable for this scheduling use case.
export function getLocalSixPmUtcMs(timezone: string, referenceDate: Date): number {
  const localDateStr = new Intl.DateTimeFormat('sv-SE', { timeZone: timezone }).format(referenceDate);

  const noonUtcMs = new Date(`${localDateStr}T12:00:00Z`).getTime();
  const localHourAtNoon = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', hour12: false }).format(
      new Date(noonUtcMs),
    ),
    10,
  );

  const targetMs = noonUtcMs + (18 - localHourAtNoon) * 3_600_000;

  return targetMs < referenceDate.getTime() ? targetMs + 86_400_000 : targetMs;
}

// Converts PlanComposeTreeOutput (what plan.compose returns) into
// CommitPlanTreeInput (what commit_plan() RPC accepts). main_assignments and
// days[].slots[].variations pass through 1:1; the RPC resolves
// slot.main_assignment_sequence against just-inserted plan_main_assignments
// rows DB-side.
export function buildCommitInputTree(
  output: PlanComposeTreeOutput,
  requestId: string,
): CommitPlanTreeInput {
  return {
    plan_id: output.plan_id,
    household_id: output.household_id,
    week_of: output.week_of,
    revision: 1,
    generated_at: new Date().toISOString(),
    prompt_version: output.prompt_version,
    // Story 3-31 carry-through: requestId IS the plan_build_id used by
    // recipe.discover's Redis cache. In the tree path, recipe_candidate_id
    // only appears on snack/extra slot rows (mains use main_assignment.recipe_id
    // which is always a real catalog id).
    plan_build_id: requestId,
    main_assignments: output.main_assignments,
    days: output.days,
  };
}

const planGenerationPlugin: FastifyPluginAsync = async (fastify) => {
  if (!fastify.orchestrator) {
    throw new Error(
      'planGenerationPlugin requires orchestrator decorator — register orchestratorHook first',
    );
  }
  if (!fastify.plansService) {
    throw new Error(
      'planGenerationPlugin requires plansService decorator — register plansHook first',
    );
  }
  if (!fastify.auditService) {
    throw new Error(
      'planGenerationPlugin requires auditService decorator — register auditHook first',
    );
  }
  if (!fastify.supabase) {
    throw new Error(
      'planGenerationPlugin requires supabase decorator — register supabasePlugin first',
    );
  }

  const scheduleQueue = fastify.bullmq.getQueue(SCHEDULE_QUEUE);
  const generateQueue = fastify.bullmq.getQueue(GENERATE_QUEUE);

  // Story 3.18 — services that hydrate cultural context for the planner. The
  // CulturalPriorRepository sources the household's ratified template keys;
  // CulturalCalendarService maps those keys to upcoming observances; the
  // MemoryContextService surfaces L0 preferences + L1 method priors.
  const culturalPriorRepository = new CulturalPriorRepository(fastify.supabase);
  const culturalCalendarService = new CulturalCalendarService(fastify.supabase);
  const memoryContextService = new MemoryContextService(fastify.supabase);
  // Story 3.20 — bag composition lookup for the planner. kek=null is fine:
  // findBagCompositionsByHousehold() does not touch encrypted columns.
  // Slice 2.6-s8 — ChildrenRepository now requires ChildAllergensRepository;
  // the planner only calls findBagCompositionsByHousehold (which never touches
  // allergens), but the dependency is required at construction time.
  const childAllergensRepository = new ChildAllergensRepository(fastify.supabase, null);
  const childrenRepository = new ChildrenRepository(
    fastify.supabase,
    null,
    fastify.log,
    childAllergensRepository,
  );
  // Story 3.21 — Extra slot pin/ban rules + household custom Extra library.
  const extraRulesRepository = new ExtraRulesRepository(fastify.supabase);
  const extraLibraryRepository = new ExtraLibraryRepository(fastify.supabase);
  // Story 3.22 — high-activity Extra proposals (FR119) read active day_overrides
  // and pair them with bag-composition data to surface sport_practice/field_trip
  // days for children whose Extra slot is OFF.
  const dayOverridesRepository = new DayOverridesRepository(fastify.supabase);

  // Fan-out scheduler — Friday 10:00 UTC (= 06:00 ET / 03:00 PT). For each
  // active household, enqueues a delayed per-household job that fires at
  // 18:00 local on Friday. The 36h window (Fri 18:00 → Sun 06:00 UTC) covers
  // all US timezones and matches the architecture NFR (≤4h queue wait per HH).
  void scheduleQueue
    .upsertJobScheduler(
      SCHEDULE_JOB_ID,
      { pattern: '0 10 * * 5', tz: 'UTC' },
      {
        name: 'fan-out',
        data: {},
        opts: {
          attempts: 2,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: { count: 8 },
          removeOnFail: { count: 8 },
        },
      },
    )
    .catch((err: unknown) => {
      fastify.log.error(
        { err, module: 'plan-generation', action: 'scheduler.registration.failed' },
        'failed to register plan-generation fan-out scheduler',
      );
    });

  fastify.bullmq.getWorker(SCHEDULE_QUEUE, async (_job: Job) => {
    const now = new Date();
    const weekOf = getNextMondayFrom(now);
    const householdsRepo = new HouseholdsRepository(fastify.supabase, null);
    const PAGE_SIZE = 500;
    const households: Array<{ id: string; timezone: string }> = [];
    let offset = 0;
    while (true) {
      const page = await householdsRepo.findAllActive(offset, PAGE_SIZE);
      households.push(...page);
      if (page.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    fastify.log.info(
      { module: 'plan-generation', action: 'fanout.start', count: households.length, weekOf },
      'plan-generation fan-out: enqueuing per-household jobs',
    );

    const enqueueResults = await Promise.allSettled(
      households.map(async (hh) => {
        const fireAtMs = getLocalSixPmUtcMs(hh.timezone, now);
        const delay = Math.max(0, fireAtMs - Date.now());
        const jobData: PlanGenerationJobData = {
          household_id: hh.id,
          week_of: weekOf,
          request_id: randomUUID(),
        };
        await generateQueue.add('generate-plan', jobData, {
          ...GENERATION_JOB_OPTS,
          delay,
          // Idempotent: same household+week always maps to the same jobId.
          // BullMQ skips duplicate adds when a job with this id is already
          // queued, which prevents double-generation if the scheduler fires
          // twice (e.g., after a worker restart).
          jobId: `plan-gen-${hh.id}-${weekOf}`,
        });
      }),
    );

    const failures = enqueueResults.filter((r) => r.status === 'rejected');
    if (failures.length > 0) {
      fastify.log.error(
        {
          module: 'plan-generation',
          action: 'fanout.partial',
          failed: failures.length,
          total: households.length,
        },
        'plan-generation fan-out: some enqueues failed',
      );
    } else {
      fastify.log.info(
        { module: 'plan-generation', action: 'fanout.complete', count: households.length, weekOf },
        'plan-generation fan-out: all household jobs enqueued',
      );
    }
  });

  // Per-household generation worker — concurrency 2 is conservative. Increase
  // at scaling time once the LLM provider rate-limit profile is settled
  // (Story 3.30 circuit-breaker audit).
  const generationWorker = fastify.bullmq.getWorker(
    GENERATE_QUEUE,
    async (job: Job<PlanGenerationJobData>) => {
      const { household_id, week_of, request_id } = job.data;
      const weekId = deriveWeekId(week_of);

      fastify.log.info(
        {
          module: 'plan-generation',
          action: 'generate.start',
          household_id,
          week_of,
          weekId,
          attempt: job.attemptsMade,
        },
        'plan-generation job started',
      );

      const householdsRepoForRun = new HouseholdsRepository(fastify.supabase, null);
      const [culturalContext, bagCompositions, extraLibraryItems, variantEligibleChildren, sovereigntyMode] = await Promise.all([
        loadCulturalContextForHousehold(household_id, week_of, culturalPriorRepository, culturalCalendarService, memoryContextService),
        loadBagCompositionsForHousehold(household_id, childrenRepository),
        loadExtraLibraryForHousehold(household_id, extraLibraryRepository),
        loadVariantEligibleChildrenForHousehold(household_id, childrenRepository),
        householdsRepoForRun.getSovereigntyMode(household_id).catch((err: unknown) => {
          fastify.log.warn(
            { err, household_id },
            'getSovereigntyMode failed — falling back to unified mode',
          );
          return 'unified' as const;
        }),
      ]);
      // extra_rules read fans out per-child; depends on bagCompositions for
      // {child_id, child_name} pairs, so it's sequenced after the parallel batch.
      // Story 3.22 — high-activity proposals also depend on bagCompositions
      // to identify children with Extra=OFF.
      const [extraRules, extraProposals] = await Promise.all([
        loadExtraRulesForChildren(bagCompositions, extraRulesRepository),
        loadHighActivityExtraProposalsForHousehold(
          household_id,
          week_of,
          bagCompositions,
          dayOverridesRepository,
        ),
      ]);

      // Story 3.22 — write a single audit row per planning batch summarising
      // the proposals injected. Ops can correlate with plan.generated to see
      // which weeks suggested override-driven Extras.
      if (extraProposals.length > 0) {
        try {
          await fastify.auditService.write({
            event_type: 'plan.extra_proposal_created',
            household_id,
            request_id,
            metadata: {
              week_of,
              proposal_count: extraProposals.length,
              proposals: extraProposals.map((p) => ({
                child_id: p.child_id,
                override_date: p.override_date,
                override_type: p.override_type,
              })),
            },
          });
        } catch (err) {
          fastify.log.error(
            { err, household_id, week_of },
            'audit write failed for plan.extra_proposal_created — continuing',
          );
        }
      }

      const composeOutput = await fastify.orchestrator.planWeek({
        householdId: household_id,
        weekOf: week_of,
        requestId: request_id,
        culturalContext,
        bagCompositions,
        extraRules,
        extraLibraryItems,
        extraProposals,
        variantEligibleChildren,
        sovereigntyMode,
      });
      const commitInput = buildCommitInputTree(composeOutput, request_id);

      // Allergy guardrail + brief_state refresh are wired inside
      // PlansService.commit(). The regenerate callback first tries the
      // Slice E Swap Agent — a mini-tier per-slot surgical retry — and only
      // falls back to a full flagship-tier planWeek regen when the swap
      // can't be done (no blocked verdicts) or can't cover every blocked
      // slot. Captures the previous attempt's commitInput in closure so the
      // swap path has the original tree to minimally edit.
      let lastAttemptCommit: CommitPlanTreeInput = commitInput;
      // Story 3.27 — track the most recent planner output so the post-commit
      // variant-proposal persistence reflects the final accepted plan rather
      // than the first attempt that may have been rewritten on guardrail
      // retry.
      let lastAttemptComposeOutput: PlanComposeTreeOutput = composeOutput;
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
            lastAttemptCommit = surgical;
            return surgical;
          }

          // Full-regen fallback. Mirrors the pre-Slice-E behavior.
          const rejectionContext = rejections
            .flatMap((r) => (r.verdict === 'blocked' ? r.conflicts : []))
            .map((c) => `allergen: ${c.allergen}, ingredient: ${c.ingredient}`)
            .join('; ');

          // Story 3.24 — when compound-uncertain rejections exist alongside or
          // instead of blocked conflicts, surface them to the planner via the
          // dedicated uncertainContext channel so it knows to choose single-
          // ingredient items rather than another compound product.
          const compoundFlagged = rejections.flatMap((r) =>
            r.verdict === 'uncertain' && r.reason === 'compound_ingredient_unverified'
              ? r.flagged_items ?? []
              : [],
          );
          const uncertainContext = (() => {
            if (compoundFlagged.length === 0) return undefined;
            const seen = new Set<string>();
            const slots = compoundFlagged
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
            culturalContext,
            bagCompositions,
            extraRules,
            extraLibraryItems,
            extraProposals,
            uncertainContext,
            variantEligibleChildren,
            sovereigntyMode,
          });
          const retryCommit = buildCommitInputTree(retryOutput, request_id);
          lastAttemptCommit = retryCommit;
          lastAttemptComposeOutput = retryOutput;
          return retryCommit;
        },
      );

      // Story 3.27 — after commit clears, persist any planner-emitted variant
      // proposal so the PlanTile can render the pending-input pills. Failure
      // here must not surface as a planning failure — the proposal is a
      // forward-looking learning signal, not a safety constraint.
      try {
        await fastify.variantProposalService.createFromTreePlanOutput({
          planOutput: lastAttemptComposeOutput,
          planId: committedPlanId,
          householdId: household_id,
          requestId: request_id,
        });
      } catch (err) {
        fastify.log.error(
          { err, household_id, plan_id: commitInput.plan_id },
          'variant proposal persistence failed — plan is committed',
        );
      }

      // Story 3.29 — soft cultural-degradation signal. The planner sets
      // degraded_reason on its compose output when the unified-sovereignty
      // intersection collapses; surface it on brief_state so BriefCanvas can
      // render the "try alternating" toggle. Failure must not block delivery —
      // the plan is the canonical output, the toggle is an opt-in offer.
      if (lastAttemptComposeOutput.degraded_reason === 'CULTURAL_INTERSECTION_EMPTY') {
        try {
          await fastify.plansService.handleDegradedPlan({
            householdId: household_id,
            requestId: request_id,
          });
        } catch (err) {
          fastify.log.error(
            { err, household_id, plan_id: committedPlanId },
            'handleDegradedPlan failed — plan is committed, brief_state may lack degraded flag',
          );
        }
      }

      fastify.log.info(
        { module: 'plan-generation', action: 'generate.complete', household_id, week_of, weekId },
        'plan-generation job completed — brief_state updated',
      );

      // Story 5.2 will wire the real SSE plan.updated emission via Redis
      // pub/sub. For now, log the intent so an integration test can assert
      // the right hook point exists.
      fastify.log.debug(
        { module: 'plan-generation', action: 'sse.deferred', household_id, weekId },
        'plan.updated SSE emission deferred to Story 5.2',
      );
    },
    { concurrency: 2 },
  );

  // Permanent failure escalation — BullMQ emits 'failed' after every failed
  // attempt, including retried ones. Only write the audit event after all
  // attempts are exhausted (job.attemptsMade reaches the configured limit).
  generationWorker.on('failed', (job: Job<PlanGenerationJobData> | undefined, err: Error) => {
    if (!job) return;
    const maxAttempts = (job.opts?.attempts as number | undefined) ?? GENERATION_JOB_OPTS.attempts;
    if (job.attemptsMade < maxAttempts) return;

    const { household_id, week_of, request_id } = job.data;

    fastify.log.error(
      {
        module: 'plan-generation',
        action: 'generate.permanent_failure',
        household_id,
        week_of,
        err,
      },
      'plan-generation job permanently failed — all retries exhausted',
    );

    fastify.auditService
      .write({
        event_type: 'plan.generation.failed',
        household_id,
        request_id,
        metadata: {
          week_of,
          error: err.message,
          attempts: job.attemptsMade,
          job_id: job.id ?? null,
          // Story 3.25 — lets ops distinguish guardrail-retry exhaustion from
          // infrastructure failures (timeout, LLM error, DB outage). Both
          // throw — only the guardrail path also emits plan.hard_fail.
          is_guardrail_rejection: err instanceof GuardrailRejectionError,
        },
      })
      .catch((auditErr: unknown) => {
        fastify.log.error(
          { err: auditErr, module: 'plan-generation', action: 'audit.write.failed', household_id },
          'failed to write plan.generation.failed audit event',
        );
      });
  });
};

export const planGenerationJobPlugin = fp(planGenerationPlugin, {
  name: 'plan-generation-job',
});
