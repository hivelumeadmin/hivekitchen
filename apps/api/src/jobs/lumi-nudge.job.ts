import { Buffer } from 'node:buffer';
import fp from 'fastify-plugin';
import type { FastifyBaseLogger, FastifyPluginAsync } from 'fastify';
import type { Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { LumiNudgeEvent, LumiSurface, NudgeTrigger } from '@hivekitchen/types';
import { ChildAllergensRepository } from '../modules/children/child-allergens.repository.js';
import { ChildrenRepository } from '../modules/children/children.repository.js';
import { HouseholdAllergensRepository } from '../modules/households/household-allergens.repository.js';
import { LumiRepository } from '../modules/lumi/lumi.repository.js';
import { LumiService } from '../modules/lumi/lumi.service.js';
import { UserRepository } from '../modules/users/user.repository.js';
import type { SseDispatcher } from '../plugins/sse-dispatcher.plugin.js';

export const NUDGE_QUEUE = 'lumi-nudge';

export interface LumiNudgeJobData {
  household_id: string;
  trigger: NudgeTrigger;
  surface: LumiSurface;
  plan_context?: string; // optional text summary for plan_completed
}

export interface LumiNudgeDeps {
  lumiService: LumiService;
  logger: FastifyBaseLogger;
  redis: Redis;
  userRepository: UserRepository;
  sseDispatcher: SseDispatcher;
}

// Story 12-S11/S12 — the nudge worker body, extracted from the BullMQ callback so
// it can be unit-tested without standing up BullMQ. Nudge turns are
// fire-and-forget at MVP: any failure is logged at warn and swallowed so it
// never surfaces as a BullMQ job failure (no retry — a failed nudge is not worth
// re-running). Plan delivery already succeeded by the time this runs.
//
// S12 adds two gates around persistNudge:
//  1. Opt-out — if the household's primary parent disabled proactive nudges, skip
//     entirely (no turn persisted, no SSE). A null parent is treated as opted-in.
//  2. Rate-limit SSE suppression — persistNudge always inserts a turn and sets a
//     30-min Redis gate (SET NX). We read that gate BEFORE persist; SSE (the orb
//     breath) is emitted only when the window was empty, so a second nudge within
//     the window is persisted silently and surfaces on the next panel open.
export async function runLumiNudge(deps: LumiNudgeDeps, data: LumiNudgeJobData): Promise<void> {
  try {
    const parent = await deps.userRepository.findPrimaryParentForHousehold(data.household_id);
    if (parent?.notification_prefs?.proactive_lumi_nudges === false) {
      deps.logger.info(
        { module: 'lumi', action: 'lumi.nudge.skipped_opt_out', household_id: data.household_id },
        'lumi nudge skipped — proactive nudges opted out',
      );
      return;
    }

    // Read the rate-limit gate before persist; persistNudge sets it (SET NX EX 1800).
    const rateKey = `lumi:nudge:household:${data.household_id}`;
    const wasRateLimited = (await deps.redis.get(rateKey)) !== null;

    const turn = await deps.lumiService.persistNudge({
      householdId: data.household_id,
      trigger: data.trigger,
      surface: data.surface,
      planContext: data.plan_context,
    });
    deps.logger.info(
      { module: 'lumi', action: 'lumi.nudge.persisted', household_id: data.household_id, trigger: data.trigger },
      'lumi nudge persisted',
    );

    // Emit the SSE (orb breath) only for the first nudge in the rate-limit window.
    if (!wasRateLimited) {
      const event: LumiNudgeEvent = { type: 'lumi.nudge', turn, surface: data.surface };
      deps.sseDispatcher.emit(data.household_id, 'lumi.nudge', JSON.stringify(event));
    }
  } catch (err) {
    deps.logger.warn(
      { err, module: 'lumi', action: 'lumi.nudge.failed', household_id: data.household_id, trigger: data.trigger },
      'lumi nudge failed — fire-and-forget, not retried',
    );
  }
}

// On-demand worker-only plugin: NO upsertJobScheduler. The plan-generation job
// enqueues via queue.add(); this worker consumes it (mirrors data-export.job.ts,
// not the cron-style account-deletion.job.ts). LumiService is constructed here
// per the encapsulated pattern from lumi.routes.ts — it is NOT decorated on the
// fastify instance globally (ADR-002 / Story 12-S11 Dev Notes).
const lumiNudgePlugin: FastifyPluginAsync = async (fastify) => {
  if (!fastify.supabase) {
    throw new Error('lumiNudgePlugin requires supabase — register supabasePlugin first');
  }

  const kekHex = fastify.env.ENVELOPE_ENCRYPTION_MASTER_KEY;
  const kek = kekHex ? Buffer.from(kekHex, 'hex') : null;
  const childAllergensRepository = new ChildAllergensRepository(fastify.supabase, kek);
  const childrenRepository = new ChildrenRepository(
    fastify.supabase,
    kek,
    fastify.log,
    childAllergensRepository,
  );
  const householdAllergensRepository = new HouseholdAllergensRepository(fastify.supabase, kek);
  const repository = new LumiRepository(fastify.supabase);
  const userRepository = new UserRepository(fastify.supabase);
  const lumiService = new LumiService({
    repository,
    redis: fastify.redis,
    logger: fastify.log,
    elevenLabsApiKey: fastify.env.ELEVENLABS_API_KEY,
    voiceId: fastify.env.ELEVENLABS_VOICE_ID,
    openai: fastify.openai,
    childrenRepository,
    householdAllergensRepository,
  });

  fastify.bullmq.getWorker(
    NUDGE_QUEUE,
    async (job: Job<LumiNudgeJobData>) => {
      await runLumiNudge(
        {
          lumiService,
          logger: fastify.log,
          redis: fastify.redis,
          userRepository,
          sseDispatcher: fastify.sseDispatcher,
        },
        job.data,
      );
    },
    { concurrency: 5 },
  );
};

export const lumiNudgeJobPlugin = fp(lumiNudgePlugin, {
  name: 'lumi-nudge-job',
});
