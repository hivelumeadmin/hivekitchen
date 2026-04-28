import type { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import type { FastifyBaseLogger } from 'fastify';
import type { ElevenLabsPostCallWebhook } from '@hivekitchen/types';
import { NotFoundError, UpstreamError } from '../../common/errors.js';
import { stripExpressionTags } from '../../common/strip-expression-tags.js';
import type { OnboardingAgent, LlmMessage } from '../../agents/onboarding.agent.js';
import type { VoiceRepository } from './voice.repository.js';

const CLOSING_PHRASE =
  "[warmly] That's everything I needed — let me put together your first plan.";
const SESSION_TIMEOUT_MS = 10 * 60 * 1000;

// ElevenLabs SDK returns conversationId at runtime but it's not in the typed response model
type SignedUrlResultWithConversationId = { signedUrl: string; conversationId?: string };

export interface VoiceServiceDeps {
  repository: VoiceRepository;
  elevenlabs: ElevenLabsClient;
  agent: OnboardingAgent;
  agentId: string;
  logger: FastifyBaseLogger;
}

export class VoiceService {
  private readonly repository: VoiceRepository;
  private readonly elevenlabs: ElevenLabsClient;
  private readonly agent: OnboardingAgent;
  private readonly agentId: string;
  private readonly logger: FastifyBaseLogger;

  constructor(deps: VoiceServiceDeps) {
    this.repository = deps.repository;
    this.elevenlabs = deps.elevenlabs;
    this.agent = deps.agent;
    this.agentId = deps.agentId;
    this.logger = deps.logger;
  }

  async createVoiceSession(
    userId: string,
    householdId: string,
  ): Promise<{ token: string; sessionId: string }> {
    let signedUrl: string;
    let conversationId: string;

    try {
      const result = await this.elevenlabs.conversationalAi.conversations.getSignedUrl({
        agentId: this.agentId,
        includeConversationId: true,
      });
      const typed = result as unknown as SignedUrlResultWithConversationId;
      signedUrl = typed.signedUrl;
      const candidate = typed.conversationId;
      if (typeof candidate !== 'string' || candidate.length === 0) {
        throw new UpstreamError(
          'ElevenLabs signed URL response missing conversationId — cannot persist session key',
        );
      }
      conversationId = candidate;
    } catch (err) {
      if (err instanceof UpstreamError) throw err;
      throw new UpstreamError(
        `ElevenLabs signed URL unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const thread = await this.repository.createThread(householdId, 'onboarding', 'voice');
    const session = await this.repository.createVoiceSession({
      userId,
      householdId,
      threadId: thread.id,
      elevenLabsConversationId: conversationId,
    });

    return { token: signedUrl, sessionId: session.id };
  }

  async generateLlmResponse(
    elevenLabsConversationId: string,
    messages: LlmMessage[],
  ): Promise<string> {
    const session = await this.repository.findSessionByConversationId(elevenLabsConversationId);
    if (!session) {
      throw new NotFoundError(`No voice session for conversation ${elevenLabsConversationId}`);
    }

    const elapsed = Date.now() - new Date(session.started_at).getTime();
    if (elapsed >= SESSION_TIMEOUT_MS) {
      await this.repository.updateVoiceSession(session.id, {
        status: 'timed_out',
        ended_at: new Date().toISOString(),
      });
      this.logger.info(
        {
          module: 'voice',
          action: 'voice.session_ended',
          session_id: session.id,
          user_id: session.user_id,
          household_id: session.household_id,
          reason: 'timed_out',
        },
        'voice session timed out',
      );
      return CLOSING_PHRASE;
    }

    return this.agent.respond(messages);
  }

  async processPostCallWebhook(payload: ElevenLabsPostCallWebhook): Promise<void> {
    if (payload.type !== 'post_call_transcription') return;

    // Defense-in-depth: verify the agent_id matches our configured agent.
    if (payload.data.agent_id !== this.agentId) {
      this.logger.warn(
        {
          module: 'voice',
          action: 'webhook.agent_id_mismatch',
          received_agent_id: payload.data.agent_id,
          conversation_id: payload.data.conversation_id,
        },
        'ElevenLabs webhook agent_id does not match configured agent — ignoring',
      );
      return;
    }

    const session = await this.repository.findSessionByConversationId(payload.data.conversation_id);
    if (!session) {
      this.logger.warn(
        {
          module: 'voice',
          action: 'webhook.session_not_found',
          conversation_id: payload.data.conversation_id,
        },
        'ElevenLabs webhook references unknown conversation_id — ignoring',
      );
      return;
    }

    // Idempotency: ElevenLabs webhooks are at-least-once. If the session is
    // already closed/timed_out we have already persisted the transcript on a
    // prior delivery, so short-circuit instead of duplicating turns.
    if (session.status !== 'active') {
      this.logger.info(
        {
          module: 'voice',
          action: 'webhook.duplicate_delivery',
          conversation_id: payload.data.conversation_id,
          session_id: session.id,
          session_status: session.status,
        },
        'ElevenLabs webhook replayed for non-active session — ignoring',
      );
      return;
    }

    const transcript = payload.data.transcript ?? [];

    for (let i = 0; i < transcript.length; i++) {
      const turn = transcript[i];
      if (!turn) continue;
      const isAgent = turn.role === 'agent';
      // Spec Schema Design: persist Lumi response with TTS expression tags stripped.
      const content = isAgent ? stripExpressionTags(turn.message) : turn.message;
      await this.repository.appendTurnNext({
        threadId: session.thread_id,
        role: isAgent ? 'lumi' : 'user',
        body: { type: 'message', content },
        modality: 'voice',
      });
    }

    let summary: { cultural_templates: string[]; palate_notes: string[]; allergens_mentioned: string[] } =
      { cultural_templates: [], palate_notes: [], allergens_mentioned: [] };

    try {
      summary = await this.agent.extractSummary(transcript);
    } catch (err) {
      this.logger.warn(
        {
          err,
          module: 'voice',
          action: 'webhook.summary_extraction_failed',
          conversation_id: payload.data.conversation_id,
          session_id: session.id,
        },
        'onboarding summary extraction failed — persisting empty summary',
      );
    }

    await this.repository.appendTurnNext({
      threadId: session.thread_id,
      role: 'system',
      body: {
        type: 'system_event',
        event: 'onboarding.summary',
        payload: summary,
      },
      modality: 'text',
    });

    // Close the onboarding thread itself (not just the voice session) so the
    // text-onboarding completion gate (householdHasCompletedOnboarding) finds
    // a closed thread carrying the summary turn and refuses re-onboarding.
    await this.repository.closeThread(session.thread_id);

    await this.repository.updateVoiceSession(session.id, {
      status: 'closed',
      ended_at: new Date().toISOString(),
    });

    this.logger.info(
      {
        module: 'voice',
        action: 'voice.session_ended',
        session_id: session.id,
        user_id: session.user_id,
        household_id: session.household_id,
        reason: 'closed',
        turn_count: transcript.length,
      },
      'voice session closed via post-call webhook',
    );
  }
}
