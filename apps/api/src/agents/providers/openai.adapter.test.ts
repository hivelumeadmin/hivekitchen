import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import type OpenAI from 'openai';
import { OpenAIAdapter, toStrictJsonSchemaParameters } from './openai.adapter.js';
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

  describe('slice B — tier resolution + cached prompt tokens', () => {
    it('resolves tier "flagship" to gpt-4o when no explicit model is passed', async () => {
      const create = vi.fn().mockResolvedValue(buildResponse({ content: 'ok' }));
      const adapter = new OpenAIAdapter(buildClient(create));
      await adapter.complete('hi', [], { tier: 'flagship' });
      const [params] = create.mock.calls[0] as [{ model: string }];
      expect(params.model).toBe('gpt-4o');
    });

    it('resolves tier "mini" to gpt-4o-mini', async () => {
      const create = vi.fn().mockResolvedValue(buildResponse({ content: 'ok' }));
      const adapter = new OpenAIAdapter(buildClient(create));
      await adapter.complete('hi', [], { tier: 'mini' });
      const [params] = create.mock.calls[0] as [{ model: string }];
      expect(params.model).toBe('gpt-4o-mini');
    });

    it('explicit model takes precedence over tier', async () => {
      const create = vi.fn().mockResolvedValue(buildResponse({ content: 'ok' }));
      const adapter = new OpenAIAdapter(buildClient(create));
      await adapter.complete('hi', [], { tier: 'mini', model: 'gpt-4o' });
      const [params] = create.mock.calls[0] as [{ model: string }];
      expect(params.model).toBe('gpt-4o');
    });

    it('falls back to gpt-4o when neither tier nor model is set (defensive default)', async () => {
      const create = vi.fn().mockResolvedValue(buildResponse({ content: 'ok' }));
      const adapter = new OpenAIAdapter(buildClient(create));
      await adapter.complete('hi', [], {} as LLMCallOptions);
      const [params] = create.mock.calls[0] as [{ model: string }];
      expect(params.model).toBe('gpt-4o');
    });

    it('extracts cachedPromptTokens from usage.prompt_tokens_details.cached_tokens', async () => {
      const create = vi.fn().mockResolvedValue({
        choices: [
          {
            finish_reason: 'stop',
            message: { role: 'assistant', content: 'ok' },
          },
        ],
        usage: {
          prompt_tokens: 4096,
          completion_tokens: 100,
          prompt_tokens_details: { cached_tokens: 3072 },
        },
      });
      const adapter = new OpenAIAdapter(buildClient(create));
      const result = await adapter.complete('hi', [], { tier: 'flagship' });
      expect(result.usage).toEqual({
        promptTokens: 4096,
        completionTokens: 100,
        cachedPromptTokens: 3072,
      });
    });

    it('reports cachedPromptTokens=0 when usage block omits prompt_tokens_details', async () => {
      const create = vi.fn().mockResolvedValue(buildResponse({ content: 'ok' }));
      const adapter = new OpenAIAdapter(buildClient(create));
      const result = await adapter.complete('hi', [], { tier: 'flagship' });
      expect(result.usage.cachedPromptTokens).toBe(0);
    });
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
      expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5, cachedPromptTokens: 0 });
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

  describe('storeCompletions (eval dataset accumulation)', () => {
    it('adds store=true to complete() params when storeCompletions=true', async () => {
      const create = vi.fn().mockResolvedValue(buildResponse({ content: 'ok' }));
      const adapter = new OpenAIAdapter(buildClient(create), { storeCompletions: true });

      await adapter.complete('hi', [], BASE_OPTIONS);

      const [params] = create.mock.calls[0] as [{ store?: boolean }];
      expect(params.store).toBe(true);
    });

    it('adds metadata to complete() params when storeCompletions=true and metadata is set', async () => {
      const create = vi.fn().mockResolvedValue(buildResponse({ content: 'ok' }));
      const adapter = new OpenAIAdapter(buildClient(create), { storeCompletions: true });
      const metadata = { agent_type: 'planner', prompt_version: 'v1.5.0' };

      await adapter.complete('hi', [], { ...BASE_OPTIONS, metadata });

      const [params] = create.mock.calls[0] as [{ metadata?: Record<string, string> }];
      expect(params.metadata).toEqual(metadata);
    });

    it('omits store and metadata from complete() when storeCompletions=false (default)', async () => {
      const create = vi.fn().mockResolvedValue(buildResponse({ content: 'ok' }));
      const adapter = new OpenAIAdapter(buildClient(create));

      await adapter.complete('hi', [], { ...BASE_OPTIONS, metadata: { agent_type: 'planner' } });

      const [params] = create.mock.calls[0] as [{ store?: boolean; metadata?: unknown }];
      expect(params.store).toBeUndefined();
      expect(params.metadata).toBeUndefined();
    });

    it('drops the ZDR header when storeCompletions=true', async () => {
      const create = vi.fn().mockResolvedValue(buildResponse({ content: 'ok' }));
      const adapter = new OpenAIAdapter(buildClient(create), { storeCompletions: true });

      await adapter.complete('hi', [], BASE_OPTIONS);

      const [, requestOptions] = create.mock.calls[0] as [
        unknown,
        { headers?: Record<string, string> } | undefined,
      ];
      expect(requestOptions?.headers?.['OpenAI-Data-Privacy']).toBeUndefined();
    });

    it('adds store=true to completeWithMessages() when storeCompletions=true', async () => {
      const create = vi.fn().mockResolvedValue(buildResponse({ content: 'ok' }));
      const adapter = new OpenAIAdapter(buildClient(create), { storeCompletions: true });

      await adapter.completeWithMessages(
        [{ role: 'user', content: 'hi' }],
        [],
        { ...BASE_OPTIONS, metadata: { agent_type: 'swap', prompt_version: 'v1.0.0' } },
      );

      const [params] = create.mock.calls[0] as [{ store?: boolean; metadata?: Record<string, string> }];
      expect(params.store).toBe(true);
      expect(params.metadata).toEqual({ agent_type: 'swap', prompt_version: 'v1.0.0' });
    });

    it('probe() never sends store=true even when storeCompletions=true', async () => {
      const create = vi.fn().mockResolvedValue(buildResponse({ content: 'pong' }));
      const adapter = new OpenAIAdapter(buildClient(create), { storeCompletions: true });

      await adapter.probe();

      const [params] = create.mock.calls[0] as [{ store?: boolean }];
      expect(params.store).toBeUndefined();
    });

    it('probe() still drops ZDR when storeCompletions=true (health checks are not stored but do not need ZDR)', async () => {
      const create = vi.fn().mockResolvedValue(buildResponse({ content: 'pong' }));
      const adapter = new OpenAIAdapter(buildClient(create), { storeCompletions: true });

      await adapter.probe();

      const [, requestOptions] = create.mock.calls[0] as [
        unknown,
        { headers?: Record<string, string> } | undefined,
      ];
      // probe() explicitly sets storeCompletions=false in its header call,
      // so ZDR is sent (probe uses the same ZDR-on path as the default).
      expect(requestOptions?.headers?.['OpenAI-Data-Privacy']).toBe('zero-retention');
    });
  });

  describe('tracesEnabled (env-gated ZDR toggle)', () => {
    it('omits OpenAI-Data-Privacy when tracesEnabled=true (dashboard logs requests)', async () => {
      const create = vi.fn().mockResolvedValue(buildResponse({ content: 'ok' }));
      const adapter = new OpenAIAdapter(buildClient(create), { tracesEnabled: true });

      await adapter.complete('hi', [], BASE_OPTIONS);

      const [, requestOptions] = create.mock.calls[0] as [
        unknown,
        { headers?: Record<string, string> } | undefined,
      ];
      expect(requestOptions?.headers?.['OpenAI-Data-Privacy']).toBeUndefined();
    });

    it('sends OpenAI-Data-Privacy=zero-retention when tracesEnabled=false (default)', async () => {
      const create = vi.fn().mockResolvedValue(buildResponse({ content: 'ok' }));
      const adapter = new OpenAIAdapter(buildClient(create), { tracesEnabled: false });

      await adapter.complete('hi', [], BASE_OPTIONS);

      const [, requestOptions] = create.mock.calls[0] as [
        unknown,
        { headers?: Record<string, string> } | undefined,
      ];
      expect(requestOptions?.headers?.['OpenAI-Data-Privacy']).toBe('zero-retention');
    });

    it('also drops the header on completeWithMessages when tracesEnabled=true', async () => {
      const create = vi.fn().mockResolvedValue(buildResponse({ content: 'ok' }));
      const adapter = new OpenAIAdapter(buildClient(create), { tracesEnabled: true });

      await adapter.completeWithMessages(
        [{ role: 'user', content: 'hi' }],
        [],
        BASE_OPTIONS,
      );

      const [, requestOptions] = create.mock.calls[0] as [
        unknown,
        { headers?: Record<string, string> } | undefined,
      ];
      expect(requestOptions?.headers?.['OpenAI-Data-Privacy']).toBeUndefined();
    });

    it('also drops the header on probe() when tracesEnabled=true', async () => {
      const create = vi.fn().mockResolvedValue(buildResponse({ content: 'pong' }));
      const adapter = new OpenAIAdapter(buildClient(create), { tracesEnabled: true });

      await adapter.probe();

      const [, requestOptions] = create.mock.calls[0] as [
        unknown,
        { headers?: Record<string, string> } | undefined,
      ];
      expect(requestOptions?.headers?.['OpenAI-Data-Privacy']).toBeUndefined();
    });
  });

  describe('slice 3.5-s2 — strict structured output (forcedToolName)', () => {
    const STRICT_SCHEMA = z.object({
      household_id: z.string(),
      nested: z.object({ a: z.number(), b: z.string() }),
      list: z.array(z.object({ c: z.boolean() })),
      optionalField: z.string().optional(),
    });

    function strictTool(name = 'plan.compose'): ToolSpec {
      return {
        name,
        description: 'compose the plan',
        inputSchema: STRICT_SCHEMA,
        outputSchema: STRICT_SCHEMA,
        maxLatencyMs: 4000,
        fn: vi.fn(),
      };
    }

    describe('toStrictJsonSchemaParameters', () => {
      it('adds additionalProperties:false on the root and every nested object', () => {
        const params = toStrictJsonSchemaParameters(strictTool());
        const props = params.properties as Record<string, Record<string, unknown>>;
        expect(params.additionalProperties).toBe(false);
        expect(props.nested.additionalProperties).toBe(false);
        expect((props.list.items as Record<string, unknown>).additionalProperties).toBe(false);
      });

      it('moves every property — including optionals — into required at each object level', () => {
        const params = toStrictJsonSchemaParameters(strictTool());
        const props = params.properties as Record<string, Record<string, unknown>>;
        expect(params.required).toEqual(
          expect.arrayContaining(['household_id', 'nested', 'list', 'optionalField']),
        );
        expect(params.required).toHaveLength(4);
        expect(props.nested.required).toEqual(expect.arrayContaining(['a', 'b']));
      });

      it('leaves non-object nodes (string, number, array shell) unmodified', () => {
        const params = toStrictJsonSchemaParameters(strictTool());
        const props = params.properties as Record<string, Record<string, unknown>>;
        expect(props.household_id.type).toBe('string');
        expect(props.household_id.additionalProperties).toBeUndefined();
        expect(props.list.type).toBe('array');
        expect(props.list.additionalProperties).toBeUndefined();
      });

      it('strips the $schema draft marker', () => {
        const params = toStrictJsonSchemaParameters(strictTool());
        expect('$schema' in params).toBe(false);
      });
    });

    it('forces tool_choice to the named tool and marks only it strict', async () => {
      const create = vi.fn().mockResolvedValue(buildResponse({ content: 'ok' }));
      const adapter = new OpenAIAdapter(buildClient(create));

      await adapter.completeWithMessages(
        [{ role: 'user', content: 'go' }],
        [strictTool('plan.compose'), strictTool('recipe.search')],
        { ...BASE_OPTIONS, forcedToolName: 'plan.compose' },
      );

      const [params] = create.mock.calls[0] as [
        {
          tool_choice: { type: string; function: { name: string } };
          tools: Array<{ function: { name: string; strict?: boolean } }>;
        },
      ];
      expect(params.tool_choice).toEqual({ type: 'function', function: { name: 'plan__compose' } });
      const composeTool = params.tools.find((t) => t.function.name === 'plan__compose');
      const searchTool = params.tools.find((t) => t.function.name === 'recipe__search');
      expect(composeTool?.function.strict).toBe(true);
      expect(searchTool?.function.strict).toBeUndefined();
    });

    it('keeps tool_choice "auto" and omits strict when forcedToolName is absent', async () => {
      const create = vi.fn().mockResolvedValue(buildResponse({ content: 'ok' }));
      const adapter = new OpenAIAdapter(buildClient(create));

      await adapter.completeWithMessages(
        [{ role: 'user', content: 'go' }],
        [strictTool('plan.compose')],
        BASE_OPTIONS,
      );

      const [params] = create.mock.calls[0] as [
        { tool_choice: unknown; tools: Array<{ function: { strict?: boolean } }> },
      ];
      expect(params.tool_choice).toBe('auto');
      expect(params.tools[0]?.function.strict).toBeUndefined();
    });

    it('reports supportsStrictTools() === true', () => {
      const adapter = new OpenAIAdapter(buildClient(vi.fn()));
      expect(adapter.supportsStrictTools()).toBe(true);
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
