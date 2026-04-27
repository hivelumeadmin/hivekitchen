import type OpenAI from 'openai';
import {
  ONBOARDING_SYSTEM_PROMPT,
  getOnboardingSystemPrompt,
  type OnboardingModality,
} from './prompts/onboarding.prompt.js';

export type LlmMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export class OnboardingAgent {
  constructor(private readonly openai: OpenAI) {}

  async respond(
    messages: LlmMessage[],
    opts: { modality?: OnboardingModality } = {},
  ): Promise<string> {
    const modality = opts.modality ?? 'voice';
    const systemPrompt = modality === 'voice' ? ONBOARDING_SYSTEM_PROMPT : getOnboardingSystemPrompt(modality);
    const fullMessages: LlmMessage[] = [
      { role: 'system', content: systemPrompt },
      ...messages.filter((m) => m.role !== 'system'),
    ];
    const completion = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: fullMessages,
      temperature: 0.7,
      max_tokens: 300,
    });
    const fallback =
      modality === 'voice'
        ? '[pause] Let me think about that for a moment.'
        : 'Let me think about that for a moment.';
    return completion.choices[0]?.message?.content ?? fallback;
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

  // Returns true when the most recent assistant turn was the closing summary
  // AND the most recent user turn affirmed it ("yes", "that's right", etc.).
  // Used to gate the front-end "Finish onboarding" affordance.
  async isSummaryConfirmed(history: LlmMessage[]): Promise<boolean> {
    if (history.length < 4) return false;
    const recent = history
      .slice(-6)
      .filter((m) => m.role !== 'system')
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n');
    const completion = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content:
            'You judge whether an onboarding conversation has reached its end: assistant has summarised what it learned and the user has confirmed or corrected the summary in their most recent message. Reply with exactly one word: "yes" or "no". Nothing else.',
        },
        { role: 'user', content: recent },
      ],
      temperature: 0,
      max_tokens: 5,
    });
    const verdict = (completion.choices[0]?.message?.content ?? '').trim().toLowerCase();
    return verdict.startsWith('yes');
  }
}
