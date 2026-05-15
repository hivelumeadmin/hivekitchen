import { z } from 'zod';
import type OpenAI from 'openai';
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParams,
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionToolMessageParam,
} from 'openai/resources/chat/completions';
import type { ToolSpec } from '../tools.manifest.js';
import type {
  LLMCallOptions,
  LLMMessage,
  LLMProvider,
  LLMResponse,
  LLMStreamEvent,
  LLMTier,
  LLMToolCall,
} from './llm-provider.interface.js';

const ZERO_RETENTION_HEADER = { 'OpenAI-Data-Privacy': 'zero-retention' } as const;

/**
 * Returns the headers to pass to chat.completions.create. When traces are
 * disabled (default), we send `OpenAI-Data-Privacy: zero-retention` so OpenAI
 * processes the request but stores no body/response — billing counters still
 * tick, but the Activity / Logs / Traces dashboard panels are empty.
 *
 * When traces are enabled (dev-only — env validation hard-blocks staging/prod),
 * the header is omitted entirely so requests appear in the OpenAI dashboard
 * for debugging. An empty object — not `undefined` — keeps the SDK call shape
 * stable across both paths.
 */
function buildRequestHeaders(tracesEnabled: boolean): Record<string, string> {
  return tracesEnabled ? {} : { ...ZERO_RETENTION_HEADER };
}

// Slice B — semantic tier → concrete OpenAI model id. Bump the values here
// to upgrade a tier across every call site at once.
const TIER_TO_MODEL: Record<LLMTier, string> = {
  flagship: 'gpt-4o',
  mini: 'gpt-4o-mini',
  reasoning: 'o1-mini',
};

/**
 * Resolves LLMCallOptions to a concrete model name. Explicit `model` wins
 * over `tier`. When neither is set, falls back to flagship — defensive
 * default since LLMCallOptions allows both to be optional at the type
 * level. Call sites should always set one or the other.
 */
function resolveModel(options: LLMCallOptions): string {
  if (options.model !== undefined && options.model.length > 0) {
    return options.model;
  }
  if (options.tier !== undefined) {
    return TIER_TO_MODEL[options.tier];
  }
  return TIER_TO_MODEL.flagship;
}

// OpenAI requires tool function names to match ^[a-zA-Z0-9_-]+$. The internal
// manifest uses dotted names ("allergy.check"); convert to underscore form
// when crossing the SDK boundary and reverse the mapping when extracting
// tool calls so the orchestrator continues to see the canonical names.
function toExternalName(internal: string): string {
  if (internal.includes('__')) {
    throw new Error(
      `Internal tool name "${internal}" must not contain "__" — reserved for the OpenAI wire-name encoding`,
    );
  }
  return internal.replace(/\./g, '__');
}

function toInternalName(external: string): string {
  return external.replace(/__/g, '.');
}

function toJsonSchemaParameters(toolSpec: ToolSpec): Record<string, unknown> {
  const schema = z.toJSONSchema(toolSpec.inputSchema) as Record<string, unknown>;
  // Strip JSON Schema draft marker — OpenAI tolerates it but it adds noise.
  if ('$schema' in schema) {
    const copy = { ...schema };
    delete copy['$schema'];
    return copy;
  }
  return schema;
}

function toOpenAITools(tools: ToolSpec[]): ChatCompletionTool[] {
  return tools.map((spec) => ({
    type: 'function',
    function: {
      name: toExternalName(spec.name),
      description: spec.description,
      parameters: toJsonSchemaParameters(spec),
    },
  }));
}

function buildMessages(prompt: string, systemPrompt: string | undefined): ChatCompletionMessageParam[] {
  const messages: ChatCompletionMessageParam[] = [];
  if (systemPrompt !== undefined) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });
  return messages;
}

// Maps the orchestrator's neutral LLMMessage shape onto the OpenAI SDK's
// ChatCompletionMessageParam. Tool results carry tool_call_id; assistant
// messages with tool_calls round-trip the SDK's wire shape (function calls
// only — non-function call types are not produced by toOpenAITools).
function buildMessagesFromLLM(messages: LLMMessage[]): ChatCompletionMessageParam[] {
  return messages.map((m): ChatCompletionMessageParam => {
    if (m.role === 'tool') {
      if (!m.toolCallId) {
        throw new Error(`buildMessagesFromLLM: tool message is missing toolCallId (name=${m.name ?? 'unknown'})`);
      }
      return {
        role: 'tool',
        tool_call_id: m.toolCallId,
        content: m.content ?? '',
      } satisfies ChatCompletionToolMessageParam;
    }
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: m.content,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: toExternalName(tc.name),
            arguments:
              typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments),
          },
        })),
      };
    }
    return {
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content ?? '',
    };
  });
}

function mapFinishReason(reason: string | null | undefined): LLMResponse['finishReason'] {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'tool_calls':
      return 'tool_calls';
    case 'length':
      return 'length';
    default:
      return 'error';
  }
}

function parseToolCallArguments(raw: string): unknown {
  if (raw === '') return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    // Surface the raw string when JSON parsing fails — callers re-validate
    // arguments through the tool's inputSchema.parse(), which produces a
    // clear ZodError rather than a swallowed parse failure.
    return raw;
  }
}

// Slice B — extract auto-prefix cached input tokens from the OpenAI usage
// block. The gpt-4o family returns `usage.prompt_tokens_details.cached_tokens`
// when caching kicked in; older / smaller models may not, in which case
// this is 0. Type via the new field is not yet in older versions of the
// openai SDK types, so we read it via a structural narrowing rather than
// asserting against the type.
function cachedPromptTokensFromUsage(usage: ChatCompletion['usage']): number {
  if (!usage) return 0;
  const details = (usage as { prompt_tokens_details?: unknown }).prompt_tokens_details;
  if (details === undefined || details === null || typeof details !== 'object') return 0;
  const cached = (details as { cached_tokens?: unknown }).cached_tokens;
  return typeof cached === 'number' && cached >= 0 ? cached : 0;
}

function mapChatCompletion(response: ChatCompletion): LLMResponse {
  const choice = response.choices[0];
  if (!choice) {
    return {
      content: null,
      toolCalls: [],
      finishReason: 'error',
      usage: {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        cachedPromptTokens: cachedPromptTokensFromUsage(response.usage),
      },
    };
  }
  const message = choice.message;
  const toolCalls: LLMToolCall[] = (message?.tool_calls ?? [])
    .filter((c): c is { id: string; type: 'function'; function: { name: string; arguments: string } } =>
      c.type === 'function',
    )
    .map((c) => ({
      id: c.id,
      name: toInternalName(c.function.name),
      arguments: parseToolCallArguments(c.function.arguments),
    }));

  return {
    content: message?.content ?? null,
    toolCalls,
    finishReason: mapFinishReason(choice.finish_reason),
    usage: {
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      cachedPromptTokens: cachedPromptTokensFromUsage(response.usage),
    },
  };
}

export class OpenAIAdapter implements LLMProvider {
  readonly name = 'openai';
  private readonly tracesEnabled: boolean;

  constructor(
    private readonly client: OpenAI,
    options: { tracesEnabled?: boolean } = {},
  ) {
    // Default false → ZDR header is sent on every call. The orchestrator hook
    // passes env.OPENAI_TRACES_ENABLED; tests can opt in explicitly.
    this.tracesEnabled = options.tracesEnabled ?? false;
  }

  async complete(
    prompt: string,
    tools: ToolSpec[],
    options: LLMCallOptions,
  ): Promise<LLMResponse> {
    const params: ChatCompletionCreateParams = {
      model: resolveModel(options),
      messages: buildMessages(prompt, options.systemPrompt),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
      ...(tools.length > 0 ? { tools: toOpenAITools(tools), tool_choice: 'auto' } : {}),
    };

    const response = (await this.client.chat.completions.create(params, {
      headers: buildRequestHeaders(this.tracesEnabled),
    })) as ChatCompletion;

    return mapChatCompletion(response);
  }

  // Multi-turn entry point used by the agentic planner loop. Mirrors complete()
  // but accepts the full conversation history (system / user / assistant /
  // tool turns) so the LLM can iterate on tool results until plan.compose
  // is called.
  async completeWithMessages(
    messages: LLMMessage[],
    tools: ToolSpec[],
    options: LLMCallOptions,
  ): Promise<LLMResponse> {
    const params: ChatCompletionCreateParams = {
      model: resolveModel(options),
      messages: buildMessagesFromLLM(messages),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
      ...(tools.length > 0 ? { tools: toOpenAITools(tools), tool_choice: 'auto' } : {}),
    };

    const response = (await this.client.chat.completions.create(params, {
      headers: buildRequestHeaders(this.tracesEnabled),
    })) as ChatCompletion;

    return mapChatCompletion(response);
  }

  async *stream(
    prompt: string,
    tools: ToolSpec[],
    options: LLMCallOptions,
  ): AsyncIterable<LLMStreamEvent> {
    const params: ChatCompletionCreateParams = {
      model: resolveModel(options),
      messages: buildMessages(prompt, options.systemPrompt),
      stream: true,
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
      ...(tools.length > 0 ? { tools: toOpenAITools(tools), tool_choice: 'auto' } : {}),
    };

    const stream = await this.client.chat.completions.create(params, {
      headers: buildRequestHeaders(this.tracesEnabled),
    });

    // The streaming overload returns an async iterable; the union return
    // type from the SDK requires this guard so the non-streaming branch is
    // narrowed away.
    if (typeof (stream as AsyncIterable<unknown>)[Symbol.asyncIterator] !== 'function') {
      yield { type: 'done' };
      return;
    }

    for await (const chunk of stream as AsyncIterable<ChatCompletionChunk>) {
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content !== undefined && delta.content !== null && delta.content !== '') {
        yield { type: 'delta', content: delta.content };
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          yield {
            type: 'tool_call_delta',
            toolCallDelta: {
              id: tc.id ?? '',
              ...(tc.function?.name !== undefined
                ? { name: toInternalName(tc.function.name) }
                : {}),
              ...(tc.function?.arguments !== undefined
                ? { argumentsDelta: tc.function.arguments }
                : {}),
            },
          };
        }
      }
    }
    yield { type: 'done' };
  }

  async probe(): Promise<boolean> {
    try {
      await this.client.chat.completions.create(
        {
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        },
        { headers: buildRequestHeaders(this.tracesEnabled) },
      );
      return true;
    } catch {
      return false;
    }
  }
}
