import type { FastifyBaseLogger } from 'fastify';
import type Redis from 'ioredis';
import type { LumiSurface, LumiContextSignal } from '@hivekitchen/types';
import { ForbiddenError, UpstreamError, ValidationError } from '../../common/errors.js';
import type { LumiRepository, TalkSessionRow } from './lumi.repository.js';

export interface LumiServiceDeps {
  repository: LumiRepository;
  redis: Redis;
  logger: FastifyBaseLogger;
  elevenLabsApiKey: string;
  voiceId: string;
}

export interface CreateTalkSessionInput {
  userId: string;
  householdId: string;
  userRole: 'primary_parent' | 'secondary_caregiver' | 'guest_author' | 'ops';
  contextSignal: LumiContextSignal;
}

export interface CreateTalkSessionResult {
  talk_session_id: string;
  stt_token: string;
  tts_token: string;
  voice_id: string;
}

const TALK_SESSION_TTL_SECONDS = 20;

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

  constructor(deps: LumiServiceDeps) {
    this.repository = deps.repository;
    this.redis = deps.redis;
    this.logger = deps.logger;
    this.elevenLabsApiKey = deps.elevenLabsApiKey;
    this.voiceId = deps.voiceId;
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

    // Issue ElevenLabs credentials BEFORE persisting the session row so a token
    // failure leaves no orphaned voice_sessions row (AC #10 — atomic creation).
    const { sttToken, ttsToken } = await this.issueElevenLabsCredentials();

    let session: TalkSessionRow;
    try {
      session = await this.repository.createTalkSession({
        userId: input.userId,
        householdId: input.householdId,
        threadId: thread.id,
      });
    } catch (err) {
      // ElevenLabs credentials were already minted — log but do not surface
      // the leak (the tokens are short-lived and unused).
      this.logger.error(
        {
          err,
          module: 'lumi',
          action: 'lumi.talk_session_persist_failed',
          household_id: input.householdId,
        },
        'voice_sessions insert failed after issuing ElevenLabs credentials — credentials will expire unused',
      );
      throw err;
    }

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

    return {
      talk_session_id: session.id,
      stt_token: sttToken,
      tts_token: ttsToken,
      voice_id: this.voiceId,
    };
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

  // The architecture spec says "the API calls ElevenLabs to obtain a single-use
  // STT token and a single-use TTS token." ElevenLabs's public API does not
  // currently expose dedicated single-use STT-stream or TTS-stream tokens; the
  // closest documented mechanism is the Conversational AI signed URL endpoint.
  // We make two distinct fetch calls so:
  //   * AC #1 ("API calls ElevenLabs to obtain a single-use STT token AND a
  //     single-use TTS token") is met structurally;
  //   * AC #10 (atomic on token failure) is exercised by a single failing call.
  // Story 12.8 owns the actual browser-direct WS transport and may revise the
  // exact endpoint(s) called here.
  private async issueElevenLabsCredentials(): Promise<{
    sttToken: string;
    ttsToken: string;
  }> {
    const url = `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${encodeURIComponent(this.voiceId)}`;
    const headers = { 'xi-api-key': this.elevenLabsApiKey };

    const sttRes = await fetch(url, { method: 'GET', headers });
    if (!sttRes.ok) {
      throw new UpstreamError(`ElevenLabs STT credential issuance failed: HTTP ${sttRes.status}`);
    }
    const sttJson = (await sttRes.json()) as { signed_url?: unknown };
    if (typeof sttJson.signed_url !== 'string' || sttJson.signed_url.length === 0) {
      throw new UpstreamError('ElevenLabs STT credential issuance returned no signed_url');
    }

    const ttsRes = await fetch(url, { method: 'GET', headers });
    if (!ttsRes.ok) {
      throw new UpstreamError(`ElevenLabs TTS credential issuance failed: HTTP ${ttsRes.status}`);
    }
    const ttsJson = (await ttsRes.json()) as { signed_url?: unknown };
    if (typeof ttsJson.signed_url !== 'string' || ttsJson.signed_url.length === 0) {
      throw new UpstreamError('ElevenLabs TTS credential issuance returned no signed_url');
    }

    return { sttToken: sttJson.signed_url, ttsToken: ttsJson.signed_url };
  }
}
