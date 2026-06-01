import type { ToolSpec } from '../tools.manifest.js';

/**
 * Slice B — semantic tier for model selection. The adapter resolves the
 * tier to a concrete provider model name at call time so calling code
 * never has to hardcode "gpt-4o" vs "gpt-4o-mini" vs reasoning-tier IDs.
 *
 *   'flagship'  — frontier model. Multi-constraint reasoning, plan
 *                 synthesis, anything that justifies the cost premium.
 *                 OpenAI: gpt-4o.
 *   'mini'      — small, fast, cheap. Focused single-task sub-agents
 *                 (Recipe Generator, Swap Agent), classification, tag
 *                 inference. OpenAI: gpt-4o-mini.
 *   'reasoning' — slow, deliberate reasoning model when chain-of-thought
 *                 quality matters. OpenAI: o1 / o3 family (where
 *                 available). Reserved for cases where flagship's
 *                 single-pass output isn't enough.
 */
export type LLMTier = 'flagship' | 'mini' | 'reasoning';

export interface LLMCallOptions {
  /** Explicit provider model name. When set, takes precedence over `tier`.
   *  Use for one-off overrides; prefer `tier` for normal call sites so
   *  model bumps are a one-line change in the adapter. */
  model?: string;
  /** Semantic tier; resolved by the adapter to a concrete model. Either
   *  `model` or `tier` must be set. */
  tier?: LLMTier;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  /** Key/value tags forwarded to OpenAI as `metadata` when
   *  OPENAI_STORE_COMPLETIONS is enabled. Used to filter stored completions
   *  by agent_type and prompt_version when running evals. Ignored when
   *  storeCompletions is false. Values must be strings (OpenAI requirement). */
  metadata?: Record<string, string>;
}

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface LLMResponse {
  content: string | null;
  toolCalls: LLMToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
  usage: {
    promptTokens: number;
    completionTokens: number;
    /** Slice B — count of input tokens served from the provider's
     *  auto-prefix cache (OpenAI gpt-4o family) or explicit
     *  cache_control blocks (Anthropic). Zero when caching didn't
     *  trigger. Telemetry signal for observing cache effectiveness on
     *  hot prompts (kitchen-map injection, planner system prompt). */
    cachedPromptTokens: number;
  };
}

export interface LLMStreamEvent {
  type: 'delta' | 'tool_call_delta' | 'done';
  content?: string;
  toolCallDelta?: { id: string; name?: string; argumentsDelta?: string };
}

// Multi-turn message for agentic loops (e.g., planWeek). The 'tool' role
// links a tool result back to its triggering call via toolCallId.
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  toolCalls?: LLMToolCall[];
  toolCallId?: string;
  name?: string;
}

export interface LLMProvider {
  readonly name: string;
  complete(prompt: string, tools: ToolSpec[], options: LLMCallOptions): Promise<LLMResponse>;
  completeWithMessages(
    messages: LLMMessage[],
    tools: ToolSpec[],
    options: LLMCallOptions,
  ): Promise<LLMResponse>;
  stream(prompt: string, tools: ToolSpec[], options: LLMCallOptions): AsyncIterable<LLMStreamEvent>;
  probe(): Promise<boolean>;
}
