import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChildRequestService } from './child-request.service.js';
import { ConflictError, NotFoundError } from '../../common/errors.js';
import type { ChildRequestRepository } from './child-request.repository.js';
import type { FoodPreferencesRepository } from '../food-preferences/food-preferences.repository.js';
import type { ThreadRepository } from '../threads/thread.repository.js';
import type { FastifyBaseLogger } from 'fastify';

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
  return { service: new ChildRequestService(repo, foodPrefs, threads, logger), repo, foodPrefs, threads, logger };
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
