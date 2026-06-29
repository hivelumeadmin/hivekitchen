import { describe, it, expect } from 'vitest';
import type {
  LLMProvider,
  LLMResponse,
  LLMCallOptions,
} from './providers/llm-provider.interface.js';
import type { ToolSpec } from './tools.manifest.js';
import { routePlanIntent, PLAN_INTENT } from './route-plan-intent.js';

interface Captured {
  prompt: string;
  tools: ToolSpec[];
  options: LLMCallOptions;
}

function fakeProvider(
  toolArgs: unknown | null,
  capture?: (c: Captured) => void,
): LLMProvider {
  const response: LLMResponse = {
    content: null,
    toolCalls:
      toolArgs === null ? [] : [{ id: 'tc1', name: 'plan.route', arguments: toolArgs }],
    finishReason: 'tool_calls',
    usage: { promptTokens: 0, completionTokens: 0, cachedPromptTokens: 0 },
  };
  return {
    name: 'fake',
    complete: (prompt, tools, options) => {
      capture?.({ prompt, tools, options });
      return Promise.resolve(response);
    },
    completeWithMessages: () => Promise.reject(new Error('unused')),
    stream: async function* () {
      throw new Error('unused');
    },
    probe: () => Promise.resolve(true),
    supportsStrictTools: () => true,
  };
}

describe('routePlanIntent', () => {
  it('parses a valid forced-tool call into a PlanIntentResult', async () => {
    const provider = fakeProvider({
      intent: 'swap_slot',
      confidence: 0.92,
      day: 'tue',
      slotKind: 'main',
      childId: 'child-maya',
    });
    const result = await routePlanIntent("Maya's bored of Tuesday's main", undefined, provider);
    expect(result).toEqual({
      intent: 'swap_slot',
      confidence: 0.92,
      day: 'tue',
      slotKind: 'main',
      childId: 'child-maya',
    });
  });

  it('strips explicit nulls before Zod (the strict-mode rule)', async () => {
    // Strict mode emits absent optionals as null; they must validate as absent.
    const provider = fakeProvider({
      intent: 'commit',
      confidence: 0.8,
      day: null,
      slotKind: null,
      childId: null,
      constraint: null,
      variation: null,
      dishQuery: null,
      scope: null,
    });
    const result = await routePlanIntent('confirm the week', undefined, provider);
    expect(result).toEqual({ intent: 'commit', confidence: 0.8 });
  });

  it('forces the route tool at the mini tier and passes context in the system prompt', async () => {
    let captured: Captured | undefined;
    const provider = fakeProvider(
      { intent: 'inspect', confidence: 1 },
      (c) => {
        captured = c;
      },
    );
    await routePlanIntent('show me Tuesday', {
      weekLabel: 'Mon 29 Jun – Fri 3 Jul',
      children: [{ id: 'c1', name: 'Maya' }],
      days: [{ day: 'tue', mainTitle: 'Wraps' }],
    }, provider);

    expect(captured?.options.tier).toBe('mini');
    expect(captured?.options.forcedToolName).toBe('plan.route');
    expect(captured?.tools[0]?.name).toBe('plan.route');
    expect(captured?.prompt).toBe('show me Tuesday');
    // context rendered for child/day resolution
    expect(captured?.options.systemPrompt).toContain('Maya=c1');
    expect(captured?.options.systemPrompt).toContain('tue (Wraps)');
  });

  it('passes a normalized exclude constraint through', async () => {
    const provider = fakeProvider({
      intent: 'exclude_filter',
      confidence: 0.7,
      constraint: 'exclude:fish',
    });
    const result = await routePlanIntent('no fish this week', undefined, provider);
    expect(result.intent).toBe('exclude_filter');
    expect(result.constraint).toBe('exclude:fish');
  });

  it('falls back (no throw) when the model returns no tool call', async () => {
    const result = await routePlanIntent('???', undefined, fakeProvider(null));
    expect(result).toEqual({ intent: PLAN_INTENT.FALLBACK, confidence: 0 });
  });

  it('falls back when the tool args are schema-invalid', async () => {
    const provider = fakeProvider({ intent: 'not_a_real_intent', confidence: 0.5 });
    const result = await routePlanIntent('weird', undefined, provider);
    expect(result.intent).toBe('fallback');
  });
});
