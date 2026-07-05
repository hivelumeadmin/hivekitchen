import { randomUUID } from 'node:crypto';
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import type { Job } from 'bullmq';
import type {
  CommitPlanTreeInput,
  GuardrailResult,
  PlanComposeTreeOutput,
  PlanProgressEvent,
  PlanUpdatedEvent,
  Weekday,
} from '@hivekitchen/types';
import { GuardrailRejectionError } from '../common/errors.js';
import { HouseholdsRepository } from '../modules/households/households.repository.js';
import { PlansRepository } from '../modules/plans/plans.repository.js';
import { ChildAllergensRepository } from '../modules/children/child-allergens.repository.js';
import { ChildrenRepository } from '../modules/children/children.repository.js';
import { ChildPreferencesRepository } from '../modules/child-preferences/child-preferences.repository.js';
import { CulturalPriorRepository } from '../modules/cultural-priors/cultural-prior.repository.js';
import { CulturalCalendarService } from '../services/cultural-calendar.service.js';
import { MemoryContextService } from '../services/memory-context.service.js';
import { ExtraRulesRepository } from '../modules/children/extra-rules.repository.js';
import { ExtraLibraryRepository } from '../modules/households/extra-library.repository.js';
import { PlanDayContextRepository } from '../modules/plans/plan-day-context.repository.js';
import { RecipesRepository } from '../modules/recipe/recipes.repository.js';
import { SnackSkuRepository } from '../modules/recipe/snack-sku.repository.js';
import { PantryService } from '../modules/pantry/pantry.service.js';
import { assignSnackRotation, type SnackSlotAssignment } from '../services/snack-rotation.service.js';
import { loadChildSignal } from '../modules/child-preferences/child-signal.assembler.js';
import { deriveWeekId } from '../lib/derive-week-id.js';
import {
  loadBagCompositionsForHousehold,
  loadCulturalContextForHousehold,
  loadExtraLibraryForHousehold,
  loadExtraRulesForChildren,
  loadHighActivityExtraProposalsForHousehold,
  loadPantrySnapshotForHousehold,
  loadRecipeCandidatesForHousehold,
  loadVariantEligibleChildrenForHousehold,
} from './planner-context.loader.js';
import { trySurgicalSwap } from './swap-retry.helper.js';
import { NUDGE_QUEUE, type LumiNudgeJobData } from './lumi-nudge.job.js';

export { deriveWeekId };

const SCHEDULE_QUEUE = 'plan-generation-schedule';
export const GENERATE_QUEUE = 'plan-generation';
export const GENERATION_JOB_OPTS_BASE = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 300_000 },
  removeOnComplete: { count: 200 },
  removeOnFail: { count: 48 },
};
const SCHEDULE_JOB_ID = 'weekly-plan-generation-fanout';

// Per-job BullMQ options for household plan generation: 3 attempts with
// exponential backoff (5m → 10m → 20m). attempts:3 satisfies the AC #3
// "3 retries on transient failure" — one initial attempt plus two retries
// would be attempts:3 BullMQ semantics; AC text reads "3 retries", which we
// implement as attempts:3 (initial + 2 retries) per BullMQ's count of
// attemptsMade incrementing on each try.
const GENERATION_JOB_OPTS = GENERATION_JOB_OPTS_BASE;

export interface PlanGenerationJobData {
  household_id: string;
  week_of: string;
  request_id: string;
  // Story 3-S34 — on-demand ("compose now") narrows the plan to a subset of
  // weekdays (mid-week / next-week-full window). The Friday cron leaves this
  // undefined → full default week (no behavior change).
  planned_days?: Weekday[];
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
// Story 3-S40 — snack slots are server-assigned (not emitted by the LLM).
// Inject them into each day's slots before passing to commit_plan() RPC.
export function buildCommitInputTree(
  output: PlanComposeTreeOutput,
  requestId: string,
  snackSlots: readonly SnackSlotAssignment[] = [],
): CommitPlanTreeInput {
  const snackByDay = new Map<string, SnackSlotAssignment>(
    snackSlots.map((s) => [s.day, s]),
  );
  const days = output.days.map((d) => {
    // Snacks are strictly server-assigned (Story 3-S40). The planner prompt
    // (v2.8.0) tells the model NOT to emit snack slots, but it occasionally
    // does anyway — those slots carry no snack_sku_id and would either render
    // as empty snacks or collide with the deterministic snack on the same day
    // (one-slot-per-kind). Strip any model-emitted snack slot first, then add
    // the deterministic rotation snack so every eligible day has exactly one.
    const nonSnackSlots = d.slots.filter((s) => s.slot_kind !== 'snack');
    const snack = snackByDay.get(d.day);
    if (!snack) return { ...d, slots: nonSnackSlots };
    return {
      ...d,
      slots: [
        ...nonSnackSlots,
        {
          slot_kind: 'snack' as const,
          snack_sku_id: snack.snack_sku_id,
          variations: snack.child_ids.map((child_id) => ({ child_id })),
        },
      ],
    };
  });
  return {
    plan_id: output.plan_id,
    household_id: output.household_id,
    week_of: output.week_of,
    revision: 1,
    generated_at: new Date().toISOString(),
    prompt_version: output.prompt_version,
    // Story 3-31 carry-through: requestId IS the plan_build_id used by
    // recipe.discover's Redis cache. In the tree path, recipe_candidate_id
    // only appears on extra slot rows (mains use main_assignment.recipe_id
    // which is always a real catalog id).
    plan_build_id: requestId,
    main_assignments: output.main_assignments,
    days,
  };
}

// Story 13-s2.5 — SSE push payload builders. Kept as pure exported functions so
// the round-trip against the contract union is unit-testable without BullMQ
// (the worker body itself runs only under BullMQ). `plan.updated` on the
// completion path always carries a `cleared` verdict: reaching completion means
// commit() cleared the guardrail (a blocked verdict throws → the failure path).
export function buildPlanUpdatedPayload(weekId: string): PlanUpdatedEvent {
  return { type: 'plan.updated', week_id: weekId, guardrail_verdict: { verdict: 'cleared' } };
}

export function buildPlanProgressPayload(
  weekId: string,
  stage: PlanProgressEvent['stage'],
): PlanProgressEvent {
  return { type: 'plan.progress', week_id: weekId, stage };
}

// Story 12-S11 — short human-readable plan summary for the proactive nudge's
// `# Proactive Nudge` prompt block. main_assignments carry only sequence +
// recipe_id at the contract layer; canonical_name may be present on resolved
// rows, so read it defensively and fall back to "a new meal". Trimmed to 200
// chars to keep the agent context bounded.
function buildPlanNudgeContext(output: PlanComposeTreeOutput, weekOf: string): string {
  const mains = (output.main_assignments ?? [])
    .slice(0, 3)
    .map((a) => (a as { canonical_name?: string }).canonical_name ?? 'a new meal')
    .join(', ');
  return (mains.length > 0 ? `Week of ${weekOf}. Mains: ${mains}` : `Week of ${weekOf}.`).slice(
    0,
    200,
  );
}

// Story 3-S35 — pure gate for the auto-compose fan-out. Exported for unit
// testing the skip/enqueue decision without BullMQ. A household is eligible
// when it has auto-compose enabled AND has composed at least one plan
// (opt-in by composing once) AND has no plan yet for the target week
// (idempotent skip so the cron never clobbers an on-demand compose).
export function selectAutoComposeEligible<
  T extends { id: string; auto_compose_enabled: boolean },
>(
  households: readonly T[],
  withAnyPlan: ReadonlySet<string>,
  withTargetWeekPlan: ReadonlySet<string>,
): T[] {
  return households.filter(
    (hh) => hh.auto_compose_enabled && withAnyPlan.has(hh.id) && !withTargetWeekPlan.has(hh.id),
  );
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
  if (!fastify.kitchenMapService) {
    throw new Error(
      'planGenerationPlugin requires kitchenMapService decorator — register kitchenMapPlugin first',
    );
  }
  if (!fastify.sseDispatcher) {
    throw new Error(
      'planGenerationPlugin requires sseDispatcher decorator — register sseDispatcherPlugin first',
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
    childAllergensRepository,
  );
  // Story 4-S11 — variant-eligible derivation now reads child_preferences
  // signal counts instead of the children.variant_eligible boolean stub.
  const childPreferencesRepository = new ChildPreferencesRepository(fastify.supabase);
  // Story 3.21 — Extra slot pin/ban rules + household custom Extra library.
  const extraRulesRepository = new ExtraRulesRepository(fastify.supabase);
  const extraLibraryRepository = new ExtraLibraryRepository(fastify.supabase);
  // Story 3.22 — high-activity Extra proposals (FR119) read active
  // plan_day_context rows and pair them with bag-composition data to surface
  // sport_practice/field_trip days for children whose Extra slot is OFF.
  const planDayContextRepository = new PlanDayContextRepository(fastify.supabase);
  // Story 3-S36 — pre-load the candidate recipe slate + pantry snapshot so the
  // planner composes from context instead of spending a recipe.search/pantry.read
  // turn. PantryService.read() is unimplemented until Epic 6 (returns empty).
  const recipesRepository = new RecipesRepository(fastify.supabase);
  const snackSkuRepository = new SnackSkuRepository(fastify.supabase);
  const pantryService = new PantryService();

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
    const plansRepo = new PlansRepository(fastify.supabase);
    const PAGE_SIZE = 500;
    const households: Array<{ id: string; timezone: string; auto_compose_enabled: boolean }> = [];
    let offset = 0;
    while (true) {
      const page = await householdsRepo.findAllActive(offset, PAGE_SIZE);
      households.push(...page);
      if (page.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    // Story 3-S35 — gate the fan-out. Enqueue a per-household job ONLY when the
    // household has auto-compose enabled AND has composed at least one plan
    // (opt-in by composing once) AND does not already have a plan for the target
    // week (idempotent skip so the Friday cron never clobbers an on-demand
    // compose for the same week). Skip reasons are logged in aggregate.
    const enabled = households.filter((hh) => hh.auto_compose_enabled);
    const enabledIds = enabled.map((hh) => hh.id);
    const [withAnyPlan, withTargetWeekPlan] = await Promise.all([
      plansRepo.findHouseholdIdsWithPlan(enabledIds),
      plansRepo.findHouseholdIdsWithPlan(enabledIds, weekOf),
    ]);
    const toEnqueue = selectAutoComposeEligible(enabled, withAnyPlan, withTargetWeekPlan);

    fastify.log.info(
      {
        module: 'plan-generation',
        action: 'fanout.start',
        weekOf,
        total: households.length,
        eligible: toEnqueue.length,
        skipped_disabled: households.length - enabled.length,
        skipped_no_plan: enabled.length - withAnyPlan.size,
        skipped_already_composed: withTargetWeekPlan.size,
      },
      'plan-generation fan-out: enqueuing per-household jobs',
    );

    const enqueueResults = await Promise.allSettled(
      toEnqueue.map(async (hh) => {
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
          total: toEnqueue.length,
        },
        'plan-generation fan-out: some enqueues failed',
      );
    } else {
      fastify.log.info(
        { module: 'plan-generation', action: 'fanout.complete', count: toEnqueue.length, weekOf },
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
      const { household_id, week_of, request_id, planned_days } = job.data;
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
      const [culturalContext, bagCompositions, extraLibraryItems, variantEligibleChildren, sovereigntyMode, childSignals, pantrySnapshot] = await Promise.all([
        loadCulturalContextForHousehold(household_id, week_of, culturalPriorRepository, culturalCalendarService, memoryContextService),
        loadBagCompositionsForHousehold(household_id, childrenRepository),
        loadExtraLibraryForHousehold(household_id, extraLibraryRepository),
        loadVariantEligibleChildrenForHousehold(household_id, childPreferencesRepository),
        householdsRepoForRun.getSovereigntyMode(household_id).catch((err: unknown) => {
          fastify.log.warn(
            { err, household_id },
            'getSovereigntyMode failed — falling back to unified mode',
          );
          return 'unified' as const;
        }),
        // Story 3-S36 — child rating signals pre-load (replaces the child_signal
        // tool turn). Failure → undefined → no <child_signals> block (no data).
        loadChildSignal({
          childPrefsRepo: childPreferencesRepository,
          childrenRepo: childrenRepository,
          householdId: household_id,
          lookbackDays: 30,
        }).catch((err: unknown) => {
          fastify.log.warn(
            { err, household_id },
            'child-signal pre-load failed — proceeding without <child_signals> block',
          );
          return undefined;
        }),
        loadPantrySnapshotForHousehold(household_id, pantryService),
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
          planDayContextRepository,
        ),
      ]);

      // Story 3-S40 — deterministic snack slot assignment. Pre-computed once per
      // job so both the initial commit and any guardrail-retry regen share the
      // same snack assignments (snacks are static for the week, never regenerated).
      const activeSnackSkus = await snackSkuRepository
        .findActiveForHousehold(household_id)
        .catch((err: unknown) => {
          fastify.log.warn(
            { err, household_id },
            'snack-sku load failed — snack slots will be omitted this week',
          );
          return [];
        });

      // Story 3-S40 — kitchenMap pre-loaded once and reused by both the snack
      // rotation (Phase-2 allergen pre-filter) and the planner call below.
      const kitchenMap = await fastify.kitchenMapService.get(household_id).catch((err: unknown) => {
        fastify.log.warn(
          { err, householdId: household_id },
          'kitchenMap load failed — proceeding without pre-loaded context',
        );
        return undefined;
      });

      // Story 3-s43 (Phase-2, AC6) — per-child declared allergens for the snack
      // rotation pre-filter. Each child's effective set = household-wide rules
      // (apply to everyone) ∪ that child's own medical allergens. Absent
      // kitchenMap → empty map → the filter is a no-op (the commit-time
      // guardrail remains the safety backstop).
      const declaredAllergensByChildId = new Map<string, string[]>();
      if (kitchenMap) {
        const householdAllergens = kitchenMap.household.declared_allergens;
        for (const child of kitchenMap.children) {
          declaredAllergensByChildId.set(child.id, [
            ...householdAllergens,
            ...child.declared_allergens,
          ]);
        }
      }

      const snackSlots = assignSnackRotation({
        bagCompositions,
        extraRules,
        activeSkus: activeSnackSkus,
        weekOf: week_of,
        plannedDays: planned_days,
        declaredAllergensByChildId,
      });

      // Story 3-S36 — candidate recipe slate. Sequenced after childSignals so the
      // per-child "liked" bias folds into ranking. Failure → undefined → no
      // <recipe_candidates> block → the planner falls back to recipe.search.
      const recipeCandidates = await loadRecipeCandidatesForHousehold(
        household_id,
        recipesRepository,
        childSignals,
      ).catch((err: unknown) => {
        fastify.log.warn(
          { err, household_id },
          'recipe-candidate pre-load failed — proceeding without <recipe_candidates> block',
        );
        return undefined;
      });

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
                context_type: p.context_type,
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

      // Story 13-s2.5 — push generation progress so the Brief draft spinner
      // shows the real stage. Fire-and-forget; no subscribers → no-op.
      fastify.sseDispatcher.emit(
        household_id,
        'message',
        JSON.stringify(buildPlanProgressPayload(weekId, 'composing')),
      );

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
        kitchenMap,
        plannedDays: planned_days,
        childSignals,
        pantrySnapshot,
        recipeCandidates,
      });
      // Compose done → the guardrail runs inside commit() next.
      fastify.sseDispatcher.emit(
        household_id,
        'message',
        JSON.stringify(buildPlanProgressPayload(weekId, 'guardrail')),
      );
      const commitInput = buildCommitInputTree(composeOutput, request_id, snackSlots);

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
      fastify.sseDispatcher.emit(
        household_id,
        'message',
        JSON.stringify(buildPlanProgressPayload(weekId, 'persisting')),
      );
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
            kitchenMap,
            plannedDays: planned_days,
            childSignals,
            pantrySnapshot,
            recipeCandidates,
          });
          const retryCommit = buildCommitInputTree(retryOutput, request_id, snackSlots);
          lastAttemptCommit = retryCommit;
          lastAttemptComposeOutput = retryOutput;
          return retryCommit;
        },
        // Slice 5-S9 — cache the planner's "Why this?" rationale. Uses the
        // initial compose output: commit()'s brief refresh fires when the FINAL
        // plan clears, but the job has no channel to update reasoning post-regen,
        // and the initial rationale stays contextually relevant for typical weeks.
        // null (when absent) explicitly clears any prior reasoning rather than
        // carrying it forward from the previous plan.
        composeOutput.reasoning ?? null,
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
            planId: committedPlanId,
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

      // Story 12-S11 — proactive nudge: fire-and-forget enqueue after plan commit.
      // The nudge job generates a Lumi turn in the household's brief-surface thread.
      // Failure must not affect plan delivery — enqueue is best-effort.
      try {
        const planContext = buildPlanNudgeContext(lastAttemptComposeOutput, week_of);
        await fastify.bullmq.getQueue(NUDGE_QUEUE).add('plan_completed', {
          household_id,
          trigger: 'plan_completed' as const,
          surface: 'brief',
          plan_context: planContext,
        } satisfies LumiNudgeJobData);
      } catch (err) {
        fastify.log.warn(
          { err, module: 'plan-generation', action: 'lumi.nudge_enqueue_failed', household_id },
          'lumi nudge enqueue failed — plan is committed, nudge silently skipped',
        );
      }

      // Story 13-s2.5 — push plan readiness. `plan.progress: ready` flips the
      // spinner to its terminal stage; `plan.updated` invalidates the plan +
      // brief queries client-side (this replaces the BriefCanvas setInterval
      // polls). Fire-and-forget: the plan is already committed, delivery is the
      // canonical output and a dropped socket is covered by Last-Event-ID replay.
      fastify.sseDispatcher.emit(
        household_id,
        'message',
        JSON.stringify(buildPlanProgressPayload(weekId, 'ready')),
      );
      fastify.sseDispatcher.emit(
        household_id,
        'message',
        JSON.stringify(buildPlanUpdatedPayload(weekId)),
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

    // Story 13-s2.5 — push a terminal `failed` stage so an open Brief tab stops
    // waiting on the draft. GuardrailRejectionError carries no allergen list, so
    // there is no `blocked` verdict to surface here (spec §4) — `plan.progress:
    // failed` covers both guardrail-exhaustion and infra failures. This is the
    // SSE-facing signal, distinct from the audit-only plan.generation.failed row.
    fastify.sseDispatcher.emit(
      household_id,
      'message',
      JSON.stringify(buildPlanProgressPayload(deriveWeekId(week_of), 'failed')),
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
