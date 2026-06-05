import { describe, it, expect, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuditService } from '../audit/audit.service.js';
import { memoryForgetJobPlugin } from './memory-forget.job.js';

// Story 7-S5 — end-to-end integration of the nightly promotion job, driving the
// REAL memoryForgetJobPlugin through a Fastify instance and a fake BullMQ facade.
// Unlike memory-forget.job.test.ts (which calls runMemoryForgetSweep directly),
// this exercises the plugin wiring: scheduler registration (AC#6), the worker
// callback's repo→audit chain (AC#1/#2), and the retry re-throw path (AC#5).

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const NODE_A = '22222222-2222-4222-8222-222222222222';
const NODE_B = '33333333-3333-4333-8333-333333333333';

type DeletedRow = { id: string; household_id: string; node_type: string };

// Minimal PostgREST delete-chain mock for MemoryRepository.hardDeleteSoftForgotten:
// .from().delete().not().lt().select() resolves with the seeded result.
function buildSupabaseMock(result: { data: DeletedRow[] | null; error: unknown }): SupabaseClient {
  return {
    from: vi.fn().mockReturnValue({
      delete: vi.fn().mockReturnValue({
        not: vi.fn().mockReturnValue({
          lt: vi.fn().mockReturnValue({
            select: vi.fn().mockResolvedValue(result),
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

interface SchedulerCall {
  queue: string;
  id: string;
  repeat: { pattern: string; tz: string };
  template: { name: string; data: unknown; opts: Record<string, unknown> };
}

function buildFakeBullmq() {
  const schedulerCalls: SchedulerCall[] = [];
  let workerProcessor: (() => Promise<unknown>) | null = null;
  let workerQueue = '';

  const facade = {
    getQueue: (name: string) => ({
      upsertJobScheduler: (id: string, repeat: SchedulerCall['repeat'], template: SchedulerCall['template']) => {
        schedulerCalls.push({ queue: name, id, repeat, template });
        return Promise.resolve({});
      },
    }),
    getWorker: (name: string, processor: () => Promise<unknown>) => {
      workerQueue = name;
      workerProcessor = processor;
      return {};
    },
  };

  return {
    facade,
    schedulerCalls,
    get workerQueue() {
      return workerQueue;
    },
    runWorker: (): Promise<unknown> => {
      if (!workerProcessor) throw new Error('worker callback was never registered');
      return workerProcessor();
    },
  };
}

async function buildJobApp(opts: {
  supabase?: SupabaseClient;
  audit?: Pick<AuditService, 'write'>;
  bullmq: ReturnType<typeof buildFakeBullmq>;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  if (opts.supabase) app.decorate('supabase', opts.supabase);
  app.decorate('bullmq', opts.bullmq.facade as unknown as FastifyInstance['bullmq']);
  app.decorate(
    'auditService',
    (opts.audit ?? { write: vi.fn().mockResolvedValue(undefined) }) as unknown as FastifyInstance['auditService'],
  );
  await app.register(memoryForgetJobPlugin);
  await app.ready();
  return app;
}

describe('memoryForgetJobPlugin (integration)', () => {
  it('AC#6 — registers a nightly scheduler with cron "0 3 * * *" UTC and 3 retry attempts', async () => {
    const bullmq = buildFakeBullmq();
    const app = await buildJobApp({ supabase: buildSupabaseMock({ data: [], error: null }), bullmq });

    expect(bullmq.schedulerCalls).toHaveLength(1);
    const call = bullmq.schedulerCalls[0];
    expect(call.queue).toBe('memory-forget');
    expect(call.id).toBe('nightly-memory-forget');
    expect(call.repeat).toEqual({ pattern: '0 3 * * *', tz: 'UTC' });
    expect(call.template.opts.attempts).toBe(3);
    expect(call.template.opts.removeOnComplete).toEqual({ count: 30 });
    expect(bullmq.workerQueue).toBe('memory-forget');

    await app.close();
  });

  it('AC#1/#2 — the worker hard-deletes via the repo and writes one tombstone audit per deleted node', async () => {
    const bullmq = buildFakeBullmq();
    const write = vi.fn().mockResolvedValue(undefined);
    const supabase = buildSupabaseMock({
      data: [
        { id: NODE_A, household_id: HOUSEHOLD_ID, node_type: 'preference' },
        { id: NODE_B, household_id: HOUSEHOLD_ID, node_type: 'allergy' },
      ],
      error: null,
    });
    const app = await buildJobApp({ supabase, audit: { write }, bullmq });

    await bullmq.runWorker();

    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'memory.hard_forgotten',
        household_id: HOUSEHOLD_ID,
        metadata: { node_id: NODE_A, node_type: 'preference' },
      }),
    );
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'memory.hard_forgotten',
        household_id: HOUSEHOLD_ID,
        metadata: { node_id: NODE_B, node_type: 'allergy' },
      }),
    );

    await app.close();
  });

  it('AC#3 — a sweep with zero qualifying nodes writes no audit rows', async () => {
    const bullmq = buildFakeBullmq();
    const write = vi.fn().mockResolvedValue(undefined);
    const app = await buildJobApp({
      supabase: buildSupabaseMock({ data: [], error: null }),
      audit: { write },
      bullmq,
    });

    await bullmq.runWorker();

    expect(write).not.toHaveBeenCalled();

    await app.close();
  });

  it('AC#5 — the worker re-throws when the delete query errors (BullMQ retry path)', async () => {
    const bullmq = buildFakeBullmq();
    const write = vi.fn();
    const app = await buildJobApp({
      supabase: buildSupabaseMock({ data: null, error: { message: 'boom', code: 'XX000' } }),
      audit: { write },
      bullmq,
    });

    await expect(bullmq.runWorker()).rejects.toMatchObject({ code: 'XX000' });
    expect(write).not.toHaveBeenCalled();

    await app.close();
  });

  it('throws at boot when the supabase decorator is missing', async () => {
    const bullmq = buildFakeBullmq();
    const app = Fastify({ logger: false });
    app.decorate('bullmq', bullmq.facade as unknown as FastifyInstance['bullmq']);
    app.decorate('auditService', { write: vi.fn() } as unknown as FastifyInstance['auditService']);

    app.register(memoryForgetJobPlugin);
    await expect(app.ready()).rejects.toThrow(/requires supabase/);
  });
});
