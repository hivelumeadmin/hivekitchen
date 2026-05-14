import { describe, it, expect, vi } from 'vitest';
import type OpenAI from 'openai';
import { z } from 'zod';
import { OnboardingAgent } from './onboarding.agent.js';
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
    const agent = new OnboardingAgent(openai);
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
    const agent = new OnboardingAgent(openai);
    const result = await agent.respond([{ role: 'user', content: 'yes' }], { modality: 'voice' });
    expect(result.complete).toBe(true);
    expect(result.text).not.toContain('[SESSION_COMPLETE]');
  });

  it('text mode with no tools: returns content unchanged (legacy path)', async () => {
    const openai = makeOpenAIMock([{ content: 'Tell me about your family.', finish_reason: 'stop' }]);
    const agent = new OnboardingAgent(openai);
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

    const agent = new OnboardingAgent(openai);
    const result = await agent.respond([{ role: 'user', content: 'My daughter is Layla' }], {
      modality: 'text',
      tools: [childSpec],
    });

    expect(childFn).toHaveBeenCalledTimes(1);
    expect(result.text).toContain('Friday');
    expect(result.toolCallsSummary).toHaveLength(1);
    expect(result.toolCallsSummary?.[0]).toEqual({ tool: 'child.upsert', error: false });
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

    const agent = new OnboardingAgent(openai);
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

    const agent = new OnboardingAgent(openai);
    const result = await agent.respond([{ role: 'user', content: 'something allergic' }], {
      modality: 'text',
      tools: [makeToolSpec('child.upsert', failingFn)],
    });

    expect(result.text).toContain('Sorry');
    expect(result.toolCallsSummary).toEqual([{ tool: 'child.upsert', error: true }]);
  });

  it('records "Unknown tool" error when agent calls a non-existent tool', async () => {
    const openai = makeOpenAIMock([
      {
        tool_calls: [{ id: 'call_1', name: 'phantom.tool', args: {} }],
        finish_reason: 'tool_calls',
      },
      { content: 'OK.', finish_reason: 'stop' },
    ]);

    const agent = new OnboardingAgent(openai);
    const result = await agent.respond([{ role: 'user', content: 'hi' }], {
      modality: 'text',
      tools: [makeToolSpec('child.upsert', vi.fn())],
    });

    expect(result.toolCallsSummary).toEqual([{ tool: 'phantom.tool', error: true }]);
  });

  it('returns final prose when no tool calls are issued (zero-tool iteration)', async () => {
    const openai = makeOpenAIMock([
      { content: 'Tell me about your family rhythms.', finish_reason: 'stop' },
    ]);

    const agent = new OnboardingAgent(openai);
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
    const agent = new OnboardingAgent(openai);
    const result = await agent.respond([{ role: 'user', content: 'hi' }], {
      modality: 'voice',
      tools: [makeToolSpec('child.upsert', childFn)],
    });
    expect(childFn).not.toHaveBeenCalled();
    expect(result.toolCallsSummary).toBeUndefined();
  });
});
