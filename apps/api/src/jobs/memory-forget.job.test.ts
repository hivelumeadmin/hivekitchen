import { describe, it, expect, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type { AuditService } from '../audit/audit.service.js';
import type { MemoryRepository } from '../modules/memory/memory.repository.js';
import { runMemoryForgetSweep } from './memory-forget.job.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const NODE_A = '22222222-2222-4222-8222-222222222222';
const NODE_B = '33333333-3333-4333-8333-333333333333';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function buildLogger(): FastifyBaseLogger {
  const noop = vi.fn();
  return {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: vi.fn().mockReturnThis(),
    level: 'info',
    silent: vi.fn(),
  } as unknown as FastifyBaseLogger;
}

type DeletedRow = { id: string; household_id: string; node_type: string };

function buildRepo(
  impl: () => Promise<DeletedRow[]>,
): Pick<MemoryRepository, 'hardDeleteSoftForgotten'> {
  return { hardDeleteSoftForgotten: vi.fn(impl) } as unknown as Pick<
    MemoryRepository,
    'hardDeleteSoftForgotten'
  >;
}

describe('runMemoryForgetSweep', () => {
  it('calls hardDeleteSoftForgotten with a cutoff ~30 days before now', async () => {
    const repo = buildRepo(async () => []);
    const audit = { write: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;

    const before = Date.now() - THIRTY_DAYS_MS;
    await runMemoryForgetSweep({ repo, audit, logger: buildLogger() });
    const after = Date.now() - THIRTY_DAYS_MS;

    expect(repo.hardDeleteSoftForgotten).toHaveBeenCalledTimes(1);
    const cutoffAt = (repo.hardDeleteSoftForgotten as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    const cutoffMs = new Date(cutoffAt).getTime();
    expect(cutoffMs).toBeGreaterThanOrEqual(before);
    expect(cutoffMs).toBeLessThanOrEqual(after);
  });

  it('writes one memory.hard_forgotten audit row per deleted node', async () => {
    const repo = buildRepo(async () => [
      { id: NODE_A, household_id: HOUSEHOLD_ID, node_type: 'preference' },
      { id: NODE_B, household_id: HOUSEHOLD_ID, node_type: 'allergy' },
    ]);
    const write = vi.fn().mockResolvedValue(undefined);
    const audit = { write } as unknown as AuditService;

    const result = await runMemoryForgetSweep({ repo, audit, logger: buildLogger() });

    expect(result.count).toBe(2);
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
  });

  it('logs INFO with count and never calls audit when zero nodes qualify', async () => {
    const repo = buildRepo(async () => []);
    const write = vi.fn().mockResolvedValue(undefined);
    const audit = { write } as unknown as AuditService;
    const logger = buildLogger();

    const result = await runMemoryForgetSweep({ repo, audit, logger });

    expect(result.count).toBe(0);
    expect(write).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'promotion.complete', count: 0 }),
      expect.any(String),
    );
  });

  it('re-throws when hardDeleteSoftForgotten rejects (BullMQ retry path)', async () => {
    const repo = buildRepo(async () => {
      throw new Error('db unavailable');
    });
    const write = vi.fn();
    const audit = { write } as unknown as AuditService;

    await expect(runMemoryForgetSweep({ repo, audit, logger: buildLogger() })).rejects.toThrow(
      'db unavailable',
    );
    expect(write).not.toHaveBeenCalled();
  });

  it('continues the audit loop when one audit write throws (best-effort tombstones)', async () => {
    const repo = buildRepo(async () => [
      { id: NODE_A, household_id: HOUSEHOLD_ID, node_type: 'preference' },
      { id: NODE_B, household_id: HOUSEHOLD_ID, node_type: 'allergy' },
    ]);
    const write = vi
      .fn()
      .mockRejectedValueOnce(new Error('audit down'))
      .mockResolvedValueOnce(undefined);
    const audit = { write } as unknown as AuditService;

    const result = await runMemoryForgetSweep({ repo, audit, logger: buildLogger() });

    expect(result.count).toBe(2);
    expect(write).toHaveBeenCalledTimes(2);
  });
});
