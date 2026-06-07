import type { Buffer } from 'node:buffer';
import type { FastifyBaseLogger } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import type Redis from 'ioredis';
import type OpenAI from 'openai';
import type { LumiSurface, LumiContextSignal, NudgeTrigger, Turn } from '@hivekitchen/types';
import { ForbiddenError, ValidationError } from '../../common/errors.js';
import { LumiAgent } from '../../agents/lumi.agent.js';
import { transcribeWav, streamTtsToWs } from '../voice/elevenlabs-audio.js';
import type { ChildrenRepository } from '../children/children.repository.js';
import type { HouseholdAllergensRepository } from '../households/household-allergens.repository.js';
import type { VoiceTranscriptRepository } from '../voice/voice-transcript.repository.js';
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
  }): Promise<{ thread_id: string; user_turn: Turn; lumi_turn: Turn }> {
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

    // 5-S5 — persist the user's speech transcript, anchored to the Lumi turn.
    // Best-effort: a transcript write failure must never block the voice turn
    // from returning (the caption is already shown client-side; losing the
    // persistence is a degraded-mode issue, not a fatal error).
    if (modality === 'voice') {
      try {
        await this.voiceTranscriptRepository.insertTranscript(
          thread.id,
          lumiTurn.id,
          input.message,
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

    return { thread_id: thread.id, user_turn: userTurn, lumi_turn: lumiTurn };
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
