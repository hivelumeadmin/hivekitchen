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
import type { SnackSkusRepository } from './snack-skus.repository.js';
import type { RecipeService } from '../recipe/recipe.service.js';
import type { RecipesRepository } from '../recipe/recipes.repository.js';
import type { RecipeAgent } from '../../agents/recipe-agent.js';
import type { PlanRegenerationJobData } from '../../jobs/plan-regeneration.job.js';
import type { VariantProposalService } from './variant-proposal.service.js';
import type {
  BriefStateRow,
  CommitPlanInput,
  GuardrailResult,
  PausePlanDayInput,
  PlanComposeInput,
  PlanComposeOutput,
  PlanItemForGuardrail,
  PlanItemRow,
  PlanItemSwapSummary,
  PlanRow,
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
  snackSkusRepository?: SnackSkusRepository;
  // Slice D — at plan-commit time, main-slot items are materialized into
  // the recipes catalog and household_recipe_usage is bumped. Optional so
  // tests pre-dating slice D can construct PlansService without it; when
  // omitted, commit() proceeds without populating recipe_id.
  recipeService?: RecipeService;
  // Slice 2.6-s3 — Layer 2 materialization wires recipesRepo + recipeAgent
  // directly so a catalog_seeded recipe with empty ingredients gets its full
  // ingredient list populated via Tavily fetch + LLM extraction before commit.
  // Optional so tests pre-dating slice 2.6-s3 still compile; when omitted, the
  // Layer 2 branch in materializeBeforeCommit is skipped (catalog_seeded items
  // pass through unchanged — only the legacy slice D path runs).
  recipesRepo?: RecipesRepository;
  recipeAgent?: RecipeAgent;
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
  private readonly snackSkusRepository: SnackSkusRepository | null;
  private readonly recipeService: RecipeService | null;
  private readonly recipesRepo: RecipesRepository | null;
  private readonly recipeAgent: RecipeAgent | null;
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
    this.snackSkusRepository = deps.snackSkusRepository ?? null;
    this.recipeService = deps.recipeService ?? null;
    this.recipesRepo = deps.recipesRepo ?? null;
    this.recipeAgent = deps.recipeAgent ?? null;
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

  // Presentation-bind transaction: clear-or-reject the plan, and on clearance
  // commit the plan + items + guardrail fields atomically. On a guardrail
  // block, the caller-supplied regenerate() callback produces the next attempt
  // (Story 3.7 wires the real composer; until then callers pass a stub that
  // rethrows NotImplementedError).
  async commit(
    input: CommitPlanInput,
    requestId: string,
    regenerate: (rejections: GuardrailResult[]) => Promise<CommitPlanInput>,
  ): Promise<string> {
    // Enforce plan_id re-use: if a plan already exists for this household+week,
    // reuse its id so commit_plan's ON CONFLICT (id) upsert path is taken and
    // the (household_id, week_id) unique index is never violated.
    const existing = await this.repo.findActiveByHouseholdAndWeek({
      householdId: input.household_id,
      weekId: input.week_id,
    });
    let current: CommitPlanInput = existing ? { ...input, plan_id: existing.id } : input;
    const planId = current.plan_id;
    const rejections: GuardrailResult[] = [];
    let lastAttempt = 0;

    for (let attempt = 1; attempt <= MAX_GUARDRAIL_RETRIES; attempt++) {
      lastAttempt = attempt;
      const guardrailItems: PlanItemForGuardrail[] = current.items.map((item) => ({
        child_id: item.child_id,
        day: item.day,
        slot: item.slot,
        ingredients: item.ingredients,
      }));

      const result = await this.allergyGuardrail.clearOrReject(
        guardrailItems,
        current.household_id,
        requestId,
      );

      if (result.verdict === 'cleared') {
        // Slice D — materialize recipes for main-slot items before commit so
        // plan_items.recipe_id points at a real row. Skipped entirely when
        // RecipeService isn't wired (legacy test paths). Materialization
        // failures are surfaced — without recipe_id, the favourite-recipes
        // projection on the kitchen map can never recover for this plan.
        const materializedRecipeIds: string[] = [];
        if (this.recipeService !== null) {
          current = await this.materializeRecipesForCommit(current, materializedRecipeIds);
        }

        const clearedAt = new Date().toISOString();
        await this.repo.commit(current, clearedAt, GUARDRAIL_VERSION);

        // Slice D — household_recipe_usage bumps run AFTER commit so a usage
        // row never references a recipe that ultimately failed to land on the
        // plan. Fire-and-forget: usage signal is a ranking input, not a
        // safety constraint — a failed bump degrades ranking, never blocks
        // the plan. Deduplicate by recipe_id since the same recipe can be
        // materialized once and used across multiple (child, day) items.
        if (this.recipeService !== null && materializedRecipeIds.length > 0) {
          const uniqueRecipeIds = [...new Set(materializedRecipeIds)];
          for (const recipeId of uniqueRecipeIds) {
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
        await this.briefStateComposer.refresh(
          current.household_id,
          current.week_id,
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

  // Story 3.25 — does a plan.hard_fail audit row exist for this household+week?
  // Slow-path read only — invoked by GET /v1/plans when plan===null && !isDraft
  // so the response can carry { hard_fail: { week_of, failed_at } } and the
  // frontend can render the FreshnessState variant="reworking" copy with a
  // real ETA instead of the "Lumi is drafting" copy.
  async getHardFailStatus(
    householdId: string,
    weekOf: string,
  ): Promise<{ week_of: string; failed_at: string } | null> {
    const result = await this.repo.findHardFailAudit(householdId, weekOf);
    return result !== null ? { week_of: weekOf, failed_at: result.failedAt } : null;
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
    await this.briefStateComposer.refresh(
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

  // Coarse component-type inference for the bias signal — snack_skus.category
  // when the swapped-out item referenced a SKU, otherwise the first ingredient
  // (best effort). A precise per-item component_type column on plan_items is
  // captured as deferred work; until then the planner sees "sweet treat" or
  // "granola bar" depending on whether the item came from the SKU catalog.
  private async recordExtraRemovalSignal(
    oldItem: PlanItemRow,
    opts: { householdId: string; requestId: string },
  ): Promise<void> {
    if (this.extraRemovalSignalService === null) return;
    let componentType: string | null = null;
    if (oldItem.item_sku_id !== null && this.snackSkusRepository !== null) {
      const sku = await this.snackSkusRepository.findById(oldItem.item_sku_id);
      componentType = sku?.category ?? null;
    }
    if (componentType === null) {
      componentType = oldItem.ingredients[0] ?? null;
    }
    if (componentType === null) return;

    await this.extraRemovalSignalService.recordRemoval({
      householdId: opts.householdId,
      childId: oldItem.child_id,
      componentType,
      planItemId: oldItem.id,
      requestId: opts.requestId,
    });
  }

  // Slice D — walk every main-slot item, materialize a recipe row (or reuse an
  // existing one with the same canonical name in this household), and stamp
  // the recipe_id onto the item. Snack + extra slots are passed through
  // untouched (they reference snack_skus.item_sku_id, not recipe_id).
  //
  // Returns a new CommitPlanInput so the caller can pass it to repo.commit.
  // Populates recordedRecipeIds (out-param) for the post-commit usage bump.
  //
  // Failure mode: bubble up. A failed materialize means we'd have committed
  // a plan with a NULL recipe_id, breaking the favourite-recipes projection
  // on the kitchen map for this plan permanently. Better to surface a 5xx
  // and let the caller retry the whole commit.
  private async materializeRecipesForCommit(
    input: CommitPlanInput,
    recordedRecipeIds: string[],
  ): Promise<CommitPlanInput> {
    if (this.recipeService === null) return input;

    const items: CommitPlanInput['items'] = [];
    for (const item of input.items) {
      if (item.slot !== 'main') {
        items.push(item);
        continue;
      }
      // Agent may already have supplied a recipe_id (Slice D.2 recipe.search
      // hit on the household's own catalog). Trust it — don't re-materialize.
      if (item.recipe_id !== undefined) {
        // Slice 2.6-s3 — Layer 2 trigger. catalog_seeded rows are inserted by
        // Stage 1 (catalog-seed.service.ts) with ingredients=[] (Layer 1: name
        // + tags only). At plan-commit time we materialize the full structured
        // ingredients via RecipeAgent.discover() so the plan store never
        // references an empty-ingredient recipe. Only main slots carry recipes
        // in this contract; the DB lookup short-circuits for non-catalog rows.
        if (item.slot === 'main' && this.recipesRepo !== null && this.recipeAgent !== null) {
          const recipe = await this.recipesRepo.findById(item.recipe_id);
          if (
            recipe !== null &&
            recipe.source === 'catalog_seeded' &&
            recipe.ingredients.length === 0
          ) {
            const materialized = await this.layer2Materialize(
              item.recipe_id,
              recipe.canonical_name,
              input.household_id,
            );
            if (!materialized) {
              // Mark the (household, recipe) pair as failed so the planner
              // skips it on retry, then throw so the regenerate callback
              // chooses a different item. Plan never commits with empty
              // ingredients pointing at a catalog_seeded row.
              await this.recipesRepo.markDiscoverFailed(item.recipe_id, input.household_id);
              throw new Error(
                `Layer 2 discovery failed for catalog_seeded recipe ${item.recipe_id} — planner retry expected`,
              );
            }
          }
        }
        items.push(item);
        recordedRecipeIds.push(item.recipe_id);
        continue;
      }

      // Story 3-31 — recipe.discover candidate path. The planner picked this
      // item from a Tavily-sourced candidate; the full extraction lives in
      // Redis under the plan_build_id namespace. Resolve, persist, drop the
      // recipe_candidate_id field, and stamp the new recipe_id.
      if (item.recipe_candidate_id !== undefined) {
        if (input.plan_build_id === undefined) {
          // F-P4: plan_build_id not threaded through — can't resolve the
          // candidate. Warn so the gap is diagnosable; fall through to
          // ingredient-based materialization.
          this.logger.warn(
            {
              module: 'recipes',
              action: 'candidate.plan_build_id_missing',
              household_id: input.household_id,
              candidate_id: item.recipe_candidate_id,
            },
            'recipe_candidate_id present but plan_build_id absent — falling back to materializeFromPlanItem',
          );
        } else {
          const resolved = await this.resolveDiscoverCandidate(input, item);
          if (resolved !== null) {
            items.push(resolved.item);
            recordedRecipeIds.push(resolved.recipeId);
            continue;
          }
        }
        // Fall through to the materialize-from-ingredients fallback below.
      }

      const result = await this.recipeService.materializeFromPlanItem({
        householdId: input.household_id,
        ingredients: item.ingredients,
        slot: 'main',
      });
      if (result === null) {
        // Empty ingredients — the guardrail already rejects these as
        // uncertain('empty_ingredients') before this point, so shouldn't
        // happen; pass through if it does so we don't lose the item.
        items.push(item);
        continue;
      }
      items.push({ ...item, recipe_id: result.recipeId });
      recordedRecipeIds.push(result.recipeId);
    }
    return { ...input, items };
  }

  /**
   * Story 3-31 — resolve a single discover-candidate plan item.
   *
   * Reads the cached RecipeAgentExtraction from Redis, maps it to the
   * RecipesRepository insert shape (mirrors materializeFromPlanItem's
   * canonical insert), persists the row, bumps household_recipe_usage,
   * and returns the updated item with recipe_id set.
   *
   * Returns null on cache miss (TTL expiry, eviction, or never-cached) so
   * the caller can fall through to materializeFromPlanItem. Logs a
   * warning on the miss path so cache-eviction-induced fallbacks are
   * observable.
   */
  private async resolveDiscoverCandidate(
    input: CommitPlanInput,
    item: CommitPlanInput['items'][number],
  ): Promise<{ item: CommitPlanInput['items'][number]; recipeId: string } | null> {
    if (this.recipeService === null) return null;
    if (item.recipe_candidate_id === undefined) return null;
    if (input.plan_build_id === undefined) return null;

    const extraction = await this.recipeService.readCandidate(
      input.plan_build_id,
      item.recipe_candidate_id,
      this.redis,
    );
    if (extraction === null) {
      this.logger.warn(
        {
          module: 'recipes',
          action: 'candidate.cache_miss',
          household_id: input.household_id,
          plan_build_id: input.plan_build_id,
          candidate_id: item.recipe_candidate_id,
        },
        'discover candidate not found in Redis at commit time — falling back to materializeFromPlanItem',
      );
      // F-P9: emit audit event so cache-miss fallbacks are observable in the
      // ops dashboard (data-quality degradation, not just a warn log).
      await this.auditService.write({
        event_type: 'recipe.candidate.cache_miss',
        household_id: input.household_id,
        request_id: input.plan_build_id ?? 'unknown',
        metadata: {
          candidate_id: item.recipe_candidate_id,
          plan_build_id: input.plan_build_id,
          slot: item.slot,
        },
      });
      return null;
    }

    const recipeId = await this.recipeService.insertFromDiscoverExtraction({
      householdId: input.household_id,
      extraction,
    });
    // Drop recipe_candidate_id from the persisted item shape — the candidate
    // is now a real row, identified by recipe_id.
    const { recipe_candidate_id: _candidateId, ...rest } = item;
    return {
      item: { ...rest, recipe_id: recipeId },
      recipeId,
    };
  }

  /**
   * Slice 2.6-s3 — Layer 2 materialization.
   *
   * Given a catalog_seeded recipe row that started with empty ingredients (the
   * Stage 1 LLM emitted name + tags only), fetch full structured ingredients
   * via the existing RecipeAgent.discover flow (Tavily fetch + LLM extraction
   * scoped to Allrecipes / RecipeTin Eats) and persist them in place on the
   * SAME recipe id via RecipesRepository.updateIngredients.
   *
   * Returns true on success, false on failure (no candidates returned, or
   * discover threw). The caller's job is to set discover_failed_at on the
   * usage row when this returns false; the planner regenerate path then
   * substitutes a different item.
   */
  private async layer2Materialize(
    recipeId: string,
    canonicalName: string,
    householdId: string,
  ): Promise<boolean> {
    if (this.recipesRepo === null || this.recipeAgent === null) return false;
    try {
      const result = await this.recipeAgent.discover({
        household_id: householdId,
        // Reuse the plan-build cache namespace conceptually, but layer 2
        // materializations are independent fetches — generate a fresh
        // identifier so the cache doesn't collide with the planner run.
        plan_build_id: `layer2-${recipeId}`,
        slot: 'main',
        count: 3,
        intent: canonicalName,
        constraints: {
          cuisine_tags: [],
          cultural_tags: [],
          dietary_flags: [],
          allergen_exclusions: [],
          max_prep_minutes: null,
        },
      });
      const first = result.candidates[0];
      if (first === undefined) return false;
      if (first.extraction.ingredients.length === 0) return false;
      const ingredientKeys = dedupeKeys(first.extraction.ingredients.map((i) => i.key));
      await this.recipesRepo.updateIngredients(
        recipeId,
        first.extraction.ingredients,
        ingredientKeys,
      );
      this.logger.info(
        {
          module: 'recipes',
          action: 'recipe.layer2_materialized',
          household_id: householdId,
          recipe_id: recipeId,
          ingredient_count: first.extraction.ingredients.length,
          source_site: first.extraction.source_site,
        },
        'catalog_seeded recipe materialized via Layer 2 discovery',
      );
      return true;
    } catch (err) {
      this.logger.warn(
        {
          module: 'recipes',
          action: 'recipe.layer2_failed',
          household_id: householdId,
          recipe_id: recipeId,
          err,
        },
        'Layer 2 RecipeAgent.discover threw — planner retry expected',
      );
      return false;
    }
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
    await this.briefStateComposer.refresh(
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

  // Story 3.13 — fetch current (non-archived) items for a plan, with household
  // ownership check. Used by the plan-regeneration job to merge day-scope new
  // items with the existing other-day items before committing.
  async getCurrentPlanItems(planId: string, householdId: string): Promise<PlanItemRow[]> {
    const plan = await this.repo.findByIdForPresentation({ planId, householdId });
    if (!plan) throw new NotFoundError(`plan ${planId}`);
    return this.repo.findItemsByPlanId(planId);
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
      week_id: plan.week_id,
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

// Slice 2.6-s3 — module-local helper. Mirrors RecipeService.insertFromDiscoverExtraction's
// dedupe shape so Layer 2 writes the same ingredient_keys array RecipeService
// would have produced for a fresh insert.
function dedupeKeys(keys: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of keys) {
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}
