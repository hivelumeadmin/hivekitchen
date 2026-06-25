import { NotImplementedError } from '../../common/errors.js';
import type {
  LLMProvider,
  LLMResponse,
  LLMStreamEvent,
} from './llm-provider.interface.js';

export class AnthropicAdapter implements LLMProvider {
  readonly name = 'anthropic';

  complete(): Promise<LLMResponse> {
    throw new NotImplementedError('AnthropicAdapter.complete');
  }

  // Failover stub for the planner agentic loop. Anthropic is the circuit-breaker
  // failover throughout Epic 3 — a future story will wire a real implementation.
  completeWithMessages(): Promise<LLMResponse> {
    throw new NotImplementedError('AnthropicAdapter.completeWithMessages');
  }

  // eslint-disable-next-line require-yield
  async *stream(): AsyncGenerator<LLMStreamEvent> {
    throw new NotImplementedError('AnthropicAdapter.stream');
  }

  probe(): Promise<boolean> {
    return Promise.resolve(false);
  }

  // Slice 3.5-s2 — Anthropic is a NotImplementedError stub. When it is wired
  // for real, forced tool calling uses `tool_choice: { type: 'tool', name: ... }`
  // (the Anthropic equivalent of OpenAI's forced function tool_choice); until
  // then the orchestrator skips the forced-compose path on Anthropic failover.
  supportsStrictTools(): boolean {
    return false;
  }
}
