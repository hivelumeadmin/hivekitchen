import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ExtraRemovalSignalService,
  EXTRA_REMOVAL_BIAS_THRESHOLD,
  EXTRA_REMOVAL_WINDOW_DAYS,
  computeWindowStartIso,
} from './extra-removal-signal.service.js';
import type { ExtraRulesRepository } from '../children/extra-rules.repository.js';
import type { AuditService } from '../../audit/audit.service.js';
import { SignalsService } from '../signals/signals.service.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = '22222222-2222-4222-8222-222222222222';
const PLAN_ITEM_ID = '33333333-3333-4333-8333-333333333333';
const REQUEST_ID = '44444444-4444-4444-8444-444444444444';
const COMPONENT_TYPE = 'sweet treat';

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

interface ClientScenario {
  insertResult?: { error: unknown };
  countResult?: { count: number | null; error: unknown };
  updateSignalsResult?: { error: unknown };
}

interface MockClient {
  client: SupabaseClient;
  insertCalls: Array<Record<string, unknown>>;
  selectCalls: Array<{ args: unknown[]; eqArgs: unknown[][]; gteArgs: unknown[][] }>;
  updateCalls: Array<{ payload: Record<string, unknown>; eqArgs: unknown[][]; gteArgs: unknown[][] }>;
}

function buildClient(scenario: ClientScenario = {}): MockClient {
  const insertCalls: MockClient['insertCalls'] = [];
  const selectCalls: MockClient['selectCalls'] = [];
  const updateCalls: MockClient['updateCalls'] = [];

  const insert = vi.fn().mockImplementation((payload: Record<string, unknown>) => {
    insertCalls.push(payload);
    return Promise.resolve(scenario.insertResult ?? { error: null });
  });

  const select = vi.fn().mockImplementation((...args: unknown[]) => {
    const record = { args, eqArgs: [] as unknown[][], gteArgs: [] as unknown[][] };
    selectCalls.push(record);
    const chain: Record<string, unknown> = {};
    chain.eq = vi.fn().mockImplementation((...eqArgs: unknown[]) => {
      record.eqArgs.push(eqArgs);
      return chain;
    });
    chain.gte = vi.fn().mockImplementation((...gteArgs: unknown[]) => {
      record.gteArgs.push(gteArgs);
      return Promise.resolve(scenario.countResult ?? { count: 0, error: null });
    });
    return chain;
  });

  const update = vi.fn().mockImplementation((payload: Record<string, unknown>) => {
    const record = { payload, eqArgs: [] as unknown[][], gteArgs: [] as unknown[][] };
    updateCalls.push(record);
    const chain: Record<string, unknown> = {};
    chain.eq = vi.fn().mockImplementation((...eqArgs: unknown[]) => {
      record.eqArgs.push(eqArgs);
      return chain;
    });
    chain.gte = vi.fn().mockImplementation((...gteArgs: unknown[]) => {
      record.gteArgs.push(gteArgs);
      return Promise.resolve(scenario.updateSignalsResult ?? { error: null });
    });
    return chain;
  });

  const builder = { insert, select, update };
  const client = {
    from: vi.fn().mockReturnValue(builder),
  } as unknown as SupabaseClient;

  return { client, insertCalls, selectCalls, updateCalls };
}

type AppendBanResult =
  | { extra_rules: { pins: string[]; bans: string[] }; status: 'appended' | 'already_banned' }
  | null;

function buildExtraRulesRepo(opts: {
  appendResult?: AppendBanResult;
  appendError?: unknown;
} = {}): ExtraRulesRepository & {
  appendBanAtomic: ReturnType<typeof vi.fn>;
} {
  // `??` collapses `null` into the default — use the in-operator so callers
  // can opt-in to a null return for the cross-household-guard test.
  const appendResult: AppendBanResult = 'appendResult' in opts
    ? (opts.appendResult as AppendBanResult)
    : { extra_rules: { pins: [], bans: [COMPONENT_TYPE] }, status: 'appended' };
  const appendBanAtomic = opts.appendError
    ? vi.fn().mockRejectedValue(opts.appendError)
    : vi.fn().mockResolvedValue(appendResult);
  return {
    appendBanAtomic,
  } as unknown as ExtraRulesRepository & {
    appendBanAtomic: ReturnType<typeof vi.fn>;
  };
}

function buildAudit(): AuditService & { write: ReturnType<typeof vi.fn> } {
  return {
    write: vi.fn().mockResolvedValue(undefined),
  } as unknown as AuditService & { write: ReturnType<typeof vi.fn> };
}

describe('ExtraRemovalSignalService.recordRemoval', () => {
  const baseInput = {
    householdId: HOUSEHOLD_ID,
    childId: CHILD_ID,
    componentType: COMPONENT_TYPE,
    planItemId: PLAN_ITEM_ID,
    requestId: REQUEST_ID,
  };

  beforeEach(() => {
    vi.useRealTimers();
  });

  it('inserts the signal row with the expected fields', async () => {
    const mock = buildClient({ countResult: { count: 1, error: null } });
    const repo = buildExtraRulesRepo();
    const service = new ExtraRemovalSignalService({
      client: mock.client,
      extraRulesRepo: repo,
      auditService: buildAudit(),
      logger: buildLogger(),
    });

    await service.recordRemoval(baseInput);

    expect(mock.insertCalls).toHaveLength(1);
    expect(mock.insertCalls[0]).toEqual({
      household_id: HOUSEHOLD_ID,
      child_id: CHILD_ID,
      component_type: COMPONENT_TYPE,
      plan_item_id: PLAN_ITEM_ID,
    });
  });

  // ---- Story 15-s2: signals-log dual-write ----

  it('dual-writes an extra_removal signal (Story 15-s2)', async () => {
    const mock = buildClient({ countResult: { count: 1, error: null } });
    const record = vi.fn().mockResolvedValue(undefined);
    const service = new ExtraRemovalSignalService({
      client: mock.client,
      extraRulesRepo: buildExtraRulesRepo(),
      auditService: buildAudit(),
      logger: buildLogger(),
      signalsService: { record },
    });

    await service.recordRemoval(baseInput);

    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]?.[0]).toMatchObject({
      household_id: HOUSEHOLD_ID,
      child_id: CHILD_ID,
      subject_ref: { plan_item_id: PLAN_ITEM_ID },
      payload: { kind: 'extra_removal', component_type: 'sweet treat' },
      source: 'app',
    });
  });

  it('still dual-writes the signal when the legacy insert fails (log ⊇ stores — 15-s2 review doctrine)', async () => {
    const mock = buildClient({
      insertResult: { error: { message: 'insert failed' } },
      countResult: { count: 1, error: null },
    });
    const record = vi.fn().mockResolvedValue(undefined);
    const service = new ExtraRemovalSignalService({
      client: mock.client,
      extraRulesRepo: buildExtraRulesRepo(),
      auditService: buildAudit(),
      logger: buildLogger(),
      signalsService: { record },
    });

    await service.recordRemoval(baseInput);

    // The signal records the removal EVENT, not the store update — a legacy
    // failure must not lose it.
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('legacy insert + bias flow still run when the signals write FAILS through the real SignalsService (AC #9)', async () => {
    const legacy = buildClient({ countResult: { count: 1, error: null } });
    const legacyFrom = (legacy.client as unknown as { from: (t: string) => unknown }).from;
    // Route 'signals' to a failing insert chain; everything else to the legacy builder.
    const failingSignalsChain = {
      insert: () => ({
        select: () => ({
          single: async () => ({ data: null, error: { code: '57014', message: 'insert failed' } }),
        }),
      }),
    };
    const client = {
      from: (table: string) => (table === 'signals' ? failingSignalsChain : legacyFrom(table)),
    } as unknown as SupabaseClient;
    const warn = vi.fn();
    const service = new ExtraRemovalSignalService({
      client,
      extraRulesRepo: buildExtraRulesRepo(),
      auditService: buildAudit(),
      logger: buildLogger(),
      signalsService: new SignalsService(client, null, { warn }),
    });

    await expect(service.recordRemoval(baseInput)).resolves.toBeUndefined();

    // record() swallowed the insert failure (warn) and the primary path ran.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(legacy.insertCalls).toHaveLength(1);
  });

  it('does NOT apply bias when count is below threshold', async () => {
    const mock = buildClient({
      countResult: { count: EXTRA_REMOVAL_BIAS_THRESHOLD - 1, error: null },
    });
    const repo = buildExtraRulesRepo();
    const audit = buildAudit();
    const service = new ExtraRemovalSignalService({
      client: mock.client,
      extraRulesRepo: repo,
      auditService: audit,
      logger: buildLogger(),
    });

    await service.recordRemoval(baseInput);

    expect(repo.appendBanAtomic).not.toHaveBeenCalled();
    expect(audit.write).not.toHaveBeenCalled();
    // No bias_applied flip update — only the count select happened.
    expect(mock.updateCalls).toHaveLength(0);
  });

  it('applies bias once count meets threshold: extends bans, flips signals, audits', async () => {
    const mock = buildClient({
      countResult: { count: EXTRA_REMOVAL_BIAS_THRESHOLD, error: null },
    });
    const repo = buildExtraRulesRepo({
      appendResult: {
        extra_rules: { pins: ['fruit'], bans: [COMPONENT_TYPE] },
        status: 'appended',
      },
    });
    const audit = buildAudit();
    const service = new ExtraRemovalSignalService({
      client: mock.client,
      extraRulesRepo: repo,
      auditService: audit,
      logger: buildLogger(),
    });

    await service.recordRemoval(baseInput);

    // The atomic RPC is called with the (child, household, type) triple — it
    // does the read+append serverside so no pins payload is passed in.
    expect(repo.appendBanAtomic).toHaveBeenCalledWith({
      childId: CHILD_ID,
      householdId: HOUSEHOLD_ID,
      componentType: COMPONENT_TYPE,
    });

    // Count query must be scoped to the household so cross-household signals
    // cannot inflate the threshold (P1 patch).
    const countSelectEqArgs = mock.selectCalls[0]?.eqArgs ?? [];
    expect(countSelectEqArgs).toContainEqual(['household_id', HOUSEHOLD_ID]);
    expect(countSelectEqArgs).toContainEqual(['child_id', CHILD_ID]);
    expect(countSelectEqArgs).toContainEqual(['component_type', COMPONENT_TYPE]);

    // bias_applied flip — single update scoped to {household, child, type, false}
    // and a removed_at >= window_start guard.
    expect(mock.updateCalls).toHaveLength(1);
    expect(mock.updateCalls[0]?.payload).toEqual({ bias_applied: true });
    const eqArgs = mock.updateCalls[0]?.eqArgs ?? [];
    expect(eqArgs).toEqual([
      ['household_id', HOUSEHOLD_ID],
      ['child_id', CHILD_ID],
      ['component_type', COMPONENT_TYPE],
      ['bias_applied', false],
    ]);

    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'plan.extra_bias_applied',
        household_id: HOUSEHOLD_ID,
        request_id: REQUEST_ID,
        metadata: expect.objectContaining({
          child_id: CHILD_ID,
          component_type: COMPONENT_TYPE,
          action: 'added_to_bans',
        }),
      }),
    );
  });

  it('normalises componentType to lowercase before inserting and counting (P3 patch)', async () => {
    const mock = buildClient({ countResult: { count: 1, error: null } });
    const repo = buildExtraRulesRepo();
    const service = new ExtraRemovalSignalService({
      client: mock.client,
      extraRulesRepo: repo,
      auditService: buildAudit(),
      logger: buildLogger(),
    });

    await service.recordRemoval({ ...baseInput, componentType: 'Sweet Treat  ' });

    expect(mock.insertCalls[0]).toMatchObject({ component_type: 'sweet treat' });
    const countEqArgs = mock.selectCalls[0]?.eqArgs ?? [];
    expect(countEqArgs).toContainEqual(['component_type', 'sweet treat']);
  });

  it('does NOT duplicate when the component_type is already banned, but still flips signals so the threshold resets', async () => {
    const mock = buildClient({
      countResult: { count: EXTRA_REMOVAL_BIAS_THRESHOLD, error: null },
    });
    const repo = buildExtraRulesRepo({
      appendResult: {
        extra_rules: { pins: [], bans: [COMPONENT_TYPE] },
        status: 'already_banned',
      },
    });
    const audit = buildAudit();
    const service = new ExtraRemovalSignalService({
      client: mock.client,
      extraRulesRepo: repo,
      auditService: audit,
      logger: buildLogger(),
    });

    await service.recordRemoval(baseInput);

    expect(repo.appendBanAtomic).toHaveBeenCalledTimes(1);
    // No new ban was written — no audit row should be emitted.
    expect(audit.write).not.toHaveBeenCalled();
    // Signals are still flipped so the threshold counter resets — without this,
    // every subsequent removal would re-trigger the no-op bias path.
    expect(mock.updateCalls).toHaveLength(1);
  });

  it('returns silently and does not throw when the insert fails', async () => {
    const mock = buildClient({ insertResult: { error: new Error('db down') } });
    const repo = buildExtraRulesRepo();
    const audit = buildAudit();
    const logger = buildLogger();
    const service = new ExtraRemovalSignalService({
      client: mock.client,
      extraRulesRepo: repo,
      auditService: audit,
      logger,
    });

    await expect(service.recordRemoval(baseInput)).resolves.toBeUndefined();
    // Insert failure short-circuits — no count, no bias evaluation.
    expect(mock.selectCalls).toHaveLength(0);
    expect(repo.appendBanAtomic).not.toHaveBeenCalled();
    expect((logger.error as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it('skips insert and bias work entirely when component_type is empty/whitespace', async () => {
    const mock = buildClient();
    const repo = buildExtraRulesRepo();
    const service = new ExtraRemovalSignalService({
      client: mock.client,
      extraRulesRepo: repo,
      auditService: buildAudit(),
      logger: buildLogger(),
    });

    await service.recordRemoval({ ...baseInput, componentType: '   ' });

    expect(mock.insertCalls).toHaveLength(0);
    expect(mock.selectCalls).toHaveLength(0);
  });

  it('does not apply bias when the count query fails', async () => {
    const mock = buildClient({
      countResult: { count: null, error: new Error('count failed') },
    });
    const repo = buildExtraRulesRepo();
    const audit = buildAudit();
    const service = new ExtraRemovalSignalService({
      client: mock.client,
      extraRulesRepo: repo,
      auditService: audit,
      logger: buildLogger(),
    });

    await service.recordRemoval(baseInput);

    expect(repo.appendBanAtomic).not.toHaveBeenCalled();
    expect(audit.write).not.toHaveBeenCalled();
  });

  it('does not flip signals when the extra_rules row is missing (cross-household guard)', async () => {
    const mock = buildClient({
      countResult: { count: EXTRA_REMOVAL_BIAS_THRESHOLD, error: null },
    });
    const repo = buildExtraRulesRepo({ appendResult: null });
    const audit = buildAudit();
    const service = new ExtraRemovalSignalService({
      client: mock.client,
      extraRulesRepo: repo,
      auditService: audit,
      logger: buildLogger(),
    });

    await service.recordRemoval(baseInput);

    // appendBanAtomic was attempted but returned null — leave signals
    // unapplied so a retry can succeed.
    expect(repo.appendBanAtomic).toHaveBeenCalledTimes(1);
    expect(mock.updateCalls).toHaveLength(0);
    expect(audit.write).not.toHaveBeenCalled();
  });

  it('does not flip signals or audit when the append RPC throws', async () => {
    const mock = buildClient({
      countResult: { count: EXTRA_REMOVAL_BIAS_THRESHOLD, error: null },
    });
    const repo = buildExtraRulesRepo({ appendError: new Error('rpc down') });
    const audit = buildAudit();
    const logger = buildLogger();
    const service = new ExtraRemovalSignalService({
      client: mock.client,
      extraRulesRepo: repo,
      auditService: audit,
      logger,
    });

    await expect(service.recordRemoval(baseInput)).resolves.toBeUndefined();
    expect(mock.updateCalls).toHaveLength(0);
    expect(audit.write).not.toHaveBeenCalled();
    expect((logger.error as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it('audit failure after a successful bias apply is logged but does not throw', async () => {
    const mock = buildClient({
      countResult: { count: EXTRA_REMOVAL_BIAS_THRESHOLD, error: null },
    });
    const repo = buildExtraRulesRepo({
      appendResult: {
        extra_rules: { pins: [], bans: [COMPONENT_TYPE] },
        status: 'appended',
      },
    });
    const audit = {
      write: vi.fn().mockRejectedValue(new Error('audit DB down')),
    } as unknown as AuditService & { write: ReturnType<typeof vi.fn> };
    const logger = buildLogger();
    const service = new ExtraRemovalSignalService({
      client: mock.client,
      extraRulesRepo: repo,
      auditService: audit,
      logger,
    });

    await expect(service.recordRemoval(baseInput)).resolves.toBeUndefined();
    expect((logger.error as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });
});

describe('computeWindowStartIso', () => {
  it('returns an ISO timestamp WINDOW_DAYS earlier than now', () => {
    const now = new Date('2026-05-07T00:00:00.000Z');
    expect(computeWindowStartIso(EXTRA_REMOVAL_WINDOW_DAYS, now)).toBe(
      '2026-04-07T00:00:00.000Z',
    );
  });

  it('handles month boundaries (UTC)', () => {
    const now = new Date('2026-03-05T00:00:00.000Z');
    expect(computeWindowStartIso(30, now)).toBe('2026-02-03T00:00:00.000Z');
  });
});
