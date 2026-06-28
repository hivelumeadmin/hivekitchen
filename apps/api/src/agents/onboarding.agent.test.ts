import { describe, it, expect, vi } from 'vitest';
import type OpenAI from 'openai';
import { z } from 'zod';
import { ChildUpsertInputSchema, RuleSetInputSchema } from '@hivekitchen/contracts';
import { OnboardingAgent, type LlmMessage } from './onboarding.agent.js';
import { OpenAIAdapter } from './providers/openai.adapter.js';
import type {
  LLMCallOptions,
  LLMProvider,
  LLMResponse,
} from './providers/llm-provider.interface.js';
import type { ToolSpec } from './tools.manifest.js';

/**
 * Slice C — focused tests for the OnboardingAgent tool-call loop.
 *
 * Strategy: mock the OpenAI client's chat.completions.create to script a
 * sequence of responses (tool calls, then final prose). Verify the loop:
 *  - Dispatches each tool call to the right spec
 *  - Appends tool results back to the conversation
 *  - Returns the final assistant content + tool_calls_summary
 *  - Errors surface as JSON tool-result messages (don't throw)
 */

function makeToolSpec(name: string, fn: (input: unknown) => Promise<unknown>): ToolSpec {
  return {
    name,
    description: `Test tool: ${name}`,
    inputSchema: z.object({ payload: z.string() }),
    outputSchema: z.object({ ok: z.boolean() }),
    maxLatencyMs: 100,
    fn,
  };
}

function makeOpenAIMock(
  responses: Array<{
    content?: string | null;
    tool_calls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
    finish_reason?: 'stop' | 'tool_calls';
  }>,
): OpenAI {
  const create = vi.fn();
  for (const r of responses) {
    create.mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: 'assistant',
            content: r.content ?? null,
            tool_calls:
              r.tool_calls?.map((tc) => ({
                id: tc.id,
                type: 'function' as const,
                function: {
                  name: tc.name.replace(/\./g, '__'),
                  arguments: JSON.stringify(tc.args),
                },
              })) ?? undefined,
          },
          finish_reason: r.finish_reason ?? 'tool_calls',
        },
      ],
    });
  }
  return {
    chat: { completions: { create } },
  } as unknown as OpenAI;
}

describe('OnboardingAgent.respond — single-shot (legacy)', () => {
  it('voice mode: returns content from one chat completion', async () => {
    const openai = makeOpenAIMock([{ content: 'Hello, who is in your family?', finish_reason: 'stop' }]);
    const agent = new OnboardingAgent(new OpenAIAdapter(openai));
    const result = await agent.respond([{ role: 'user', content: 'hi' }], { modality: 'voice' });
    expect(result.text).toBe('Hello, who is in your family?');
    expect(result.complete).toBe(false);
    expect(result.toolCallsSummary).toBeUndefined();
  });

  it('voice mode: detects [SESSION_COMPLETE] sentinel and strips it', async () => {
    const openai = makeOpenAIMock([
      {
        content:
          "[warmly] That's everything I needed — let me put together your first plan.[SESSION_COMPLETE]",
        finish_reason: 'stop',
      },
    ]);
    const agent = new OnboardingAgent(new OpenAIAdapter(openai));
    const result = await agent.respond([{ role: 'user', content: 'yes' }], { modality: 'voice' });
    expect(result.complete).toBe(true);
    expect(result.text).not.toContain('[SESSION_COMPLETE]');
  });

  it('text mode with no tools: returns content unchanged (legacy path)', async () => {
    const openai = makeOpenAIMock([{ content: 'Tell me about your family.', finish_reason: 'stop' }]);
    const agent = new OnboardingAgent(new OpenAIAdapter(openai));
    const result = await agent.respond([{ role: 'user', content: 'hello' }], { modality: 'text' });
    expect(result.text).toBe('Tell me about your family.');
    expect(result.toolCallsSummary).toBeUndefined();
  });
});

describe('OnboardingAgent.respond — tool-call loop', () => {
  it('dispatches a single tool call, then returns final prose with summary', async () => {
    const childFn = vi.fn().mockResolvedValue({ child_id: 'c-1', name: 'Layla', was_existing: false });
    const childSpec = makeToolSpec('child.upsert', childFn);

    const openai = makeOpenAIMock([
      {
        tool_calls: [
          { id: 'call_1', name: 'child.upsert', args: { payload: 'Layla' } },
        ],
        finish_reason: 'tool_calls',
      },
      {
        content: "Great — what's a typical Friday like in your house?",
        finish_reason: 'stop',
      },
    ]);

    const agent = new OnboardingAgent(new OpenAIAdapter(openai));
    const result = await agent.respond([{ role: 'user', content: 'My daughter is Layla' }], {
      modality: 'text',
      tools: [childSpec],
    });

    expect(childFn).toHaveBeenCalledTimes(1);
    expect(result.text).toContain('Friday');
    expect(result.toolCallsSummary).toHaveLength(1);
    expect(result.toolCallsSummary?.[0]).toMatchObject({ tool: 'child.upsert', error: false });
  });

  it('dispatches multiple tool calls in one iteration', async () => {
    const childFn = vi.fn().mockResolvedValue({ child_id: 'c-1', was_existing: false });
    const memoryFn = vi.fn().mockResolvedValue({ node_id: 'n-1', created_at: '2026-05-14T00:00:00Z' });

    const openai = makeOpenAIMock([
      {
        tool_calls: [
          { id: 'call_1', name: 'child.upsert', args: { payload: 'A' } },
          { id: 'call_2', name: 'memory.note', args: { payload: 'B' } },
        ],
        finish_reason: 'tool_calls',
      },
      { content: 'Got it.', finish_reason: 'stop' },
    ]);

    const agent = new OnboardingAgent(new OpenAIAdapter(openai));
    const result = await agent.respond([{ role: 'user', content: 'My daughter Layla loves rice' }], {
      modality: 'text',
      tools: [makeToolSpec('child.upsert', childFn), makeToolSpec('memory.note', memoryFn)],
    });

    expect(childFn).toHaveBeenCalled();
    expect(memoryFn).toHaveBeenCalled();
    expect(result.toolCallsSummary).toHaveLength(2);
  });

  it('surfaces tool errors as JSON tool-results without throwing', async () => {
    const failingFn = vi.fn().mockRejectedValue(new Error('Unknown allergen tag: unicorn'));

    const openai = makeOpenAIMock([
      {
        tool_calls: [{ id: 'call_1', name: 'child.upsert', args: { payload: 'bad' } }],
        finish_reason: 'tool_calls',
      },
      {
        content: "Sorry, I'm not sure I caught that — could you say it again?",
        finish_reason: 'stop',
      },
    ]);

    const agent = new OnboardingAgent(new OpenAIAdapter(openai));
    const result = await agent.respond([{ role: 'user', content: 'something allergic' }], {
      modality: 'text',
      tools: [makeToolSpec('child.upsert', failingFn)],
    });

    expect(result.text).toContain('Sorry');
    expect(result.toolCallsSummary).toMatchObject([{ tool: 'child.upsert', error: true }]);
  });

  it('records "Unknown tool" error when agent calls a non-existent tool', async () => {
    const openai = makeOpenAIMock([
      {
        tool_calls: [{ id: 'call_1', name: 'phantom.tool', args: {} }],
        finish_reason: 'tool_calls',
      },
      { content: 'OK.', finish_reason: 'stop' },
    ]);

    const agent = new OnboardingAgent(new OpenAIAdapter(openai));
    const result = await agent.respond([{ role: 'user', content: 'hi' }], {
      modality: 'text',
      tools: [makeToolSpec('child.upsert', vi.fn())],
    });

    expect(result.toolCallsSummary).toMatchObject([{ tool: 'phantom.tool', error: true }]);
  });

  it('returns final prose when no tool calls are issued (zero-tool iteration)', async () => {
    const openai = makeOpenAIMock([
      { content: 'Tell me about your family rhythms.', finish_reason: 'stop' },
    ]);

    const agent = new OnboardingAgent(new OpenAIAdapter(openai));
    const result = await agent.respond([{ role: 'user', content: 'hi' }], {
      modality: 'text',
      tools: [makeToolSpec('child.upsert', vi.fn())],
    });

    expect(result.text).toBe('Tell me about your family rhythms.');
    expect(result.toolCallsSummary).toEqual([]);
  });

  it('voice mode ignores tools (legacy single-shot)', async () => {
    const childFn = vi.fn();
    const openai = makeOpenAIMock([{ content: 'Hello.', finish_reason: 'stop' }]);
    const agent = new OnboardingAgent(new OpenAIAdapter(openai));
    const result = await agent.respond([{ role: 'user', content: 'hi' }], {
      modality: 'voice',
      tools: [makeToolSpec('child.upsert', childFn)],
    });
    expect(childFn).not.toHaveBeenCalled();
    expect(result.toolCallsSummary).toBeUndefined();
  });
});

// ===========================================================================
// Slice 2.7-s2 — strict tool schemas + null-strip
// ===========================================================================
// Routes onboarding's tool serialization through the planner's strict adapter
// (toStrictJsonSchemaParameters) and strips model-emitted nulls before the
// handler's Zod parse. These tests pin both halves end-to-end through respond().

// A mock that records every chat.completions.create call so we can inspect the
// `tools` param the agent actually emitted.
function makeRecordingOpenAIMock(
  responses: Array<{
    content?: string | null;
    tool_calls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
    finish_reason?: 'stop' | 'tool_calls';
  }>,
): { openai: OpenAI; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn();
  for (const r of responses) {
    create.mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: 'assistant',
            content: r.content ?? null,
            tool_calls:
              r.tool_calls?.map((tc) => ({
                id: tc.id,
                type: 'function' as const,
                function: { name: tc.name.replace(/\./g, '__'), arguments: JSON.stringify(tc.args) },
              })) ?? undefined,
          },
          finish_reason: r.finish_reason ?? 'tool_calls',
        },
      ],
    });
  }
  return { openai: { chat: { completions: { create } } } as unknown as OpenAI, create };
}

// Build a ToolSpec backed by a REAL contract schema so the strict transform and
// the handler-side Zod parse exercise the production shapes.
function realSchemaToolSpec(
  name: string,
  inputSchema: ToolSpec['inputSchema'],
  fn: (input: unknown) => Promise<unknown>,
): ToolSpec {
  return {
    name,
    description: `Real-schema tool: ${name}`,
    inputSchema,
    outputSchema: z.object({ ok: z.boolean() }),
    maxLatencyMs: 100,
    fn,
  };
}

describe('OnboardingAgent — strict tool serialization (2.7-s2)', () => {
  it('emits tools with strict:true, additionalProperties:false, every prop required', async () => {
    const { openai, create } = makeRecordingOpenAIMock([
      { content: 'Hi there.', finish_reason: 'stop' },
    ]);
    const agent = new OnboardingAgent(new OpenAIAdapter(openai));
    await agent.respond([{ role: 'user', content: 'hello' }], {
      modality: 'text',
      tools: [realSchemaToolSpec('child.upsert', ChildUpsertInputSchema, vi.fn())],
    });

    const params = create.mock.calls[0]?.[0] as {
      tools: Array<{ function: { name: string; strict?: boolean; parameters: Record<string, unknown> } }>;
    };
    const fn = params.tools[0].function;
    expect(fn.name).toBe('child__upsert');
    expect(fn.strict).toBe(true);
    expect(fn.parameters.additionalProperties).toBe(false);

    // OpenAI strict mode requires EVERY property in `required` — including the
    // originally-optional ones.
    const required = fn.parameters.required as string[];
    const props = Object.keys(fn.parameters.properties as Record<string, unknown>);
    expect(new Set(required)).toEqual(new Set(props));
    expect(required).toContain('school_policy_notes');
    expect(required).toContain('declared_allergens');
  });

  it('serializes originally-optional fields as anyOf:[…, null] (nullable rule)', async () => {
    const { openai, create } = makeRecordingOpenAIMock([
      { content: 'Hi.', finish_reason: 'stop' },
    ]);
    const agent = new OnboardingAgent(new OpenAIAdapter(openai));
    await agent.respond([{ role: 'user', content: 'hello' }], {
      modality: 'text',
      tools: [realSchemaToolSpec('child.upsert', ChildUpsertInputSchema, vi.fn())],
    });

    const params = create.mock.calls[0]?.[0] as {
      tools: Array<{ function: { parameters: { properties: Record<string, { anyOf?: Array<{ type?: string }> }> } } }>;
    };
    const props = params.tools[0].function.parameters.properties;
    const allergenBranches = props.declared_allergens.anyOf ?? [];
    expect(allergenBranches.some((b) => b.type === 'null')).toBe(true);
  });

  it('keeps open-vocab tag fields as loose strings, not strict enums (AC3)', async () => {
    const { openai, create } = makeRecordingOpenAIMock([
      { content: 'Hi.', finish_reason: 'stop' },
    ]);
    const agent = new OnboardingAgent(new OpenAIAdapter(openai));
    await agent.respond([{ role: 'user', content: 'hello' }], {
      modality: 'text',
      tools: [realSchemaToolSpec('child.upsert', ChildUpsertInputSchema, vi.fn())],
    });

    const params = create.mock.calls[0]?.[0] as {
      tools: Array<{ function: { parameters: { properties: Record<string, { anyOf?: Array<Record<string, unknown>> }> } } }>;
    };
    const props = params.tools[0].function.parameters.properties;
    // declared_allergens is an array of free strings — its non-null branch must
    // be an array with string items, never an enum of fixed tag values.
    const arrayBranch = (props.declared_allergens.anyOf ?? []).find((b) => b.type === 'array') as
      | { items?: { enum?: unknown; type?: string } }
      | undefined;
    expect(arrayBranch?.items?.enum).toBeUndefined();
    expect(arrayBranch?.items?.type).toBe('string');
  });
});

describe('OnboardingAgent — null-strip before handler parse (2.7-s2)', () => {
  it('strips model-emitted nulls so a previously-bounced payload parses on first call (AC2/AC4)', async () => {
    let received: unknown;
    const childFn = vi.fn(async (input: unknown) => {
      received = input;
      // The REAL handler re-parses; declared_allergens is .optional() (NOT
      // nullable), so an unstripped explicit null would throw here.
      ChildUpsertInputSchema.parse(input);
      return { child_id: 'c-1', name: 'Layla', was_existing: false };
    });

    const openai = makeOpenAIMock([
      {
        tool_calls: [
          {
            id: 'call_1',
            name: 'child.upsert',
            // Strict mode forces every field present → the model fills the ones
            // it has no value for with null.
            args: {
              name: 'Layla',
              age_band: 'child',
              school_policy_notes: null,
              declared_allergens: null,
              cultural_identifiers: null,
              dietary_preferences: null,
              bag_composition_pattern: null,
            },
          },
        ],
        finish_reason: 'tool_calls',
      },
      { content: 'Great.', finish_reason: 'stop' },
    ]);

    const agent = new OnboardingAgent(new OpenAIAdapter(openai));
    const result = await agent.respond([{ role: 'user', content: 'My daughter is Layla' }], {
      modality: 'text',
      tools: [realSchemaToolSpec('child.upsert', ChildUpsertInputSchema, childFn)],
    });

    // First-call success — no error round-trip.
    expect(result.toolCallsSummary).toMatchObject([{ tool: 'child.upsert', error: false }]);
    // Null-valued keys were removed before the handler saw the args.
    expect(received).not.toHaveProperty('declared_allergens');
    expect(received).not.toHaveProperty('school_policy_notes');
    expect(received).toMatchObject({ name: 'Layla', age_band: 'child' });
  });

  it('null-strip preserves the handler-side .refine guard (rule.set custom xor) (AC5)', async () => {
    const ruleFn = vi.fn(async (input: unknown) => {
      // RuleSetInputSchema.refine: custom_label is required when rule_type=custom.
      RuleSetInputSchema.parse(input);
      return { household_rule_id: 'r-1', was_existing: false };
    });

    const openai = makeOpenAIMock([
      {
        tool_calls: [
          {
            id: 'call_1',
            name: 'rule.set',
            // custom rule but the model emitted null for the label — after the
            // strip the field is absent and the .refine must still reject it.
            args: { rule_type: 'custom', custom_label: null },
          },
        ],
        finish_reason: 'tool_calls',
      },
      { content: 'Sorry, could you tell me the rule again?', finish_reason: 'stop' },
    ]);

    const agent = new OnboardingAgent(new OpenAIAdapter(openai));
    const result = await agent.respond([{ role: 'user', content: 'we have a custom rule' }], {
      modality: 'text',
      tools: [realSchemaToolSpec('rule.set', RuleSetInputSchema, ruleFn)],
    });

    expect(result.toolCallsSummary).toMatchObject([{ tool: 'rule.set', error: true }]);
  });
});

// ===========================================================================
// Slice 2.7-s4 — provider seam + per-call tier selection
// ===========================================================================
// The agent now talks to the LLMProvider interface. These tests use a recording
// fake provider (NOT the OpenAI adapter) so the per-call `tier` / option choices
// are directly assertable: the conversational turn stays on the strong tier with
// strict tools (AC1), while the three classifier/extractor calls drop to the
// cheap tier (AC2/AC5). The dormant voice single-shot path stays strong (AC6).

function llmResponse(partial: Partial<LLMResponse>): LLMResponse {
  return {
    content: null,
    toolCalls: [],
    finishReason: 'stop',
    usage: { promptTokens: 0, completionTokens: 0, cachedPromptTokens: 0 },
    ...partial,
  };
}

function makeRecordingProvider(scripted: LLMResponse[]): {
  provider: LLMProvider;
  calls: Array<{ method: 'complete' | 'completeWithMessages'; options: LLMCallOptions }>;
} {
  const calls: Array<{ method: 'complete' | 'completeWithMessages'; options: LLMCallOptions }> = [];
  let cursor = 0;
  const next = (): LLMResponse => scripted[Math.min(cursor++, scripted.length - 1)]!;
  const provider: LLMProvider = {
    name: 'recording',
    complete: async (_prompt, _tools, options) => {
      calls.push({ method: 'complete', options });
      return next();
    },
    completeWithMessages: async (_messages, _tools, options) => {
      calls.push({ method: 'completeWithMessages', options });
      return next();
    },
    stream: async function* () {
      throw new Error('not used');
    },
    probe: async () => true,
    supportsStrictTools: () => true,
  };
  return { provider, calls };
}

describe('OnboardingAgent — provider seam + tier selection (2.7-s4)', () => {
  it('routes the conversational tool-loop turn through the strong tier with strict tools', async () => {
    const { provider, calls } = makeRecordingProvider([
      llmResponse({ content: 'Hi there.', finishReason: 'stop' }),
    ]);
    const agent = new OnboardingAgent(provider);

    await agent.respond([{ role: 'user', content: 'hello' }], {
      modality: 'text',
      tools: [makeToolSpec('child.upsert', vi.fn())],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('completeWithMessages');
    expect(calls[0]!.options.tier).toBe('flagship');
    expect(calls[0]!.options.strictAllTools).toBe(true);
  });

  it('runs the dormant voice single-shot path on the strong tier (AC6)', async () => {
    const { provider, calls } = makeRecordingProvider([
      llmResponse({ content: 'Done.[SESSION_COMPLETE]', finishReason: 'stop' }),
    ]);
    const agent = new OnboardingAgent(provider);

    const result = await agent.respond([{ role: 'user', content: 'yes' }], { modality: 'voice' });

    expect(result.complete).toBe(true);
    expect(result.text).not.toContain('[SESSION_COMPLETE]');
    expect(calls[0]!.method).toBe('completeWithMessages');
    expect(calls[0]!.options.tier).toBe('flagship');
  });

  it('runs isSummaryConfirmed on the cheap tier (5-token yes/no)', async () => {
    const { provider, calls } = makeRecordingProvider([llmResponse({ content: 'yes' })]);
    const agent = new OnboardingAgent(provider);
    const history: LlmMessage[] = Array.from({ length: 6 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `m${String(i)}`,
    }));

    const confirmed = await agent.isSummaryConfirmed(history);

    expect(confirmed).toBe(true);
    expect(calls[0]!.method).toBe('complete');
    expect(calls[0]!.options.tier).toBe('mini');
    expect(calls[0]!.options.maxTokens).toBe(5);
  });

  it('keeps isSummaryConfirmed strict (verdict !== "yes" on the cheap tier returns false)', async () => {
    const { provider } = makeRecordingProvider([llmResponse({ content: 'yes, but not really' })]);
    const agent = new OnboardingAgent(provider);
    const history: LlmMessage[] = Array.from({ length: 6 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `m${String(i)}`,
    }));

    expect(await agent.isSummaryConfirmed(history)).toBe(false);
  });

  it('runs extractSummary on the cheap tier with json_object response format', async () => {
    const { provider, calls } = makeRecordingProvider([
      llmResponse({
        content: JSON.stringify({
          cultural_templates: ['halal'],
          palate_notes: [],
          allergens_mentioned: [],
          family_rhythms: [],
        }),
      }),
    ]);
    const agent = new OnboardingAgent(provider);

    const summary = await agent.extractSummary([{ role: 'user', message: 'we keep halal' }]);

    expect(summary.cultural_templates).toEqual(['halal']);
    expect(calls[0]!.method).toBe('complete');
    expect(calls[0]!.options.tier).toBe('mini');
    expect(calls[0]!.options.responseFormat).toBe('json_object');
  });

  it('runs inferCulturalPriors on the cheap tier and still falls back to [] on failure', async () => {
    const okProvider = makeRecordingProvider([
      llmResponse({ content: JSON.stringify({ priors: [{ key: 'halal', confidence: 90, presence: 80 }] }) }),
    ]);
    const agent = new OnboardingAgent(okProvider.provider);

    const priors = await agent.inferCulturalPriors([{ role: 'user', message: 'we keep halal' }]);

    expect(priors).toHaveLength(1);
    expect(priors[0]!.key).toBe('halal');
    expect(okProvider.calls[0]!.options.tier).toBe('mini');
    expect(okProvider.calls[0]!.options.responseFormat).toBe('json_object');

    // Provider failure → silence-mode [] (UX-DR46), so a weaker model never regresses.
    const failing: LLMProvider = {
      name: 'failing',
      complete: async () => {
        throw new Error('mini-tier outage');
      },
      completeWithMessages: async () => {
        throw new Error('mini-tier outage');
      },
      stream: async function* () {
        throw new Error('not used');
      },
      probe: async () => true,
      supportsStrictTools: () => true,
    };
    const failAgent = new OnboardingAgent(failing);
    expect(await failAgent.inferCulturalPriors([{ role: 'user', message: 'x' }])).toEqual([]);
  });
});
