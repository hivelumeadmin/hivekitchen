import type { FastifyBaseLogger } from 'fastify';
import { ConflictError, ForbiddenError, NotFoundError, UpstreamError } from '../../common/errors.js';
import { stripExpressionTags } from '../../common/strip-expression-tags.js';
import type { OnboardingAgent, LlmMessage } from '../../agents/onboarding.agent.js';
import type { CulturalPriorService } from '../cultural-priors/cultural-prior.service.js';
import type { MemoryService } from '../memory/memory.service.js';
import type { VoiceRepository, TurnRow } from './voice.repository.js';

const SESSION_TIMEOUT_MS = 10 * 60 * 1000;

type CloseReason = 'completed' | 'timed_out' | 'client_disconnect';

interface OnboardingSummary {
  cultural_templates: string[];
  palate_notes: string[];
  allergens_mentioned: string[];
  family_rhythms: string[];
}

// In-memory per-session state. At beta scale a per-instance Map is sufficient.
interface Session {
  sessionId: string;
  userId: string;
  householdId: string;
  threadId: string;
  messages: LlmMessage[];
  startedAt: Date;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
}

export interface VoiceServiceDeps {
  repository: VoiceRepository;
  agent: OnboardingAgent;
  culturalPriorService: CulturalPriorService;
  elevenLabsApiKey: string;
  voiceId: string;
  ttsModelId: string;
  logger: FastifyBaseLogger;
  memoryService?: MemoryService;
}

export class VoiceService {
  private readonly repository: VoiceRepository;
  private readonly agent: OnboardingAgent;
  private readonly culturalPriorService: CulturalPriorService;
  private readonly elevenLabsApiKey: string;
  private readonly voiceId: string;
  private readonly ttsModelId: string;
  private readonly logger: FastifyBaseLogger;
  private readonly memoryService?: MemoryService;
  private readonly sessions = new Map<string, Session>();

  constructor(deps: VoiceServiceDeps) {
    this.repository = deps.repository;
    this.agent = deps.agent;
    this.culturalPriorService = deps.culturalPriorService;
    this.elevenLabsApiKey = deps.elevenLabsApiKey;
    this.voiceId = deps.voiceId;
    this.ttsModelId = deps.ttsModelId;
    this.logger = deps.logger;
    this.memoryService = deps.memoryService;
  }

  async createSession(userId: string, householdId: string): Promise<{ sessionId: string }> {
    const existing = await this.repository.findActiveSessionForHousehold(householdId);
    if (existing !== null) {
      const ageMs = Date.now() - new Date(existing.started_at).getTime();
      if (ageMs < SESSION_TIMEOUT_MS) {
        throw new ConflictError(
          'Active voice session already exists for this household — close it before creating a new one',
        );
      }
      // Orphaned row from a server restart — the in-memory timeout never fired.
      // Expire both the session and its thread so the new session can proceed.
      await Promise.allSettled([
        this.repository.updateVoiceSession(existing.id, {
          status: 'timed_out',
          ended_at: new Date().toISOString(),
        }),
        this.repository.closeThread(existing.thread_id),
      ]);
    }

    const thread = await this.repository.createThread(householdId, 'onboarding', 'voice');
    let dbSession: Awaited<ReturnType<typeof this.repository.createVoiceSession>>;
    try {
      dbSession = await this.repository.createVoiceSession({
        userId,
        householdId,
        threadId: thread.id,
        elevenLabsConversationId: null,
      });
    } catch (err) {
      try { await this.repository.closeThread(thread.id); } catch { /* noop */ }
      throw err;
    }

    const session: Session = {
      sessionId: dbSession.id,
      userId,
      householdId,
      threadId: thread.id,
      messages: [],
      startedAt: new Date(dbSession.started_at),
      timeoutHandle: null,
    };
    session.timeoutHandle = setTimeout(() => {
      void this.handleTimeout(dbSession.id);
    }, SESSION_TIMEOUT_MS);
    this.sessions.set(dbSession.id, session);

    return { sessionId: dbSession.id };
  }

  async deleteSession(sessionId: string, userId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return; // already completed or expired — idempotent
    if (session.userId !== userId) throw new ForbiddenError('Not authorized to close this session');
    await this.closeSession(sessionId, 'client_disconnect');
  }

  // REST-based onboarding voice turn (replaces the old WS binary audio proxy).
  // The browser transcribes audio via ElevenLabs Scribe WS (using a token from
  // issueSttToken), then calls this endpoint with the transcript text. The agent
  // processes it and returns the reply. When complete: true, summary + priors
  // are included and the session is automatically closed.
  async processTextTurn(
    sessionId: string,
    userId: string,
    transcript: string,
  ): Promise<{
    reply: string;
    complete: boolean;
    summary?: OnboardingSummary;
    cultural_priors_detected?: boolean;
  }> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new NotFoundError('voice session not found or already closed');
    if (session.userId !== userId) throw new ForbiddenError('auth failed');

    session.messages.push({ role: 'user', content: transcript });

    let agentReply: { text: string; complete: boolean };
    try {
      agentReply = await this.agent.respond(session.messages, { modality: 'voice' });
    } catch (err) {
      session.messages.pop(); // revert so next turn has balanced history
      throw err;
    }

    const strippedText = stripExpressionTags(agentReply.text);

    await this.repository.appendTurnNext({
      threadId: session.threadId,
      role: 'user',
      body: { type: 'message', content: transcript },
      modality: 'voice',
    });
    await this.repository.appendTurnNext({
      threadId: session.threadId,
      role: 'lumi',
      body: { type: 'message', content: strippedText },
      modality: 'voice',
    });
    session.messages.push({ role: 'assistant', content: strippedText });

    if (!agentReply.complete) {
      return { reply: strippedText, complete: false };
    }

    // Session complete — extract summary, persist, then close
    const transcriptTurns = session.messages.map((m) => ({
      role: m.role === 'assistant' ? 'agent' : m.role,
      message: m.content,
    }));

    let summary: OnboardingSummary;
    try {
      summary = await this.agent.extractSummary(transcriptTurns);
    } catch (err) {
      this.logger.error(
        { err, module: 'voice', action: 'voice.summary_extraction_failed', session_id: sessionId },
        'onboarding summary extraction failed — closing without summary',
      );
      await this.closeSession(sessionId, 'timed_out');
      throw new UpstreamError('Onboarding summary extraction failed — please try again');
    }

    let summaryTurn: TurnRow | null = null;
    try {
      summaryTurn = await this.repository.appendTurnNext({
        threadId: session.threadId,
        role: 'system',
        body: {
          type: 'system_event',
          event: 'onboarding.summary',
          payload: { ...summary } as Record<string, unknown>,
        },
        modality: 'voice',
      });
    } catch (err) {
      this.logger.warn(
        { err, module: 'voice', action: 'voice.summary_turn_persist_failed', session_id: sessionId },
        'failed to persist onboarding.summary system_event turn',
      );
    }

    let culturalPriorsDetected = false;
    try {
      const result = await this.culturalPriorService.inferFromSummary({
        householdId: session.householdId,
        threadId: session.threadId,
        transcript: transcriptTurns,
      });
      culturalPriorsDetected = result.detectedCount > 0;
    } catch (err) {
      this.logger.warn(
        { err, module: 'voice', action: 'voice.cultural_inference_failed', session_id: sessionId },
        'cultural prior inference failed — silence-mode fallback',
      );
    }

    if (this.memoryService && summaryTurn !== null) {
      try {
        await this.memoryService.seedFromOnboarding({
          householdId: session.householdId,
          userId: session.userId,
          threadId: session.threadId,
          summaryTurnId: summaryTurn.id,
          summary,
        });
      } catch (err) {
        this.logger.warn(
          { err, module: 'voice', action: 'voice.memory_seed_failed', session_id: sessionId },
          'memory seed failed — silence-mode fallback',
        );
      }
    }

    await this.closeSession(sessionId, 'completed');
    return { reply: strippedText, complete: true, summary, cultural_priors_detected: culturalPriorsDetected };
  }

  // Slice 2-S20 — TTS single-use token (browser-direct TTS WebSocket).
  async issueTtsToken(): Promise<{ token: string; voice_id: string; model_id: string }> {
    const url = 'https://api.elevenlabs.io/v1/single-use-token/tts_websocket';
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'xi-api-key': this.elevenLabsApiKey },
      });
    } catch (err) {
      throw new UpstreamError(
        `ElevenLabs TTS token request failed: ${err instanceof Error ? err.message : 'network error'}`,
      );
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '<unreadable>');
      this.logger.error(
        { module: 'voice', action: 'tts.token_mint_failed', status: res.status, body },
        'ElevenLabs TTS single-use-token mint failed',
      );
      throw new UpstreamError(
        `ElevenLabs TTS token mint failed: HTTP ${res.status} — ${body.slice(0, 300)}`,
      );
    }
    let json: { token?: unknown };
    try {
      json = (await res.json()) as { token?: unknown };
    } catch {
      throw new UpstreamError('ElevenLabs TTS token response was not valid JSON');
    }
    if (typeof json.token !== 'string' || json.token.length === 0) {
      throw new UpstreamError('ElevenLabs TTS token response missing token');
    }
    return { token: json.token, voice_id: this.voiceId, model_id: this.ttsModelId };
  }

  // STT single-use token for browser-direct ElevenLabs Scribe WebSocket.
  // Browser connects to wss://api.elevenlabs.io/v1/speech-to-text/realtime?token=<token>
  // and streams PCM audio directly. Audio never transits the HK API.
  async issueSttToken(): Promise<{ token: string }> {
    const url = 'https://api.elevenlabs.io/v1/single-use-token/realtime_scribe';
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'xi-api-key': this.elevenLabsApiKey },
      });
    } catch (err) {
      throw new UpstreamError(
        `ElevenLabs STT token request failed: ${err instanceof Error ? err.message : 'network error'}`,
      );
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '<unreadable>');
      this.logger.error(
        { module: 'voice', action: 'stt.token_mint_failed', status: res.status, body },
        'ElevenLabs STT single-use-token mint failed',
      );
      throw new UpstreamError(
        `ElevenLabs STT token mint failed: HTTP ${res.status} — ${body.slice(0, 300)}`,
      );
    }
    let json: { token?: unknown };
    try {
      json = (await res.json()) as { token?: unknown };
    } catch {
      throw new UpstreamError('ElevenLabs STT token response was not valid JSON');
    }
    if (typeof json.token !== 'string' || json.token.length === 0) {
      throw new UpstreamError('ElevenLabs STT token response missing token');
    }
    return { token: json.token };
  }

  private async handleTimeout(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.logger.info(
      { module: 'voice', action: 'voice.session_timeout', session_id: sessionId },
      'voice session timed out after 10 minutes of inactivity',
    );
    await this.closeSession(sessionId, 'timed_out');
  }

  private async closeSession(sessionId: string, reason: CloseReason): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);

    if (session.timeoutHandle !== null) {
      clearTimeout(session.timeoutHandle);
      session.timeoutHandle = null;
    }

    const dbStatus =
      reason === 'completed' ? 'closed' : reason === 'timed_out' ? 'timed_out' : 'disconnected';

    try {
      await this.repository.closeThread(session.threadId);
    } catch (err) {
      this.logger.warn(
        { err, module: 'voice', action: 'voice.close_thread_failed', session_id: sessionId },
        'failed to close onboarding thread',
      );
    }

    try {
      await this.repository.updateVoiceSession(session.sessionId, {
        status: dbStatus,
        ended_at: new Date().toISOString(),
      });
    } catch (err) {
      this.logger.error(
        { err, module: 'voice', action: 'voice.update_session_failed', session_id: sessionId },
        'failed to update voice session status during close',
      );
    }

    this.logger.info(
      {
        module: 'voice',
        action: 'voice.session_ended',
        session_id: sessionId,
        user_id: session.userId,
        household_id: session.householdId,
        reason,
        turn_count: session.messages.length,
      },
      'voice session ended',
    );
  }
}
