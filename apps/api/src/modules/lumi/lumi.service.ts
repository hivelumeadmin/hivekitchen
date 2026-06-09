import type { Buffer } from 'node:buffer';
import type { FastifyBaseLogger } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import type Redis from 'ioredis';
import type OpenAI from 'openai';
import { z } from 'zod';
import type { LumiSurface, LumiContextSignal, NudgeTrigger, Turn } from '@hivekitchen/types';
import { ForbiddenError, ValidationError } from '../../common/errors.js';
import { STANDARD_TIER_CAP_MS, VOICE_CAP_COPY, getWeekStart } from '../../common/voice-tier.js';
import { LumiAgent } from '../../agents/lumi.agent.js';
import { transcribeWav, streamTtsToWs } from '../voice/elevenlabs-audio.js';
import type { ChildrenRepository } from '../children/children.repository.js';
import type { HouseholdAllergensRepository } from '../households/household-allergens.repository.js';
import type { MemoryService } from '../memory/memory.service.js';
import type { VoiceTranscriptRepository } from '../voice/voice-transcript.repository.js';
import type { VoiceUsageRepository } from '../voice/voice-usage.repository.js';
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
  elevenLabsApiKey: string;
  voiceId: string;
  openai: OpenAI; // NEW — real LumiAgent dispatch
  childrenRepository: ChildrenRepository; // NEW — for household snapshot
  householdAllergensRepository: HouseholdAllergensRepository; // NEW — canonical allergen table
  voiceTranscriptRepository: VoiceTranscriptRepository; // 5-S5 — voice transcript persistence
  memoryService?: MemoryService; // 5-S7 — passive enrichment; optional so nudge-job ctor is unchanged
  familyLanguageRepository?: FamilyLanguageRepository; // 5-S10 — optional; detection + snapshot ratchet skipped when absent
  voiceUsageRepository?: VoiceUsageRepository; // 5-S16 — tier cap; absent = cap disabled (tests, nudge-job)
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

// Story 5-S5b — per-connection state for an ambient Lumi voice WebSocket
// (GET /v1/lumi/voice/ws). One object lives in the route handler's closure for
// the life of the socket; the service mutates it. `contextSignal` is set from
// the browser's `context` frame; `isProcessing` is the single-flight guard
// (mirrors the onboarding VoiceService turn loop); `seq` numbers the frames.
export interface LumiVoiceWsState {
  householdId: string;
  userId: string; // 5-S15 — for transcript user_id
  voiceRetentionMode: 'standard' | 'immediate_delete'; // 5-S15 — cached at WS open
  contextSignal: LumiContextSignal | null;
  isProcessing: boolean;
  seq: number;
}

const TALK_SESSION_TTL_SECONDS = 20;

// 60s × 16kHz × 2B ≈ 1.9 MB — mirrors the onboarding voice cap (2.6b).
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;

// Non-fatal voice error copy — a single STT/agent/TTS miss never tears the
// session down (12-S10 TRANSCRIPT_FAILED behaviour); the user just speaks again.
const STT_FAILED_COPY = 'Could not hear that — try again';
const AGENT_FAILED_COPY = "I'm having a little trouble — could you say that again?";
const TTS_FAILED_COPY = 'Voice unavailable — please read the response instead';

// 5-S16 — estimate WAV audio duration from the buffer's 44-byte PCM header
// (sample rate, channels, bit depth read from the standard offsets). Returns 0
// for malformed or sub-header buffers so the usage increment is simply skipped.
function estimateWavDurationMs(buf: Buffer): number {
  if (buf.length <= 44) return 0;
  const sampleRate = buf.readUInt32LE(24); // bytes 24–27: sample rate (Hz)
  const numChannels = buf.readUInt16LE(22); // bytes 22–23: channel count
  const bitsPerSample = buf.readUInt16LE(34); // bytes 34–35: bit depth
  if (sampleRate === 0 || numChannels === 0 || bitsPerSample === 0) return 0;
  const bytesPerSecond = sampleRate * numChannels * (bitsPerSample / 8);
  return ((buf.length - 44) / bytesPerSecond) * 1_000;
}

// 5-S7 — enrichment signal extraction result (internal, not a public contract).
// These schemas are an implementation detail of the passive-enrichment OpenAI
// call; they are intentionally NOT in @hivekitchen/contracts.
const ENRICHMENT_NODE_TYPES = [
  'preference',
  'rhythm',
  'cultural_rhythm',
  'allergy',
  'child_obsession',
  'school_policy',
  'other',
] as const;
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

node_type: preference | rhythm | cultural_rhythm | allergy | child_obsession | school_policy | other
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
  private readonly elevenLabsApiKey: string;
  private readonly voiceId: string;
  private readonly openai: OpenAI;
  private readonly childrenRepository: ChildrenRepository;
  private readonly householdAllergensRepository: HouseholdAllergensRepository;
  private readonly voiceTranscriptRepository: VoiceTranscriptRepository;
  private readonly memoryService?: MemoryService;
  private readonly familyLanguageRepository?: FamilyLanguageRepository;
  private readonly voiceUsageRepository?: VoiceUsageRepository;

  constructor(deps: LumiServiceDeps) {
    this.repository = deps.repository;
    this.redis = deps.redis;
    this.logger = deps.logger;
    this.elevenLabsApiKey = deps.elevenLabsApiKey;
    this.voiceId = deps.voiceId;
    this.openai = deps.openai;
    this.childrenRepository = deps.childrenRepository;
    this.householdAllergensRepository = deps.householdAllergensRepository;
    this.voiceTranscriptRepository = deps.voiceTranscriptRepository;
    this.memoryService = deps.memoryService;
    this.familyLanguageRepository = deps.familyLanguageRepository;
    this.voiceUsageRepository = deps.voiceUsageRepository;
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

    // Lazy-resolve the ambient thread. The thread row carries `modality='voice'`
    // because Story 12.4 left the column NOT NULL; the `threads_one_active_per_household_type`
    // partial index is modality-agnostic, so this value is stored but is not
    // enforced by uniqueness — voice and text turns will share this same row
    // (ADR-002 Decision 3). A future story may relax `modality NOT NULL` and
    // backfill these rows to NULL; not blocking on it.
    const existing = await this.repository.findActiveAmbientThread(
      input.householdId,
      surface,
    );
    const thread =
      existing ??
      (await this.repository.createAmbientThread(input.householdId, surface, 'voice'));

    // Story 5-S5b — no ElevenLabs credential pre-mint any more. The session is
    // just a bound id: the browser opens HiveKitchen's own /v1/lumi/voice/ws
    // with its JWT + this id, and the server owns Scribe STT + TTS.
    const session: TalkSessionRow = await this.repository.createTalkSession({
      userId: input.userId,
      householdId: input.householdId,
      threadId: thread.id,
    });

    // Best-effort 20s inactivity sentinel. Auto-close consumer arrives in
    // Story 12.8; for now this is just a TTL stamp.
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

  // Story 5-S5b — process one complete voice utterance arriving over the ambient
  // Lumi WebSocket. Mirrors the onboarding VoiceService turn loop but drives the
  // LumiAgent (via submitTextTurn) instead of the OnboardingAgent. STT is raw
  // ElevenLabs Scribe (REST); the reply is synthesized via ElevenLabs TTS and
  // streamed back as binary frames; persistence (thread_turns + voice_transcript)
  // is exactly the 5-S5 path because it flows through submitTextTurn.
  //
  // Non-fatal by design: a single STT/agent/TTS failure emits an `error` frame
  // and returns without closing the socket — the user simply speaks again. The
  // `state.isProcessing` single-flight guard drops any frame that arrives while
  // a turn is in flight (matches the onboarding guard).
  async processVoiceUtterance(
    state: LumiVoiceWsState,
    wav: Buffer,
    ws: WebSocket,
  ): Promise<void> {
    if (state.contextSignal === null) {
      this.logger.warn(
        { module: 'lumi', action: 'lumi.voice.utterance_before_context' },
        'audio frame arrived before the context frame — dropping',
      );
      return;
    }

    if (state.isProcessing) {
      this.logger.warn(
        { module: 'lumi', action: 'lumi.voice.turn_dropped_concurrent' },
        'binary frame dropped — turn already in flight',
      );
      return;
    }

    if (wav.length > MAX_AUDIO_BYTES) {
      this.logger.warn(
        { module: 'lumi', action: 'lumi.voice.audio_too_large', bytes: wav.length },
        'audio frame exceeds size limit — dropping',
      );
      this.sendJson(ws, { type: 'error', code: 'audio_too_large', message: 'Audio clip too long — please speak in shorter segments' });
      return;
    }

    const contextSignal = state.contextSignal;
    state.isProcessing = true;
    const seq = ++state.seq;

    try {
      // 5-S16 — standard-tier weekly cap check. Run INSIDE the isProcessing lock
      // so a concurrent utterance from the same WS session is dropped by the
      // guard above while this DB read is in flight; the `finally` always
      // releases the lock, so a cap-reached early return never leaves it stuck.
      // Fail-open: an unreachable usage table never blocks the user.
      // 5-S16 — capture the current week key once so the cap check and usage
      // increment always attribute to the same ISO week, avoiding a
      // Monday-UTC-midnight race where two getWeekStart() calls straddle rollover.
      const weekStart = getWeekStart();

      if (this.voiceUsageRepository) {
        let consumed = 0;
        try {
          consumed = await this.voiceUsageRepository.getWeeklyUsage(state.userId, weekStart);
        } catch (err) {
          this.logger.warn(
            { err, module: 'lumi', action: 'lumi.voice.usage_read_failed' },
            'voice usage read failed — failing open (not capping)',
          );
        }
        if (consumed >= STANDARD_TIER_CAP_MS) {
          this.logger.info(
            { module: 'lumi', action: 'lumi.voice.cap_reached', user_id: state.userId, ms_consumed: consumed },
            'voice tier cap reached — rejecting utterance',
          );
          this.sendJson(ws, { type: 'error', code: 'voice_cap_reached', message: VOICE_CAP_COPY });
          return;
        }
      }

      let transcript: string;
      try {
        transcript = await transcribeWav(this.elevenLabsApiKey, wav);
      } catch (err) {
        this.logger.warn(
          { err, module: 'lumi', action: 'lumi.voice.stt_failed' },
          'ElevenLabs STT failed — sending non-fatal error frame',
        );
        this.sendJson(ws, { type: 'error', code: 'stt_failed', message: STT_FAILED_COPY });
        return;
      }

      // 5-S16 — increment usage after successful STT (duration now known). Fire-
      // and-forget with a .catch(): the increment is best-effort and must never
      // delay or abort the in-flight turn; the cap check fails-open for the same
      // reason. The .catch() also prevents an unhandled-rejection warning.
      if (this.voiceUsageRepository) {
        const durationMs = Math.round(estimateWavDurationMs(wav));
        if (durationMs > 0) {
          this.voiceUsageRepository
            .incrementUsage(state.userId, weekStart, durationMs)
            .catch((err: unknown) => {
              this.logger.warn(
                { err, module: 'lumi', action: 'lumi.voice.usage_increment_failed', duration_ms: durationMs },
                'voice usage increment failed — best-effort, continuing',
              );
            });
        }
      }

      if (transcript.trim().length === 0) {
        // Scribe heard nothing intelligible — treat like a soft miss.
        this.sendJson(ws, { type: 'error', code: 'stt_failed', message: STT_FAILED_COPY });
        return;
      }

      this.sendJson(ws, { type: 'transcript', seq, text: transcript });
      // Slice 5-S6 — non-verbal "thinking" signal for the real STT→reply gap.
      // No speech is emitted in this gap; the client renders a calm orb pulse.
      // Today this fires on every turn (LumiAgent.respond does not tool-call, so
      // estimated tool latency is ~0). TODO(5-S6-D / Epic 12 phase 2): when a
      // tool-calling conversational orchestrator lands, gate this on
      // classifyLatency(plannedTools).mode === 'thinking-pulse'.
      this.sendJson(ws, { type: 'lumi.thinking', seq });

      let result: Awaited<ReturnType<typeof this.submitTextTurn>>;
      try {
        result = await this.submitTextTurn({
          householdId: state.householdId,
          userId: state.userId, // 5-S15
          voiceRetentionMode: state.voiceRetentionMode, // 5-S15
          message: transcript,
          contextSignal,
          modality: 'voice',
        });
      } catch (err) {
        this.logger.warn(
          { err, module: 'lumi', action: 'lumi.voice.agent_failed' },
          'LumiAgent turn failed — sending non-fatal error frame',
        );
        this.sendJson(ws, { type: 'error', code: 'agent_failed', message: AGENT_FAILED_COPY });
        return;
      }

      const reply =
        result.lumi_turn.body.type === 'message' ? result.lumi_turn.body.content : '';

      this.sendJson(ws, { type: 'response.start', seq });

      if (reply.trim().length === 0) {
        // Empty agent reply — skip TTS, close the turn immediately with no audio.
        this.sendJson(ws, { type: 'response.end', seq, text: reply });
        return;
      }

      try {
        await streamTtsToWs(this.elevenLabsApiKey, this.voiceId, reply, ws);
      } catch (err) {
        this.logger.warn(
          { err, module: 'lumi', action: 'lumi.voice.tts_failed' },
          'ElevenLabs TTS streaming failed — sending reply text + non-fatal error frame',
        );
        // Close the open turn so the client can show the reply, then report.
        this.sendJson(ws, { type: 'response.end', seq, text: reply });
        this.sendJson(ws, { type: 'error', code: 'tts_failed', message: TTS_FAILED_COPY });
        return;
      }

      this.sendJson(ws, { type: 'response.end', seq, text: reply });
    } finally {
      state.isProcessing = false;
    }
  }

  private sendJson(ws: WebSocket, payload: object): void {
    try {
      ws.send(JSON.stringify(payload));
    } catch (err) {
      this.logger.warn(
        { err, module: 'lumi', action: 'lumi.voice.ws_send_failed' },
        'voice WebSocket send failed (client likely disconnected)',
      );
    }
  }

  // Ambient text turn (Story 12-S8 stub; 12-S9 real dispatch). Lazy-resolves the
  // per-surface ambient thread, fetches conversation history + the household
  // snapshot, asks the real LumiAgent (gpt-4o) for a reply, persists the user
  // turn and the reply, and returns both. The thread row is modality-agnostic
  // (ADR-002 Decision 3) — created with `modality='text'` here but shared with
  // any voice turns on the same surface.
  async submitTextTurn(input: {
    householdId: string;
    message: string;
    contextSignal: LumiContextSignal;
    // 5-S5 — voice turns pass 'voice'; text turns omit it (defaults to 'text').
    // Stamps thread_turns.modality and gates voice_transcripts persistence.
    modality?: 'text' | 'voice';
    // 5-S15 — passed for voice turns: scopes the transcript row to the user and
    // skips the insert entirely when the user has chosen immediate-delete mode.
    userId?: string;
    voiceRetentionMode?: 'standard' | 'immediate_delete';
    // 5-S10 — present only when this turn crossed a family-language ratification
    // threshold. processVoiceUtterance ignores it (live voice surfacing deferred).
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

    // Fetch prior turns BEFORE inserting the new user turn so the current
    // message is not duplicated (it travels separately as `message`). A
    // brand-new thread has no history.
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
    });

    const lumiTurn = await this.repository.insertTurn({
      threadId: thread.id,
      role: 'lumi',
      body: { type: 'message', content: lumiText },
      modality,
    });

    // 5-S7 — passive enrichment. Fire-and-forget: never blocks the text or voice
    // turn response. Source ref anchors to the user turn so Visible Memory can
    // link back to the conversation. subject_child_id is always null here; Lumi
    // detects household-level signals only (per-child linking is a future slice).
    void this.runPassiveEnrichment(input.householdId, userTurn.id, thread.id, input.message, lumiText);

    // 5-S5 — persist the user's speech transcript, anchored to the Lumi turn.
    // Best-effort: a transcript write failure must never block the voice turn
    // from returning (the caption is already shown client-side; losing the
    // persistence is a degraded-mode issue, not a fatal error).
    if (modality === 'voice' && input.voiceRetentionMode !== 'immediate_delete') {
      // 5-S15: skip the insert entirely when the user chose immediate-delete mode.
      try {
        await this.voiceTranscriptRepository.insertTranscript(
          thread.id,
          lumiTurn.id,
          input.message,
          90, // default retention days
          input.userId, // undefined for text callers; set for voice callers (5-S15)
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

    // 5-S10 — inline family-language detection. Unlike 5-S7's fire-and-forget
    // enrichment, this is awaited: the ratification turn IS part of the response
    // (AC3), and detection is a synchronous dictionary scan + one cheap
    // read-modify-write. Best-effort: any failure here must never break the
    // user's turn (it is an enhancement, not the reply).
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
          const first = newlyCandidate[0]; // one prompt at a time — keep it calm (UX)
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

  // 5-S7 — passive memory enrichment. Best-effort, fire-and-forget extraction of
  // memory-worthy signals from one parent↔Lumi exchange. MUST catch all errors
  // internally: it runs as `void this.runPassiveEnrichment(...)`, so an uncaught
  // rejection would surface as an unhandledRejection. Three guard layers: the
  // OpenAI call, JSON.parse, and each per-signal note write.
  private async runPassiveEnrichment(
    householdId: string,
    turnId: string,
    threadId: string,
    userMessage: string,
    lumiReply: string,
  ): Promise<void> {
    if (!this.memoryService) return; // nudge-job path has no memoryService
    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: ENRICHMENT_SYSTEM_PROMPT },
          { role: 'user', content: `Parent: ${userMessage}\nLumi: ${lumiReply}` },
        ],
        max_tokens: 400,
        temperature: 0, // deterministic extraction, not creative generation
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

  // Story 12-S11 — proactive nudge. Fetches the household snapshot, lazy-resolves
  // the surface ambient thread, asks the agent for a one-shot warm message,
  // persists it as a `lumi` turn (stamped with nudgeTrigger for traceability),
  // and sets a 30-min Redis rate-limit gate (SET NX — never resets a live
  // window; S12 reads it to suppress the orb SSE). Persistence is unconditional;
  // the rate-limit gate is best-effort. This method MAY throw — the caller
  // (lumi-nudge job) is fire-and-forget and wraps it in its own try/catch.
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

    // SET NX EX 1800 — set only if not already set, so a live rate-limit window
    // is never reset. ioredis returns null on the NX no-op; we don't branch on it.
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

  // Story 12-S9 — assemble the `# Household Snapshot` block the agent injects
  // into its system prompt. The API owns this read; the agent never touches the
  // DB (ADR-002). Display name + each child's first name, age band, and active
  // allergens, in a readable single-block format.
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

    // 5-S10 — forward-only family-language ratchet (UX-DR47). Once a kinship
    // term is 'active', Lumi must use the household's exact word and never the
    // generic English equivalent. Skipped when the repo is absent (no-op for the
    // nudge-job ctor path that does not wire it).
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
      // Not found and not-owned both collapse to 403 to avoid leaking session
      // existence to other users.
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
