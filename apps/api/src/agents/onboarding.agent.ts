import type OpenAI from 'openai';
import { ONBOARDING_SYSTEM_PROMPT } from './prompts/onboarding.prompt.js';

export type LlmMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export class OnboardingAgent {
  constructor(private readonly openai: OpenAI) {}

  async respond(messages: LlmMessage[]): Promise<string> {
    const fullMessages: LlmMessage[] = [
      { role: 'system', content: ONBOARDING_SYSTEM_PROMPT },
      ...messages.filter((m) => m.role !== 'system'),
    ];
    const completion = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: fullMessages,
      temperature: 0.7,
      max_tokens: 300,
    });
    return completion.choices[0]?.message?.content ?? '[pause] Let me think about that for a moment.';
  }

  async extractSummary(transcript: Array<{ role: string; message: string }>): Promise<{
    cultural_templates: string[];
    palate_notes: string[];
    allergens_mentioned: string[];
  }> {
    const transcriptText = transcript.map((t) => `${t.role}: ${t.message}`).join('\n');
    const completion = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'Extract structured onboarding data from this conversation transcript. Return JSON only.',
        },
        {
          role: 'user',
          content: `Extract: cultural_templates (array of strings), palate_notes (array), allergens_mentioned (array).\n\nTranscript:\n${transcriptText}`,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
    });
    const raw = JSON.parse(completion.choices[0]?.message?.content ?? '{}') as {
      cultural_templates?: unknown;
      palate_notes?: unknown;
      allergens_mentioned?: unknown;
    };
    const onlyStrings = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    return {
      cultural_templates: onlyStrings(raw.cultural_templates),
      palate_notes: onlyStrings(raw.palate_notes),
      allergens_mentioned: onlyStrings(raw.allergens_mentioned),
    };
  }
}
