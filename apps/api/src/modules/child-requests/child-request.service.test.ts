import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChildRequestService } from './child-request.service.js';
import { ConflictError, NotFoundError } from '../../common/errors.js';
import type { ChildRequestRepository } from './child-request.repository.js';
import type { FoodPreferencesRepository } from '../food-preferences/food-preferences.repository.js';
import type { ThreadRepository } from '../threads/thread.repository.js';
import type { FastifyBaseLogger } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SignalsService } from '../signals/signals.service.js';

// AC #9 (15-s2 review patch): a REAL SignalsService whose insert always fails —
// proves the seam survives a failing signals WRITE (not just an unwired dep).
function failingSignalsService() {
  const warn = vi.fn();
  const client = {
    from: (table: string) => {
      if (table !== 'signals') throw new Error(`unexpected table: ${table}`);
      return {
        insert: () => ({
          select: () => ({
            single: async () => ({ data: null, error: { code: '57014', message: 'insert failed' } }),
          }),
        }),
      };
    },
  } as unknown as SupabaseClient;
  return { signalsService: new SignalsService(client, null, { warn }), warn };
}

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const REQUEST_ID = '44444444-4444-4444-8444-444444444444';
const USER_ID = '55555555-5555-4555-8555-555555555555';

function makeService(overrides?: {
  repo?: Partial<ChildRequestRepository>;
  foodPrefs?: Partial<FoodPreferencesRepository>;
  threads?: Partial<ThreadRepository>;
}) {
  const repo = {
    create: vi.fn(),
    findPendingByHousehold: vi.fn(),
    findById: vi.fn(),
    resolve: vi.fn().mockResolvedValue(undefined),
    findChildName: vi.fn().mockResolvedValue('Layla'),
    ...overrides?.repo,
  } as unknown as ChildRequestRepository;
  const foodPrefs = {
    declare: vi.fn().mockResolvedValue({ food_preference_id: 'fp', was_existing: false }),
    ...overrides?.foodPrefs,
  } as unknown as FoodPreferencesRepository;
  const threads = {
    findActiveThreadByHousehold: vi.fn().mockResolvedValue(null),
    appendTurnNext: vi.fn(),
    ...overrides?.threads,
  } as unknown as ThreadRepository;
  const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger;
  // Story 15-s2 — signals dual-write seam; record() never throws by contract.
  const signals = { record: vi.fn().mockResolvedValue(undefined) };
  return {
    service: new ChildRequestService(repo, foodPrefs, threads, logger, signals),
    repo, foodPrefs, threads, logger, signals,
  };
}

describe('ChildRequestService.submitRequest', () => {
  it('returns { id } and attempts the best-effort Lumi thread injection', async () => {
    const { service, repo, threads } = makeService({
      repo: { create: vi.fn().mockResolvedValue({ id: REQUEST_ID }) },
    });

    const result = await service.submitRequest(
      { childId: CHILD_ID, householdId: HOUSEHOLD_ID, sessionId: SESSION_ID },
      'I want pizza on Friday!',
    );

    expect(result).toEqual({ id: REQUEST_ID });
    expect(repo.create).toHaveBeenCalledWith({
      householdId: HOUSEHOLD_ID,
      childId: CHILD_ID,
      sessionId: SESSION_ID,
      requestText: 'I want pizza on Friday!',
    });
    // No active planning thread → no turn appended (no-op, never throws).
    expect(threads.findActiveThreadByHousehold).toHaveBeenCalledWith(HOUSEHOLD_ID, 'planning', 'text');
    expect(threads.appendTurnNext).not.toHaveBeenCalled();
  });

  it('appends a plain lumi message turn when a planning thread exists', async () => {
    const { service, threads } = makeService({
      repo: { create: vi.fn().mockResolvedValue({ id: REQUEST_ID }) },
      threads: {
        findActiveThreadByHousehold: vi.fn().mockResolvedValue({ id: 'thread-1' }),
        appendTurnNext: vi.fn().mockResolvedValue({ server_seq: 5 }),
      },
    });

    await service.submitRequest(
      { childId: CHILD_ID, householdId: HOUSEHOLD_ID, sessionId: SESSION_ID },
      'tacos!',
    );

    expect(threads.appendTurnNext).toHaveBeenCalledWith({
      threadId: 'thread-1',
      role: 'lumi',
      body: { type: 'message', content: 'Layla asked: "tacos!"' },
      modality: 'text',
    });
  });

  it('dual-writes a lunch_request signal with the verbatim text (Story 15-s2)', async () => {
    const { service, signals } = makeService({
      repo: { create: vi.fn().mockResolvedValue({ id: REQUEST_ID }) },
    });

    await service.submitRequest(
      { childId: CHILD_ID, householdId: HOUSEHOLD_ID, sessionId: SESSION_ID },
      'salmon please',
    );

    expect(signals.record).toHaveBeenCalledTimes(1);
    expect(signals.record.mock.calls[0]?.[0]).toMatchObject({
      household_id: HOUSEHOLD_ID,
      child_id: CHILD_ID,
      subject_ref: { request_id: REQUEST_ID, session_id: SESSION_ID },
      payload: { kind: 'lunch_request', text: 'salmon please' },
      source: 'lunch_link',
    });
  });

  it('submits fine when no signals service is wired (optional dep)', async () => {
    const repo = {
      create: vi.fn().mockResolvedValue({ id: REQUEST_ID }),
      findChildName: vi.fn().mockResolvedValue('Layla'),
    } as unknown as ChildRequestRepository;
    const threads = {
      findActiveThreadByHousehold: vi.fn().mockResolvedValue(null),
    } as unknown as ThreadRepository;
    const logger = { warn: vi.fn() } as unknown as FastifyBaseLogger;
    const service = new ChildRequestService(
      repo,
      {} as unknown as FoodPreferencesRepository,
      threads,
      logger,
    );

    await expect(
      service.submitRequest(
        { childId: CHILD_ID, householdId: HOUSEHOLD_ID, sessionId: SESSION_ID },
        'pizza',
      ),
    ).resolves.toEqual({ id: REQUEST_ID });
  });

  it('still submits when the signals write FAILS through the real SignalsService (AC #9)', async () => {
    const { signalsService, warn } = failingSignalsService();
    const repo = {
      create: vi.fn().mockResolvedValue({ id: REQUEST_ID }),
      findChildName: vi.fn().mockResolvedValue('Layla'),
    } as unknown as ChildRequestRepository;
    const threads = {
      findActiveThreadByHousehold: vi.fn().mockResolvedValue(null),
    } as unknown as ThreadRepository;
    const logger = { warn: vi.fn() } as unknown as FastifyBaseLogger;
    const service = new ChildRequestService(
      repo,
      {} as unknown as FoodPreferencesRepository,
      threads,
      logger,
      signalsService,
    );

    await expect(
      service.submitRequest(
        { childId: CHILD_ID, householdId: HOUSEHOLD_ID, sessionId: SESSION_ID },
        'pizza',
      ),
    ).resolves.toEqual({ id: REQUEST_ID });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('maps a unique-violation (23505) to ConflictError', async () => {
    const { service } = makeService({
      repo: { create: vi.fn().mockRejectedValue({ code: '23505', message: 'dup' }) },
    });

    await expect(
      service.submitRequest(
        { childId: CHILD_ID, householdId: HOUSEHOLD_ID, sessionId: SESSION_ID },
        'again',
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('never lets a thread-injection failure block the submission', async () => {
    const { service } = makeService({
      repo: { create: vi.fn().mockResolvedValue({ id: REQUEST_ID }) },
      threads: {
        findActiveThreadByHousehold: vi.fn().mockRejectedValue(new Error('threads down')),
      },
    });

    await expect(
      service.submitRequest(
        { childId: CHILD_ID, householdId: HOUSEHOLD_ID, sessionId: SESSION_ID },
        'pizza',
      ),
    ).resolves.toEqual({ id: REQUEST_ID });
  });
});

describe('ChildRequestService.approve', () => {
  let ctx: ReturnType<typeof makeService>;
  beforeEach(() => {
    ctx = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue({
          id: REQUEST_ID,
          household_id: HOUSEHOLD_ID,
          child_id: CHILD_ID,
          request_text: 'pizza on Friday',
          status: 'pending',
        }),
        resolve: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it('writes a soft, advisory food_preferences signal (just_for_context, child_request)', async () => {
    await ctx.service.approve(REQUEST_ID, { resolvedByUserId: USER_ID, householdId: HOUSEHOLD_ID });

    expect(ctx.repo.resolve).toHaveBeenCalledWith(REQUEST_ID, {
      status: 'approved',
      resolvedByUserId: USER_ID,
    });
    expect(ctx.foodPrefs.declare).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      CHILD_ID,
      'pizza on Friday',
      'likes',
      'just_for_context',
      'child_request',
    );
  });

  it('truncates the planner-signal item to 100 chars', async () => {
    const long = 'a'.repeat(150);
    ctx = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue({
          id: REQUEST_ID,
          household_id: HOUSEHOLD_ID,
          child_id: CHILD_ID,
          request_text: long,
          status: 'pending',
        }),
      },
    });
    await ctx.service.approve(REQUEST_ID, { resolvedByUserId: USER_ID, householdId: HOUSEHOLD_ID });
    expect(ctx.foodPrefs.declare).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      CHILD_ID,
      'a'.repeat(100),
      'likes',
      'just_for_context',
      'child_request',
    );
  });

  it('dual-writes a preference_edit signal after the food_preferences mirror (Story 15-s2)', async () => {
    await ctx.service.approve(REQUEST_ID, { resolvedByUserId: USER_ID, householdId: HOUSEHOLD_ID });

    expect(ctx.signals.record).toHaveBeenCalledTimes(1);
    expect(ctx.signals.record.mock.calls[0]?.[0]).toMatchObject({
      household_id: HOUSEHOLD_ID,
      child_id: CHILD_ID,
      payload: {
        kind: 'preference_edit',
        item: 'pizza on Friday',
        valence: 'likes',
        enforcement: 'just_for_context',
        scope: 'child',
      },
      source: 'app',
    });
  });

  it('still writes the preference_edit signal when the food_preferences mirror fails (log ⊇ stores — 15-s2 review doctrine)', async () => {
    ctx = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue({
          id: REQUEST_ID,
          household_id: HOUSEHOLD_ID,
          child_id: CHILD_ID,
          request_text: 'pizza on Friday',
          status: 'pending',
        }),
      },
      foodPrefs: { declare: vi.fn().mockRejectedValue(new Error('db down')) },
    });

    await ctx.service.approve(REQUEST_ID, { resolvedByUserId: USER_ID, householdId: HOUSEHOLD_ID });

    // The signal records the approval EVENT, not the store update — the failed
    // mirror is warn-logged and the approval still succeeds.
    expect(ctx.signals.record).toHaveBeenCalledTimes(1);
    expect(ctx.logger.warn).toHaveBeenCalled();
  });

  it('still approves when the signals write FAILS through the real SignalsService (AC #9)', async () => {
    const { signalsService, warn } = failingSignalsService();
    const repo = {
      findById: vi.fn().mockResolvedValue({
        id: REQUEST_ID,
        household_id: HOUSEHOLD_ID,
        child_id: CHILD_ID,
        request_text: 'pizza on Friday',
        status: 'pending',
      }),
      resolve: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChildRequestRepository;
    const foodPrefs = {
      declare: vi.fn().mockResolvedValue({ food_preference_id: 'fp', was_existing: false }),
    } as unknown as FoodPreferencesRepository;
    const logger = { warn: vi.fn() } as unknown as FastifyBaseLogger;
    const service = new ChildRequestService(
      repo,
      foodPrefs,
      {} as unknown as ThreadRepository,
      logger,
      signalsService,
    );

    await expect(
      service.approve(REQUEST_ID, { resolvedByUserId: USER_ID, householdId: HOUSEHOLD_ID }),
    ).resolves.toBeUndefined();
    expect(foodPrefs.declare).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('throws NotFoundError when the request is not in the household', async () => {
    ctx = makeService({ repo: { findById: vi.fn().mockResolvedValue(null) } });
    await expect(
      ctx.service.approve(REQUEST_ID, { resolvedByUserId: USER_ID, householdId: HOUSEHOLD_ID }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ConflictError when already resolved (no double food_preferences write)', async () => {
    ctx = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue({
          id: REQUEST_ID,
          household_id: HOUSEHOLD_ID,
          child_id: CHILD_ID,
          request_text: 'pizza',
          status: 'approved',
        }),
      },
    });
    await expect(
      ctx.service.approve(REQUEST_ID, { resolvedByUserId: USER_ID, householdId: HOUSEHOLD_ID }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(ctx.foodPrefs.declare).not.toHaveBeenCalled();
  });
});

describe('ChildRequestService.decline', () => {
  it('resolves declined and writes NO planner signal', async () => {
    const { service, repo, foodPrefs } = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue({
          id: REQUEST_ID,
          household_id: HOUSEHOLD_ID,
          child_id: CHILD_ID,
          request_text: 'pizza',
          status: 'pending',
        }),
      },
    });

    await service.decline(REQUEST_ID, { resolvedByUserId: USER_ID, householdId: HOUSEHOLD_ID });

    expect(repo.resolve).toHaveBeenCalledWith(REQUEST_ID, {
      status: 'declined',
      resolvedByUserId: USER_ID,
    });
    expect(foodPrefs.declare).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when the request is not in the household', async () => {
    const { service } = makeService({ repo: { findById: vi.fn().mockResolvedValue(null) } });
    await expect(
      service.decline(REQUEST_ID, { resolvedByUserId: USER_ID, householdId: HOUSEHOLD_ID }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
