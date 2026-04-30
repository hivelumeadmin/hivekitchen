import { Buffer } from 'node:buffer';
import type { FastifyBaseLogger } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import { ConflictError, UpstreamError } from '../../common/errors.js';
import { stripExpressionTags } from '../../common/strip-expression-tags.js';
import type { OnboardingAgent, LlmMessage } from '../../agents/onboarding.agent.js';
import type { CulturalPriorService } from '../cultural-priors/cultural-prior.service.js';
import type { VoiceRepository } from './voice.repository.js';

const SESSION_TIMEOUT_MS = 10 * 60 * 1000;

const WS_CLOSE_NORMAL = 1000;
const WS_CLOSE_AUTH_FAILED = 4001;
const WS_CLOSE_NOT_FOUND = 4004;

type CloseReason = 'completed' | 'timed_out' | 'client_disconnect';

interface OnboardingSummary {
  cultural_templates: string[];
  palate_notes: string[];
  allergens_mentioned: string[];
}

interface WsSession {
  sessionId: string;
  userId: string;
  householdId: string;
  threadId: string;
  seq: number;
  messages: LlmMessage[];
  isProcessing: boolean;
  startedAt: Date;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
}

export interface VoiceServiceDeps {
  repository: VoiceRepository;
  agent: OnboardingAgent;
  culturalPriorService: CulturalPriorService;
  elevenLabsApiKey: string;
  voiceId: string;
  logger: FastifyBaseLogger;
}

export class WsAuthFailedError extends Error {
  readonly code = WS_CLOSE_AUTH_FAILED;
}

export class WsSessionNotFoundError extends Error {
  readonly code = WS_CLOSE_NOT_FOUND;
}

// In-memory WS session store. At beta scale (150 concurrent HH) a per-instance
// Map is sufficient. See deferred-work.md for the Redis-backed upgrade once
// the API runs behind a load balancer.
export class VoiceService {
  private readonly repository: VoiceRepository;
  private readonly agent: OnboardingAgent;
  private readonly culturalPriorService: CulturalPriorService;
  private readonly elevenLabsApiKey: string;
  private readonly voiceId: string;
  private readonly logger: FastifyBaseLogger;
  private readonly sessions = new Map<string, WsSession>();

  constructor(deps: VoiceServiceDeps) {
    this.repository = deps.repository;
    this.agent = deps.agent;
    this.culturalPriorService = deps.culturalPriorService;
    this.elevenLabsApiKey = deps.elevenLabsApiKey;
    this.voiceId = deps.voiceId;
    this.logger = deps.logger;
  }

  async createSession(
    userId: string,
    householdId: string,
  ): Promise<{ sessionId: string }> {
    const existing = await this.repository.findActiveSessionForHousehold(householdId);
    if (existing !== null) {
      throw new ConflictError(
        'Active voice session already exists for this household — close it before creating a new one',
      );
    }

    const thread = await this.repository.createThread(householdId, 'onboarding', 'voice');
    const session = await this.repository.createVoiceSession({
      userId,
      householdId,
      threadId: thread.id,
      elevenLabsConversationId: null,
    });

    return { sessionId: session.id };
  }

  async openWsSession(sessionId: string, userId: string, ws: WebSocket): Promise<void> {
    const session = await this.repository.findVoiceSession(sessionId);
    if (session === null || session.status !== 'active') {
      throw new WsSessionNotFoundError(`voice session ${sessionId} not found or not active`);
    }
    if (session.user_id !== userId) {
      throw new WsAuthFailedError('JWT user does not match session owner');
    }

    const wsSession: WsSession = {
      sessionId: session.id,
      userId: session.user_id,
      householdId: session.household_id,
      threadId: session.thread_id,
      seq: 0,
      messages: [],
      isProcessing: false,
      startedAt: new Date(session.started_at),
      timeoutHandle: null,
    };

    const staleSession = this.sessions.get(sessionId);
    if (staleSession?.timeoutHandle != null) {
      clearTimeout(staleSession.timeoutHandle);
    }

    wsSession.timeoutHandle = setTimeout(() => {
      void this.handleTimeout(sessionId, ws);
    }, SESSION_TIMEOUT_MS);

    this.sessions.set(sessionId, wsSession);
    // session.ready is sent by the route handler after message/close listeners
    // are registered to eliminate any theoretical race between receipt and handling.
  }

  async processAudioChunk(sessionId: string, audioBuffer: Buffer, ws: WebSocket): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.logger.warn(
        { module: 'voice', action: 'voice.audio_chunk_unknown_session', session_id: sessionId },
        'audio chunk arrived for unknown session — dropping',
      );
      return;
    }

    if (session.isProcessing) {
      this.logger.warn(
        {
          module: 'voice',
          action: 'voice.turn_dropped_concurrent',
          session_id: sessionId,
        },
        'binary frame dropped — turn already in flight',
      );
      return;
    }

    if (Date.now() - session.startedAt.getTime() >= SESSION_TIMEOUT_MS) {
      await this.handleTimeout(sessionId, ws);
      return;
    }

    session.isProcessing = true;
    const seq = ++session.seq;

    try {
      // STT
      let transcript: string;
      try {
        transcript = await this.transcribe(audioBuffer);
      } catch (err) {
        this.logger.warn(
          { err, module: 'voice', action: 'voice.stt_failed', session_id: sessionId },
          'ElevenLabs STT failed — sending non-fatal error frame',
        );
        this.sendText(ws, {
          type: 'error',
          code: 'stt_failed',
          message: 'Could not hear that — try again',
        });
        return;
      }

      this.sendText(ws, { type: 'transcript', seq, text: transcript });
      session.messages.push({ role: 'user', content: transcript });

      // Agent
      let agentReply: { text: string; complete: boolean };
      try {
        agentReply = await this.agent.respond(session.messages, { modality: 'voice' });
      } catch (err) {
        session.messages.pop(); // revert the user push so the next turn has a balanced history
        this.logger.warn(
          { err, module: 'voice', action: 'voice.agent_failed', session_id: sessionId },
          'OnboardingAgent.respond failed — sending non-fatal error frame',
        );
        this.sendText(ws, {
          type: 'error',
          code: 'agent_failed',
          message: "I'm having a little trouble — could you say that again?",
        });
        return;
      }

      this.sendText(ws, { type: 'response.start', seq });

      try {
        await this.streamTts(agentReply.text, ws);
      } catch (err) {
        this.logger.warn(
          { err, module: 'voice', action: 'voice.tts_failed', session_id: sessionId },
          'ElevenLabs TTS streaming failed mid-stream — sending non-fatal error frame',
        );
        // Close the open turn so the client can recover, then report the error.
        // Pass the stripped text so the client can display it per the error message.
        this.sendText(ws, { type: 'response.end', seq, text: stripExpressionTags(agentReply.text) });
        this.sendText(ws, {
          type: 'error',
          code: 'tts_failed',
          message: 'Voice unavailable — please read the response instead',
        });
        return;
      }

      const strippedText = stripExpressionTags(agentReply.text);
      this.sendText(ws, { type: 'response.end', seq, text: strippedText });

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
      // Push to in-memory history only after both DB writes succeed so the
      // history stays balanced if a write fails (the user turn remains on disk;
      // the next audio chunk retries from the correct in-memory state).
      session.messages.push({ role: 'assistant', content: strippedText });

      if (agentReply.complete) {
        session.isProcessing = false;
        await this.closeSession(sessionId, ws, 'completed');
        return;
      }
    } finally {
      const stillOpen = this.sessions.get(sessionId);
      if (stillOpen) stillOpen.isProcessing = false;
    }
  }

  async onWsClose(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    await this.closeSession(sessionId, null, 'client_disconnect');
  }

  private async handleTimeout(sessionId: string, ws: WebSocket, attempt = 0): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.isProcessing) {
      const MAX_RESCHEDULE_ATTEMPTS = 6; // 30 s cap beyond the 10-min mark
      if (attempt >= MAX_RESCHEDULE_ATTEMPTS) {
        this.logger.error(
          { module: 'voice', action: 'voice.timeout_processing_stuck', session_id: sessionId, attempt },
          'session stuck in isProcessing 30 s past timeout — forcing close',
        );
        session.isProcessing = false;
      } else {
        session.timeoutHandle = setTimeout(() => {
          void this.handleTimeout(sessionId, ws, attempt + 1);
        }, 5000);
        return;
      }
    }

    const seq = ++session.seq;
    const closingText = this.agent.closingPhrase();
    this.sendText(ws, { type: 'response.start', seq });
    try {
      await this.streamTts(closingText, ws);
    } catch (err) {
      this.logger.warn(
        { err, module: 'voice', action: 'voice.tts_failed_on_timeout', session_id: sessionId },
        'TTS streaming failed during timeout closing phrase — closing without audio',
      );
    }
    const strippedText = stripExpressionTags(closingText);
    this.sendText(ws, { type: 'response.end', seq, text: strippedText });

    try {
      await this.repository.appendTurnNext({
        threadId: session.threadId,
        role: 'user',
        body: { type: 'message', content: '[session timed out]' },
        modality: 'voice',
      });
    } catch (err) {
      this.logger.warn(
        { err, module: 'voice', action: 'voice.timeout_user_turn_persist_failed', session_id: sessionId },
        'failed to persist timeout user turn — continuing to close',
      );
    }

    try {
      await this.repository.appendTurnNext({
        threadId: session.threadId,
        role: 'lumi',
        body: { type: 'message', content: strippedText },
        modality: 'voice',
      });
    } catch (err) {
      this.logger.warn(
        { err, module: 'voice', action: 'voice.timeout_turn_persist_failed', session_id: sessionId },
        'failed to persist timeout closing phrase — continuing to close',
      );
    }

    await this.closeSession(sessionId, ws, 'timed_out');
  }

  private async closeSession(
    sessionId: string,
    ws: WebSocket | null,
    reason: CloseReason,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);

    if (session.timeoutHandle !== null) {
      clearTimeout(session.timeoutHandle);
      session.timeoutHandle = null;
    }

    const dbStatus = reason === 'completed' ? 'closed' : reason === 'timed_out' ? 'timed_out' : 'disconnected';

    // For timed_out and client_disconnect: close the thread and voice session
    // without writing an onboarding.summary event. This keeps
    // householdHasCompletedOnboarding returning false so the household can
    // re-enter onboarding via a new voice session.
    if (reason !== 'completed') {
      try {
        await this.repository.closeThread(session.threadId);
      } catch (err) {
        this.logger.warn(
          { err, module: 'voice', action: 'voice.close_thread_failed', session_id: sessionId },
          'failed to close onboarding thread on incomplete session',
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
      if (ws !== null) {
        try {
          ws.close(WS_CLOSE_NORMAL);
        } catch (err) {
          this.logger.warn(
            { err, module: 'voice', action: 'voice.ws_close_failed', session_id: sessionId },
            'WebSocket close call threw',
          );
        }
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
        'voice session ended without summary',
      );
      return;
    }

    // reason === 'completed': extract summary and persist onboarding data.
    const transcriptTurns = session.messages.map((m) => ({
      role: m.role === 'assistant' ? 'agent' : m.role,
      message: m.content,
    }));

    let summary: OnboardingSummary;
    try {
      summary = await this.agent.extractSummary(transcriptTurns);
    } catch (err) {
      // Refuse to persist an empty summary (text path equivalent protection).
      // Close thread so householdHasCompletedOnboarding stays false and the
      // household can re-onboard — the summary event is absent so the check
      // returns false even on a closed thread.
      this.logger.error(
        { err, module: 'voice', action: 'voice.summary_extraction_failed', session_id: sessionId },
        'onboarding summary extraction failed — refusing to persist empty summary',
      );
      if (ws !== null) {
        this.sendText(ws, {
          type: 'error',
          code: 'summary_failed',
          message: 'Could not save your onboarding summary — please try again',
        });
      }
      try {
        await this.repository.closeThread(session.threadId);
      } catch (closeErr) {
        this.logger.warn(
          { err: closeErr, module: 'voice', action: 'voice.close_thread_failed', session_id: sessionId },
          'failed to close thread after summary extraction failure',
        );
      }
      try {
        await this.repository.updateVoiceSession(session.sessionId, {
          status: 'closed',
          ended_at: new Date().toISOString(),
        });
      } catch (updateErr) {
        this.logger.error(
          { err: updateErr, module: 'voice', action: 'voice.update_session_failed', session_id: sessionId },
          'failed to update voice session after summary extraction failure',
        );
      }
      if (ws !== null) {
        try {
          ws.close(1011);
        } catch {
          /* noop */
        }
      }
      this.logger.info(
        {
          module: 'voice',
          action: 'voice.session_ended',
          session_id: sessionId,
          user_id: session.userId,
          household_id: session.householdId,
          reason,
          outcome: 'summary_extraction_failed',
          turn_count: session.messages.length,
        },
        'voice session ended with summary extraction failure',
      );
      return;
    }

    try {
      await this.repository.appendTurnNext({
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
        'cultural prior inference failed during voice close — silence-mode fallback',
      );
    }

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
        status: 'closed',
        ended_at: new Date().toISOString(),
      });
    } catch (err) {
      this.logger.error(
        { err, module: 'voice', action: 'voice.update_session_failed', session_id: sessionId },
        'failed to update voice session status during close',
      );
    }

    if (ws !== null) {
      this.sendText(ws, {
        type: 'session.summary',
        summary,
        cultural_priors_detected: culturalPriorsDetected,
      });
      try {
        ws.close(WS_CLOSE_NORMAL);
      } catch (err) {
        this.logger.warn(
          { err, module: 'voice', action: 'voice.ws_close_failed', session_id: sessionId },
          'WebSocket close call threw',
        );
      }
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
        cultural_priors_detected: culturalPriorsDetected,
      },
      'voice session ended',
    );
  }

  private async transcribe(audioBuffer: Buffer): Promise<string> {
    const form = new FormData();
    const blob = new Blob([new Uint8Array(audioBuffer)], { type: 'audio/wav' });
    form.append('audio', blob, 'utterance.wav');
    form.append('model_id', 'scribe_v1');

    const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': this.elevenLabsApiKey },
      body: form,
    });

    if (!res.ok) {
      throw new UpstreamError(
        `ElevenLabs STT failed: HTTP ${res.status}`,
      );
    }

    const json = (await res.json()) as { text?: unknown };
    if (typeof json.text !== 'string') {
      throw new UpstreamError('ElevenLabs STT returned no transcript text');
    }
    return json.text;
  }

  private async streamTts(text: string, ws: WebSocket): Promise<void> {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': this.elevenLabsApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_v3',
          output_format: 'mp3_44100_128',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.8,
            style: 0.6,
            use_speaker_boost: true,
          },
        }),
      },
    );

    if (!res.ok || res.body === null) {
      throw new UpstreamError(`ElevenLabs TTS failed: HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.byteLength > 0) {
          ws.send(Buffer.from(value));
        }
      }
    } finally {
      reader.cancel().catch(() => { /* noop */ });
    }
  }

  private sendText(ws: WebSocket, payload: object): void {
    try {
      ws.send(JSON.stringify(payload));
    } catch (err) {
      this.logger.warn(
        { err, module: 'voice', action: 'voice.ws_send_failed' },
        'WebSocket send failed (client likely disconnected)',
      );
    }
  }
}
