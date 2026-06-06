import type OpenAI from 'openai';
import type { LumiSurface, LumiContextSignal, Turn } from '@hivekitchen/types';
import { LUMI_BASE_PERSONA } from './prompts/lumi-base.prompt.js';
import { getSurfacePrompt } from './prompts/surfaces/index.js';

export interface LumiAgentRespondInput {
  message: string;
  surface: LumiSurface;
  contextSignal: LumiContextSignal | null;
  conversationHistory: Turn[]; // prior turns, up to last 20 (S8 getThreadTurns)
  householdSnapshot: string; // assembled by LumiService.fetchHouseholdSnapshot()
  modality: 'text' | 'voice';
}

const LUMI_MODEL = 'gpt-4o';
const LUMI_MAX_TOKENS = 400;
const LUMI_TEMPERATURE = 0.7;

const LUMI_FALLBACK_REPLY = 'Let me think about that for a moment.';

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
    const messages = this.buildMessages(systemPrompt, input.conversationHistory, input.message);

    const completion = await this.openai.chat.completions.create({
      model: LUMI_MODEL,
      messages,
      temperature: LUMI_TEMPERATURE,
      max_tokens: LUMI_MAX_TOKENS,
    });

    return completion.choices[0]?.message?.content ?? LUMI_FALLBACK_REPLY;
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
