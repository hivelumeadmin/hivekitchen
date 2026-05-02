import { z } from 'zod';
import type OpenAI from 'openai';
import type {
  ChatCompletionChunk,
  ChatCompletionCreateParams,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import type { ToolSpec } from '../tools.manifest.js';
import type {
  LLMCallOptions,
  LLMProvider,
  LLMResponse,
  LLMStreamEvent,
  LLMToolCall,
} from './llm-provider.interface.js';

const ZERO_RETENTION_HEADER = { 'OpenAI-Data-Privacy': 'zero-retention' } as const;

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

export class OpenAIAdapter implements LLMProvider {
  readonly name = 'openai';

  constructor(private readonly client: OpenAI) {}

  async complete(
    prompt: string,
    tools: ToolSpec[],
    options: LLMCallOptions,
  ): Promise<LLMResponse> {
    const params: ChatCompletionCreateParams = {
      model: options.model,
      messages: buildMessages(prompt, options.systemPrompt),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
      ...(tools.length > 0 ? { tools: toOpenAITools(tools), tool_choice: 'auto' } : {}),
    };

    const response = await this.client.chat.completions.create(params, {
      headers: { ...ZERO_RETENTION_HEADER },
    });

    const choice = response.choices[0];
    if (!choice) {
      return {
        content: null,
        toolCalls: [],
        finishReason: 'error',
        usage: {
          promptTokens: response.usage?.prompt_tokens ?? 0,
          completionTokens: response.usage?.completion_tokens ?? 0,
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
      finishReason: mapFinishReason(choice?.finish_reason),
      usage: {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
      },
    };
  }

  async *stream(
    prompt: string,
    tools: ToolSpec[],
    options: LLMCallOptions,
  ): AsyncIterable<LLMStreamEvent> {
    const params: ChatCompletionCreateParams = {
      model: options.model,
      messages: buildMessages(prompt, options.systemPrompt),
      stream: true,
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
      ...(tools.length > 0 ? { tools: toOpenAITools(tools), tool_choice: 'auto' } : {}),
    };

    const stream = await this.client.chat.completions.create(params, {
      headers: { ...ZERO_RETENTION_HEADER },
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
        { headers: { ...ZERO_RETENTION_HEADER } },
      );
      return true;
    } catch {
      return false;
    }
  }
}
