import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import type OpenAI from 'openai';
import { OpenAIAdapter } from './openai.adapter.js';
import type { LLMCallOptions } from './llm-provider.interface.js';
import type { ToolSpec } from '../tools.manifest.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';

const BASE_OPTIONS: LLMCallOptions = {
  model: 'gpt-4o',
  temperature: 0.2,
  maxTokens: 256,
};

function buildClient(create: ReturnType<typeof vi.fn>): OpenAI {
  return {
    chat: {
      completions: { create },
    },
  } as unknown as OpenAI;
}

function buildResponse(overrides: {
  content?: string | null;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  finishReason?: string;
}) {
  const tool_calls = overrides.toolCalls?.map((c) => ({
    id: c.id,
    type: 'function' as const,
    function: { name: c.name, arguments: c.arguments },
  }));
  return {
    choices: [
      {
        finish_reason: overrides.finishReason ?? 'stop',
        message: {
          role: 'assistant',
          content: overrides.content ?? null,
          ...(tool_calls ? { tool_calls } : {}),
        },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  };
}

describe('OpenAIAdapter', () => {
  it('exposes the provider name "openai"', () => {
    const adapter = new OpenAIAdapter(buildClient(vi.fn()));
    expect(adapter.name).toBe('openai');
  });

  describe('complete()', () => {
    it('calls chat.completions.create with no tools when toolset is empty', async () => {
      const create = vi.fn().mockResolvedValue(buildResponse({ content: 'hello' }));
      const adapter = new OpenAIAdapter(buildClient(create));

      const result = await adapter.complete('say hi', [], BASE_OPTIONS);

      expect(create).toHaveBeenCalledTimes(1);
      const [params, requestOptions] = create.mock.calls[0] as [
        { tools?: unknown; messages: Array<{ role: string }> },
        { headers?: Record<string, string> } | undefined,
      ];
      expect(params.tools).toBeUndefined();
      expect(params.messages[0]).toEqual({ role: 'user', content: 'say hi' });
      expect(requestOptions?.headers?.['OpenAI-Data-Privacy']).toBe('zero-retention');
      expect(result.finishReason).toBe('stop');
      expect(result.toolCalls).toEqual([]);
      expect(result.content).toBe('hello');
      expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5 });
    });

    it('passes a system prompt as the first message when provided', async () => {
      const create = vi.fn().mockResolvedValue(buildResponse({ content: 'ok' }));
      const adapter = new OpenAIAdapter(buildClient(create));

      await adapter.complete('user-text', [], { ...BASE_OPTIONS, systemPrompt: 'be brief' });

      const [params] = create.mock.calls[0] as [{ messages: Array<{ role: string; content: string }> }];
      expect(params.messages).toEqual([
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'user-text' },
      ]);
    });

    it('returns finishReason "tool_calls" with parsed toolCalls when the model invokes a tool', async () => {
      const args = JSON.stringify({ household_id: HOUSEHOLD_ID });
      const create = vi.fn().mockResolvedValue(
        buildResponse({
          finishReason: 'tool_calls',
          toolCalls: [{ id: 'call_1', name: 'allergy__check', arguments: args }],
        }),
      );
      const adapter = new OpenAIAdapter(buildClient(create));
      const inputSchema = z.object({ household_id: z.string().uuid() });
      const tool: ToolSpec = {
        name: 'allergy.check',
        description: 'advisory allergy check',
        inputSchema,
        outputSchema: inputSchema,
        maxLatencyMs: 150,
        fn: vi.fn(),
      };

      const result = await adapter.complete('check it', [tool], BASE_OPTIONS);

      const [params] = create.mock.calls[0] as [
        {
          tools: Array<{ type: string; function: { name: string; parameters: unknown } }>;
          tool_choice: string;
        },
      ];
      expect(params.tools).toHaveLength(1);
      // Dotted internal name is rewritten with underscores when the spec
      // crosses the SDK boundary, then mapped back when extracting tool calls.
      expect(params.tools[0]?.function.name).toBe('allergy__check');
      expect(params.tool_choice).toBe('auto');

      expect(result.finishReason).toBe('tool_calls');
      expect(result.toolCalls).toEqual([
        { id: 'call_1', name: 'allergy.check', arguments: { household_id: HOUSEHOLD_ID } },
      ]);
    });

    it('re-throws when the SDK call fails', async () => {
      const create = vi.fn().mockRejectedValue(new Error('upstream-down'));
      const adapter = new OpenAIAdapter(buildClient(create));

      await expect(adapter.complete('hi', [], BASE_OPTIONS)).rejects.toThrow('upstream-down');
    });

    it('maps an unknown finish_reason to "error"', async () => {
      const create = vi
        .fn()
        .mockResolvedValue(buildResponse({ finishReason: 'unexpected', content: null }));
      const adapter = new OpenAIAdapter(buildClient(create));

      const result = await adapter.complete('hi', [], BASE_OPTIONS);

      expect(result.finishReason).toBe('error');
    });
  });

  describe('probe()', () => {
    it('returns true when the SDK call succeeds', async () => {
      const create = vi.fn().mockResolvedValue(buildResponse({ content: 'pong' }));
      const adapter = new OpenAIAdapter(buildClient(create));

      await expect(adapter.probe()).resolves.toBe(true);

      const [params] = create.mock.calls[0] as [{ model: string; max_tokens?: number }];
      expect(params.model).toBe('gpt-4o-mini');
      expect(params.max_tokens).toBe(1);
    });

    it('returns false when the SDK call throws', async () => {
      const create = vi.fn().mockRejectedValue(new Error('network'));
      const adapter = new OpenAIAdapter(buildClient(create));

      await expect(adapter.probe()).resolves.toBe(false);
    });
  });
});
