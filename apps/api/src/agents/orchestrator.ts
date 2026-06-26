import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import { PlanComposeTreeOutputSchema } from '@hivekitchen/contracts';
import type { PlanComposeTreeOutput } from '@hivekitchen/types';
import { ForbiddenToolCallError } from '../common/errors.js';
import type { AuditService } from '../audit/audit.service.js';
import type { MemoryService } from '../modules/memory/memory.service.js';
import type { AllergyGuardrailService } from '../modules/allergy-guardrail/allergy-guardrail.service.js';
import type { RecipeService } from '../modules/recipe/recipe.service.js';
import type { PantryService } from '../modules/pantry/pantry.service.js';
import type { PlansService } from '../modules/plans/plans.service.js';
import type { CulturalPriorService } from '../modules/cultural-priors/cultural-prior.service.js';
import type { ChildPreferencesRepository } from '../modules/child-preferences/child-preferences.repository.js';
import type { ChildrenRepository } from '../modules/children/children.repository.js';
import { TOOL_MANIFEST } from './tools.manifest.js';
import { createAllergyCheckSpec } from './tools/allergy.tools.js';
import { createChildSignalSpec } from './tools/child-signal.tools.js';
import { createMemoryNoteSpec, createMemoryRecallSpec } from './tools/memory.tools.js';
import {
  createRecipeDiscoverSpec,
  createRecipeFetchSpec,
  createRecipeSearchSpec,
} from './tools/recipe.tools.js';
import type { RecipeAgent } from './recipe-agent.js';
import { createPantryReadSpec } from './tools/pantry.tools.js';
import { createPlanComposeSpec } from './tools/plan.tools.js';
import { createCulturalLookupSpec } from './tools/cultural.tools.js';
import { PLANNER_PROMPT } from './prompts/planner.prompt.js';
import { SWAP_PROMPT } from './prompts/swap.prompt.js';
import { ResilientProvider } from './providers/resilience.js';
import type {
  LLMCallOptions,
  LLMMessage,
  LLMProvider,
  LLMResponse,
  LLMTier,
} from './providers/llm-provider.interface.js';
import type { ToolSpec } from './tools.manifest.js';
import { assemblePlannerContext } from './planner/context/assemble.js';
import { ensureCandidateCoverage } from './planner/coverage.js';
import { applyPlanDefaults, enforceNoConsecutiveMain } from './planner/post-compose.js';
import { createPlanTracer } from './planner/plan-tracer.js';
import type {
  PlannerBagComposition,
  PlannerCulturalContext,
  PlannerExtraLibraryItem,
  PlannerExtraProposal,
  PlannerExtraRules,
  PlannerPantrySnapshot,
  PlannerRecipeCandidateSlate,
  PlannerVariantEligibleChild,
} from './planner/context/assemble.js';
import {
  buildBagCompositionLines,
  buildCulturalContextLines,
  buildExtraProposalLines,
  buildExtraRulesLines,
  buildSovereigntyContextLines,
  buildVariantEligibilityLines,
  renderPlannerChildSignalsBlock,
  renderPlannerKitchenMapBlock,
  renderPlannerPantryBlock,
  renderPlannerRecipeCandidatesBlock,
} from './planner/context/render.js';
import type { ChildSignalOutput, KitchenMap, Weekday } from '@hivekitchen/types';

// Story 3.5-s4 — the render/assembly concern was extracted into
// planner/context/{assemble,render}.ts. These interfaces are re-exported so
// existing importers (planner-context.loader.ts, orchestrator.test.ts) keep a
// stable import path.
export type {
  PlannerBagComposition,
  PlannerCulturalContext,
  PlannerExtraLibraryItem,
  PlannerExtraProposal,
  PlannerExtraRules,
  PlannerPantrySnapshot,
  PlannerRecipeCandidate,
  PlannerRecipeCandidateSlate,
  PlannerVariantEligibleChild,
} from './planner/context/assemble.js';

// Slice E — input shape for DomainOrchestrator.swapBlockedItems. One entry
// per slot the deterministic allergy guardrail blocked, carrying the
// original ingredients so the agent can reason about minimal-edit
// substitutions ("peanut butter → sunflower seed butter") rather than
// rebuilding the whole meal.
export interface BlockedItem {
  readonly child_id: string;
  readonly day: string;
  readonly slot: string;
  readonly original_ingredients: readonly string[];
  readonly blocked_by: ReadonlyArray<{ allergen: string; ingredient: string }>;
}

// pre-4-s1 — single options object for planWeek, replacing the 14 positional
// params accumulated over stories 3-13..3-29. Field names match the prior
// positional parameter names so the function body needs no body changes
// beyond a top-level destructure.
export interface PlanWeekOptions {
  householdId: string;
  weekOf: string;
  requestId: string;
  rejectionContext?: string;
  dayScope?: string;
  culturalContext?: PlannerCulturalContext;
  bagCompositions?: readonly PlannerBagComposition[];
  extraRules?: readonly PlannerExtraRules[];
  extraLibraryItems?: readonly PlannerExtraLibraryItem[];
  extraProposals?: readonly PlannerExtraProposal[];
  slotScopeContext?: string;
  uncertainContext?: string;
  variantEligibleChildren?: readonly PlannerVariantEligibleChild[];
  sovereigntyMode?: 'unified' | 'alternating';
  kitchenMap?: KitchenMap;
  // Story 3-S36 — pre-loaded planner reads. The job assembles these before the
  // agentic loop so the planner composes from context instead of spending one
  // LLM turn per read tool. Absent/empty blocks fall back to the retained tools
  // (recipes) or are treated as "no data" (signals/pantry).
  childSignals?: ChildSignalOutput;
  pantrySnapshot?: PlannerPantrySnapshot;
  recipeCandidates?: PlannerRecipeCandidateSlate;
  // Story 3-S33 — partial-week composition. When present and non-empty, the
  // planner composes plan_days entries for ONLY these weekdays (mid-week /
  // on-demand composition, Story 3-S34). Absent/empty = full default week.
  plannedDays?: readonly Weekday[];
  // Story 3-S33 — day-scope regeneration neighbour Mains. When dayScope is set,
  // these are the current Mains on the adjacent days so the planner can avoid
  // matching them (no-consecutive-Main rule). Populated by the regen caller.
  adjacentMains?: ReadonlyArray<{ day: Weekday; main_name: string }>;
  /**
   * Story 3.5-s7 — override the LLM tier used for the single forced-compose call.
   * Default: 'flagship'. Set to 'mini' to run the planner mini-tier eval
   * (see planner-mini-tier.eval.test.ts). Do NOT change this in production jobs.
   */
  composeTier?: LLMTier;
}

export interface OrchestratorServices {
  memory: MemoryService;
  allergyGuardrail: AllergyGuardrailService;
  recipe: RecipeService;
  pantry: PantryService;
  plan: PlansService;
  culturalPrior: CulturalPriorService;
  // Story 4-S11 — the child_signal planner tool reads aggregated rating
  // signals (childPrefs) joined with the children roster (children) for names.
  childPrefs: ChildPreferencesRepository;
  children: ChildrenRepository;
}

const FAILURE_THRESHOLD = 5;
const FAILURE_WINDOW_MS = 60_000;
const RECOVERY_MS = 900_000;

export class DomainOrchestrator {
  private readonly resilient: ResilientProvider;
  private readonly services: OrchestratorServices;
  // Story 3-31: optional so legacy tests (no discover surface exercised) can
  // construct the orchestrator without mocking a RecipeAgent. planWeek
  // throws if a discover call is reached without one wired.
  private readonly recipeAgent: RecipeAgent | null;

  constructor(
    providers: LLMProvider[],
    services: OrchestratorServices,
    private readonly redis: Redis,
    private readonly auditService: AuditService,
    private readonly logger: FastifyBaseLogger,
    recipeAgent?: RecipeAgent,
  ) {
    this.services = services;
    this.recipeAgent = recipeAgent ?? null;
    if (providers.length === 0) {
      throw new Error('DomainOrchestrator requires at least one LLMProvider');
    }

    TOOL_MANIFEST.set('allergy.check', createAllergyCheckSpec(services.allergyGuardrail, redis));
    TOOL_MANIFEST.set('memory.note', createMemoryNoteSpec(services.memory));
    TOOL_MANIFEST.set('memory.recall', createMemoryRecallSpec(services.memory, redis));
    TOOL_MANIFEST.set('recipe.search', createRecipeSearchSpec(services.recipe, redis));
    TOOL_MANIFEST.set('recipe.fetch', createRecipeFetchSpec(services.recipe, redis));
    TOOL_MANIFEST.set('pantry.read', createPantryReadSpec(services.pantry, redis));
    TOOL_MANIFEST.set('plan.compose', createPlanComposeSpec(services.plan, redis, services.recipe));
    TOOL_MANIFEST.set('cultural.lookup', createCulturalLookupSpec(services.culturalPrior, redis));
    TOOL_MANIFEST.set('child_signal', createChildSignalSpec(services.childPrefs, services.children, redis));

    // Story 3.5-s7 — provider-resilience plumbing (429 retry, circuit breaker,
    // provider failover) now lives in ResilientProvider. The orchestrator
    // delegates every LLM call through it; the failover/recovery audit shape is
    // preserved via the onFailover / onRecovered callbacks below.
    this.resilient = new ResilientProvider(providers, {
      failureThreshold: FAILURE_THRESHOLD,
      windowMs: FAILURE_WINDOW_MS,
      recoveryMs: RECOVERY_MS,
      logger: this.logger,
      onFailover: (from, to, reason) => {
        void this.auditService.write({
          event_type: 'llm.provider.failover',
          request_id: randomUUID(),
          metadata: { from, to, reason },
        });
      },
      onRecovered: (from, to) => {
        void writeAuditWithRetry(
          this.auditService,
          {
            event_type: 'llm.provider.recovered',
            household_id: 'system',
            request_id: 'health-check',
            metadata: { from, to, provider: to },
          },
          this.logger,
        );
      },
    });
  }

  // Story 3.5-s7 — thin wrapper over ResilientProvider. The 429 retry loop and
  // circuit-breaker accounting moved into ResilientProvider; the orchestrator
  // keeps the domain concern: filter to the allowed tools and reject any
  // tool call outside the allowlist. Validation runs AFTER the resilient call
  // (which already recorded provider success) so a forbidden-tool-call error is
  // attributed to the agent's tool policy, not the provider's reliability.
  async complete(
    prompt: string,
    tools: ToolSpec[],
    options: LLMCallOptions,
    allowedTools?: readonly string[],
  ): Promise<LLMResponse> {
    const effectiveTools = allowedTools
      ? tools.filter((t) => allowedTools.includes(t.name))
      : tools;

    const result = await this.resilient.complete(prompt, effectiveTools, options);

    if (allowedTools) {
      for (const tc of result.toolCalls ?? []) {
        if (!allowedTools.includes(tc.name)) {
          throw new ForbiddenToolCallError(tc.name);
        }
      }
    }

    return result;
  }

  // Multi-turn variant of complete() — feeds the full conversation history
  // (system / user / assistant / tool turns) into the resilient provider, which
  // owns the 429 retry loop and failover. Mirrors complete()'s allowed-tool
  // enforcement so the planner gets the same tool-policy guarantees.
  async completeWithMessages(
    messages: LLMMessage[],
    tools: ToolSpec[],
    options: LLMCallOptions,
    allowedTools?: readonly string[],
  ): Promise<LLMResponse> {
    const effectiveTools = allowedTools
      ? tools.filter((t) => allowedTools.includes(t.name))
      : tools;

    const result = await this.resilient.completeWithMessages(messages, effectiveTools, options);

    if (allowedTools) {
      for (const tc of result.toolCalls ?? []) {
        if (!allowedTools.includes(tc.name)) {
          throw new ForbiddenToolCallError(tc.name);
        }
      }
    }

    return result;
  }

  // Story 3.5-s5 — single-shot planner pipeline:
  //   assemble → ensureCandidateCoverage → compose
  // The LLM makes exactly one call (a forced plan.compose). Recipe acquisition
  // is a deterministic pre-flight (ensureCandidateCoverage), NOT model-driven
  // tool calls. The old open-ended ReAct loop + MAX_PLAN_ITERATIONS ceiling +
  // stopped-without-compose nudge + toolTrace debug write are gone. The BullMQ
  // worker converts the returned tree into CommitPlanTreeInput and calls
  // plansService.commit() — this method does NOT commit.
  //
  // - rejectionContext: passes guardrail blocks from a previous attempt so the
  //   planner can avoid the same unsafe ingredients on retry (Story 3.7
  //   regenerate path).
  async planWeek(opts: PlanWeekOptions): Promise<PlanComposeTreeOutput> {
    const {
      householdId,
      weekOf,
      requestId,
      rejectionContext,
      dayScope,
      slotScopeContext,
      uncertainContext,
      plannedDays,
      adjacentMains,
    } = opts;
    // Story 3.5-s4 — bundle the render-relevant opts subset once; the render
    // functions now take this typed context instead of individual positional args.
    const ctx = assemblePlannerContext(opts);
    if (plannedDays && plannedDays.length > 0 && dayScope !== undefined) {
      throw new Error('plannedDays and dayScope are mutually exclusive');
    }

    // Per-run agentic trace (opt-in via PLAN_TRACE_DIR). No-op when unset.
    const planStartMs = Date.now();
    const tracer = createPlanTracer(
      {
        requestId,
        householdId,
        weekOf,
        tier: opts.composeTier ?? 'flagship',
        attempt:
          rejectionContext !== undefined && rejectionContext.length > 0
            ? 'guardrail-retry'
            : 'initial',
      },
      this.logger,
    );
    tracer?.recordContext({
      kitchenMap: opts.kitchenMap,
      dayScope,
      plannedDays,
      rejectionContext,
      uncertainContext,
    });
    // Story 3-31 — recipe.discover needs the per-run requestId in its deps
    // closure (for audit correlation), so we override the manifest's stub
    // spec with a per-run live spec. When recipeAgent isn't wired (legacy
    // test paths), the stub-throwing manifest entry remains and the planner
    // would surface a NotImplementedError if it actually called discover.
    let tools = (() => {
      const base = Array.from(TOOL_MANIFEST.values());
      if (this.recipeAgent === null) return base;
      const discoverSpec = createRecipeDiscoverSpec(
        this.services.recipe,
        {
          recipeAgent: this.recipeAgent,
          redis: this.redis,
          audit: this.auditService,
          requestId,
        },
        this.redis,
      );
      return base.map((t) => (t.name === 'recipe.discover' ? discoverSpec : t));
    })();

    // Story 3.5-s5 — deterministic recipe pre-flight. Runs BEFORE the render so
    // any newly-acquired candidates are folded into the slate (and the handle
    // map) the model sees. On a warm slate this is a no-op; on a cold/short
    // slate it calls RecipeService.search/discover directly — no LLM turn.
    const augmentedCtx = await ensureCandidateCoverage(ctx, {
      recipeService: this.services.recipe,
      recipeAgent: this.recipeAgent,
      redis: this.redis,
      auditService: this.auditService,
      requestId,
      householdId,
      logger: this.logger,
    });
    tracer?.recordCoverage(
      { main: ctx.recipeCandidates?.main.length ?? 0, extra: ctx.recipeCandidates?.extra.length ?? 0 },
      {
        main: augmentedCtx.recipeCandidates?.main.length ?? 0,
        extra: augmentedCtx.recipeCandidates?.extra.length ?? 0,
      },
    );

    // Story 3.5-s3 — render the candidate slate once here, so the handle map is
    // available both for the prompt block (assembled below) and the per-run
    // plan.compose override (next). Handles (m1.., e1..) are STABLE for this
    // planWeek call: plan-generation.job.ts assembles the slate once and passes
    // the same recipeCandidates object to every retry (initial + guardrail-retry
    // callback), so a handle resolves to the same UUID across the whole job.
    const { block: recipeCandidatesBlock, handleMap } =
      renderPlannerRecipeCandidatesBlock(augmentedCtx);

    // Story 3.5-s3 — when a slate is present, swap plan.compose for a per-run spec
    // carrying the handle index. The model emits handles (m1, e1) that resolve
    // deterministically to catalog UUIDs from the in-memory slate — never a DB
    // fuzzy match. Mirrors the recipe.discover per-run override above. When no
    // slate is provided, the manifest's plan.compose is used as-is (preserving
    // every existing non-slate test path).
    if (augmentedCtx.recipeCandidates !== undefined) {
      const composeWithHandles = createPlanComposeSpec(
        this.services.plan,
        this.redis,
        this.services.recipe,
        handleMap,
      );
      tools = tools.map((t) => (t.name === 'plan.compose' ? composeWithHandles : t));
    }

    // Story 3.5-s5 — the sole tool sent on the single forced-compose call. Bound
    // AFTER the s3 handle override so the forced call uses the handle-aware spec.
    const planComposeTool = tools.find((t) => t.name === 'plan.compose');
    if (planComposeTool === undefined) {
      throw new Error('planWeek: plan.compose tool not registered in TOOL_MANIFEST');
    }

    const culturalLines = buildCulturalContextLines(augmentedCtx);
    const bagCompositionLines = buildBagCompositionLines(augmentedCtx);
    const extraRulesLines = buildExtraRulesLines(augmentedCtx);
    const extraProposalLines = buildExtraProposalLines(augmentedCtx);
    const variantEligibilityLines = buildVariantEligibilityLines(augmentedCtx);
    const sovereigntyLines = buildSovereigntyContextLines(augmentedCtx);

    const kitchenMapBlock = renderPlannerKitchenMapBlock(augmentedCtx);
    // Story 3-S36 — pre-loaded read blocks. Rendered right after the KitchenMap
    // block so all stable, run-invariant context sits together at the leading
    // edge of the prompt (OpenAI prefix-cache friendly, same rationale as 3-S32).
    const childSignalsBlock = renderPlannerChildSignalsBlock(augmentedCtx);
    const pantryBlock = renderPlannerPantryBlock(augmentedCtx);
    // recipeCandidatesBlock + handleMap are built above (with the per-run override).

    const contextLines = [
      kitchenMapBlock || undefined,
      childSignalsBlock || undefined,
      pantryBlock || undefined,
      recipeCandidatesBlock || undefined,
      `Household ID: ${householdId}`,
      `Planning week starting: ${weekOf} (Monday)`,
      `Request ID: ${requestId}`,
      ...culturalLines,
      ...bagCompositionLines,
      ...extraRulesLines,
      ...extraProposalLines,
      ...variantEligibilityLines,
      ...sovereigntyLines,
      dayScope !== undefined
        ? `Regeneration scope: DAY ONLY. Only generate a new plan for ${dayScope.toUpperCase()}. Keep all other days exactly as previously composed. Only call plan.compose with a days[] entry for ${dayScope} — do not include other days. main_assignments stay the same across the regeneration; declare the existing M-group as you received it.${
            adjacentMains && adjacentMains.length > 0
              ? ` The adjacent days already use these Mains — do NOT assign the same Main to ${dayScope.toUpperCase()}: ${adjacentMains
                  .map((a) => `${a.day} → ${a.main_name}`)
                  .join(', ')}.`
              : ''
          }`
        : undefined,
      rejectionContext !== undefined && rejectionContext.length > 0
        ? `Previous attempt was blocked by the allergy guardrail. Blocked ingredients/reasons:\n${rejectionContext}\nCompose a revised plan that avoids these.`
        : 'This is the first generation attempt for this household and week.',
    ].filter((line): line is string => !!line);

    // Story 3.23 — slot-scoped regen takes priority over all other framing so
    // the planner treats it as the primary constraint. The bag-wide allergy
    // guardrail still evaluates every slot post-compose; slot scope only
    // controls which slots the planner is asked to rewrite.
    if (slotScopeContext !== undefined) {
      contextLines.unshift(slotScopeContext);
    }

    // Story 3.24 — compound-uncertain substitution is a safety constraint and
    // ranks higher than slot scope. Unshifting after slotScopeContext leaves
    // it at position 0 so the planner sees it first.
    if (uncertainContext !== undefined) {
      contextLines.unshift(uncertainContext);
    }

    // Story 3-S33 — partial-week composition. The day window is the primary
    // framing for a mid-week plan, so it sits at position 0 (above slot/uncertain
    // scope). No-op when the caller wants the full default week.
    if (plannedDays !== undefined && plannedDays.length > 0) {
      contextLines.unshift(
        `PARTIAL WEEK: Compose plan_days entries for ONLY these weekdays: ${plannedDays.join(
          ', ',
        )}. Do NOT emit any plan_days entry for any other weekday — the omitted days are intentionally left empty (the plan starts mid-week).`,
      );
    }

    const messages: LLMMessage[] = [
      { role: 'system', content: PLANNER_PROMPT.text },
      { role: 'user', content: contextLines.join('\n') },
    ];
    tracer?.recordPrompt(messages);

    // Story 3.5-s5 — single forced-compose call. `plan.compose` is the sole
    // tool and `forcedToolName` pins tool_choice to it, so a strict-tools
    // provider MUST return exactly one schema-valid plan.compose call. The
    // ReAct loop, iteration ceiling, stopped-without-compose nudge, and
    // toolTrace debug write are gone — recipe acquisition happened in the
    // ensureCandidateCoverage pre-flight above.
    const composeOptions: LLMCallOptions = {
      // Slice B — semantic tier rather than hardcoded model id. Adapter
      // resolves to gpt-4o today; a future model bump is a one-line change
      // in providers/openai.adapter.ts.
      // Story 3.5-s7 — `composeTier` lets the mini-tier live eval force 'mini';
      // every production caller leaves it undefined → 'flagship'.
      tier: opts.composeTier ?? 'flagship',
      // Story 3-S38 (Opt #3) — 0.2 sharply cuts format drift while keeping a
      // sliver of variety for recipe selection.
      temperature: 0.2,
      maxTokens: 4096,
      metadata: { agent_type: 'planner', prompt_version: PLANNER_PROMPT.version },
      forcedToolName: 'plan.compose',
    };
    tracer?.recordLlmCall(composeOptions, messages.length);
    const llmStartMs = Date.now();
    const response = await this.completeWithMessages(
      messages,
      [planComposeTool],
      composeOptions,
      ['plan.compose'],
    );
    tracer?.recordLlmResponse(response, Date.now() - llmStartMs);

    const tc = response.toolCalls[0];
    if (tc === undefined) {
      // A strict-tools provider can't reach here; a non-forced provider (or an
      // empty response) can. There is no fallback loop anymore.
      throw new Error(
        'planWeek: model did not call plan.compose (non-forced provider or empty response)',
      );
    }

    tracer?.recordToolCall('plan.compose', tc.arguments);

    // allowedTools enforcement in completeWithMessages guarantees tc.name ===
    // 'plan.compose'. plan.tools.ts validates input + output schemas; infra
    // errors (e.g. ZodError, unresolved handle) propagate — no catch.
    const composed = (await planComposeTool.fn(tc.arguments)) as PlanComposeTreeOutput;

    // Story 3.5-s6 — post-compose deterministic passes:
    // applyPlanDefaults fills portion_size/spice_level/texture for any variation
    // the model left undefined (never touches removals/add_ons).
    // enforceNoConsecutiveMain throws if adjacent calendar days share a Main.
    const defaulted = applyPlanDefaults(composed, augmentedCtx);
    try {
      enforceNoConsecutiveMain(defaulted);
    } catch (err) {
      tracer?.recordPostCompose(false);
      tracer?.recordError(err);
      await tracer?.flush();
      throw err;
    }
    tracer?.recordPostCompose(true);
    tracer?.recordResult(defaulted, defaulted.plan_id, Date.now() - planStartMs);
    await tracer?.flush();

    this.logger.info(
      { requestId, householdId, weekOf, planId: defaulted.plan_id },
      'planWeek: plan composed',
    );

    return defaulted;
  }

  // Slice E — per-slot Swap Agent. Mirrors planWeek's structure but with a
  // tight prompt + the mini tier + a narrow tools allowlist. Used by the
  // BullMQ regenerate callbacks (plan-generation.job, plan-regeneration.job)
  // when the deterministic allergy guardrail blocks a small number of slots:
  // instead of paying for a full flagship-tier replanWeek, we ask a cheap
  // agent to propose minimal-edit substitutions for just the blocked items.
  //
  // The returned PlanComposeOutput's `days` array contains ONLY the changed
  // slots. The caller merges by (child_id, day, slot) over the previous
  // CommitPlanInput, validates coverage, and falls back to a full planWeek
  // if any blocked slot is missing a replacement.
  //
  // Design notes (forward-looking, not implemented here):
  //   - When Lumi voice/chat orchestration arrives (Epic 12 phase 2+), we
  //     will NOT introduce a separate Triage Agent. The "merged orchestrator"
  //     principle: one agent classifies intent AND executes, saving a model
  //     hop per turn. This Swap Agent is the first instance of that pattern:
  //     one agent, narrow scope, mini tier.
  async swapBlockedItems(opts: {
    householdId: string;
    weekOf: string;
    requestId: string;
    blockedItems: readonly BlockedItem[];
    // Story 3.24 — when set, the swap agent receives the compound-uncertain
    // instruction as the first context line. Prepended (not appended) so it
    // ranks above the BlockedItems list — the swap is still expected to cover
    // those slots, but compound-uncertain items demand single-ingredient
    // replacements regardless of any allergen reasoning.
    uncertainContext?: string;
  }): Promise<PlanComposeTreeOutput> {
    const MAX_SWAP_ITERATIONS = 5;
    const tools = Array.from(TOOL_MANIFEST.values());

    if (opts.blockedItems.length === 0) {
      throw new Error('swapBlockedItems: blockedItems must not be empty');
    }

    const blockedLines = opts.blockedItems.map((b, i) => {
      const reasons = b.blocked_by
        .map((r) => `${r.allergen} via ${r.ingredient}`)
        .join('; ');
      return [
        `[${String(i + 1)}] child_id=${b.child_id} day=${b.day} slot=${b.slot}`,
        `    original_ingredients: ${b.original_ingredients.join(', ')}`,
        `    blocked_by: ${reasons}`,
      ].join('\n');
    });

    const contextLines = [
      `Household ID: ${opts.householdId}`,
      `Week starting: ${opts.weekOf} (Monday)`,
      `Request ID: ${opts.requestId}`,
      `Blocked items to swap (${String(opts.blockedItems.length)}):`,
      ...blockedLines,
      'Call plan.compose with ONLY these slots replaced. Other days/slots/variations are already cleared and must not appear in your output.',
    ];

    // Story 3.24 — compound-uncertain instruction ranks above all other lines
    // so the swap agent treats single-ingredient replacement as the controlling
    // constraint when applicable.
    if (opts.uncertainContext !== undefined) {
      contextLines.unshift(opts.uncertainContext);
    }

    const messages: LLMMessage[] = [
      { role: 'system', content: SWAP_PROMPT.text },
      { role: 'user', content: contextLines.join('\n') },
    ];

    // Per-run agentic trace (opt-in via PLAN_TRACE_DIR). The swap agent is a
    // multi-iteration ReAct loop, so each LLM turn and every tool execution is
    // recorded. The try/finally guarantees a trace file on every exit path.
    const swapStartMs = Date.now();
    const tracer = createPlanTracer(
      {
        requestId: opts.requestId,
        householdId: opts.householdId,
        weekOf: opts.weekOf,
        tier: 'mini',
        attempt: 'initial',
        agent: 'swap',
      },
      this.logger,
    );
    tracer?.recordPrompt(messages);

    let swapResult: PlanComposeTreeOutput | null = null;

    try {
      for (let i = 0; i < MAX_SWAP_ITERATIONS; i++) {
        // Mini tier: blocked-item count is small, output is small, hard
        // safety constraints are validated post-hoc by the deterministic
        // guardrail. A mini-class model has plenty of recall for the common
        // allergen substitutions this agent handles.
        const swapCallOptions = {
          tier: 'mini' as const,
          temperature: 0.4,
          maxTokens: 1024,
          metadata: { agent_type: 'swap', prompt_version: SWAP_PROMPT.version },
        };
        tracer?.recordLlmCall(swapCallOptions, messages.length, i);
        const llmStartMs = Date.now();
        const response = await this.completeWithMessages(
          messages,
          tools,
          swapCallOptions,
          SWAP_PROMPT.toolsAllowed,
        );
        tracer?.recordLlmResponse(response, Date.now() - llmStartMs, i);

        this.logger.debug(
          {
            requestId: opts.requestId,
            householdId: opts.householdId,
            iteration: i,
            model_tier: 'mini',
            prompt_tokens: response.usage.promptTokens,
            cached_prompt_tokens: response.usage.cachedPromptTokens,
            completion_tokens: response.usage.completionTokens,
            tool_call_count: response.toolCalls.length,
            blocked_item_count: opts.blockedItems.length,
          },
          'swapBlockedItems: llm iteration completed',
        );

        messages.push({
          role: 'assistant',
          content: response.content,
          toolCalls: response.toolCalls,
        });

        if (response.finishReason === 'stop' || response.toolCalls.length === 0) {
          break;
        }

        for (const tc of response.toolCalls) {
          const spec = TOOL_MANIFEST.get(tc.name);
          if (!spec) {
            this.logger.error(
              { requestId: opts.requestId, toolName: tc.name },
              'swapBlockedItems: unregistered tool called — treating as fatal',
            );
            throw new ForbiddenToolCallError(tc.name);
          }

          let result: unknown;
          try {
            // The swap agent doesn't know the prompt_version string. Inject it
            // before schema validation so PlanComposeTreeInputSchema doesn't reject
            // the call. The value is only observability metadata; the final commit
            // uses previousCommit.prompt_version, not the swap output's.
            let callArgs: unknown = tc.arguments;
            if (tc.name === 'plan.compose') {
              const a = callArgs as Record<string, unknown>;
              if (typeof a.prompt_version !== 'string') {
                callArgs = { ...a, prompt_version: SWAP_PROMPT.version };
              }
            }
            result = await spec.fn(callArgs);
          } catch (err) {
            // Same policy as planWeek: plan.compose errors are fatal (no point
            // continuing the loop with no compose result); other tool errors
            // are surfaced as JSON so the agent can adapt within the loop.
            if (tc.name === 'plan.compose') throw err;
            result = { error: err instanceof Error ? err.message : String(err) };
          }

          tracer?.recordToolExecution(tc.name, tc.arguments, result);

          if (tc.name === 'plan.compose') {
            const parseResult = PlanComposeTreeOutputSchema.safeParse(result);
            if (!parseResult.success) {
              try {
                await this.auditService.write({
                  event_type: 'planner.bad_output',
                  household_id: opts.householdId,
                  request_id: opts.requestId,
                  metadata: {
                    agent: 'swap',
                    weekOf: opts.weekOf,
                    zodIssues: parseResult.error.issues,
                  },
                });
              } catch {
                // audit write failure must not suppress the schema error
              }
              throw parseResult.error;
            }
            swapResult = parseResult.data;
          }

          messages.push({
            role: 'tool',
            content: JSON.stringify(result),
            toolCallId: tc.id,
            name: tc.name,
          });
        }

        if (swapResult !== null) break;
      }

      if (swapResult === null) {
        throw new Error(
          `swapBlockedItems: swap agent did not call plan.compose within ${String(MAX_SWAP_ITERATIONS)} iterations (householdId=${opts.householdId}, weekOf=${opts.weekOf})`,
        );
      }

      tracer?.recordResult(swapResult, swapResult.plan_id, Date.now() - swapStartMs);

      this.logger.info(
        {
          requestId: opts.requestId,
          householdId: opts.householdId,
          weekOf: opts.weekOf,
          blocked_item_count: opts.blockedItems.length,
          proposed_day_count: swapResult.days.length,
        },
        'swapBlockedItems: replacements proposed',
      );

      return swapResult;
    } catch (err) {
      tracer?.recordError(err);
      throw err;
    } finally {
      await tracer?.flush();
    }
  }

  getActiveProvider(): LLMProvider {
    return this.resilient.getActiveProvider();
  }

  getProviderStatus(): { active_provider: string; circuit_open: boolean; providers: string[] } {
    return this.resilient.getStatus();
  }

  dispose(): void {
    this.resilient.dispose();
  }
}

// Audit write with exponential backoff. Recovery audit drives the
// `auto_resolve` rule in alert.json — a silent loss leaves ops paged
// indefinitely. We attempt up to 3 writes before giving up and logging.
async function writeAuditWithRetry(
  auditService: AuditService,
  input: Parameters<AuditService['write']>[0],
  logger: FastifyBaseLogger,
): Promise<void> {
  const delaysMs = [100, 500, 2000];
  for (let attempt = 0; attempt < delaysMs.length; attempt += 1) {
    try {
      await auditService.write(input);
      return;
    } catch (err) {
      const isLast = attempt === delaysMs.length - 1;
      if (isLast) {
        logger.error(
          { err, event_type: input.event_type, attempt: attempt + 1 },
          'audit write failed after retries',
        );
        return;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, delaysMs[attempt]));
    }
  }
}
