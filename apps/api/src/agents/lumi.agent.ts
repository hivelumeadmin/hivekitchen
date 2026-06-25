import type OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import type { LumiSurface, LumiContextSignal, NudgeTrigger, Turn } from '@hivekitchen/types';
import type { TimeOfDayBand } from '../common/time-of-day.js';
import { LUMI_BASE_PERSONA } from './prompts/lumi-base.prompt.js';
import { getSurfacePrompt } from './prompts/surfaces/index.js';

export interface LumiAgentRespondInput {
  message: string;
  surface: LumiSurface;
  contextSignal: LumiContextSignal | null;
  conversationHistory: Turn[]; // prior turns, up to last 20 (S8 getThreadTurns)
  householdSnapshot: string; // assembled by LumiService.fetchHouseholdSnapshot()
  modality: 'text' | 'voice';
  // 5-S11 — server-derived time-of-day band; when present, adds a length/tone
  // modifier on top of the surface prompt (morning/afternoon = brief, evening/
  // night = reflective). Absent for callers that don't compute it.
  conversationalContext?: {
    timeOfDayBand: TimeOfDayBand;
  };
  // 7-S15 — when BOTH are present (kitchen-profile shared-tastes edits), respond
  // runs a tool-call loop instead of a single shot: the model may call a tool,
  // the executor (supplied by LumiService — the only DB-aware layer, keeping
  // this agent stateless per ADR-002) runs it, and the JSON result feeds back
  // until the model emits prose. Absent for every other turn, which keeps the
  // single-shot path byte-for-byte unchanged.
  tools?: ChatCompletionTool[];
  toolExecutor?: (name: string, args: Record<string, unknown>) => Promise<string>;
}

// Story 12-S11 — input for a one-shot proactive nudge (no conversation history;
// the user did not ask a question).
export interface LumiAgentGenerateNudgeInput {
  trigger: NudgeTrigger;
  surface: LumiSurface;
  householdSnapshot: string;
  planContext?: string; // brief text summary of the plan (plan_completed trigger)
}

const LUMI_MODEL = 'gpt-4o';
const LUMI_MAX_TOKENS = 400;
// Nudges are one short sentence — a tighter cap than respond() keeps them brief
// and cost-effective (Story 12-S11).
const LUMI_NUDGE_MAX_TOKENS = 150;
const LUMI_TEMPERATURE = 0.7;

const LUMI_FALLBACK_REPLY = 'Let me think that through.';

// 7-S15 — hard cap on tool-call round-trips, guarding against a model that
// loops on malformed output. Kitchen-profile turns use 0–few tool calls.
const LUMI_MAX_TOOL_ITERATIONS = 5;

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

// Real LLM dispatch (Story 12-S9). Assembles the system prompt in the
// canonical order (base persona → surface → snapshot → current surface →
// recent actions), threads prior turns as OpenAI conversation history, and
// returns a single-shot completion. Stateless: every dependency is passed in;
// the agent never touches the DB (ADR-002 — the API layer owns persistence).
export class LumiAgent {
  constructor(private readonly openai: OpenAI) {}

  async respond(input: LumiAgentRespondInput): Promise<string> {
    const systemPrompt = this.buildSystemPrompt(input);
    const baseMessages = this.buildMessages(systemPrompt, input.conversationHistory, input.message);

    if (input.tools !== undefined && input.tools.length > 0 && input.toolExecutor !== undefined) {
      return this.respondWithTools(baseMessages, input.tools, input.toolExecutor);
    }

    const completion = await this.openai.chat.completions.create({
      model: LUMI_MODEL,
      messages: baseMessages,
      temperature: LUMI_TEMPERATURE,
      max_tokens: LUMI_MAX_TOKENS,
    });

    return completion.choices[0]?.message?.content ?? LUMI_FALLBACK_REPLY;
  }

  // 7-S15 — tool-call loop. Mirrors OnboardingAgent.respondWithTools but stays
  // minimal: LumiService owns the wire tool names, so the executor receives the
  // function name verbatim and maps it. Tool errors are returned to the model
  // as JSON (so it can recover in prose), never thrown out of the loop.
  private async respondWithTools(
    baseMessages: ChatMessage[],
    tools: ChatCompletionTool[],
    toolExecutor: (name: string, args: Record<string, unknown>) => Promise<string>,
  ): Promise<string> {
    const messages: ChatCompletionMessageParam[] = baseMessages.map(
      (m): ChatCompletionMessageParam => ({ role: m.role, content: m.content }),
    );

    for (let iter = 0; iter < LUMI_MAX_TOOL_ITERATIONS; iter++) {
      const completion = await this.openai.chat.completions.create({
        model: LUMI_MODEL,
        messages,
        tools,
        tool_choice: 'auto',
        temperature: LUMI_TEMPERATURE,
        max_tokens: LUMI_MAX_TOKENS,
      });
      const choice = completion.choices[0];
      if (!choice) return LUMI_FALLBACK_REPLY;

      const msg = choice.message;
      const toolCalls = msg.tool_calls ?? [];
      if (toolCalls.length === 0 || choice.finish_reason === 'stop') {
        return msg.content ?? LUMI_FALLBACK_REPLY;
      }

      messages.push({ role: 'assistant', content: msg.content, tool_calls: toolCalls });

      for (const tc of toolCalls) {
        if (tc.type !== 'function') continue;
        let args: Record<string, unknown> = {};
        try {
          const parsed: unknown = JSON.parse(tc.function.arguments);
          if (parsed !== null && typeof parsed === 'object') {
            args = parsed as Record<string, unknown>;
          }
        } catch {
          args = {};
        }
        const result = await toolExecutor(tc.function.name, args);
        messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
      }
    }

    // Cap exhausted — one final tool-free call so the user gets prose rather
    // than a dangling tool turn.
    const final = await this.openai.chat.completions.create({
      model: LUMI_MODEL,
      messages,
      temperature: LUMI_TEMPERATURE,
      max_tokens: LUMI_MAX_TOKENS,
    });
    return final.choices[0]?.message?.content ?? LUMI_FALLBACK_REPLY;
  }

  // Story 12-S11 — one-shot proactive message. Unlike respond(), there is no
  // user question and no conversation history: a single synthetic user turn
  // ("What's your proactive message?") elicits the reply, avoiding an empty
  // user turn that some models handle poorly. Stateless like respond().
  async generateNudge(input: LumiAgentGenerateNudgeInput): Promise<string> {
    const systemPrompt = this.buildNudgeSystemPrompt(input);

    const completion = await this.openai.chat.completions.create({
      model: LUMI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: "What's your proactive message?" },
      ],
      temperature: LUMI_TEMPERATURE,
      max_tokens: LUMI_NUDGE_MAX_TOKENS,
    });

    return completion.choices[0]?.message?.content ?? LUMI_FALLBACK_REPLY;
  }

  private buildNudgeSystemPrompt(input: LumiAgentGenerateNudgeInput): string {
    const parts: string[] = [
      LUMI_BASE_PERSONA.trim(),
      getSurfacePrompt(input.surface).trim(),
    ];

    if (input.householdSnapshot.length > 0) {
      parts.push(`\n# Household Snapshot\n${input.householdSnapshot}`);
    }

    const nudgeBlock = [
      '\n# Proactive Nudge',
      'You are about to send a proactive message — the user did NOT ask a question.',
      `Trigger: ${input.trigger}`,
    ];
    if (input.planContext !== undefined && input.planContext.length > 0) {
      nudgeBlock.push(`Plan context: ${input.planContext}`);
    }
    nudgeBlock.push(
      'Write ONE short, warm sentence (max 25 words) referencing what just happened.',
      'Speak as Lumi; be specific to this family. Do not ask a question. Do not start with "I".',
    );
    parts.push(nudgeBlock.join('\n'));

    return parts.join('\n');
  }

  private buildSystemPrompt(input: LumiAgentRespondInput): string {
    const parts: string[] = [
      LUMI_BASE_PERSONA.trim(),
      getSurfacePrompt(input.surface).trim(),
    ];

    if (input.householdSnapshot.length > 0) {
      parts.push(`\n# Household Snapshot\n${input.householdSnapshot}`);
    }

    if (input.contextSignal !== null) {
      const ctx: string[] = [`Surface: ${input.contextSignal.surface}`];
      if (input.contextSignal.entity_type !== undefined) {
        ctx.push(
          `Viewing: ${input.contextSignal.entity_type}${input.contextSignal.entity_summary !== undefined ? ` — ${input.contextSignal.entity_summary}` : ''}`,
        );
      }
      parts.push(`\n# Current Surface\n${ctx.join('\n')}`);

      if (
        input.contextSignal.recent_actions !== undefined &&
        input.contextSignal.recent_actions.length > 0
      ) {
        parts.push(
          `\n# Recent Actions\n${input.contextSignal.recent_actions.map((a) => `- ${a}`).join('\n')}`,
        );
      }
    }

    if (input.conversationalContext !== undefined) {
      const { timeOfDayBand } = input.conversationalContext;
      const instruction =
        timeOfDayBand === 'morning' || timeOfDayBand === 'afternoon'
          ? 'The parent is likely in a hurry. Keep your reply to one or two sentences — direct and warm, not terse.'
          : 'The parent has time to reflect. A warm 2–4 sentence reply is welcome — be specific to this family, not generic.';
      parts.push(`\n# Conversational Context\nTime of day: ${timeOfDayBand}\n${instruction}`);
    }

    return parts.join('\n');
  }

  private buildMessages(
    systemPrompt: string,
    history: Turn[],
    currentMessage: string,
  ): ChatMessage[] {
    const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];

    // Inject prior turns as conversation history. Only 'user' and 'lumi' roles
    // translate to OpenAI roles ('lumi' → 'assistant'). System turns are skipped.
    for (const turn of history) {
      if (turn.role === 'user') {
        const content = turn.body.type === 'message' ? turn.body.content : '';
        if (content) messages.push({ role: 'user', content });
      } else if (turn.role === 'lumi') {
        const content = turn.body.type === 'message' ? turn.body.content : '';
        if (content) messages.push({ role: 'assistant', content });
      }
    }

    // Current user message (not yet persisted when respond() is called)
    messages.push({ role: 'user', content: currentMessage });
    return messages;
  }
}
