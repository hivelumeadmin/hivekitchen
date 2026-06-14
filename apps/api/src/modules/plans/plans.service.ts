import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { GUARDRAIL_VERSION } from '../allergy-guardrail/allergy-rules.engine.js';
import { deriveWeekId, getCurrentWeekMonday, getNextWeekMonday } from '../../lib/derive-week-id.js';
import {
  GuardrailRejectionError,
  NotFoundError,
  SwapGuardrailBlockedError,
  TooManyRequestsError,
  ValidationError,
} from '../../common/errors.js';
import type { AllergyGuardrailService } from '../allergy-guardrail/allergy-guardrail.service.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { PlansRepository } from './plans.repository.js';
import type { BriefStateRepository } from './brief-state.repository.js';
import type { BriefStateComposer } from './brief-state.composer.js';
import type { ExtraRemovalSignalService } from './extra-removal-signal.service.js';
import type { RecipeService } from '../recipe/recipe.service.js';
import type { RecipesRepository } from '../recipe/recipes.repository.js';
import type { PlanRegenerationJobData } from '../../jobs/plan-regeneration.job.js';
import type { VariantProposalService } from './variant-proposal.service.js';
import { FlaggedCompoundItemSchema } from '@hivekitchen/contracts';
import type {
  BriefStateRow,
  CommitPlanTreeInput,
  FlaggedCompoundItem,
  GuardrailResult,
  PauseChildOnDayInput,
  PausePlanDayTreeInput,
  PlanComposeTreeInput,
  PlanComposeTreeOutput,
  PlanDayRow,
  PlanItemForGuardrail,
  PlanMainAssignmentRow,
  PlanRow,
  PlanSlotRow,
  PlanSlotVariationRow,
  RegeneratePlanQuery,
  SwapMainInput,
  SwapSlotRecipeInput,
  UpdateVariationInput,
  Weekday,
} from '@hivekitchen/types';

export interface PlansServiceDeps {
  repository: PlansRepository;
  briefStateRepository: BriefStateRepository;
  briefStateComposer: BriefStateComposer;
  allergyGuardrail: AllergyGuardrailService;
  auditService: AuditService;
  logger: FastifyBaseLogger;
  redis: Redis;                     // Story 3.13 — for rate limiting
  regenQueue: Queue;                // Story 3.13 — BullMQ plan-regeneration queue
  // Story 3.22 — passive bias from repeated Extra removals. Optional so existing
  // tests that pre-date the dep can construct PlansService without wiring it.
  // The swapItem hook is a no-op when the service is not provided.
  extraRemovalSignalService?: ExtraRemovalSignalService;
  // Slice D — household_recipe_usage bumps post-commit so the kitchen map's
  // favourite-recipes projection has signal. Optional so tests pre-dating
  // slice D can construct PlansService without it; when omitted, commit()
  // skips the bumps. After Phase 9 cutover, recipe materialization itself
  // moved out of commit() — the planner emits real recipe_ids under the
  // tree prompt — so recipeService is now used solely for recordUse().
  recipeService?: RecipeService;
  // Story 3-DM-C1 Phase 9b part 4 step 2 — recipe.ingredients lookup for the
  // swap operations. swapMain and swapSlotRecipe both need to evaluate the
  // new recipe's ingredient set against household allergy rules before
  // persisting; the lookup goes through RecipesRepository.findById. Optional
  // so existing tests that pre-date the swap tree-shape rewrite can compose
  // without wiring it — swap methods that require it throw a clear domain
  // error when omitted.
  recipesRepository?: RecipesRepository;
  // Story 3.27 — persists Lumi-proposed preparation-method variants after a
  // plan clears the guardrail. Optional so pre-3.27 tests continue to compose;
  // when omitted, planner-emitted variant_proposal is silently ignored at
  // commit time.
  variantProposalService?: VariantProposalService;
}

// Story 3.13 — regeneration rate limit (architecture §3.6).
const REGEN_RATE_LIMIT = 5;              // max requests per household per week
const REGEN_TTL_SECONDS = 8 * 24 * 3600; // 8 days — covers the full plan week + buffer

const MAX_GUARDRAIL_RETRIES = 3;

export { getCurrentWeekMonday, getNextWeekMonday };

export class PlansService {
  private readonly repo: PlansRepository;
  private readonly briefStateRepo: BriefStateRepository;
  private readonly briefStateComposer: BriefStateComposer;
  private readonly allergyGuardrail: AllergyGuardrailService;
  private readonly auditService: AuditService;
  private readonly logger: FastifyBaseLogger;
  private readonly redis: Redis;
  private readonly regenQueue: Queue;
  private readonly extraRemovalSignalService: ExtraRemovalSignalService | null;
  private readonly recipeService: RecipeService | null;
  private readonly recipesRepo: RecipesRepository | null;
  private readonly variantProposalService: VariantProposalService | null;

  constructor(deps: PlansServiceDeps) {
    this.repo = deps.repository;
    this.briefStateRepo = deps.briefStateRepository;
    this.briefStateComposer = deps.briefStateComposer;
    this.allergyGuardrail = deps.allergyGuardrail;
    this.auditService = deps.auditService;
    this.logger = deps.logger;
    this.redis = deps.redis;
    this.regenQueue = deps.regenQueue;
    this.extraRemovalSignalService = deps.extraRemovalSignalService ?? null;
    this.recipeService = deps.recipeService ?? null;
    this.recipesRepo = deps.recipesRepository ?? null;
    this.variantProposalService = deps.variantProposalService ?? null;
  }

  // Single-row read from brief_state. Never composes at request time
  // (architecture §1.5). Returns null when no plan has been committed yet —
  // the frontend renders an empty/skeleton state.
  async getBrief(householdId: string): Promise<BriefStateRow | null> {
    return this.briefStateRepo.findByHousehold(householdId);
  }

  // Story 3-DM-C1 Phase 9b part 4 step 5 — tree-shape planner tool entry.
  // Attaches a freshly-generated plan_id and passes through the canonical
  // tree (main_assignments + days[].slots[].variations). Does NOT commit —
  // the BullMQ worker drives the commit flow separately so the agent layer
  // remains stateless. The legacy flat `compose()` retired with the
  // plan_items array.
  async composeTree(input: PlanComposeTreeInput): Promise<PlanComposeTreeOutput> {
    return Promise.resolve({
      plan_id: randomUUID(),
      household_id: input.household_id,
      week_of: input.week_of,
      main_assignments: input.main_assignments,
      days: input.days,
      prompt_version: input.prompt_version,
    });
  }

  // Presentation-bind transaction: clear-or-reject the plan, and on clearance
  // commit the plan + tree + guardrail fields atomically. On a guardrail
  // block, the caller-supplied regenerate() callback produces the next attempt.
  //
  // Phase 9 cutover: input shape is the canonical tree
  // (main_assignments + days[].slots[].variations). Recipe materialization
  // moved out — the planner emits real recipe_ids from recipe.search /
  // recipe.fetch under PLANNER_PROMPT. Discover candidates only live on
  // snack/extra slot rows and resolve at commit_plan() RPC time DB-side.
  async commit(
    input: CommitPlanTreeInput,
    requestId: string,
    regenerate: (rejections: GuardrailResult[]) => Promise<CommitPlanTreeInput>,
    // Slice 5-S9 — the planner's "Why this?" rationale, cached into
    // brief_state.payload.plan_reasoning on the commit refresh. Optional so the
    // existing 3-arg callers stay valid; only plan-generation.job passes it.
    // null = new plan with no reasoning (clears any prior); undefined = carry forward.
    planReasoning?: string | null,
  ): Promise<string> {
    // Enforce plan_id re-use: if a plan already exists for this household+week,
    // reuse its id so commit_plan's ON CONFLICT (id) upsert path is taken and
    // the (household_id, week_of) unique constraint is never violated.
    // Until Phase 9c applies the migration, the lookup still goes through the
    // week_id-keyed flat repository method; weekId is deterministically
    // derived from week_of so the result is identical.
    const weekId = deriveWeekId(input.week_of);
    const existing = await this.repo.findActiveByHouseholdAndWeek({
      householdId: input.household_id,
      weekId,
    });
    let current: CommitPlanTreeInput = existing ? { ...input, plan_id: existing.id } : input;
    const planId = current.plan_id;
    const rejections: GuardrailResult[] = [];
    let lastAttempt = 0;

    for (let attempt = 1; attempt <= MAX_GUARDRAIL_RETRIES; attempt++) {
      lastAttempt = attempt;
      const guardrailItems = buildGuardrailItemsFromTree(current);

      const result = await this.allergyGuardrail.clearOrReject(
        guardrailItems,
        current.household_id,
        requestId,
      );

      if (result.verdict === 'cleared') {
        const clearedAt = new Date().toISOString();
        await this.repo.commitTree(current, clearedAt, GUARDRAIL_VERSION);

        // household_recipe_usage bumps run AFTER commit so a usage row never
        // references a recipe that ultimately failed to land on the plan.
        // Fire-and-forget: usage signal is a ranking input, not a safety
        // constraint. Recipe ids come straight from the canonical tree:
        // main_assignments[].recipe_id covers every Main slot; snack/extra
        // slots carry recipe_id directly on the slot row. Dedupe across both.
        if (this.recipeService !== null) {
          const recipeIds = collectRecipeIdsFromTree(current);
          for (const recipeId of recipeIds) {
            void this.recipeService
              .recordUse({ householdId: current.household_id, recipeId })
              .catch((err: unknown) => {
                this.logger.error(
                  { err, plan_id: planId, recipe_id: recipeId },
                  'recipe usage bump failed — plan committed',
                );
              });
          }
        }

        // Refresh the brief_state projection — the composer swallows its own
        // errors, so awaiting here is safe and keeps the commit → projection
        // → audit sequence ordered.
        await this.briefStateComposer.refreshTree(
          current.household_id,
          weekId,
          requestId,
          { planReasoning },
        );

        try {
          await this.auditService.write({
            event_type: 'plan.generated',
            household_id: current.household_id,
            request_id: requestId,
            metadata: {
              plan_id: planId,
              revision: current.revision,
              prompt_version: current.prompt_version,
            },
            stages: [
              ...rejections.map((r, i) => ({
                stage: 'guardrail_rejection',
                attempt: i + 1,
                conflicts: r.verdict === 'blocked' ? r.conflicts : [],
                // Story 3.24 — compound-uncertain rejections carry flagged_items
                // (not allergen+ingredient conflicts). Preserve them in the audit
                // trail so post-hoc analysis can reconstruct which compounds
                // triggered each retry.
                ...(r.verdict === 'uncertain' && r.reason === 'compound_ingredient_unverified'
                  ? {
                      reason: r.reason,
                      flagged_items: r.flagged_items ?? [],
                    }
                  : {}),
              })),
              {
                stage: 'guardrail_verdict',
                verdict: 'cleared',
                guardrail_version: GUARDRAIL_VERSION,
              },
            ],
          });
        } catch (err) {
          this.logger.error(
            { plan_id: planId, err },
            'audit write failed after plan commit — plan is committed',
          );
        }

        this.logger.info(
          { plan_id: planId, attempt, guardrail_version: GUARDRAIL_VERSION },
          'plan committed after guardrail clearance',
        );
        return planId;
      }

      if (result.verdict === 'uncertain') {
        // Story 3.24 — compound-uncertain is recoverable via substitution; falls
        // through to the same retry path as 'blocked'. Infrastructure-uncertain
        // (empty_ingredients, no_rules_loaded, falcpa_baseline_missing, decrypt
        // failure, …) cannot be repaired by regeneration — exit immediately.
        // Guard: compound reason with no flagged_items is a vacuous result — treat
        // as infrastructure failure (engine invariant violated; regeneration won't help).
        if (
          result.reason !== 'compound_ingredient_unverified' ||
          !(result.flagged_items?.length)
        ) {
          throw new GuardrailRejectionError(planId, attempt);
        }
      }

      rejections.push(result);
      if (result.verdict === 'uncertain') {
        this.logger.warn(
          {
            plan_id: planId,
            attempt,
            reason: result.reason,
            flagged_count: result.flagged_items?.length ?? 0,
          },
          'compound-uncertain ingredients flagged — attempting substitution via regenerate',
        );
      } else {
        this.logger.warn(
          { plan_id: planId, attempt, verdict: result.verdict },
          'guardrail blocked plan — attempting regeneration',
        );
      }

      if (attempt < MAX_GUARDRAIL_RETRIES) {
        try {
          current = await regenerate(rejections);
        } catch (err) {
          this.logger.error(
            { plan_id: planId, attempt, err },
            'regenerate callback threw during guardrail retry',
          );
          throw new GuardrailRejectionError(planId, attempt);
        }
      }
    }

    // Story 3.25 — hard-fail escalation. The retry loop exhausted all attempts
    // without a cleared verdict. Emit `plan.hard_fail` audit so ops/parent
    // surfaces can render the AccountableError state, then preserve the
    // existing throw. Audit-write failure must not mask the guardrail rejection
    // (AC4) — log and continue.
    try {
      await this.auditService.write({
        event_type: 'plan.hard_fail',
        household_id: current.household_id,
        request_id: requestId,
        metadata: {
          plan_id: planId,
          week_of: current.week_of,
          rejection_count: rejections.length,
        },
        stages: rejections.map((r, i) => ({
          stage: 'guardrail_rejection',
          attempt: i + 1,
          verdict: r.verdict,
          conflicts: r.verdict === 'blocked' ? r.conflicts : [],
          ...(r.verdict === 'uncertain' && r.reason === 'compound_ingredient_unverified'
            ? { reason: r.reason, flagged_items: r.flagged_items ?? [] }
            : {}),
        })),
      });
    } catch (auditErr) {
      this.logger.error(
        { auditErr, plan_id: planId },
        'audit write failed for plan.hard_fail — throwing GuardrailRejectionError anyway',
      );
    }
    throw new GuardrailRejectionError(planId, lastAttempt);
  }

  // Story 3.29 — soft cultural-degradation signal. Invoked from
  // plan-generation.job AFTER PlansService.commit() clears the guardrail and
  // briefStateComposer.refresh() writes the projection. The plan is committed
  // either way; this overlays plan_state='degraded' on brief_state so
  // BriefCanvas can render the inline note + "try alternating" toggle.
  //
  // Failure mode: caller treats as best-effort. The plan is the canonical
  // delivery; a missing brief_state update degrades the UX (no toggle) but
  // does not block the plan. Errors are logged and propagated; the job
  // catches them so plan delivery is unaffected.
  async handleDegradedPlan(opts: {
    householdId: string;
    planId: string;        // Story 3-DM-D1 — required for the plans-table write
    requestId: string;
  }): Promise<void> {
    const message =
      "This week's plan couldn't honor every rule strictly. Try alternating whose rules lead each day?";
    await this.repo.setPlanState({
      planId: opts.planId,
      householdId: opts.householdId,
      planState: 'degraded',
      setAt: new Date().toISOString(),
      message,
    });
    try {
      await this.auditService.write({
        event_type: 'plan.cultural_degraded',
        household_id: opts.householdId,
        request_id: opts.requestId,
        metadata: { reason: 'CULTURAL_INTERSECTION_EMPTY' },
      });
    } catch (err) {
      this.logger.error(
        { err, household_id: opts.householdId },
        'audit write failed for plan.cultural_degraded',
      );
    }
  }

  // Story 3.29 — clears the degraded plan_state once the parent picks a mode
  // (called from PATCH /v1/households/:id/sovereignty-mode). Idempotent — a
  // null plan_state row is left untouched.
  async clearDegradedPlanState(householdId: string): Promise<void> {
    await this.repo.clearDegradedPlanState(householdId);
  }

  // Story 3.25 — does a plan.hard_fail audit row exist for this household+week?
  // Slow-path read only — invoked by GET /v1/plans when plan===null && !isDraft
  // so the response can carry { hard_fail: { week_of, failed_at } } and the
  // frontend can render the FreshnessState variant="reworking" copy with a
  // real ETA instead of the "Lumi is drafting" copy.
  // Story pre-4-s3 — also returns flagged_items extracted from the audit's
  // `stages` JSON array (any stage with verdict==='uncertain' &&
  // reason==='compound_ingredient_unverified'). Deduped by (child_id,
  // ingredient, slot, day). Empty array when no compound-uncertain stage exists.
  async getHardFailStatus(
    householdId: string,
    weekOf: string,
  ): Promise<{ week_of: string; failed_at: string; flagged_items: FlaggedCompoundItem[] } | null> {
    const result = await this.repo.findHardFailAudit(householdId, weekOf);
    if (result === null) return null;
    const flaggedItems = this.extractFlaggedItems(result.stages);
    return { week_of: weekOf, failed_at: result.failedAt, flagged_items: flaggedItems };
  }

  // Story pre-4-s3 — narrow the untyped JSONB `stages` column safely. Each
  // stage that isn't compound-uncertain (e.g. blocked) is skipped, not thrown.
  // A malformed flagged_items entry that fails Zod parsing logs and is skipped.
  // Dedup key: (child_id, ingredient, slot, day) — same compound flagged across
  // multiple retry attempts collapses to one banner item.
  private extractFlaggedItems(rawStages: unknown): FlaggedCompoundItem[] {
    if (!Array.isArray(rawStages)) return [];
    const seen = new Set<string>();
    const flagged: FlaggedCompoundItem[] = [];
    for (const stage of rawStages) {
      if (
        typeof stage !== 'object' ||
        stage === null ||
        !('verdict' in stage) ||
        stage.verdict !== 'uncertain' ||
        !('reason' in stage) ||
        stage.reason !== 'compound_ingredient_unverified' ||
        !('flagged_items' in stage) ||
        !Array.isArray(stage.flagged_items)
      ) {
        continue;
      }
      for (const raw of stage.flagged_items) {
        const parsed = FlaggedCompoundItemSchema.safeParse(raw);
        if (!parsed.success) {
          this.logger.warn(
            { issues: parsed.error.issues },
            'skipping malformed flagged_item in plan.hard_fail stages',
          );
          continue;
        }
        const key = JSON.stringify([parsed.data.child_id, parsed.data.ingredient, parsed.data.slot, parsed.data.day]);
        if (seen.has(key)) continue;
        seen.add(key);
        flagged.push(parsed.data);
      }
    }
    return flagged;
  }

  // Story 3-DM-C1 Phase 9b part 4 step 5 — the flat swapItem / pauseDay /
  // getPlanHistory + the private recordExtraRemovalSignal helper retired
  // with the plan_items flat surface. The replacements are tree-shape:
  //   • swapItem       → swapMain / updateVariation / swapSlotRecipe
  //   • pauseDay       → pauseDayTree
  //   • getPlanHistory → getPlanHistoryTree
  //   • getPlanForWeek → getPlanForWeekTree
  // The Extra-removal passive bias signal (Story 3.22) was attached to the
  // flat swap path; the canonical model surfaces this signal as a variation
  // patch (add_ons / removals) and the dedicated signal hook lands as its
  // own follow-up slice (the legacy implementation depended on item.slot ===
  // 'extra' which the tree distinguishes via plan_slots.slot_kind + the
  // variation patch shape).

  // Slice 5-S12 — lightweight household-ownership check for the conversational
  // swap-proposal route. Returns null when the plan does not exist or belongs
  // to another household so the route can map it to a 404.
  async findById(planId: string, householdId: string): Promise<PlanRow | null> {
    return this.repo.findByIdForPresentation({ planId, householdId });
  }

  // Story 3.13 / Phase 9 — fetch the current (non-archived) plan tree for
  // a plan, with household ownership check. Used by plan-regeneration.job
  // for the day-scope merge (keep other days' subtrees, replace the target
  // day's slots+variations). main_assignments are plan-level and carry
  // across regen; days/slots/variations are the per-day subtree.
  async getCurrentPlanTree(planId: string, householdId: string): Promise<{
    plan: PlanRow;
    mainAssignments: PlanMainAssignmentRow[];
    days: PlanDayRow[];
    slots: PlanSlotRow[];
    variations: PlanSlotVariationRow[];
  }> {
    const plan = await this.repo.findByIdForPresentation({ planId, householdId });
    if (!plan) throw new NotFoundError(`plan ${planId}`);
    const [mainAssignments, days, slots] = await Promise.all([
      this.repo.findMainAssignmentsByPlanId(planId),
      this.repo.findDaysByPlanId(planId),
      this.repo.findSlotsByPlanId(planId),
    ]);
    const variations = slots.length === 0
      ? []
      : await this.repo.findVariationsBySlotIds(slots.map((s) => s.id));
    return { plan, mainAssignments, days, slots, variations };
  }

  // Story 3.13 — user-triggered plan regeneration.
  // Rate-limited to REGEN_RATE_LIMIT per household per plan-week via Redis INCR.
  // Enqueues a PlanRegenerationJobData job and returns the BullMQ job ID + remaining limit.
  // Does NOT wait for the job to complete — returns 202 immediately.
  async requestRegeneration(opts: {
    planId: string;
    householdId: string;
    query: RegeneratePlanQuery;
    requestId: string;
  }): Promise<{ jobId: string; rateLimitRemaining: number }> {
    // 1. Load plan — validates household ownership and that plan exists.
    const plan = await this.repo.findByIdForPresentation({
      planId: opts.planId,
      householdId: opts.householdId,
    });
    if (!plan) throw new NotFoundError(`plan ${opts.planId}`);

    // 2. Rate limit: per-household per-week counter in Redis. Story 3-DM-C1
    // step 5: keyed by week_of (the canonical row no longer carries week_id);
    // deriveWeekId is the deterministic mapping when a stable UUID is needed.
    // Key expires in REGEN_TTL_SECONDS so old counters don't linger past the plan week.
    const weekIdKey = deriveWeekId(plan.week_of);
    const rateLimitKey = `regen-limit:${opts.householdId}:${weekIdKey}`;
    const count = await this.redis.incr(rateLimitKey);
    if (count === 1) {
      // First increment: set TTL. Subsequent INCRs inherit the existing TTL.
      await this.redis.expire(rateLimitKey, REGEN_TTL_SECONDS);
    }
    if (count > REGEN_RATE_LIMIT) {
      const ttl = await this.redis.ttl(rateLimitKey);
      const retryAfter = ttl > 0 ? ttl : REGEN_TTL_SECONDS;
      throw new TooManyRequestsError(retryAfter);
    }
    const rateLimitRemaining = REGEN_RATE_LIMIT - count;

    // 3. Enqueue. jobId includes requestId so duplicate client retries dedupe.
    const jobIdKey =
      `regen-${opts.householdId}-${weekIdKey}-${opts.query.scope}` +
      (opts.query.scope === 'day' ? `-${opts.query.day ?? ''}` : '') +
      `-${opts.requestId}`;

    const jobData: PlanRegenerationJobData = {
      plan_id: opts.planId,
      household_id: opts.householdId,
      week_of: plan.week_of,
      current_revision: plan.revision,  // worker sets revision = current_revision + 1
      scope: opts.query.scope,
      ...(opts.query.day !== undefined ? { day: opts.query.day } : {}),
      request_id: opts.requestId,
    };

    const job = await this.regenQueue.add('regenerate-plan', jobData, {
      attempts: 2,
      backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
      jobId: jobIdKey,
    });

    // 4. Audit the regeneration request. Audit failure does not throw.
    try {
      await this.auditService.write({
        event_type: 'plan.regeneration_requested',
        household_id: opts.householdId,
        request_id: opts.requestId,
        metadata: {
          plan_id: opts.planId,
          scope: opts.query.scope,
          day: opts.query.day ?? null,
          week_of: plan.week_of,
          rate_limit_used: count,
        },
      });
    } catch (err) {
      this.logger.error(
        { err, plan_id: opts.planId },
        'audit write failed for regeneration request — job still enqueued',
      );
    }

    this.logger.info(
      {
        plan_id: opts.planId,
        scope: opts.query.scope,
        job_id: job.id,
        count,
        rateLimitRemaining,
      },
      'plan regeneration job enqueued',
    );

    return { jobId: job.id ?? jobIdKey, rateLimitRemaining };
  }

  // ==========================================================================
  // Story 3-DM-C1 Phase 9b part 4 step 2 — tree-shape READS + MUTATIONS.
  //
  // READS: getPlanForWeekTree + getPlanHistoryTree return the four arrays
  // directly (main_assignments + days + slots + variations) so the routes
  // can hand them straight to the wire-shape response schemas. Plan-row
  // shape upgrades from PlanRow (with week_id) to PlanRow (drops
  // week_id, adds nullable state fields). state/state_set_at/state_message
  // default to null until the migration applies — pre-migration plans rows
  // don't carry those columns.
  //
  // MUTATIONS: replace the flat swapItem with three operations matching the
  // canonical model. Every recipe-changing operation re-runs the guardrail
  // against the new effective ingredient set per (child, day, slot). The
  // guardrail integration here is the design moment that was deferred from
  // commit-time (buildGuardrailItemsFromTree's recipe-base-ingredient gap):
  // swap-time HAS access to the affected recipe and MUST evaluate it.
  // ==========================================================================

  // Story 3-DM-C1 — tree-shape READ for GET /v1/plans.
  // Returns the four tree arrays plus the canonical plan row. Empty arrays
  // when the plan doesn't exist (draft / not-yet-generated path).
  async getPlanForWeekTree(opts: {
    householdId: string;
    week: 'current' | 'next';
  }): Promise<{
    plan: PlanRow | null;
    mainAssignments: PlanMainAssignmentRow[];
    days: PlanDayRow[];
    slots: PlanSlotRow[];
    variations: PlanSlotVariationRow[];
    isDraft: boolean;
    weekOf: string;
  }> {
    const weekOf =
      opts.week === 'next' ? getNextWeekMonday() : getCurrentWeekMonday();
    const weekId = deriveWeekId(weekOf);
    const isDraft = opts.week === 'next';

    const plan = await this.repo.findByHouseholdAndWeek({
      householdId: opts.householdId,
      weekId,
    });
    if (!plan) {
      return {
        plan: null,
        mainAssignments: [],
        days: [],
        slots: [],
        variations: [],
        isDraft,
        weekOf,
      };
    }

    const [mainAssignments, days, slots] = await Promise.all([
      this.repo.findMainAssignmentsByPlanId(plan.id),
      this.repo.findDaysByPlanId(plan.id),
      this.repo.findSlotsByPlanId(plan.id),
    ]);
    const variations =
      slots.length === 0
        ? []
        : await this.repo.findVariationsBySlotIds(slots.map((s) => s.id));

    return {
      plan,
      mainAssignments,
      days,
      slots,
      variations,
      isDraft,
      weekOf,
    };
  }

  // Story 3-DM-C1 — tree-shape READ for GET /v1/plans/:weekId/history.
  // Same tree shape; swap_history is empty for now (canonical model has no
  // archived plan_items; audit-derived population is a follow-up slice).
  async getPlanHistoryTree(opts: {
    householdId: string;
    weekId: string;
  }): Promise<{
    plan: PlanRow;
    mainAssignments: PlanMainAssignmentRow[];
    days: PlanDayRow[];
    slots: PlanSlotRow[];
    variations: PlanSlotVariationRow[];
    swapHistory: never[];
    weekOf: string | null;
  }> {
    const plan = await this.repo.findByHouseholdAndWeek({
      householdId: opts.householdId,
      weekId: opts.weekId,
    });
    if (!plan) {
      throw new NotFoundError(`plan for week ${opts.weekId}`);
    }
    const [mainAssignments, days, slots] = await Promise.all([
      this.repo.findMainAssignmentsByPlanId(plan.id),
      this.repo.findDaysByPlanId(plan.id),
      this.repo.findSlotsByPlanId(plan.id),
    ]);
    const variations =
      slots.length === 0
        ? []
        : await this.repo.findVariationsBySlotIds(slots.map((s) => s.id));

    return {
      plan,
      mainAssignments,
      days,
      slots,
      variations,
      swapHistory: [],
      weekOf: plan.week_of,
    };
  }

  // Story 3-DM-C1 — swap an M-assignment's recipe. Affects every plan_day
  // whose main slot points at this M-assignment (per the 3-Main weekly
  // pattern, that's typically 2 days). Per-child variations carry their
  // own removals/add_ons that survive the swap untouched — the parent
  // explicitly swaps the SHARED Main, not per-kid forks. The guardrail
  // re-evaluates each (day, child) pair on the new recipe.
  async swapMain(opts: {
    planId: string;
    mainAssignmentId: string;
    householdId: string;
    requestId: string;
    input: SwapMainInput;
  }): Promise<PlanMainAssignmentRow> {
    const tree = await this.getCurrentPlanTree(opts.planId, opts.householdId);
    const assignment = tree.mainAssignments.find(
      (m) => m.id === opts.mainAssignmentId,
    );
    if (!assignment) {
      throw new NotFoundError(`main_assignment ${opts.mainAssignmentId}`);
    }

    const recipeIngredients = await this.fetchRecipeDisplayIngredients(
      opts.input.new_recipe_id,
    );

    // Affected slots: every main slot pointing at this M-assignment.
    const affectedSlotIds = new Set(
      tree.slots
        .filter((s) => s.main_assignment_id === opts.mainAssignmentId)
        .map((s) => s.id),
    );
    if (affectedSlotIds.size === 0) {
      // No slots reference this M-assignment — defensive, shouldn't happen
      // because main_assignment_id FK is the only way slots reach a Main.
      // No-op swap: skip the guardrail eval, persist, return.
      const updated = await this.repo.swapMain({
        mainAssignmentId: opts.mainAssignmentId,
        newRecipeId: opts.input.new_recipe_id,
      });
      await this.briefStateComposer.refreshTree(
        opts.householdId,
        deriveWeekId(tree.plan.week_of),
        opts.requestId,
        { userInitiated: true },
      );
      return updated;
    }

    const slotsById = new Map(tree.slots.map((s) => [s.id, s]));
    const daysById = new Map(tree.days.map((d) => [d.id, d]));
    const guardrailItems: PlanItemForGuardrail[] = [];
    for (const variation of tree.variations) {
      if (!affectedSlotIds.has(variation.plan_slot_id)) continue;
      const slot = slotsById.get(variation.plan_slot_id);
      const day = slot ? daysById.get(slot.plan_day_id) : undefined;
      if (!slot || !day) continue;
      guardrailItems.push(
        buildVariationGuardrailItem(
          recipeIngredients,
          variation,
          day.day,
          slot.slot_kind,
        ),
      );
    }

    if (guardrailItems.length > 0) {
      const verdict = await this.allergyGuardrail.evaluate(
        guardrailItems,
        opts.householdId,
      );
      if (verdict.verdict === 'blocked' || verdict.verdict === 'uncertain') {
        const allergens =
          verdict.verdict === 'blocked'
            ? verdict.conflicts.map((c) => c.allergen)
            : [];
        await this.tryAuditSwapRejection({
          householdId: opts.householdId,
          requestId: opts.requestId,
          planId: opts.planId,
          source: 'user_swap_main',
          subjectId: opts.mainAssignmentId,
          verdict,
        });
        throw new SwapGuardrailBlockedError(opts.mainAssignmentId, allergens);
      }
    }

    const updated = await this.repo.swapMain({
      mainAssignmentId: opts.mainAssignmentId,
      newRecipeId: opts.input.new_recipe_id,
    });

    await this.briefStateComposer.refreshTree(
      opts.householdId,
      deriveWeekId(tree.plan.week_of),
      opts.requestId,
      { userInitiated: true },
    );

    try {
      await this.auditService.write({
        event_type: 'plan.main_swapped',
        household_id: opts.householdId,
        request_id: opts.requestId,
        metadata: {
          plan_id: opts.planId,
          main_assignment_id: opts.mainAssignmentId,
          new_recipe_id: opts.input.new_recipe_id,
          guardrail_version: GUARDRAIL_VERSION,
        },
      });
    } catch (err) {
      this.logger.error(
        { err, plan_id: opts.planId },
        'audit write failed after main swap — swap committed',
      );
    }

    return updated;
  }

  // Story 3-DM-C1 — swap a snack/extra slot's recipe. Main slots reject
  // with ValidationError (the swapMain route is the correct path). Each
  // variation under the slot is re-evaluated against the new recipe.
  async swapSlotRecipe(opts: {
    planId: string;
    planSlotId: string;
    householdId: string;
    requestId: string;
    input: SwapSlotRecipeInput;
  }): Promise<PlanSlotRow> {
    const tree = await this.getCurrentPlanTree(opts.planId, opts.householdId);
    const slot = tree.slots.find((s) => s.id === opts.planSlotId);
    if (!slot) {
      throw new NotFoundError(`plan_slot ${opts.planSlotId}`);
    }
    if (slot.slot_kind === 'main') {
      throw new ValidationError(
        'main slots cannot be swapped here — use PATCH /v1/plans/:planId/main-assignments/:mainAssignmentId/recipe',
      );
    }

    const recipeIngredients = await this.fetchRecipeDisplayIngredients(
      opts.input.new_recipe_id,
    );

    const daysById = new Map(tree.days.map((d) => [d.id, d]));
    const day = daysById.get(slot.plan_day_id);
    if (!day) {
      throw new NotFoundError(`plan_day for slot ${opts.planSlotId}`);
    }

    const guardrailItems: PlanItemForGuardrail[] = [];
    for (const variation of tree.variations) {
      if (variation.plan_slot_id !== opts.planSlotId) continue;
      guardrailItems.push(
        buildVariationGuardrailItem(
          recipeIngredients,
          variation,
          day.day,
          slot.slot_kind,
        ),
      );
    }

    if (guardrailItems.length > 0) {
      const verdict = await this.allergyGuardrail.evaluate(
        guardrailItems,
        opts.householdId,
      );
      if (verdict.verdict === 'blocked' || verdict.verdict === 'uncertain') {
        const allergens =
          verdict.verdict === 'blocked'
            ? verdict.conflicts.map((c) => c.allergen)
            : [];
        await this.tryAuditSwapRejection({
          householdId: opts.householdId,
          requestId: opts.requestId,
          planId: opts.planId,
          source: 'user_swap_slot_recipe',
          subjectId: opts.planSlotId,
          verdict,
        });
        throw new SwapGuardrailBlockedError(opts.planSlotId, allergens);
      }
    }

    const updated = await this.repo.updateSlotRecipe({
      slotId: opts.planSlotId,
      newRecipeId: opts.input.new_recipe_id,
    });

    await this.briefStateComposer.refreshTree(
      opts.householdId,
      deriveWeekId(tree.plan.week_of),
      opts.requestId,
      { userInitiated: true },
    );

    try {
      await this.auditService.write({
        event_type: 'plan.slot_recipe_swapped',
        household_id: opts.householdId,
        request_id: opts.requestId,
        metadata: {
          plan_id: opts.planId,
          plan_slot_id: opts.planSlotId,
          slot_kind: slot.slot_kind,
          new_recipe_id: opts.input.new_recipe_id,
          guardrail_version: GUARDRAIL_VERSION,
        },
      });
    } catch (err) {
      this.logger.error(
        { err, plan_id: opts.planId },
        'audit write failed after slot recipe swap — swap committed',
      );
    }

    return updated;
  }

  // Story 3-DM-C1 — patch a per-child variation. Recipe is unchanged; the
  // guardrail re-evaluates against the NEW effective ingredient set
  // (recipe.ingredients - new.removals + new.add_ons). Pause-toggling via
  // this method is rejected — pause_at flows go through the dedicated
  // pauseChildOnDayTree / unpause routes.
  async updateVariation(opts: {
    planId: string;
    variationId: string;
    householdId: string;
    requestId: string;
    input: UpdateVariationInput;
  }): Promise<PlanSlotVariationRow> {
    const tree = await this.getCurrentPlanTree(opts.planId, opts.householdId);
    const variation = tree.variations.find((v) => v.id === opts.variationId);
    if (!variation) {
      throw new NotFoundError(`plan_slot_variation ${opts.variationId}`);
    }
    const slot = tree.slots.find((s) => s.id === variation.plan_slot_id);
    if (!slot) {
      throw new NotFoundError(
        `plan_slot for variation ${opts.variationId}`,
      );
    }
    const day = tree.days.find((d) => d.id === slot.plan_day_id);
    if (!day) {
      throw new NotFoundError(`plan_day for variation ${opts.variationId}`);
    }

    // Determine the effective recipe for this variation.
    let recipeId: string | null;
    if (slot.slot_kind === 'main') {
      const m = tree.mainAssignments.find(
        (a) => a.id === slot.main_assignment_id,
      );
      recipeId = m?.recipe_id ?? null;
    } else {
      recipeId = slot.recipe_id;
    }
    if (recipeId === null) {
      throw new ValidationError(
        `slot ${slot.id} has no resolvable recipe — cannot evaluate guardrail`,
      );
    }
    const recipeIngredients =
      await this.fetchRecipeDisplayIngredients(recipeId);

    // Build the post-patch variation state for guardrail evaluation.
    const nextRemovals = opts.input.removals ?? variation.removals;
    const nextAddOns = opts.input.add_ons ?? variation.add_ons;

    const guardrailItem = buildVariationGuardrailItem(
      recipeIngredients,
      {
        ...variation,
        removals: nextRemovals,
        add_ons: nextAddOns,
      },
      day.day,
      slot.slot_kind,
    );

    const verdict = await this.allergyGuardrail.evaluate(
      [guardrailItem],
      opts.householdId,
    );
    if (verdict.verdict === 'blocked' || verdict.verdict === 'uncertain') {
      const allergens =
        verdict.verdict === 'blocked'
          ? verdict.conflicts.map((c) => c.allergen)
          : [];
      await this.tryAuditSwapRejection({
        householdId: opts.householdId,
        requestId: opts.requestId,
        planId: opts.planId,
        source: 'user_update_variation',
        subjectId: opts.variationId,
        verdict,
      });
      throw new SwapGuardrailBlockedError(opts.variationId, allergens);
    }

    // Build the repo patch shape. Only carry through fields the user supplied
    // — the repo writes exactly what's in the patch. nullable string fields
    // (cutting_style / container / notes) preserve null vs undefined semantics
    // because the contract schema declared them as nullable+optional.
    const repoPatch: Parameters<PlansRepository['updateVariation']>[0]['patch'] = {};
    if (opts.input.portion_size !== undefined) repoPatch.portion_size = opts.input.portion_size;
    if (opts.input.texture !== undefined) repoPatch.texture = opts.input.texture;
    if (opts.input.spice_level !== undefined) repoPatch.spice_level = opts.input.spice_level;
    if (opts.input.cutting_style !== undefined) repoPatch.cutting_style = opts.input.cutting_style;
    if (opts.input.container !== undefined) repoPatch.container = opts.input.container;
    if (opts.input.add_ons !== undefined) repoPatch.add_ons = opts.input.add_ons;
    if (opts.input.removals !== undefined) repoPatch.removals = opts.input.removals;
    if (opts.input.notes !== undefined) repoPatch.notes = opts.input.notes;

    const updated = await this.repo.updateVariation({
      variationId: opts.variationId,
      patch: repoPatch,
    });

    await this.briefStateComposer.refreshTree(
      opts.householdId,
      deriveWeekId(tree.plan.week_of),
      opts.requestId,
      { userInitiated: true },
    );

    try {
      await this.auditService.write({
        event_type: 'plan.variation_updated',
        household_id: opts.householdId,
        request_id: opts.requestId,
        metadata: {
          plan_id: opts.planId,
          variation_id: opts.variationId,
          changed_fields: Object.keys(repoPatch),
          guardrail_version: GUARDRAIL_VERSION,
        },
      });
    } catch (err) {
      this.logger.error(
        { err, plan_id: opts.planId },
        'audit write failed after variation update — update committed',
      );
    }

    return updated;
  }

  // Story 3-DM-C1 — pause a full plan_day. Single UPDATE on the
  // plan_days row; the DB CHECK demands paused_at + paused_reason both be
  // set together, hence reason is required at the contract layer. Already-
  // paused days re-stamp their paused_at (idempotent), so the brief refresh
  // still runs to ensure any reason-text update propagates.
  async pauseDayTree(opts: {
    planId: string;
    day: Weekday;
    householdId: string;
    requestId: string;
    input: PausePlanDayTreeInput;
  }): Promise<PlanDayRow> {
    const tree = await this.getCurrentPlanTree(opts.planId, opts.householdId);
    const day = tree.days.find((d) => d.day === opts.day);
    if (!day) {
      throw new ValidationError(
        `plan ${opts.planId} has no day '${opts.day}'`,
      );
    }

    const pausedAt = new Date().toISOString();
    const updated = await this.repo.pauseDayById({
      dayId: day.id,
      pausedAt,
      reason: opts.input.reason,
      note: opts.input.note ?? null,
    });

    await this.briefStateComposer.refreshTree(
      opts.householdId,
      deriveWeekId(tree.plan.week_of),
      opts.requestId,
      { userInitiated: true },
    );

    try {
      await this.auditService.write({
        event_type: 'plan.day_paused',
        household_id: opts.householdId,
        request_id: opts.requestId,
        metadata: {
          plan_id: opts.planId,
          plan_day_id: day.id,
          day: opts.day,
          paused_at: pausedAt,
          reason: opts.input.reason,
          ...(opts.input.note !== undefined && { note: opts.input.note }),
        },
      });
    } catch (err) {
      this.logger.error(
        { err, plan_id: opts.planId },
        'audit write failed after day pause — pause committed',
      );
    }

    return updated;
  }

  // Story 3-DM-C1 — pause one child across every slot on a given day.
  // Calls the pause_child_on_day RPC which flips paused_at on every
  // variation matching (child_id, plan_day_id). Idempotent: the RPC
  // returns 0 when every matching variation was already paused.
  async pauseChildOnDayTree(opts: {
    planId: string;
    day: Weekday;
    householdId: string;
    requestId: string;
    input: PauseChildOnDayInput;
  }): Promise<{ pausedCount: number }> {
    const tree = await this.getCurrentPlanTree(opts.planId, opts.householdId);
    const day = tree.days.find((d) => d.day === opts.day);
    if (!day) {
      throw new ValidationError(
        `plan ${opts.planId} has no day '${opts.day}'`,
      );
    }

    const pausedAt = new Date().toISOString();
    const pausedCount = await this.repo.pauseChildOnDay({
      childId: opts.input.child_id,
      planDayId: day.id,
      pausedAt,
    });

    if (pausedCount > 0) {
      await this.briefStateComposer.refreshTree(
        opts.householdId,
        deriveWeekId(tree.plan.week_of),
        opts.requestId,
        { userInitiated: true },
      );
    }

    try {
      await this.auditService.write({
        event_type: 'plan.child_paused_on_day',
        household_id: opts.householdId,
        request_id: opts.requestId,
        metadata: {
          plan_id: opts.planId,
          plan_day_id: day.id,
          day: opts.day,
          child_id: opts.input.child_id,
          paused_at: pausedAt,
          paused_count: pausedCount,
        },
      });
    } catch (err) {
      this.logger.error(
        { err, plan_id: opts.planId },
        'audit write failed after child-day pause — pause committed',
      );
    }

    return { pausedCount };
  }

  // ==========================================================================
  // Tree-shape private helpers
  // ==========================================================================

  // Fetches a recipe's ingredient list via RecipesRepository and projects to
  // the display-name string array the guardrail evaluates against. Throws
  // ValidationError when recipesRepo isn't wired (tests pre-dating the dep)
  // or when the recipe id doesn't resolve.
  private async fetchRecipeDisplayIngredients(
    recipeId: string,
  ): Promise<string[]> {
    if (this.recipesRepo === null) {
      throw new ValidationError(
        'recipesRepository not configured — swap operations require recipe lookup',
      );
    }
    const recipe = await this.recipesRepo.findById(recipeId);
    if (recipe === null) {
      throw new NotFoundError(`recipe ${recipeId}`);
    }
    // recipes.ingredients is JSONB; the canonical shape is the object form
    // (key/modifier/display/quantity/unit/optional/substitutes). Catalog-
    // seeded or legacy rows MAY hold plain strings. Accept both — emit
    // strings as-is, project objects to their `display`. Anything else is
    // skipped silently rather than throwing; an empty result is handled
    // by the caller building zero guardrail items.
    const out: string[] = [];
    for (const raw of recipe.ingredients) {
      if (typeof raw === 'string') {
        out.push(raw);
      } else if (raw !== null && typeof raw === 'object' && 'display' in raw) {
        const display = (raw as { display?: unknown }).display;
        if (typeof display === 'string' && display.length > 0) {
          out.push(display);
        }
      }
    }
    return out;
  }

  private async tryAuditSwapRejection(opts: {
    householdId: string;
    requestId: string;
    planId: string;
    source: string;
    subjectId: string;
    verdict: GuardrailResult;
  }): Promise<void> {
    const allergens =
      opts.verdict.verdict === 'blocked'
        ? opts.verdict.conflicts.map((c) => c.allergen)
        : [];
    try {
      await this.auditService.write({
        event_type: 'allergy.guardrail_rejection',
        household_id: opts.householdId,
        request_id: opts.requestId,
        metadata: {
          plan_id: opts.planId,
          subject_id: opts.subjectId,
          source: opts.source,
          verdict: opts.verdict.verdict,
          allergens,
          ...(opts.verdict.verdict === 'uncertain' && {
            reason: opts.verdict.reason,
          }),
        },
      });
    } catch (auditErr) {
      this.logger.error(
        { auditErr, plan_id: opts.planId },
        'audit write failed for swap guardrail rejection',
      );
    }
  }
}

// Story 3-DM-C1 Phase 9 — walk the canonical plan tree and emit one
// PlanItemForGuardrail per (day, slot, child). The guardrail evaluates
// allergens at the (child, ingredient) grain; the tree's variations carry
// add_ons / removals strings that the guardrail can scan.
//
// Note: the recipe's base ingredients (the canonical ingredient list on the
// recipes row) are NOT joined into this walk yet. The planner's tree path
// emits real recipe_ids whose ingredients the recipes table owns; a future
// patch should batch-fetch and union them so the guardrail sees the full
// effective ingredient set. Until then the guardrail sees only the per-child
// add_ons (variation-level overlay), which matches the family-first model's
// understanding that the *allergen-fork* always lives on the variation.
function buildGuardrailItemsFromTree(input: CommitPlanTreeInput): PlanItemForGuardrail[] {
  const out: PlanItemForGuardrail[] = [];
  for (const day of input.days) {
    for (const slot of day.slots) {
      for (const variation of slot.variations) {
        out.push({
          child_id: variation.child_id,
          day: day.day,
          slot: slot.slot_kind,
          ingredients: [...(variation.add_ons ?? [])],
        });
      }
    }
  }
  return out;
}

// Story 3-DM-C1 Phase 9b part 4 step 5 — toCanonicalPlanRow retired with
// the flat PlanRow → PlanRowCanonical projection. The canonical PlanRow IS
// the only PlanRow now; the rename is the cutover.

// Story 3-DM-C1 Phase 9b part 4 step 2 — build one PlanItemForGuardrail
// for a single (variation, day, slot) tuple. The effective ingredient set
// is recipe.ingredients (display names) − variation.removals + variation.add_ons,
// with simple substring-equality dedupe of removals. This is the swap-time
// guardrail unit; the commit-time path's buildGuardrailItemsFromTree still
// uses only variation.add_ons because the recipe-batch-fetch hasn't landed
// at commit yet (its own follow-up slice).
function buildVariationGuardrailItem(
  recipeIngredients: ReadonlyArray<string>,
  variation: { child_id: string; add_ons: readonly string[]; removals: readonly string[] },
  day: Weekday,
  slotKind: 'main' | 'snack' | 'extra',
): PlanItemForGuardrail {
  const removed = new Set(variation.removals.map((r) => r.toLowerCase().trim()));
  const effective: string[] = [];
  for (const ing of recipeIngredients) {
    if (!removed.has(ing.toLowerCase().trim())) effective.push(ing);
  }
  for (const add of variation.add_ons) effective.push(add);
  return {
    child_id: variation.child_id,
    day,
    slot: slotKind,
    ingredients: effective,
  };
}

// Collects unique recipe_ids referenced by a committed plan tree. Used for
// the post-commit household_recipe_usage bumps. main_assignments cover every
// Main slot; non-main slots (snack/extra) carry recipe_id directly.
function collectRecipeIdsFromTree(input: CommitPlanTreeInput): string[] {
  const seen = new Set<string>();
  for (const m of input.main_assignments) seen.add(m.recipe_id);
  for (const day of input.days) {
    for (const slot of day.slots) {
      if (slot.recipe_id !== undefined && slot.recipe_id !== null) {
        seen.add(slot.recipe_id);
      }
    }
  }
  return [...seen];
}
