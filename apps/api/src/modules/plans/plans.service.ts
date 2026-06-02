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
import type { PlanRegenerationJobData } from '../../jobs/plan-regeneration.job.js';
import type { VariantProposalService } from './variant-proposal.service.js';
import { FlaggedCompoundItemSchema } from '@hivekitchen/contracts';
import type {
  BriefStateRow,
  CommitPlanTreeInput,
  FlaggedCompoundItem,
  GuardrailResult,
  PausePlanDayInput,
  PlanComposeInput,
  PlanComposeOutput,
  PlanComposeTreeInput,
  PlanComposeTreeOutput,
  PlanDayRow,
  PlanItemForGuardrail,
  PlanItemRow,
  PlanItemSwapSummary,
  PlanMainAssignmentRow,
  PlanRow,
  PlanSlotRow,
  PlanSlotVariationRow,
  RegeneratePlanQuery,
  SwapPlanItemInput,
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
    this.variantProposalService = deps.variantProposalService ?? null;
  }

  // Single-row read from brief_state. Never composes at request time
  // (architecture §1.5). Returns null when no plan has been committed yet —
  // the frontend renders an empty/skeleton state.
  async getBrief(householdId: string): Promise<BriefStateRow | null> {
    return this.briefStateRepo.findByHousehold(householdId);
  }

  // Story 3.14 — Following-week draft view (FR21).
  // Resolves the requested week's Monday (UTC), derives the deterministic week_id,
  // and returns the cleared plan + items, or null when the week's plan is not yet
  // generated. is_draft mirrors (week === 'next') so the client doesn't recompute
  // date math; week_of is always populated from the resolved Monday.
  async getPlanForWeek(opts: {
    householdId: string;
    week: 'current' | 'next';
  }): Promise<{
    plan: PlanRow | null;
    planItems: PlanItemRow[];
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
      return { plan: null, planItems: [], isDraft, weekOf };
    }

    const planItems = await this.repo.findItemsByPlanId(plan.id);
    return { plan, planItems, isDraft, weekOf };
  }

  // Pure transform: converts the planner agent's PlanComposeInput into a
  // PlanComposeOutput by attaching a freshly-generated plan_id. Does NOT
  // commit — the BullMQ worker drives the commit flow separately so the
  // agent layer remains stateless.
  async compose(input: PlanComposeInput): Promise<PlanComposeOutput> {
    return Promise.resolve({
      plan_id: randomUUID(),
      household_id: input.household_id,
      week_of: input.week_of,
      days: input.days,
      prompt_version: input.prompt_version,
    });
  }

  // Story 3-DM-C1 Phase 5 — tree-shape planner tool entry. Same shape as
  // compose() (attach a plan_id, pass through), but operates on the
  // canonical tree (main_assignments + days[].slots[].variations) instead
  // of the flat days[].items[] array. Coexists with compose() until Phase 9.
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
    requestId: string;
  }): Promise<void> {
    const message =
      "This week's plan couldn't honor every rule strictly. Try alternating whose rules lead each day?";
    await this.briefStateRepo.setPlanState({
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
    await this.briefStateRepo.clearDegradedPlanState(householdId);
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

  // Story 3.12 — per-slot ingredient swap with guardrail validation.
  // Runs allergyGuardrail.evaluate on ONLY the swapped item (the rest of the
  // plan was cleared at generation time and is unchanged). On guardrail block
  // → 422. On success → brief_state projection refreshed (userInitiated:true
  // → scaffolding_diff null).
  async swapItem(opts: {
    planId: string;
    itemId: string;
    householdId: string;
    input: SwapPlanItemInput;
    requestId: string;
  }): Promise<PlanItemRow> {
    // 1. Load plan — validates household ownership via findByIdForPresentation.
    const plan = await this.repo.findByIdForPresentation({
      planId: opts.planId,
      householdId: opts.householdId,
    });
    if (!plan) throw new NotFoundError(`plan ${opts.planId}`);

    // 2. Load item — validates it belongs to this plan.
    const existingItem = await this.repo.findItemById({
      itemId: opts.itemId,
      planId: opts.planId,
    });
    if (!existingItem) throw new NotFoundError(`plan_item ${opts.itemId}`);

    // 3. Guardrail: check only the swapped item's new ingredients.
    const guardrailItem: PlanItemForGuardrail = {
      child_id: existingItem.child_id,
      day: existingItem.day,
      slot: existingItem.slot,
      ingredients: opts.input.ingredients,
    };
    const result = await this.allergyGuardrail.evaluate(
      [guardrailItem],
      opts.householdId,
    );

    if (result.verdict === 'blocked' || result.verdict === 'uncertain') {
      const allergens =
        result.verdict === 'blocked'
          ? result.conflicts.map((c) => c.allergen)
          : [];
      try {
        await this.auditService.write({
          event_type: 'allergy.guardrail_rejection',
          household_id: opts.householdId,
          request_id: opts.requestId,
          metadata: {
            plan_id: opts.planId,
            item_id: opts.itemId,
            source: 'user_swap',
            verdict: result.verdict,
            allergens,
            // Surface the guardrail's reason (e.g. 'no_rules_loaded',
            // 'rules_outdated') so ops can triage why uncertain results occur.
            ...(result.verdict === 'uncertain' && { reason: result.reason }),
          },
        });
      } catch (auditErr) {
        this.logger.error(
          { auditErr },
          'audit write failed for swap guardrail rejection',
        );
      }
      throw new SwapGuardrailBlockedError(opts.itemId, allergens);
    }

    // 4. Re-check plan revision before write — guards against a BullMQ
    // regeneration committing a new revision between findItemById and the
    // update. Without this check, our swap could write to plan_items rows that
    // no longer belong to the current plan, and the change would never reach
    // the projection. NotFoundError signals the client to refetch the brief.
    const planAfter = await this.repo.findByIdForPresentation({
      planId: opts.planId,
      householdId: opts.householdId,
    });
    if (!planAfter || planAfter.revision !== plan.revision) {
      throw new NotFoundError(`plan ${opts.planId}`);
    }

    // 5. Commit the ingredient update.
    const updatedItem = await this.repo.updateItemIngredients({
      itemId: opts.itemId,
      planId: opts.planId,
      ingredients: opts.input.ingredients,
      recipeId: opts.input.recipe_id,
      itemSlotId: opts.input.item_id,
    });

    // 6. Refresh brief_state projection. userInitiated:true → scaffolding_diff stays null.
    await this.briefStateComposer.refreshTree(
      opts.householdId,
      plan.week_id,
      opts.requestId,
      { userInitiated: true },
    );

    // 7. Audit the successful swap.
    try {
      await this.auditService.write({
        event_type: 'plan.item_swapped',
        household_id: opts.householdId,
        request_id: opts.requestId,
        metadata: {
          plan_id: opts.planId,
          item_id: opts.itemId,
          day: existingItem.day,
          slot: existingItem.slot,
          new_ingredients: opts.input.ingredients,
          guardrail_version: GUARDRAIL_VERSION,
        },
      });
    } catch (err) {
      this.logger.error(
        { err, plan_id: opts.planId, item_id: opts.itemId },
        'audit write failed after item swap — swap committed',
      );
    }

    // Story 3.22 — passive bias from repeated Extra removals (FR116). Fire-and-
    // forget so a slow/failing signal write never blocks the swap response.
    if (existingItem.slot === 'extra' && this.extraRemovalSignalService !== null) {
      void this.recordExtraRemovalSignal(existingItem, opts).catch((err: unknown) => {
        this.logger.error(
          { err, plan_id: opts.planId, item_id: opts.itemId },
          'extra removal signal failed — swap is committed',
        );
      });
    }

    return updatedItem;
  }

  // Coarse component-type inference for the bias signal. With snack_skus
  // folded into recipes (Story 3-DM-A2), the SKU.category lookup retired;
  // we now use the swapped-out item's first ingredient as a best-effort
  // component label. A precise per-item component_type column is captured
  // as deferred work.
  private async recordExtraRemovalSignal(
    oldItem: PlanItemRow,
    opts: { householdId: string; requestId: string },
  ): Promise<void> {
    if (this.extraRemovalSignalService === null) return;
    const componentType = oldItem.ingredients[0] ?? null;
    if (componentType === null) return;

    await this.extraRemovalSignalService.recordRemoval({
      householdId: opts.householdId,
      childId: oldItem.child_id,
      componentType,
      planItemId: oldItem.id,
      requestId: opts.requestId,
    });
  }

  // Story 3.12 — sick-day pause: marks paused_at on all plan_items for the day.
  // The underlying plan is unchanged — ingredients are preserved for Lunch
  // Link context and future un-pause.
  //
  // App-level idempotency: pauseDay returns the rows it actually flipped. If
  // every item for the day is already paused we return 204 without a redundant
  // audit/refresh, so client retries with the same Idempotency-Key don't burn
  // audit rows or recompute the projection. If the (plan, day) pair has zero
  // items we throw ValidationError (422), distinguishing it from the silent-
  // success case.
  async pauseDay(opts: {
    planId: string;
    day: PlanItemRow['day'];
    householdId: string;
    requestId: string;
    reason?: PausePlanDayInput['reason'];
  }): Promise<void> {
    // 1. Validate plan ownership.
    const plan = await this.repo.findByIdForPresentation({
      planId: opts.planId,
      householdId: opts.householdId,
    });
    if (!plan) throw new NotFoundError(`plan ${opts.planId}`);

    // 2. Reject pause requests for days that don't exist in the plan (e.g., a
    //    school holiday the planner skipped). 422 with a domain reason rather
    //    than a silent 204 success.
    const itemCount = await this.repo.countItemsForDay({
      planId: opts.planId,
      day: opts.day,
    });
    if (itemCount === 0) {
      throw new ValidationError(
        `plan ${opts.planId} has no items for day '${opts.day}'`,
      );
    }

    // 3. Pause all not-yet-paused items for the day. Returns the rows that were
    //    actually flipped — empty array means every item was already paused.
    const pausedAt = new Date().toISOString();
    const pausedRows = await this.repo.pauseDay({
      planId: opts.planId,
      day: opts.day,
      pausedAt,
    });
    if (pausedRows.length === 0) {
      // Already-paused day: idempotent no-op. Skip refresh + audit.
      return;
    }

    // 4. Refresh brief_state — paused field will propagate to PlanTileSummary.
    await this.briefStateComposer.refreshTree(
      opts.householdId,
      plan.week_id,
      opts.requestId,
      { userInitiated: true },
    );

    // 5. Audit. `reason` (if provided by the route) is threaded into metadata
    //    so ops can distinguish parent-declared sick days from other pause
    //    reasons in the timeline.
    try {
      await this.auditService.write({
        event_type: 'plan.day_paused',
        household_id: opts.householdId,
        request_id: opts.requestId,
        metadata: {
          plan_id: opts.planId,
          day: opts.day,
          paused_at: pausedAt,
          ...(opts.reason !== undefined && { reason: opts.reason }),
        },
      });
    } catch (err) {
      this.logger.error(
        { err, plan_id: opts.planId },
        'audit write failed after day pause — pause committed',
      );
    }
  }

  // Story 3.15 — Historical plans view (FR25).
  // Resolves a past week's plan by week_id and returns the final committed
  // items + a per-slot swap audit derived from archived plan_items.
  // findItemsByPlanId() and findSwapHistory() touch disjoint row sets
  // (replaced_by_plan_id IS NULL vs IS NOT NULL), so Promise.all is safe and
  // halves the round-trip latency relative to a sequential pair of queries.
  async getPlanHistory(opts: {
    householdId: string;
    weekId: string;
  }): Promise<{
    plan: PlanRow;
    planItems: PlanItemRow[];
    swapHistory: PlanItemSwapSummary[];
    weekOf: string | null;
  }> {
    const plan = await this.repo.findByHouseholdAndWeek({
      householdId: opts.householdId,
      weekId: opts.weekId,
    });
    if (!plan) {
      throw new NotFoundError(`plan for week ${opts.weekId}`);
    }

    const [planItems, swapHistory] = await Promise.all([
      this.repo.findItemsByPlanId(plan.id),
      this.repo.findSwapHistory(plan.id),
    ]);

    return { plan, planItems, swapHistory, weekOf: plan.week_of };
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
    if (!plan.week_of) {
      // Pre-3.13 plan row with no week_of — cannot regenerate without the date.
      throw new ValidationError(
        `plan ${opts.planId} was created before Story 3.13 and lacks week_of; view the current week's brief to regenerate`,
      );
    }

    // 2. Rate limit: per-household per-week_id counter in Redis.
    // Key expires in REGEN_TTL_SECONDS so old counters don't linger past the plan week.
    const rateLimitKey = `regen-limit:${opts.householdId}:${plan.week_id}`;
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
      `regen-${opts.householdId}-${plan.week_id}-${opts.query.scope}` +
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
