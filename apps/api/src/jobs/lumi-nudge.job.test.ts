import { describe, it, expect, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import type { LumiService } from '../modules/lumi/lumi.service.js';
import type { UserRepository, UserProfileRow } from '../modules/users/user.repository.js';
import type { SseDispatcher } from '../plugins/sse-dispatcher.plugin.js';
import { runLumiNudge, type LumiNudgeDeps, type LumiNudgeJobData } from './lumi-nudge.job.js';

function buildLogger(): FastifyBaseLogger {
  const noop = vi.fn();
  return {
    info: noop,
    warn: vi.fn(),
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: vi.fn().mockReturnThis(),
    level: 'info',
    silent: vi.fn(),
  } as unknown as FastifyBaseLogger;
}

const JOB_DATA: LumiNudgeJobData = {
  household_id: '11111111-1111-4111-8111-111111111111',
  trigger: 'plan_completed',
  surface: 'brief',
  plan_context: 'Week of 2026-10-14. Mains: Dal-rice',
};

const TURN = { id: 'turn-1', role: 'lumi' };

function parentRow(proactive?: boolean): UserProfileRow {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    email: 'parent@example.com',
    display_name: 'Parent',
    preferred_language: 'en',
    role: 'primary_parent',
    notification_prefs:
      proactive === undefined
        ? { weekly_plan_ready: true, grocery_list_ready: true }
        : { weekly_plan_ready: true, grocery_list_ready: true, proactive_lumi_nudges: proactive },
    cultural_language: 'default',
    parental_notice_acknowledged_at: null,
    parental_notice_acknowledged_version: null,
    caption_only_mode: false,
    voice_retention_mode: 'standard',
  };
}

interface BuildOpts {
  persistImpl?: ReturnType<typeof vi.fn>;
  parent?: UserProfileRow | null;
  redisGet?: string | null;
}

function buildDeps(opts: BuildOpts = {}): {
  deps: LumiNudgeDeps;
  persistNudge: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
  redisGet: ReturnType<typeof vi.fn>;
  logger: FastifyBaseLogger;
} {
  const persistNudge = opts.persistImpl ?? vi.fn().mockResolvedValue(TURN);
  const lumiService = { persistNudge } as unknown as LumiService;

  const findPrimaryParentForHousehold = vi
    .fn()
    .mockResolvedValue(opts.parent === undefined ? parentRow() : opts.parent);
  const userRepository = { findPrimaryParentForHousehold } as unknown as UserRepository;

  const redisGet = vi.fn().mockResolvedValue(opts.redisGet ?? null);
  const redis = { get: redisGet } as unknown as Redis;

  const emit = vi.fn();
  const sseDispatcher = { register: vi.fn(), unregister: vi.fn(), emit } as SseDispatcher;

  const logger = buildLogger();
  return {
    deps: { lumiService, logger, redis, userRepository, sseDispatcher },
    persistNudge,
    emit,
    redisGet,
    logger,
  };
}

describe('runLumiNudge', () => {
  it('calls lumiService.persistNudge with the mapped job data', async () => {
    const { deps, persistNudge } = buildDeps();

    await runLumiNudge(deps, JOB_DATA);

    expect(persistNudge).toHaveBeenCalledWith({
      householdId: JOB_DATA.household_id,
      trigger: 'plan_completed',
      surface: 'brief',
      planContext: 'Week of 2026-10-14. Mains: Dal-rice',
    });
  });

  it('swallows a persistNudge error and does not throw', async () => {
    const { deps } = buildDeps({ persistImpl: vi.fn().mockRejectedValue(new Error('openai down')) });

    await expect(runLumiNudge(deps, JOB_DATA)).resolves.toBeUndefined();
  });

  it('logs a warning when persistNudge fails and does not emit SSE', async () => {
    const { deps, logger, emit } = buildDeps({
      persistImpl: vi.fn().mockRejectedValue(new Error('db down')),
    });

    await runLumiNudge(deps, JOB_DATA);

    expect(logger.warn).toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('skips entirely when the primary parent opted out (no persist, no SSE)', async () => {
    const { deps, persistNudge, emit } = buildDeps({ parent: parentRow(false) });

    await runLumiNudge(deps, JOB_DATA);

    expect(persistNudge).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('proceeds when no primary parent is found (null treated as opted-in)', async () => {
    const { deps, persistNudge, emit } = buildDeps({ parent: null });

    await runLumiNudge(deps, JOB_DATA);

    expect(persistNudge).toHaveBeenCalled();
    expect(emit).toHaveBeenCalled();
  });

  it('persists but suppresses SSE when the rate-limit window is already set', async () => {
    const { deps, persistNudge, emit } = buildDeps({ redisGet: '1' });

    await runLumiNudge(deps, JOB_DATA);

    expect(persistNudge).toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('emits the serialized LumiNudgeEvent when the window is empty', async () => {
    const { deps, emit } = buildDeps({ redisGet: null });

    await runLumiNudge(deps, JOB_DATA);

    expect(emit).toHaveBeenCalledWith(
      JOB_DATA.household_id,
      'lumi.nudge',
      JSON.stringify({ type: 'lumi.nudge', turn: TURN, surface: 'brief' }),
    );
  });

  it('reads the rate-limit gate before persisting', async () => {
    const { deps, redisGet } = buildDeps();

    await runLumiNudge(deps, JOB_DATA);

    expect(redisGet).toHaveBeenCalledWith(`lumi:nudge:household:${JOB_DATA.household_id}`);
  });
});
