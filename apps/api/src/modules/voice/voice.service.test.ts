import { describe, it, expect, vi, afterEach } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { VoiceService } from './voice.service.js';
import type { VoiceRepository, VoiceSessionRow } from './voice.repository.js';
import type { OnboardingAgent } from '../../agents/onboarding.agent.js';
import type { CulturalPriorService } from '../cultural-priors/cultural-prior.service.js';

const USER_ID = 'user-1111-1111-1111';
const HOUSEHOLD_ID = 'hh-2222-2222-2222';
const THREAD_ID = 'thread-3333-3333-3333';
const SESSION_ID = 'session-4444-4444-4444';

function makeSessionRow(overrides?: Partial<VoiceSessionRow>): VoiceSessionRow {
  return {
    id: SESSION_ID,
    user_id: USER_ID,
    household_id: HOUSEHOLD_ID,
    thread_id: THREAD_ID,
    elevenlabs_conversation_id: null,
    status: 'active',
    started_at: new Date().toISOString(),
    ended_at: null,
    ...overrides,
  };
}

function makeRepository(overrides?: Partial<VoiceRepository>): VoiceRepository {
  return {
    findActiveSessionForHousehold: vi.fn().mockResolvedValue(null),
    createThread: vi.fn().mockResolvedValue({ id: THREAD_ID }),
    createVoiceSession: vi.fn().mockResolvedValue(makeSessionRow()),
    findVoiceSession: vi.fn().mockResolvedValue(makeSessionRow()),
    appendTurn: vi.fn().mockResolvedValue(undefined),
    appendTurnNext: vi.fn().mockResolvedValue(undefined),
    getNextSeq: vi.fn().mockResolvedValue(1),
    closeThread: vi.fn().mockResolvedValue(undefined),
    updateVoiceSession: vi.fn().mockResolvedValue(makeSessionRow()),
    ...overrides,
  } as unknown as VoiceRepository;
}

function makeAgent(): OnboardingAgent {
  return {
    respond: vi.fn().mockResolvedValue({ text: 'Hello there!', complete: false }),
    extractSummary: vi.fn().mockResolvedValue({
      cultural_templates: [],
      palate_notes: [],
      allergens_mentioned: [],
      family_rhythms: [],
    }),
    closingPhrase: vi.fn().mockReturnValue('[warmly] That is everything I needed.'),
  } as unknown as OnboardingAgent;
}

function makeCulturalPriorService(): CulturalPriorService {
  return {
    inferFromSummary: vi.fn().mockResolvedValue({ detectedCount: 0 }),
  } as unknown as CulturalPriorService;
}

function makeLogger(): FastifyBaseLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(),
    level: 'info',
  } as unknown as FastifyBaseLogger;
}

function makeService(opts?: {
  repository?: VoiceRepository;
  agent?: OnboardingAgent;
}): VoiceService {
  return new VoiceService({
    repository: opts?.repository ?? makeRepository(),
    agent: opts?.agent ?? makeAgent(),
    culturalPriorService: makeCulturalPriorService(),
    elevenLabsApiKey: 'test-el-key',
    voiceId: 'test-voice-id',
    ttsModelId: 'eleven_flash_v2_5',
    logger: makeLogger(),
  });
}

describe('VoiceService — createSession', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns session_id on success', async () => {
    const service = makeService();
    const result = await service.createSession(USER_ID, HOUSEHOLD_ID);
    expect(result.sessionId).toBe(SESSION_ID);
  });

  it('throws ConflictError when an active session already exists', async () => {
    const repository = makeRepository({
      findActiveSessionForHousehold: vi.fn().mockResolvedValue(makeSessionRow()),
    });
    const service = makeService({ repository });

    await expect(service.createSession(USER_ID, HOUSEHOLD_ID)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('cleans up thread when createVoiceSession fails', async () => {
    const closeThread = vi.fn().mockResolvedValue(undefined);
    const repository = makeRepository({
      createVoiceSession: vi.fn().mockRejectedValue(new Error('DB constraint violation')),
      closeThread,
    });
    const service = makeService({ repository });

    await expect(service.createSession(USER_ID, HOUSEHOLD_ID)).rejects.toThrow(
      'DB constraint violation',
    );

    expect(closeThread).toHaveBeenCalledWith(THREAD_ID);
  });

  it('does NOT call closeThread when createThread itself fails', async () => {
    const closeThread = vi.fn();
    const repository = makeRepository({
      createThread: vi.fn().mockRejectedValue(new Error('DB unreachable')),
      closeThread,
    });
    const service = makeService({ repository });

    await expect(service.createSession(USER_ID, HOUSEHOLD_ID)).rejects.toThrow('DB unreachable');
    expect(closeThread).not.toHaveBeenCalled();
  });
});
