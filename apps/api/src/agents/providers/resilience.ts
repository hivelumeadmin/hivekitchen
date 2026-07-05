import type { FastifyBaseLogger } from 'fastify';
import { CircuitBreaker } from '../circuit-breaker.js';
import type { ToolSpec } from '../tools.manifest.js';
import type {
  LLMCallOptions,
  LLMMessage,
  LLMProvider,
  LLMResponse,
  LLMStreamEvent,
} from './llm-provider.interface.js';

// Story 3.5-s7 — extracted from DomainOrchestrator. The retry, circuit-breaker,
// and provider-switching plumbing that used to live inline in the orchestrator
// now lives behind this LLMProvider decorator, so the orchestrator's domain code
// is free of failover concerns and both layers test independently.

// Exported for tests — the number of times a 429 rate-limit error is retried
// (with a token-window wait) before the error propagates.
export const MAX_RATE_LIMIT_RETRIES = 3;

export interface ResilienceOptions {
  failureThreshold: number;
  windowMs: number;
  recoveryMs: number;
  logger: Pick<FastifyBaseLogger, 'warn' | 'error' | 'info'>;
  /** Called when the circuit breaker opens and a provider swap occurs. */
  onFailover: (from: string, to: string, reason: string) => void;
  /** Called when the recovery probe succeeds and the primary is restored. */
  onRecovered: (from: string, to: string) => void;
}

// Wraps an ordered list of providers (primary first) and presents the active
// one through the LLMProvider interface. On non-429 failures it drives a
// CircuitBreaker that swaps to the next provider after `failureThreshold`
// failures inside `windowMs`, then probes the primary back after `recoveryMs`.
export class ResilientProvider implements LLMProvider {
  private currentProviderIndex = 0;
  private readonly breaker: CircuitBreaker;
  private readonly providers: LLMProvider[];
  private readonly options: ResilienceOptions;

  constructor(providers: LLMProvider[], options: ResilienceOptions) {
    if (providers.length === 0) {
      throw new Error('ResilientProvider requires at least one LLMProvider');
    }
    this.providers = providers;
    this.options = options;

    this.breaker = new CircuitBreaker({
      failureThreshold: options.failureThreshold,
      windowMs: options.windowMs,
      recoveryMs: options.recoveryMs,
      onOpen: () => {
        this.handleBreakerOpen();
      },
      onRecovered: () => {
        void this.handleRecoveryAttempt();
      },
    });
  }

  get name(): string {
    return this.providers[this.currentProviderIndex]?.name ?? 'unknown';
  }

  async complete(prompt: string, tools: ToolSpec[], options: LLMCallOptions): Promise<LLMResponse> {
    const provider = this.activeProvider();
    try {
      const result = await provider.complete(prompt, tools, options);
      this.breaker.recordSuccess();
      return result;
    } catch (err) {
      this.breaker.recordFailure();
      throw err;
    }
  }

  async completeWithMessages(
    messages: LLMMessage[],
    tools: ToolSpec[],
    options: LLMCallOptions,
  ): Promise<LLMResponse> {
    const provider = this.activeProvider();

    // Retry loop for OpenAI 429 TPM rate limit errors. The SDK's default 2
    // retries use the `retry-after` header (~3s) but often that's not enough
    // time for the token window to clear. We read the `x-ratelimit-reset-tokens`
    // header (seconds until the full TPM window resets) and wait that long.
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await provider.completeWithMessages(messages, tools, options);
        this.breaker.recordSuccess();
        return result;
      } catch (err) {
        const isRateLimit =
          err !== null &&
          typeof err === 'object' &&
          'status' in err &&
          (err as { status: number }).status === 429;
        if (isRateLimit && attempt < MAX_RATE_LIMIT_RETRIES) {
          // Read reset-tokens header if available, else fall back to 90s.
          const headers = (err as { headers?: Record<string, string> }).headers ?? {};
          const resetTokensHeader = headers['x-ratelimit-reset-tokens'];
          // Header formats: "54.726s" (seconds only) or "1m21.587s" (minutes+seconds)
          let resetSec = 90;
          if (resetTokensHeader) {
            const minMatch = /(\d+)m([\d.]+)s/.exec(resetTokensHeader);
            const secMatch = /^([\d.]+)s$/.exec(resetTokensHeader);
            if (minMatch) {
              resetSec = parseInt(minMatch[1], 10) * 60 + parseFloat(minMatch[2]);
            } else if (secMatch) {
              resetSec = parseFloat(secMatch[1]);
            }
          }
          const waitMs = Math.ceil(resetSec * 1000) + 1000; // +1s buffer
          this.options.logger.warn(
            { attempt, waitMs, resetTokensHeader },
            'completeWithMessages: TPM rate limit — waiting for token window reset',
          );
          await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
          continue;
        }
        // Non-429 error (or retries exhausted): this is a real provider fault,
        // so it counts toward the circuit breaker. A 429 never reaches here
        // while attempts remain — API throttling is not a provider outage.
        this.breaker.recordFailure();
        throw err;
      }
    }
  }

  async *stream(
    prompt: string,
    tools: ToolSpec[],
    options: LLMCallOptions,
  ): AsyncIterable<LLMStreamEvent> {
    yield* this.activeProvider().stream(prompt, tools, options);
  }

  async probe(): Promise<boolean> {
    const primary = this.providers[0];
    if (!primary) return false;
    try {
      return await primary.probe();
    } catch {
      return false;
    }
  }

  supportsStrictTools(): boolean {
    return this.activeProvider().supportsStrictTools();
  }

  getActiveProvider(): LLMProvider {
    return this.activeProvider();
  }

  getStatus(): { active_provider: string; circuit_open: boolean; providers: string[] } {
    return {
      active_provider: this.providers[this.currentProviderIndex]?.name ?? 'unknown',
      circuit_open: this.breaker.isTripped(),
      providers: this.providers.map((p) => p.name),
    };
  }

  dispose(): void {
    this.breaker.dispose();
  }

  private activeProvider(): LLMProvider {
    const provider = this.providers[this.currentProviderIndex];
    if (!provider) {
      throw new Error(`No active LLM provider at index ${String(this.currentProviderIndex)}`);
    }
    return provider;
  }

  private handleBreakerOpen(): void {
    const reason = `circuit_breaker_open_after_${String(this.options.failureThreshold)}_failures_in_${String(this.options.windowMs)}ms`;
    const previousProvider = this.providers[this.currentProviderIndex];
    this.options.logger.warn(
      { provider: previousProvider?.name, reason },
      'circuit breaker opened — swapping provider',
    );
    this.swapProvider(reason);
  }

  private async handleRecoveryAttempt(): Promise<void> {
    // Guard: only attempt recovery when we are actually on a non-primary
    // provider. This also covers the case where a stale recovery callback
    // fires after `currentProviderIndex` was already reset.
    if (this.currentProviderIndex === 0) return;
    const primary = this.providers[0];
    if (!primary) return;
    const previous = this.providers[this.currentProviderIndex];
    let healthy = false;
    try {
      healthy = await primary.probe();
    } catch {
      healthy = false;
    }
    if (healthy) {
      this.currentProviderIndex = 0;
      this.options.logger.info(
        { event_type: 'llm.provider.recovered', from: previous?.name, to: primary.name },
        'primary provider recovered',
      );
      this.options.onRecovered(previous?.name ?? 'unknown', primary.name);
    }
  }

  private swapProvider(reason: string): void {
    const previousIndex = this.currentProviderIndex;
    const nextIndex = Math.min(previousIndex + 1, this.providers.length - 1);
    if (nextIndex === previousIndex) {
      this.options.logger.error(
        { provider: this.providers[previousIndex]?.name, reason },
        'no remaining providers to fail over to',
      );
      return;
    }
    this.currentProviderIndex = nextIndex;
    const from = this.providers[previousIndex]?.name ?? 'unknown';
    const to = this.providers[nextIndex]?.name ?? 'unknown';
    this.options.logger.error(
      { event_type: 'llm.provider.failover', from, to, reason },
      'llm provider failover triggered',
    );
    this.options.onFailover(from, to, reason);
  }
}
