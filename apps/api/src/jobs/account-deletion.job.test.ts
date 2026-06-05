import { describe, it, expect, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuditService } from '../audit/audit.service.js';
import { runAccountDeletion, type AccountDeletionDeps } from './account-deletion.job.js';
import { HouseholdsRepository } from '../modules/households/households.repository.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const PRIMARY_USER_ID = '22222222-2222-4222-8222-222222222222';
const CHILD_ID = '33333333-3333-4333-8333-333333333333';
const NODE_ID = '44444444-4444-4444-8444-444444444444';
const THREAD_ID = '55555555-5555-4555-8555-555555555555';

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

interface JobMockOpts {
  users?: Array<{ id: string }>;
  deleteUserThrows?: boolean;
}

function buildJobMock(opts: JobMockOpts = {}) {
  const sequence: string[] = [];
  const processorInserts: Array<Record<string, unknown>> = [];
  const deleteUserCalls: string[] = [];

  const selectData: Record<string, Array<{ id: string }>> = {
    users: opts.users ?? [{ id: PRIMARY_USER_ID }],
    children: [{ id: CHILD_ID }],
    memory_nodes: [{ id: NODE_ID }],
    threads: [{ id: THREAD_ID }],
  };

  const supabase = {
    from(table: string) {
      return {
        select() {
          const chain: Record<string, unknown> = {};
          chain.eq = () => chain;
          chain.limit = () => chain;
          chain.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
            resolve({ data: selectData[table] ?? [], error: null });
          return chain;
        },
        delete() {
          sequence.push(`delete:${table}`);
          const chain: Record<string, unknown> = {};
          chain.eq = () => chain;
          chain.in = () => chain;
          chain.not = () => chain;
          chain.then = (resolve: (v: { error: null }) => unknown) => resolve({ error: null });
          return chain;
        },
        insert(row: Record<string, unknown>) {
          if (table === 'processor_deletion_log') processorInserts.push(row);
          return Promise.resolve({ error: null });
        },
      };
    },
    auth: {
      admin: {
        deleteUser: vi.fn(async (id: string) => {
          deleteUserCalls.push(id);
          if (opts.deleteUserThrows) throw new Error('auth delete failed');
          return { data: {}, error: null };
        }),
      },
    },
  } as unknown as SupabaseClient;

  const audit = {
    write: vi.fn(async (input: { event_type: string }) => {
      sequence.push(`audit:${input.event_type}`);
    }),
  } as unknown as Pick<AuditService, 'write'>;

  const logger = buildLogger();
  const deps: AccountDeletionDeps = { supabase, audit, logger };

  return { deps, sequence, processorInserts, deleteUserCalls, audit, logger, supabase };
}

const HOUSEHOLD = { id: HOUSEHOLD_ID, deletion_requested_at: '2026-05-01T00:00:00.000Z' };

describe('runAccountDeletion', () => {
  it('writes the account.hard_deleted audit row before deleting the households row', async () => {
    const mock = buildJobMock();

    await runAccountDeletion(mock.deps, HOUSEHOLD);

    expect(mock.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'account.hard_deleted',
        household_id: HOUSEHOLD_ID,
      }),
    );
    const auditIdx = mock.sequence.indexOf('audit:account.hard_deleted');
    const householdIdx = mock.sequence.indexOf('delete:households');
    expect(auditIdx).toBeGreaterThanOrEqual(0);
    expect(householdIdx).toBeGreaterThanOrEqual(0);
    expect(auditIdx).toBeLessThan(householdIdx);
  });

  it('cascades deletes in dependency order: memory_nodes before children, children before plans, households last', async () => {
    const mock = buildJobMock();

    await runAccountDeletion(mock.deps, HOUSEHOLD);

    const deletes = mock.sequence.filter((s) => s.startsWith('delete:')).map((s) => s.slice(7));
    expect(deletes.indexOf('memory_nodes')).toBeLessThan(deletes.indexOf('children'));
    expect(deletes.indexOf('children')).toBeLessThan(deletes.indexOf('plans'));
    expect(deletes[deletes.length - 1]).toBe('households');
  });

  it('writes a processor_deletion_log row for all 6 processors after the cascade', async () => {
    const mock = buildJobMock();

    await runAccountDeletion(mock.deps, HOUSEHOLD);

    expect(mock.processorInserts).toHaveLength(6);
    expect(mock.processorInserts.map((r) => r.processor)).toEqual([
      'supabase_auth',
      'elevenlabs',
      'sendgrid',
      'twilio',
      'stripe',
      'openai',
    ]);
  });

  it('continues to the next processor when one processor erasure throws', async () => {
    const mock = buildJobMock({ deleteUserThrows: true });

    await runAccountDeletion(mock.deps, HOUSEHOLD);

    // All 6 rows still written; supabase_auth marked failed, the rest completed.
    expect(mock.processorInserts).toHaveLength(6);
    const authRow = mock.processorInserts.find((r) => r.processor === 'supabase_auth');
    expect(authRow?.status).toBe('failed');
    expect(mock.processorInserts.filter((r) => r.status === 'completed')).toHaveLength(5);
  });

  it('calls supabase_auth deleteUser for every household user id', async () => {
    const mock = buildJobMock();

    await runAccountDeletion(mock.deps, HOUSEHOLD);

    expect(mock.deleteUserCalls).toEqual([PRIMARY_USER_ID]);
  });

  it('skips supabase_auth deleteUser and warns when no household users exist', async () => {
    const mock = buildJobMock({ users: [] });

    await runAccountDeletion(mock.deps, HOUSEHOLD);

    expect(mock.deleteUserCalls).toEqual([]);
    expect(mock.logger.warn).toHaveBeenCalled();
    // The processor_deletion_log row is still written (status completed — skip is not a failure).
    const authRow = mock.processorInserts.find((r) => r.processor === 'supabase_auth');
    expect(authRow?.status).toBe('completed');
  });
});

describe('HouseholdsRepository.findPendingHardDeletes', () => {
  it('queries households filtered to a non-null deletion_requested_at older than the cutoff', async () => {
    const notSpy = vi.fn();
    const ltSpy = vi.fn();
    const client = {
      from() {
        return {
          select() {
            const chain: Record<string, unknown> = {};
            chain.not = (col: string, op: string, val: unknown) => {
              notSpy(col, op, val);
              return chain;
            };
            chain.lt = (col: string, val: unknown) => {
              ltSpy(col, val);
              return Promise.resolve({ data: [], error: null });
            };
            return chain;
          },
        };
      },
    } as unknown as SupabaseClient;

    const repo = new HouseholdsRepository(client, null);
    const cutoff = '2026-05-06T00:00:00.000Z';
    const result = await repo.findPendingHardDeletes(cutoff);

    expect(result).toEqual([]);
    expect(notSpy).toHaveBeenCalledWith('deletion_requested_at', 'is', null);
    expect(ltSpy).toHaveBeenCalledWith('deletion_requested_at', cutoff);
  });
});
