import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { ForbiddenToolCallError } from '../common/errors.js';
import type { AuditService } from '../audit/audit.service.js';
import type { MemoryService } from '../modules/memory/memory.service.js';
import type { AllergyGuardrailService } from '../modules/allergy-guardrail/allergy-guardrail.service.js';
import { TOOL_MANIFEST } from './tools.manifest.js';
import { createAllergyCheckSpec } from './tools/allergy.tools.js';
import { createMemoryNoteSpec } from './tools/memory.tools.js';
import { CircuitBreaker } from './circuit-breaker.js';
import type {
  LLMCallOptions,
  LLMProvider,
  LLMResponse,
} from './providers/llm-provider.interface.js';
import type { ToolSpec } from './tools.manifest.js';

export interface OrchestratorServices {
  memory: MemoryService;
  allergyGuardrail: AllergyGuardrailService;
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
    private readonly auditService: AuditService,
    private readonly logger: FastifyBaseLogger,
  ) {
    if (providers.length === 0) {
      throw new Error('DomainOrchestrator requires at least one LLMProvider');
    }

    TOOL_MANIFEST.set('allergy.check', createAllergyCheckSpec(services.allergyGuardrail));
    TOOL_MANIFEST.set('memory.note', createMemoryNoteSpec(services.memory));

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
