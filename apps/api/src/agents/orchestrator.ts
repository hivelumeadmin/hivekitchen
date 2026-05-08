import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import { PlanComposeOutputSchema } from '@hivekitchen/contracts';
import type { PlanComposeOutput } from '@hivekitchen/types';
import { ForbiddenToolCallError } from '../common/errors.js';
import type { AuditService } from '../audit/audit.service.js';
import type { MemoryService } from '../modules/memory/memory.service.js';
import type { AllergyGuardrailService } from '../modules/allergy-guardrail/allergy-guardrail.service.js';
import type { RecipeService } from '../modules/recipe/recipe.service.js';
import type { PantryService } from '../modules/pantry/pantry.service.js';
import type { PlansService } from '../modules/plans/plans.service.js';
import type { CulturalPriorService } from '../modules/cultural-priors/cultural-prior.service.js';
import { TOOL_MANIFEST } from './tools.manifest.js';
import { createAllergyCheckSpec } from './tools/allergy.tools.js';
import { createMemoryNoteSpec, createMemoryRecallSpec } from './tools/memory.tools.js';
import { createRecipeFetchSpec, createRecipeSearchSpec } from './tools/recipe.tools.js';
import { createPantryReadSpec } from './tools/pantry.tools.js';
import { createPlanComposeSpec } from './tools/plan.tools.js';
import { createCulturalLookupSpec } from './tools/cultural.tools.js';
import { PLANNER_PROMPT } from './prompts/planner.prompt.js';
import { CircuitBreaker } from './circuit-breaker.js';
import type {
  LLMCallOptions,
  LLMMessage,
  LLMProvider,
  LLMResponse,
} from './providers/llm-provider.interface.js';
import type { ToolSpec } from './tools.manifest.js';
import type {
  CulturalObservance,
  CulturalTemplateKey,
} from '../services/cultural-calendar.service.js';

// Story 3.18 — cultural context the planner agent receives alongside household
// + week metadata. Empty arrays = silence-mode household → no cultural lines
// injected → planner uses neutral defaults.
export interface PlannerCulturalContext {
  observances: readonly CulturalObservance[];
  l0Preferences: readonly string[];
  l1MethodPriors: readonly string[];
  culturalObligations: readonly string[];
  culturalTemplates: readonly CulturalTemplateKey[];
}

// Story 3.20 — per-child bag-slot configuration (snack/extra on/off). Main is
// always on, so it's not part of the shape. The planner uses this to decide
// which slots to fill for each child; an inactive slot must produce no
// plan_items entry, not an entry with empty ingredients.
export interface PlannerBagComposition {
  child_id: string;
  child_name: string;
  snack: boolean;
  extra: boolean;
}

// Story 3.21 — per-child Extra slot pin/ban rules + the household's
// custom Extra library. Empty arrays = no preference; the planner falls
// back to its general "interesting Extra" composition logic.
export interface PlannerExtraRules {
  child_id: string;
  child_name: string;
  pins: readonly string[];
  bans: readonly string[];
}

export interface PlannerExtraLibraryItem {
  id: string;
  name: string;
  component_type: string;
  is_allergen_free: boolean;
}

// Story 3.22 — children whose Extra slot is OFF but who have a high-activity
// day_override (sport_practice / field_trip) on the upcoming week. The planner
// is instructed to propose one Extra item for those specific days; full parent-
// confirmation UX is deferred to a follow-up story.
export interface PlannerExtraProposal {
  child_id: string;
  child_name: string;
  override_date: string;
  override_type: 'sport_practice' | 'field_trip';
}

export interface OrchestratorServices {
  memory: MemoryService;
  allergyGuardrail: AllergyGuardrailService;
  recipe: RecipeService;
  pantry: PantryService;
  plan: PlansService;
  culturalPrior: CulturalPriorService;
}

const FAILURE_THRESHOLD = 5;
const FAILURE_WINDOW_MS = 60_000;
const RECOVERY_MS = 900_000;

export class DomainOrchestrator {
  private currentProviderIndex = 0;
  private readonly breaker: CircuitBreaker;

  constructor(
    private readonly providers: LLMProvider[],
    services: OrchestratorServices,
    private readonly redis: Redis,
    private readonly auditService: AuditService,
    private readonly logger: FastifyBaseLogger,
  ) {
    if (providers.length === 0) {
      throw new Error('DomainOrchestrator requires at least one LLMProvider');
    }

    TOOL_MANIFEST.set('allergy.check', createAllergyCheckSpec(services.allergyGuardrail, redis));
    TOOL_MANIFEST.set('memory.note', createMemoryNoteSpec(services.memory));
    TOOL_MANIFEST.set('memory.recall', createMemoryRecallSpec(services.memory, redis));
    TOOL_MANIFEST.set('recipe.search', createRecipeSearchSpec(services.recipe, redis));
    TOOL_MANIFEST.set('recipe.fetch', createRecipeFetchSpec(services.recipe, redis));
    TOOL_MANIFEST.set('pantry.read', createPantryReadSpec(services.pantry, redis));
    TOOL_MANIFEST.set('plan.compose', createPlanComposeSpec(services.plan, redis));
    TOOL_MANIFEST.set('cultural.lookup', createCulturalLookupSpec(services.culturalPrior, redis));

    this.breaker = new CircuitBreaker({
      failureThreshold: FAILURE_THRESHOLD,
      windowMs: FAILURE_WINDOW_MS,
      recoveryMs: RECOVERY_MS,
      onOpen: () => {
        this.handleBreakerOpen();
      },
      onRecovered: () => {
        void this.handleRecoveryAttempt();
      },
    });
  }

  async complete(
    prompt: string,
    tools: ToolSpec[],
    options: LLMCallOptions,
    allowedTools?: readonly string[],
  ): Promise<LLMResponse> {
    const provider = this.providers[this.currentProviderIndex];
    if (!provider) {
      throw new Error(`No active LLM provider at index ${String(this.currentProviderIndex)}`);
    }

    const effectiveTools = allowedTools
      ? tools.filter((t) => allowedTools.includes(t.name))
      : tools;

    let result: LLMResponse;
    try {
      result = await provider.complete(prompt, effectiveTools, options);
      this.breaker.recordSuccess();
    } catch (err) {
      this.breaker.recordFailure();
      throw err;
    }

    // Validation runs AFTER recordSuccess so a forbidden-tool-call error is
    // attributed to the agent's tool policy, not the provider's reliability.
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
  // (system / user / assistant / tool turns) into the active provider. Mirrors
  // complete()'s circuit-breaker accounting and forbidden-tool enforcement so
  // the planner agentic loop gets the same failover guarantees.
  async completeWithMessages(
    messages: LLMMessage[],
    tools: ToolSpec[],
    options: LLMCallOptions,
    allowedTools?: readonly string[],
  ): Promise<LLMResponse> {
    const provider = this.providers[this.currentProviderIndex];
    if (!provider) {
      throw new Error(`No active LLM provider at index ${String(this.currentProviderIndex)}`);
    }

    const effectiveTools = allowedTools
      ? tools.filter((t) => allowedTools.includes(t.name))
      : tools;

    let result: LLMResponse;
    try {
      result = await provider.completeWithMessages(messages, effectiveTools, options);
      this.breaker.recordSuccess();
    } catch (err) {
      this.breaker.recordFailure();
      throw err;
    }

    if (allowedTools) {
      for (const tc of result.toolCalls ?? []) {
        if (!allowedTools.includes(tc.name)) {
          throw new ForbiddenToolCallError(tc.name);
        }
      }
    }

    return result;
  }

  // Agentic planner loop. Runs the PLANNER_PROMPT agent until it calls
  // plan.compose, then returns the composed PlanComposeOutput. The BullMQ
  // worker is responsible for converting the result into CommitPlanInput and
  // calling plansService.commit() — this method does NOT commit.
  //
  // - MAX_PLAN_ITERATIONS guards against runaway tool-calling loops.
  // - rejectionContext: passes guardrail blocks from a previous attempt so the
  //   planner can avoid the same unsafe ingredients on retry (Story 3.7
  //   regenerate path).
  async planWeek(
    householdId: string,
    weekOf: string,
    requestId: string,
    rejectionContext?: string,
    dayScope?: string,  // Story 3.13 — ISO day name ('tuesday') for day-scoped regen
    culturalContext?: PlannerCulturalContext,  // Story 3.18 — observances + L0/L1 priors
    bagCompositions?: readonly PlannerBagComposition[],  // Story 3.20 — per-child snack/extra slots
    extraRules?: readonly PlannerExtraRules[],  // Story 3.21 — per-child Extra pins/bans
    extraLibraryItems?: readonly PlannerExtraLibraryItem[],  // Story 3.21 — household custom Extras
    extraProposals?: readonly PlannerExtraProposal[],  // Story 3.22 — high-activity Extra proposals (FR119)
  ): Promise<PlanComposeOutput> {
    const MAX_PLAN_ITERATIONS = 20;
    const tools = Array.from(TOOL_MANIFEST.values());

    const culturalLines = buildCulturalContextLines(culturalContext);
    const bagCompositionLines = buildBagCompositionLines(bagCompositions);
    const extraRulesLines = buildExtraRulesLines(extraRules, extraLibraryItems);
    const extraProposalLines = buildExtraProposalLines(extraProposals);

    const contextLines = [
      `Household ID: ${householdId}`,
      `Planning week starting: ${weekOf} (Monday)`,
      `Request ID: ${requestId}`,
      ...culturalLines,
      ...bagCompositionLines,
      ...extraRulesLines,
      ...extraProposalLines,
      dayScope !== undefined
        ? `Regeneration scope: DAY ONLY. Only generate a new plan for ${dayScope.toUpperCase()}. Keep all other days exactly as previously composed. Only call plan.compose with items for ${dayScope} — do not include other days.`
        : undefined,
      rejectionContext !== undefined && rejectionContext.length > 0
        ? `Previous attempt was blocked by the allergy guardrail. Blocked ingredients/reasons:\n${rejectionContext}\nCompose a revised plan that avoids these.`
        : 'This is the first generation attempt for this household and week.',
    ].filter((line): line is string => line !== undefined);

    const messages: LLMMessage[] = [
      { role: 'system', content: PLANNER_PROMPT.text },
      { role: 'user', content: contextLines.join('\n') },
    ];

    let planComposeResult: PlanComposeOutput | null = null;

    for (let i = 0; i < MAX_PLAN_ITERATIONS; i++) {
      const response = await this.completeWithMessages(
        messages,
        tools,
        { model: 'gpt-4o', temperature: 0.7, maxTokens: 4096 },
        PLANNER_PROMPT.toolsAllowed,
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
            { requestId, toolName: tc.name },
            'planWeek: unregistered tool called — treating as fatal',
          );
          throw new ForbiddenToolCallError(tc.name);
        }

        let result: unknown;
        try {
          result = await spec.fn(tc.arguments);
        } catch (err) {
          // Non-plan.compose tool errors are surfaced as a JSON result so the
          // LLM can adapt. plan.compose errors are fatal — no point continuing
          // without a plan.
          if (tc.name === 'plan.compose') throw err;
          result = { error: err instanceof Error ? err.message : String(err) };
        }

        if (tc.name === 'plan.compose') {
          planComposeResult = PlanComposeOutputSchema.parse(result);
        }

        messages.push({
          role: 'tool',
          content: JSON.stringify(result),
          toolCallId: tc.id,
          name: tc.name,
        });
      }

      if (planComposeResult !== null) break;
    }

    if (planComposeResult === null) {
      throw new Error(
        `planWeek: planner agent did not call plan.compose within ${String(MAX_PLAN_ITERATIONS)} iterations (householdId=${householdId}, weekOf=${weekOf})`,
      );
    }

    this.logger.info(
      { requestId, householdId, weekOf, planId: planComposeResult.plan_id },
      'planWeek: plan composed',
    );

    return planComposeResult;
  }

  getActiveProvider(): LLMProvider {
    const provider = this.providers[this.currentProviderIndex];
    if (!provider) {
      throw new Error(`No active LLM provider at index ${String(this.currentProviderIndex)}`);
    }
    return provider;
  }

  dispose(): void {
    this.breaker.dispose();
  }

  private handleBreakerOpen(): void {
    const reason = `circuit_breaker_open_after_${String(FAILURE_THRESHOLD)}_failures_in_${String(FAILURE_WINDOW_MS)}ms`;
    const previousProvider = this.providers[this.currentProviderIndex];
    this.logger.warn(
      { provider: previousProvider?.name, reason },
      'circuit breaker opened — swapping provider',
    );
    this.swapProvider(reason);
  }

  private async handleRecoveryAttempt(): Promise<void> {
    if (this.currentProviderIndex === 0) return;
    const primary = this.providers[0];
    if (!primary) return;
    let healthy = false;
    try {
      healthy = await primary.probe();
    } catch {
      healthy = false;
    }
    if (healthy) {
      this.currentProviderIndex = 0;
      this.logger.info({ provider: primary.name }, 'primary provider recovered');
    }
  }

  private swapProvider(reason: string): void {
    const previousIndex = this.currentProviderIndex;
    const nextIndex = Math.min(previousIndex + 1, this.providers.length - 1);
    if (nextIndex === previousIndex) {
      this.logger.error(
        { provider: this.providers[previousIndex]?.name, reason },
        'no remaining providers to fail over to',
      );
      return;
    }
    this.currentProviderIndex = nextIndex;
    const from = this.providers[previousIndex]?.name ?? 'unknown';
    const to = this.providers[nextIndex]?.name ?? 'unknown';
    this.logger.error({ from, to, reason }, 'llm provider failover triggered');
    void this.auditService.write({
      event_type: 'llm.provider.failover',
      request_id: randomUUID(),
      metadata: { from, to, reason },
    });
  }
}

const CULTURAL_TEMPLATE_DISPLAY_NAMES: Record<CulturalTemplateKey, string> = {
  halal: 'Halal',
  kosher: 'Kosher',
  hindu_vegetarian: 'Hindu vegetarian',
  south_asian: 'South Asian',
  east_african: 'East African',
  caribbean: 'Caribbean',
};

// Story 3.18 — translates the structured cultural context into the
// natural-language lines the planner agent receives in its user message.
// Returns an empty list for silence-mode households so the prompt stays
// neutral.
export function buildCulturalContextLines(
  context: PlannerCulturalContext | undefined,
): string[] {
  if (context === undefined) return [];

  const lines: string[] = [];

  if (context.culturalTemplates.length > 0) {
    const displayNames = context.culturalTemplates.map(
      (k) => CULTURAL_TEMPLATE_DISPLAY_NAMES[k] ?? k,
    );
    lines.push(
      `Cultural templates ratified by this household: ${displayNames.join(', ')}.`,
    );
  }

  if (context.observances.length > 0) {
    lines.push('Upcoming cultural observances during this plan week:');
    for (const o of context.observances) {
      const range = o.start_date === o.end_date
        ? o.start_date
        : `${o.start_date} – ${o.end_date}`;
      const notes = o.dietary_notes !== null && o.dietary_notes.length > 0
        ? ` ${o.dietary_notes}`
        : '';
      const templateName = CULTURAL_TEMPLATE_DISPLAY_NAMES[o.cultural_template] ?? o.cultural_template;
      const recurrenceSuffix = o.observance_name === 'Shabbat' ? ', recurs weekly' : '';
      lines.push(`- ${o.observance_name} (${templateName}${recurrenceSuffix}): ${range}.${notes}`);
    }
  }

  if (context.l0Preferences.length > 0) {
    lines.push('Household food preferences (apply silently — no confirmation needed):');
    for (const p of context.l0Preferences) {
      lines.push(`- ${p}`);
    }
  }

  if (context.culturalObligations.length > 0) {
    lines.push('Cultural obligations (required — do not override):');
    for (const p of context.culturalObligations) {
      lines.push(`- ${p}`);
    }
  }

  if (context.l1MethodPriors.length > 0) {
    lines.push('Preparation priors (soft signals — prefer but not required):');
    for (const p of context.l1MethodPriors) {
      lines.push(`- ${p}`);
    }
  }

  return lines;
}

// Story 3.20 — formats per-child bag composition as planner context lines.
// The planner must omit plan_items for inactive slots; emitting items with
// empty ingredients would break the guardrail's `min(1)` invariant and feel
// to the parent like the slot is still "live but blank".
export function buildBagCompositionLines(
  compositions: readonly PlannerBagComposition[] | undefined,
): string[] {
  if (compositions === undefined || compositions.length === 0) return [];
  const lines: string[] = ['Per-child bag composition (Main is always active — never skip Main):'];
  for (const c of compositions) {
    const snack = c.snack ? 'ON' : 'OFF';
    const extra = c.extra ? 'ON' : 'OFF';
    lines.push(`- ${c.child_name} (${c.child_id}): Snack ${snack}, Extra ${extra}`);
  }
  lines.push(
    'Generate plan_items only for active slots. Do not produce a Snack item when Snack is OFF, and do not produce an Extra item when Extra is OFF.',
  );
  return lines;
}

// Story 3.21 — formats per-child Extra pin/ban rules + the household's
// custom Extra library as planner context lines. Pins are forward-looking
// preferences ("always include a fruit"), bans are hard prohibitions
// ("never propose a sweet treat"). Library items are parent-authored named
// options the planner should prefer when they fulfil a pinned type.
export function buildExtraRulesLines(
  rules: readonly PlannerExtraRules[] | undefined,
  libraryItems: readonly PlannerExtraLibraryItem[] | undefined,
): string[] {
  const hasRules = rules !== undefined && rules.some((r) => r.pins.length > 0 || r.bans.length > 0);
  const hasLibrary = libraryItems !== undefined && libraryItems.length > 0;
  if (!hasRules && !hasLibrary) return [];

  const lines: string[] = [];

  if (hasRules && rules !== undefined) {
    lines.push('Per-child Extra slot pin/ban rules:');
    for (const r of rules) {
      if (r.pins.length === 0 && r.bans.length === 0) continue;
      const parts: string[] = [];
      if (r.pins.length > 0) {
        parts.push(`always include one of [${r.pins.join(', ')}]`);
      }
      if (r.bans.length > 0) {
        parts.push(`never propose [${r.bans.join(', ')}]`);
      }
      lines.push(`- ${r.child_name} (${r.child_id}): ${parts.join('; ')}.`);
    }
  }

  if (hasLibrary && libraryItems !== undefined) {
    const summary = libraryItems
      .map((i) => `${i.name} (${i.component_type})`)
      .join(', ');
    lines.push(
      `Household custom Extra items available (prefer these when they match a pinned component type): ${summary}.`,
    );
  }

  return lines;
}

// Story 3.22 — translates high-activity Extra proposals into prompt context.
// The planner is told to propose ONE Extra item only on the named day for
// children whose Extra slot is normally OFF, overriding the bag-composition
// suppression rule for that single day. Parent confirmation UX for the
// proposed item is deferred — the MVP commits the planner's proposal and
// relies on the swap path for opt-out.
export function buildExtraProposalLines(
  proposals: readonly PlannerExtraProposal[] | undefined,
): string[] {
  if (proposals === undefined || proposals.length === 0) return [];
  const lines: string[] = [
    'High-activity day Extra proposals (Lumi-suggested — propose Extra ONLY on the named day, even when Extra is OFF for that child):',
  ];
  for (const p of proposals) {
    lines.push(
      `- On ${p.override_date}, ${p.child_name} (${p.child_id}) has a ${p.override_type}. Add one Extra item for that day only; do not add Extra on other days for this child.`,
    );
  }
  return lines;
}

