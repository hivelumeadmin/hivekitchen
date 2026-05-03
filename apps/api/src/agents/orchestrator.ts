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
  ): Promise<PlanComposeOutput> {
    const MAX_PLAN_ITERATIONS = 20;
    const tools = Array.from(TOOL_MANIFEST.values());

    const contextLines = [
      `Household ID: ${householdId}`,
      `Planning week starting: ${weekOf} (Monday)`,
      `Request ID: ${requestId}`,
      rejectionContext !== undefined && rejectionContext.length > 0
        ? `Previous attempt was blocked by the allergy guardrail. Blocked ingredients/reasons:\n${rejectionContext}\nCompose a revised plan that avoids these.`
        : 'This is the first generation attempt for this household and week.',
    ];

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
