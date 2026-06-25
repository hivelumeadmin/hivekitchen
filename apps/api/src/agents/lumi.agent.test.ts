import { describe, it, expect, vi } from 'vitest';
import type OpenAI from 'openai';
import type { LumiSurface, Turn } from '@hivekitchen/types';
import { LumiAgent } from './lumi.agent.js';
import { LUMI_BASE_PERSONA } from './prompts/lumi-base.prompt.js';
import { getSurfacePrompt } from './prompts/surfaces/index.js';

type CreateArgs = {
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature: number;
  max_tokens: number;
};

// Minimal fake OpenAI client. `create` records its args and resolves the given
// content (or null to exercise the fallback path).
function buildFakeOpenAI(content: string | null): {
  openai: OpenAI;
  create: ReturnType<typeof vi.fn>;
} {
  const create = vi.fn().mockResolvedValue({
    choices: [{ message: { content } }],
  });
  const openai = { chat: { completions: { create } } } as unknown as OpenAI;
  return { openai, create };
}

function systemMessageOf(create: ReturnType<typeof vi.fn>): string {
  const args = create.mock.calls[0][0] as CreateArgs;
  const sys = args.messages.find((m) => m.role === 'system');
  return sys?.content ?? '';
}

function buildTurn(seq: number, role: Turn['role'], content: string): Turn {
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    thread_id: '11111111-1111-4111-8111-111111111111',
    server_seq: seq,
    role,
    body: { type: 'message', content },
    modality: 'text',
    created_at: '2026-06-05T00:00:00.000Z',
  };
}

const BASE_INPUT = {
  message: 'what should we have Tuesday?',
  contextSignal: null,
  conversationHistory: [] as Turn[],
  householdSnapshot: '',
  modality: 'text' as const,
};

describe('LumiAgent.respond — system prompt assembly', () => {
  it('calls OpenAI with a system message containing the base persona', async () => {
    const { openai, create } = buildFakeOpenAI('Mocked response.');
    const agent = new LumiAgent(openai);

    const reply = await agent.respond({ ...BASE_INPUT, surface: 'planning' });

    expect(reply).toBe('Mocked response.');
    expect(create).toHaveBeenCalledTimes(1);
    expect(systemMessageOf(create)).toContain(LUMI_BASE_PERSONA.trim());
  });

  it('includes the planning surface prompt for surface=planning', async () => {
    const { openai, create } = buildFakeOpenAI('ok');
    const agent = new LumiAgent(openai);

    await agent.respond({ ...BASE_INPUT, surface: 'planning' });

    expect(systemMessageOf(create)).toContain(getSurfacePrompt('planning').trim());
  });

  it('includes the grocery-list surface prompt — and NOT the planning one — for surface=grocery-list', async () => {
    const { openai, create } = buildFakeOpenAI('ok');
    const agent = new LumiAgent(openai);

    await agent.respond({ ...BASE_INPUT, surface: 'grocery-list' });

    const sys = systemMessageOf(create);
    expect(sys).toContain(getSurfacePrompt('grocery-list').trim());
    expect(sys).not.toContain(getSurfacePrompt('planning').trim());
  });

  it('injects the household snapshot block when a snapshot is provided', async () => {
    const { openai, create } = buildFakeOpenAI('ok');
    const agent = new LumiAgent(openai);
    const snapshot = 'Family: The Garcias\n- Sofia (child) — allergens: peanut';

    await agent.respond({ ...BASE_INPUT, surface: 'planning', householdSnapshot: snapshot });

    const sys = systemMessageOf(create);
    expect(sys).toContain('# Household Snapshot');
    expect(sys).toContain(snapshot);
  });

  it('omits the snapshot block when the snapshot is empty', async () => {
    const { openai, create } = buildFakeOpenAI('ok');
    const agent = new LumiAgent(openai);

    await agent.respond({ ...BASE_INPUT, surface: 'planning', householdSnapshot: '' });

    expect(systemMessageOf(create)).not.toContain('# Household Snapshot');
  });

  it('adds Current Surface and Recent Actions blocks from the context signal', async () => {
    const { openai, create } = buildFakeOpenAI('ok');
    const agent = new LumiAgent(openai);

    await agent.respond({
      ...BASE_INPUT,
      surface: 'meal-detail',
      contextSignal: {
        surface: 'meal-detail',
        entity_type: 'meal',
        entity_summary: 'Tuesday — chicken rice bowl',
        recent_actions: ['swapped Monday Main', 'cleared peanut'],
      },
    });

    const sys = systemMessageOf(create);
    expect(sys).toContain('# Current Surface');
    expect(sys).toContain('Surface: meal-detail');
    expect(sys).toContain('Viewing: meal — Tuesday — chicken rice bowl');
    expect(sys).toContain('# Recent Actions');
    expect(sys).toContain('- swapped Monday Main');
    expect(sys).toContain('- cleared peanut');
  });
});

describe('LumiAgent.respond — conversational context (5-S11)', () => {
  it('adds the brief morning instruction for timeOfDayBand=morning', async () => {
    const { openai, create } = buildFakeOpenAI('ok');
    const agent = new LumiAgent(openai);

    await agent.respond({
      ...BASE_INPUT,
      surface: 'planning',
      conversationalContext: { timeOfDayBand: 'morning' },
    });

    const sys = systemMessageOf(create);
    expect(sys).toContain('# Conversational Context');
    expect(sys).toContain('Time of day: morning');
    expect(sys).toContain('The parent is likely in a hurry.');
    expect(sys).toContain('one or two sentences');
  });

  it('adds the brief instruction for timeOfDayBand=afternoon', async () => {
    const { openai, create } = buildFakeOpenAI('ok');
    const agent = new LumiAgent(openai);

    await agent.respond({
      ...BASE_INPUT,
      surface: 'planning',
      conversationalContext: { timeOfDayBand: 'afternoon' },
    });

    expect(systemMessageOf(create)).toContain('The parent is likely in a hurry.');
  });

  it('adds the reflective evening instruction for timeOfDayBand=evening', async () => {
    const { openai, create } = buildFakeOpenAI('ok');
    const agent = new LumiAgent(openai);

    await agent.respond({
      ...BASE_INPUT,
      surface: 'evening-check-in',
      conversationalContext: { timeOfDayBand: 'evening' },
    });

    const sys = systemMessageOf(create);
    expect(sys).toContain('# Conversational Context');
    expect(sys).toContain('Time of day: evening');
    expect(sys).toContain('The parent has time to reflect.');
    expect(sys).toContain('2–4 sentence');
  });

  it('adds the reflective instruction for timeOfDayBand=night', async () => {
    const { openai, create } = buildFakeOpenAI('ok');
    const agent = new LumiAgent(openai);

    await agent.respond({
      ...BASE_INPUT,
      surface: 'general',
      conversationalContext: { timeOfDayBand: 'night' },
    });

    expect(systemMessageOf(create)).toContain('The parent has time to reflect.');
  });

  it('omits the Conversational Context block when conversationalContext is absent', async () => {
    const { openai, create } = buildFakeOpenAI('ok');
    const agent = new LumiAgent(openai);

    await agent.respond({ ...BASE_INPUT, surface: 'planning' });

    expect(systemMessageOf(create)).not.toContain('# Conversational Context');
  });

  it('keeps the base persona, snapshot, and recent-actions blocks ahead of the context block', async () => {
    const { openai, create } = buildFakeOpenAI('ok');
    const agent = new LumiAgent(openai);
    const snapshot = 'Family: The Garcias';

    await agent.respond({
      ...BASE_INPUT,
      surface: 'meal-detail',
      householdSnapshot: snapshot,
      contextSignal: {
        surface: 'meal-detail',
        recent_actions: ['swapped Monday Main'],
      },
      conversationalContext: { timeOfDayBand: 'morning' },
    });

    const sys = systemMessageOf(create);
    const personaIdx = sys.indexOf(LUMI_BASE_PERSONA.trim());
    const snapshotIdx = sys.indexOf('# Household Snapshot');
    const recentIdx = sys.indexOf('# Recent Actions');
    const contextIdx = sys.indexOf('# Conversational Context');

    expect(personaIdx).toBeGreaterThanOrEqual(0);
    expect(snapshotIdx).toBeGreaterThan(personaIdx);
    expect(recentIdx).toBeGreaterThan(snapshotIdx);
    expect(contextIdx).toBeGreaterThan(recentIdx);
  });
});

describe('LumiAgent.respond — conversation history', () => {
  it('threads prior user/lumi turns before the current user message', async () => {
    const { openai, create } = buildFakeOpenAI('ok');
    const agent = new LumiAgent(openai);
    const history = [buildTurn(1, 'user', 'hi Lumi'), buildTurn(2, 'lumi', 'hello!')];

    await agent.respond({
      ...BASE_INPUT,
      surface: 'planning',
      conversationHistory: history,
      message: 'what about Tuesday?',
    });

    const args = create.mock.calls[0][0] as CreateArgs;
    // system + 2 history (user, assistant) + current user = 4 messages.
    // (The story text says "5"; the snippet's own breakdown — system + 2 + current
    // — sums to 4, which is what buildMessages actually produces.)
    expect(args.messages).toHaveLength(4);
    expect(args.messages[0].role).toBe('system');
    expect(args.messages[1]).toEqual({ role: 'user', content: 'hi Lumi' });
    expect(args.messages[2]).toEqual({ role: 'assistant', content: 'hello!' });
    expect(args.messages[3]).toEqual({ role: 'user', content: 'what about Tuesday?' });
  });

  it('skips system-role turns in the conversation history', async () => {
    const { openai, create } = buildFakeOpenAI('ok');
    const agent = new LumiAgent(openai);
    const history = [
      buildTurn(1, 'system', 'session started'),
      buildTurn(2, 'user', 'hi'),
      buildTurn(3, 'lumi', 'hey'),
    ];

    await agent.respond({
      ...BASE_INPUT,
      surface: 'planning',
      conversationHistory: history,
      message: 'still there?',
    });

    const args = create.mock.calls[0][0] as CreateArgs;
    // system + user + assistant + current = 4 (the system-role turn is dropped).
    expect(args.messages).toHaveLength(4);
    expect(args.messages.some((m) => m.content === 'session started')).toBe(false);
  });
});

describe('LumiAgent.respond — fallback', () => {
  it('returns the fallback reply when OpenAI returns null content', async () => {
    const { openai } = buildFakeOpenAI(null);
    const agent = new LumiAgent(openai);

    const reply = await agent.respond({ ...BASE_INPUT, surface: 'planning' });

    expect(reply).toBe('Let me think that through.');
  });
});

describe('LumiAgent.generateNudge', () => {
  const NUDGE_INPUT = {
    trigger: 'plan_completed' as const,
    surface: 'brief' as const,
    householdSnapshot: '',
  };

  it('returns the mocked completion content', async () => {
    const { openai, create } = buildFakeOpenAI('Your week is ready, with dal-rice on Monday.');
    const agent = new LumiAgent(openai);

    const reply = await agent.generateNudge(NUDGE_INPUT);

    expect(reply).toBe('Your week is ready, with dal-rice on Monday.');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('injects the household snapshot and plan context into the system prompt', async () => {
    const { openai, create } = buildFakeOpenAI('ok');
    const agent = new LumiAgent(openai);
    const snapshot = 'Family: The Garcias\n- Sofia (child) — allergens: peanut';

    await agent.generateNudge({
      ...NUDGE_INPUT,
      householdSnapshot: snapshot,
      planContext: 'Week of 2026-10-14. Mains: Dal-rice, Khichdi, Pasta',
    });

    const sys = systemMessageOf(create);
    expect(sys).toContain('# Household Snapshot');
    expect(sys).toContain(snapshot);
    expect(sys).toContain('# Proactive Nudge');
    expect(sys).toContain('Trigger: plan_completed');
    expect(sys).toContain('Plan context: Week of 2026-10-14. Mains: Dal-rice, Khichdi, Pasta');
  });

  it('sends a synthetic user turn and a 150-token cap', async () => {
    const { openai, create } = buildFakeOpenAI('ok');
    const agent = new LumiAgent(openai);

    await agent.generateNudge(NUDGE_INPUT);

    const args = create.mock.calls[0][0] as CreateArgs;
    expect(args.max_tokens).toBe(150);
    expect(args.messages).toHaveLength(2);
    expect(args.messages[0].role).toBe('system');
    expect(args.messages[1]).toEqual({
      role: 'user',
      content: "What's your proactive message?",
    });
  });

  it('returns the fallback reply when OpenAI returns null content', async () => {
    const { openai } = buildFakeOpenAI(null);
    const agent = new LumiAgent(openai);

    const reply = await agent.generateNudge(NUDGE_INPUT);

    expect(reply).toBe('Let me think that through.');
  });
});

describe('surface prompt smoke — all surfaces return non-empty prompts', () => {
  const surfaces: LumiSurface[] = [
    'planning',
    'meal-detail',
    'child-profile',
    'kitchen-profile',
    'grocery-list',
    'evening-check-in',
    'heart-note',
    'general',
  ];

  for (const surface of surfaces) {
    it(`getSurfacePrompt('${surface}') returns a non-empty string`, () => {
      expect(getSurfacePrompt(surface).trim().length).toBeGreaterThan(0);
    });
  }
});

describe('LumiAgent.respond — tool-call loop (7-S15)', () => {
  const TOOLS = [
    {
      type: 'function',
      function: {
        name: 'food_preference__declare',
        description: 'declare a food preference',
        parameters: { type: 'object', properties: {} },
      },
    },
  ] as unknown as import('openai/resources/chat/completions').ChatCompletionTool[];

  it('executes a tool call then returns the follow-up prose', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'tc1',
                  type: 'function',
                  function: {
                    name: 'food_preference__declare',
                    arguments: JSON.stringify({
                      item: 'chili',
                      valence: 'dislikes',
                      enforcement: 'strong',
                    }),
                  },
                },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [{ finish_reason: 'stop', message: { content: 'Got it — noted.' } }],
      });
    const openai = { chat: { completions: { create } } } as unknown as OpenAI;
    const agent = new LumiAgent(openai);
    const executor = vi.fn().mockResolvedValue(JSON.stringify({ declared: true }));

    const reply = await agent.respond({
      ...BASE_INPUT,
      surface: 'kitchen-profile',
      tools: TOOLS,
      toolExecutor: executor,
    });

    expect(reply).toBe('Got it — noted.');
    expect(executor).toHaveBeenCalledWith('food_preference__declare', {
      item: 'chili',
      valence: 'dislikes',
      enforcement: 'strong',
    });
    expect(create).toHaveBeenCalledTimes(2);
    const secondMessages = (create.mock.calls[1][0] as { messages: Array<{ role: string }> })
      .messages;
    expect(secondMessages.some((m) => m.role === 'tool')).toBe(true);
  });

  it('keeps the single-shot path when no tools are provided', async () => {
    const { openai, create } = buildFakeOpenAI('Plain reply.');
    const agent = new LumiAgent(openai);
    const reply = await agent.respond({ ...BASE_INPUT, surface: 'kitchen-profile' });
    expect(reply).toBe('Plain reply.');
    expect(create).toHaveBeenCalledTimes(1);
  });
});
