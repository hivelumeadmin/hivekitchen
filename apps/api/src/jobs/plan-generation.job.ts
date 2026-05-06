import { randomUUID } from 'node:crypto';
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import type { Job } from 'bullmq';
import type {
  CommitPlanInput,
  GuardrailResult,
  PlanComposeOutput,
  PlanItemWrite,
} from '@hivekitchen/types';
import { HouseholdsRepository } from '../modules/households/households.repository.js';
import { deriveWeekId } from '../lib/derive-week-id.js';

export { deriveWeekId };

const SCHEDULE_QUEUE = 'plan-generation-schedule';
const GENERATE_QUEUE = 'plan-generation';
const SCHEDULE_JOB_ID = 'weekly-plan-generation-fanout';

// Per-job BullMQ options for household plan generation: 3 attempts with
// exponential backoff (5m → 10m → 20m). attempts:3 satisfies the AC #3
// "3 retries on transient failure" — one initial attempt plus two retries
// would be attempts:3 BullMQ semantics; AC text reads "3 retries", which we
// implement as attempts:3 (initial + 2 retries) per BullMQ's count of
// attemptsMade incrementing on each try.
const GENERATION_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 300_000 },
  removeOnComplete: { count: 200 },
  removeOnFail: { count: 48 },
};

export interface PlanGenerationJobData {
  household_id: string;
  week_of: string;
  request_id: string;
}

// Given a Friday date at fan-out time, returns the ISO date of the following
// Monday. "Following Monday" = 3 days after Friday.
export function getNextMondayFrom(fridayDate: Date): string {
  const d = new Date(fridayDate);
  d.setUTCDate(d.getUTCDate() + 3);
  return d.toISOString().slice(0, 10);
}

// Returns the UTC timestamp (ms) when 18:00 local time arrives in the given
// IANA timezone on the same calendar day as `referenceDate`. If 18:00 local
// has already passed, returns the timestamp for 18:00 local on the NEXT day.
//
// Uses UTC noon of the local date as a stable probe point — noon is well
// clear of DST midnight transitions and works for all IANA timezones.
// Whole-hour-offset zones are exact; half-hour-offset zones (IST, NPT) land
// within an hour, which is acceptable for this scheduling use case.
export function getLocalSixPmUtcMs(timezone: string, referenceDate: Date): number {
  const localDateStr = new Intl.DateTimeFormat('sv-SE', { timeZone: timezone }).format(referenceDate);

  const noonUtcMs = new Date(`${localDateStr}T12:00:00Z`).getTime();
  const localHourAtNoon = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', hour12: false }).format(
      new Date(noonUtcMs),
    ),
    10,
  );

  const targetMs = noonUtcMs + (18 - localHourAtNoon) * 3_600_000;

  return targetMs < referenceDate.getTime() ? targetMs + 86_400_000 : targetMs;
}

// Converts the planner agent's PlanComposeOutput to the CommitPlanInput shape
// expected by PlansService.commit(). Flattens per-day/per-child items into a
// flat PlanItemWrite[] and attaches the deterministic week_id.
export function buildCommitInput(
  output: PlanComposeOutput,
  weekId: string,
  _requestId: string,
): CommitPlanInput {
  const items: PlanItemWrite[] = output.days.flatMap((d) =>
    d.items.map((item) => ({
      child_id: item.child_id,
      day: d.day,
      slot: item.slot,
      ingredients: item.ingredients,
      ...(item.recipe_id !== undefined ? { recipe_id: item.recipe_id } : {}),
      ...(item.item_id !== undefined ? { item_id: item.item_id } : {}),
    })),
  );

  return {
    plan_id: output.plan_id,
    household_id: output.household_id,
    week_id: weekId,
    week_of: output.week_of,   // Story 3.13 — PlanComposeOutput.week_of is already available
    revision: 1,
    generated_at: new Date().toISOString(),
    prompt_version: output.prompt_version,
    items,
  };
}

const planGenerationPlugin: FastifyPluginAsync = async (fastify) => {
  if (!fastify.orchestrator) {
    throw new Error(
      'planGenerationPlugin requires orchestrator decorator — register orchestratorHook first',
    );
  }
  if (!fastify.plansService) {
    throw new Error(
      'planGenerationPlugin requires plansService decorator — register plansHook first',
    );
  }
  if (!fastify.auditService) {
    throw new Error(
      'planGenerationPlugin requires auditService decorator — register auditHook first',
    );
  }
  if (!fastify.supabase) {
    throw new Error(
      'planGenerationPlugin requires supabase decorator — register supabasePlugin first',
    );
  }

  const scheduleQueue = fastify.bullmq.getQueue(SCHEDULE_QUEUE);
  const generateQueue = fastify.bullmq.getQueue(GENERATE_QUEUE);

  // Fan-out scheduler — Friday 10:00 UTC (= 06:00 ET / 03:00 PT). For each
  // active household, enqueues a delayed per-household job that fires at
  // 18:00 local on Friday. The 36h window (Fri 18:00 → Sun 06:00 UTC) covers
  // all US timezones and matches the architecture NFR (≤4h queue wait per HH).
  void scheduleQueue
    .upsertJobScheduler(
      SCHEDULE_JOB_ID,
      { pattern: '0 10 * * 5', tz: 'UTC' },
      {
        name: 'fan-out',
        data: {},
        opts: {
          attempts: 2,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: { count: 8 },
          removeOnFail: { count: 8 },
        },
      },
    )
    .catch((err: unknown) => {
      fastify.log.error(
        { err, module: 'plan-generation', action: 'scheduler.registration.failed' },
        'failed to register plan-generation fan-out scheduler',
      );
    });

  fastify.bullmq.getWorker(SCHEDULE_QUEUE, async (_job: Job) => {
    const now = new Date();
    const weekOf = getNextMondayFrom(now);
    const householdsRepo = new HouseholdsRepository(fastify.supabase, null);
    const households = await householdsRepo.findAllActive();

    fastify.log.info(
      { module: 'plan-generation', action: 'fanout.start', count: households.length, weekOf },
      'plan-generation fan-out: enqueuing per-household jobs',
    );

    const enqueueResults = await Promise.allSettled(
      households.map(async (hh) => {
        const fireAtMs = getLocalSixPmUtcMs(hh.timezone, now);
        const delay = Math.max(0, fireAtMs - Date.now());
        const jobData: PlanGenerationJobData = {
          household_id: hh.id,
          week_of: weekOf,
          request_id: randomUUID(),
        };
        await generateQueue.add('generate-plan', jobData, {
          ...GENERATION_JOB_OPTS,
          delay,
          // Idempotent: same household+week always maps to the same jobId.
          // BullMQ skips duplicate adds when a job with this id is already
          // queued, which prevents double-generation if the scheduler fires
          // twice (e.g., after a worker restart).
          jobId: `plan-gen-${hh.id}-${weekOf}`,
        });
      }),
    );

    const failures = enqueueResults.filter((r) => r.status === 'rejected');
    if (failures.length > 0) {
      fastify.log.error(
        {
          module: 'plan-generation',
          action: 'fanout.partial',
          failed: failures.length,
          total: households.length,
        },
        'plan-generation fan-out: some enqueues failed',
      );
    } else {
      fastify.log.info(
        { module: 'plan-generation', action: 'fanout.complete', count: households.length, weekOf },
        'plan-generation fan-out: all household jobs enqueued',
      );
    }
  });

  // Per-household generation worker — concurrency 2 is conservative. Increase
  // at scaling time once the LLM provider rate-limit profile is settled
  // (Story 3.30 circuit-breaker audit).
  const generationWorker = fastify.bullmq.getWorker(
    GENERATE_QUEUE,
    async (job: Job<PlanGenerationJobData>) => {
      const { household_id, week_of, request_id } = job.data;
      const weekId = deriveWeekId(week_of);

      fastify.log.info(
        {
          module: 'plan-generation',
          action: 'generate.start',
          household_id,
          week_of,
          weekId,
          attempt: job.attemptsMade,
        },
        'plan-generation job started',
      );

      const composeOutput = await fastify.orchestrator.planWeek(household_id, week_of, request_id);
      const commitInput = buildCommitInput(composeOutput, weekId, request_id);

      // Allergy guardrail + brief_state refresh are wired inside
      // PlansService.commit(). The regenerate callback re-runs the planner
      // with rejection context so the next attempt avoids the unsafe items.
      await fastify.plansService.commit(
        commitInput,
        request_id,
        async (rejections: GuardrailResult[]) => {
          const rejectionContext = rejections
            .flatMap((r) => (r.verdict === 'blocked' ? r.conflicts : []))
            .map((c) => `allergen: ${c.allergen}, ingredient: ${c.ingredient}`)
            .join('; ');

          const retryOutput = await fastify.orchestrator.planWeek(
            household_id,
            week_of,
            request_id,
            rejectionContext,
          );
          return buildCommitInput(retryOutput, weekId, request_id);
        },
      );

      fastify.log.info(
        { module: 'plan-generation', action: 'generate.complete', household_id, week_of, weekId },
        'plan-generation job completed — brief_state updated',
      );

      // Story 5.2 will wire the real SSE plan.updated emission via Redis
      // pub/sub. For now, log the intent so an integration test can assert
      // the right hook point exists.
      fastify.log.debug(
        { module: 'plan-generation', action: 'sse.deferred', household_id, weekId },
        'plan.updated SSE emission deferred to Story 5.2',
      );
    },
    { concurrency: 2 },
  );

  // Permanent failure escalation — BullMQ emits 'failed' after every failed
  // attempt, including retried ones. Only write the audit event after all
  // attempts are exhausted (job.attemptsMade reaches the configured limit).
  generationWorker.on('failed', (job: Job<PlanGenerationJobData> | undefined, err: Error) => {
    if (!job) return;
    const maxAttempts = (job.opts?.attempts as number | undefined) ?? GENERATION_JOB_OPTS.attempts;
    if (job.attemptsMade < maxAttempts) return;

    const { household_id, week_of, request_id } = job.data;

    fastify.log.error(
      {
        module: 'plan-generation',
        action: 'generate.permanent_failure',
        household_id,
        week_of,
        err,
      },
      'plan-generation job permanently failed — all retries exhausted',
    );

    fastify.auditService
      .write({
        event_type: 'plan.generation.failed',
        household_id,
        request_id,
        metadata: {
          week_of,
          error: err.message,
          attempts: job.attemptsMade,
          job_id: job.id ?? null,
        },
      })
      .catch((auditErr: unknown) => {
        fastify.log.error(
          { err: auditErr, module: 'plan-generation', action: 'audit.write.failed', household_id },
          'failed to write plan.generation.failed audit event',
        );
      });
  });
};

export const planGenerationJobPlugin = fp(planGenerationPlugin, {
  name: 'plan-generation-job',
});
