import type { FastifyBaseLogger } from 'fastify';
import type Redis from 'ioredis';
import type OpenAI from 'openai';
import { z } from 'zod';
import type { LumiSurface, LumiContextSignal, NudgeTrigger, Turn } from '@hivekitchen/types';
import { ForbiddenError, ValidationError } from '../../common/errors.js';
import { getTimeOfDayBand } from '../../common/time-of-day.js';
import { LumiAgent } from '../../agents/lumi.agent.js';
import type { ChildrenRepository } from '../children/children.repository.js';
import type { HouseholdAllergensRepository } from '../households/household-allergens.repository.js';
import type { MemoryService } from '../memory/memory.service.js';
import type { VoiceTranscriptRepository } from '../voice/voice-transcript.repository.js';
import {
  detectFamilyLanguageTerms,
  FAMILY_LANGUAGE_RATIFY_THRESHOLD,
} from '../family-language/family-language.detector.js';
import type { FamilyLanguageRepository } from '../family-language/family-language.repository.js';
import type { LumiRepository, TalkSessionRow } from './lumi.repository.js';

export interface LumiServiceDeps {
  repository: LumiRepository;
  redis: Redis;
  logger: FastifyBaseLogger;
  openai: OpenAI;
  childrenRepository: ChildrenRepository;
  householdAllergensRepository: HouseholdAllergensRepository;
  voiceTranscriptRepository: VoiceTranscriptRepository;
  memoryService?: MemoryService;
  familyLanguageRepository?: FamilyLanguageRepository;
}

export interface CreateTalkSessionInput {
  userId: string;
  householdId: string;
  userRole: 'primary_parent' | 'secondary_caregiver' | 'guest_author' | 'ops';
  contextSignal: LumiContextSignal;
}

export interface CreateTalkSessionResult {
  talk_session_id: string;
}

const TALK_SESSION_TTL_SECONDS = 20;

// Migration 20260904000300 narrowed node_type to 3 values.
const ENRICHMENT_NODE_TYPES = ['rhythm', 'child_obsession', 'other'] as const;
const EnrichmentSignalSchema = z.object({
  node_type: z.enum(ENRICHMENT_NODE_TYPES),
  facet: z.string().min(1).max(40),
  prose_text: z.string().min(1).max(150),
  confidence: z.number().min(0).max(1),
});
const EnrichmentResultSchema = z.object({
  signals: z.array(EnrichmentSignalSchema).max(3),
});

// 5-S7 — extraction system prompt. The literal word "JSON" must remain present:
// response_format json_object requires it in the prompt or OpenAI returns 400.
const ENRICHMENT_SYSTEM_PROMPT =
  `You are a memory signal extractor for Lumi, a family kitchen assistant.
Given one parent↔Lumi exchange, identify memory-worthy facts the PARENT explicitly stated about their family: food preferences, cultural events or practices, family rhythms, or child-specific observations.

Return ONLY valid JSON:
{"signals": [{"node_type": "...", "facet": "...", "prose_text": "...", "confidence": 0.0}]}
or {"signals": []} if nothing memory-worthy was stated.

node_type: rhythm | child_obsession | other
facet: short stable kebab-case identifier, max 40 chars (e.g. "diwali-2026", "layla-no-broccoli", "tuesday-pasta-night")
prose_text: one complete sentence capturing the fact, max 150 chars
confidence: 0.8 if explicitly stated; 0.6 if implied; 0.5 if uncertain

Rules:
- Only capture facts the PARENT explicitly stated. Do NOT invent or infer beyond their words.
- Ignore greetings, questions, logistics, and Lumi's own reply content.
- Max 3 signals per turn. Signal facets must be distinct.`.trim();

// 'onboarding' is a valid LumiSurface (see lumi.ts contract comment) but the
// onboarding voice flow has its own dedicated route at POST /v1/voice/sessions
// (Story 2.6/2.6b). Ambient tap-to-talk is for non-onboarding surfaces only.
// 400 (not 403) — this is a wrong-endpoint client mistake, not an authz failure.
function assertAmbientSurface(surface: LumiSurface): void {
  if (surface === 'onboarding') {
    throw new ValidationError(
      "Onboarding voice sessions must be created via POST /v1/voice/sessions, not the ambient Lumi route",
    );
  }
}

export class LumiService {
  private readonly repository: LumiRepository;
  private readonly redis: Redis;
  private readonly logger: FastifyBaseLogger;
  private readonly openai: OpenAI;
  private readonly childrenRepository: ChildrenRepository;
  private readonly householdAllergensRepository: HouseholdAllergensRepository;
  private readonly voiceTranscriptRepository: VoiceTranscriptRepository;
  private readonly memoryService?: MemoryService;
  private readonly familyLanguageRepository?: FamilyLanguageRepository;

  constructor(deps: LumiServiceDeps) {
    this.repository = deps.repository;
    this.redis = deps.redis;
    this.logger = deps.logger;
    this.openai = deps.openai;
    this.childrenRepository = deps.childrenRepository;
    this.householdAllergensRepository = deps.householdAllergensRepository;
    this.voiceTranscriptRepository = deps.voiceTranscriptRepository;
    this.memoryService = deps.memoryService;
    this.familyLanguageRepository = deps.familyLanguageRepository;
  }

  async createTalkSession(input: CreateTalkSessionInput): Promise<CreateTalkSessionResult> {
    const surface = input.contextSignal.surface;
    assertAmbientSurface(surface);

    if (input.userRole !== 'primary_parent') {
      throw new ForbiddenError('Voice sessions are restricted to primary parents');
    }

    const tier = await this.repository.getHouseholdTier(input.householdId);
    if (tier === null) {
      throw new ForbiddenError('Household not found');
    }
    if (tier !== 'premium') {
      throw new ForbiddenError('Voice sessions require Premium tier');
    }

    const existing = await this.repository.findActiveAmbientThread(
      input.householdId,
      surface,
    );
    const thread =
      existing ??
      (await this.repository.createAmbientThread(input.householdId, surface, 'voice'));

    const session: TalkSessionRow = await this.repository.createTalkSession({
      userId: input.userId,
      householdId: input.householdId,
      threadId: thread.id,
    });

    try {
      await this.redis.set(
        `lumi:voice:session:${session.id}:active`,
        '1',
        'EX',
        TALK_SESSION_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn(
        {
          err,
          module: 'lumi',
          action: 'lumi.redis_sentinel_failed',
          session_id: session.id,
        },
        'redis SET for talk session sentinel failed — non-fatal',
      );
    }

    return { talk_session_id: session.id };
  }

  // Ambient text turn. Lazy-resolves the per-surface ambient thread, fetches
  // conversation history + the household snapshot, asks the real LumiAgent for
  // a reply, persists both turns, and returns them. Voice turns pass
  // modality:'voice' and userId so the transcript row is attributed correctly.
  async submitTextTurn(input: {
    householdId: string;
    userId?: string;
    message: string;
    contextSignal: LumiContextSignal;
    modality?: 'text' | 'voice';
    voiceRetentionMode?: 'standard' | 'immediate_delete';
  }): Promise<{ thread_id: string; user_turn: Turn; lumi_turn: Turn; ratification_turn?: Turn }> {
    const surface = input.contextSignal.surface;
    const modality = input.modality ?? 'text';
    assertAmbientSurface(surface);

    const existing = await this.repository.findActiveAmbientThread(
      input.householdId,
      surface,
    );
    const thread =
      existing ??
      (await this.repository.createAmbientThread(input.householdId, surface, 'text'));

    const priorTurns =
      existing !== null
        ? await this.repository.getThreadTurns(thread.id, input.householdId)
        : [];
    const householdSnapshot = await this.fetchHouseholdSnapshot(input.householdId);

    const userTurn = await this.repository.insertTurn({
      threadId: thread.id,
      role: 'user',
      body: { type: 'message', content: input.message },
      modality,
    });

    const agent = new LumiAgent(this.openai);
    const lumiText = await agent.respond({
      message: input.message,
      surface,
      contextSignal: input.contextSignal,
      conversationHistory: priorTurns,
      householdSnapshot,
      modality,
      conversationalContext: { timeOfDayBand: getTimeOfDayBand(new Date()) },
    });

    const lumiTurn = await this.repository.insertTurn({
      threadId: thread.id,
      role: 'lumi',
      body: { type: 'message', content: lumiText },
      modality,
    });

    void this.runPassiveEnrichment(input.householdId, userTurn.id, thread.id, input.message, lumiText);

    if (modality === 'voice' && input.voiceRetentionMode !== 'immediate_delete') {
      try {
        await this.voiceTranscriptRepository.insertTranscript(
          thread.id,
          lumiTurn.id,
          input.message,
          90,
          input.userId,
        );
      } catch (err) {
        this.logger.warn(
          {
            err,
            module: 'lumi',
            action: 'lumi.voice_transcript_persist_failed',
            thread_id: thread.id,
          },
          'voice transcript persist failed — best-effort, continuing',
        );
      }
    }

    let ratificationTurn: Turn | undefined;
    if (this.familyLanguageRepository) {
      try {
        const detected = detectFamilyLanguageTerms(input.message);
        if (detected.length > 0) {
          const { newlyCandidate } = await this.familyLanguageRepository.recordUsage(
            input.householdId,
            detected,
            FAMILY_LANGUAGE_RATIFY_THRESHOLD,
          );
          const first = newlyCandidate[0];
          if (first) {
            ratificationTurn = await this.repository.insertTurn({
              threadId: thread.id,
              role: 'lumi',
              body: { type: 'family_language_prompt', term: first.term, maps_to: first.maps_to },
              modality,
            });
          }
        }
      } catch (err) {
        this.logger.warn(
          {
            err,
            module: 'lumi',
            action: 'lumi.family_language_detect_failed',
            household_id: input.householdId,
          },
          'family-language detection failed — non-fatal, continuing',
        );
      }
    }

    return {
      thread_id: thread.id,
      user_turn: userTurn,
      lumi_turn: lumiTurn,
      ...(ratificationTurn ? { ratification_turn: ratificationTurn } : {}),
    };
  }

  private async runPassiveEnrichment(
    householdId: string,
    turnId: string,
    threadId: string,
    userMessage: string,
    lumiReply: string,
  ): Promise<void> {
    if (!this.memoryService) return;
    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: ENRICHMENT_SYSTEM_PROMPT },
          { role: 'user', content: `Parent: ${userMessage}\nLumi: ${lumiReply}` },
        ],
        max_tokens: 400,
        temperature: 0,
      });
      const raw = completion.choices[0]?.message?.content ?? '{"signals":[]}';
      let parsed: ReturnType<typeof EnrichmentResultSchema.safeParse>;
      try {
        parsed = EnrichmentResultSchema.safeParse(JSON.parse(raw));
      } catch {
        this.logger.warn(
          { module: 'lumi', action: 'lumi.passive_enrichment_parse_failed' },
          'passive enrichment JSON.parse threw — raw response was not valid JSON',
        );
        return;
      }
      if (!parsed.success) {
        this.logger.warn(
          { module: 'lumi', action: 'lumi.passive_enrichment_parse_failed' },
          'passive enrichment result failed schema validation',
        );
        return;
      }
      const sourceRef: Record<string, unknown> = { thread_id: threadId, turn_id: turnId };
      for (const signal of parsed.data.signals) {
        try {
          await this.memoryService.noteFromAgent({
            householdId,
            nodeType: signal.node_type,
            facet: signal.facet,
            proseText: signal.prose_text,
            subjectChildId: null,
            confidence: signal.confidence,
            sourceType: 'turn',
            sourceRef,
          });
        } catch (err) {
          this.logger.warn(
            { err, module: 'lumi', action: 'lumi.passive_enrichment_note_failed', facet: signal.facet },
            'passive enrichment note write failed — skipping signal',
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        { err, module: 'lumi', action: 'lumi.passive_enrichment_failed', household_id: householdId },
        'passive enrichment extraction failed — non-fatal',
      );
    }
  }

  async persistNudge(input: {
    householdId: string;
    trigger: NudgeTrigger;
    surface: LumiSurface;
    planContext?: string;
  }): Promise<Turn> {
    const householdSnapshot = await this.fetchHouseholdSnapshot(input.householdId);

    const existing = await this.repository.findActiveAmbientThread(
      input.householdId,
      input.surface,
    );
    const thread =
      existing ??
      (await this.repository.createAmbientThread(input.householdId, input.surface, 'text'));

    const agent = new LumiAgent(this.openai);
    const nudgeText = await agent.generateNudge({
      trigger: input.trigger,
      surface: input.surface,
      householdSnapshot,
      planContext: input.planContext,
    });

    const turn = await this.repository.insertTurn({
      threadId: thread.id,
      role: 'lumi',
      body: { type: 'message', content: nudgeText },
      modality: 'text',
      nudgeTrigger: input.trigger,
    });

    try {
      await this.redis.set(
        `lumi:nudge:household:${input.householdId}`,
        '1',
        'EX',
        1800,
        'NX',
      );
    } catch (err) {
      this.logger.warn(
        {
          err,
          module: 'lumi',
          action: 'lumi.nudge_redis_gate_failed',
          household_id: input.householdId,
        },
        'redis nudge gate SET failed — non-fatal, S12 SSE will skip rate-limit check',
      );
    }

    return turn;
  }

  private async fetchHouseholdSnapshot(householdId: string): Promise<string> {
    const [displayName, children, allergenRows] = await Promise.all([
      this.repository.getHouseholdDisplayName(householdId),
      this.childrenRepository.findByHouseholdId(householdId),
      this.householdAllergensRepository.findByHouseholdId(householdId),
    ]);

    const kitchenAllergens: string[] = [];
    const allergensByChild = new Map<string, string[]>();
    for (const { child_id, allergen } of allergenRows) {
      if (child_id === null) {
        kitchenAllergens.push(allergen);
      } else {
        const list = allergensByChild.get(child_id) ?? [];
        list.push(allergen);
        allergensByChild.set(child_id, list);
      }
    }

    const lines: string[] = [];
    if (displayName !== null) lines.push(`Family: ${displayName}`);
    if (kitchenAllergens.length > 0) lines.push(`Kitchen allergens: ${kitchenAllergens.join(', ')}`);
    for (const child of children) {
      const allergens = allergensByChild.get(child.id) ?? [];
      const allergenStr =
        allergens.length > 0 ? `allergens: ${allergens.join(', ')}` : 'no known allergens';
      lines.push(`- ${child.name} (${child.age_band}) — ${allergenStr}`);
    }

    if (this.familyLanguageRepository) {
      try {
        const activeTerms = (await this.familyLanguageRepository.getTerms(householdId)).filter(
          (t) => t.state === 'active',
        );
        if (activeTerms.length > 0) {
          lines.push(
            'Family language (use these exact words, never the generic English term):',
            ...activeTerms.map((t) => `- call the ${t.maps_to} "${t.term}"`),
          );
        }
      } catch (err) {
        this.logger.warn(
          {
            err,
            module: 'lumi',
            action: 'lumi.family_language_snapshot_failed',
            household_id: householdId,
          },
          'family-language snapshot read failed — continuing without the ratchet block',
        );
      }
    }

    return lines.join('\n');
  }

  async closeTalkSession(input: {
    sessionId: string;
    userId: string;
    householdId: string;
  }): Promise<void> {
    const session = await this.repository.findTalkSession(input.sessionId);
    if (
      session === null ||
      session.user_id !== input.userId ||
      session.household_id !== input.householdId
    ) {
      throw new ForbiddenError('Talk session not accessible');
    }

    if (session.status === 'active') {
      await this.repository.closeTalkSession(input.sessionId, new Date().toISOString(), input.householdId);
    }

    try {
      await this.redis.del(`lumi:voice:session:${input.sessionId}:active`);
    } catch (err) {
      this.logger.warn(
        {
          err,
          module: 'lumi',
          action: 'lumi.redis_sentinel_del_failed',
          session_id: input.sessionId,
        },
        'redis DEL for talk session sentinel failed — non-fatal',
      );
    }
  }
}
