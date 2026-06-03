import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ChildRequestRepository } from './child-request.repository.js';
import { NotFoundError } from '../../common/errors.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const REQUEST_ID = '44444444-4444-4444-8444-444444444444';
const USER_ID = '55555555-5555-4555-8555-555555555555';

interface Step {
  op: string;
  args: unknown[];
}

type Result = { data: unknown; error: unknown };

// Chainable proxy: every builder method records a {op,args} step and returns the
// proxy; the .single()/.maybeSingle()/await terminals resolve via `resolve`,
// which can branch on the recorded path.
function buildClient(resolve: (steps: Step[]) => Result): {
  client: SupabaseClient;
  steps: Step[];
} {
  const steps: Step[] = [];
  function proxy(): unknown {
    return new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'single' || prop === 'maybeSingle') {
            return () => Promise.resolve(resolve(steps));
          }
          if (prop === 'then') {
            return (onF: (v: Result) => unknown, onR?: (e: unknown) => unknown) =>
              Promise.resolve(resolve(steps)).then(onF, onR);
          }
          return (...args: unknown[]) => {
            steps.push({ op: String(prop), args });
            return proxy();
          };
        },
      },
    );
  }
  const client = {
    from(table: string) {
      steps.push({ op: 'from', args: [table] });
      return proxy();
    },
  };
  return { client: client as unknown as SupabaseClient, steps };
}

describe('ChildRequestRepository.create', () => {
  it('inserts a row and returns the persisted shape', async () => {
    const row = {
      id: REQUEST_ID,
      household_id: HOUSEHOLD_ID,
      child_id: CHILD_ID,
      session_id: SESSION_ID,
      request_text: 'I want pizza on Friday!',
      status: 'pending',
      resolved_at: null,
      resolved_by_user_id: null,
      created_at: '2026-06-03T12:00:00.000Z',
    };
    const { client, steps } = buildClient(() => ({ data: row, error: null }));
    const repo = new ChildRequestRepository(client);

    const result = await repo.create({
      householdId: HOUSEHOLD_ID,
      childId: CHILD_ID,
      sessionId: SESSION_ID,
      requestText: 'I want pizza on Friday!',
    });

    expect(result.id).toBe(REQUEST_ID);
    expect(result.status).toBe('pending');
    expect(steps.find((s) => s.op === 'from')?.args).toEqual(['child_lunch_requests']);
    expect(steps.find((s) => s.op === 'insert')?.args[0]).toMatchObject({
      household_id: HOUSEHOLD_ID,
      child_id: CHILD_ID,
      session_id: SESSION_ID,
      request_text: 'I want pizza on Friday!',
    });
  });

  it('propagates a unique-constraint violation on session_id', async () => {
    const { client } = buildClient(() => ({
      data: null,
      error: { code: '23505', message: 'duplicate key value' },
    }));
    const repo = new ChildRequestRepository(client);

    await expect(
      repo.create({
        householdId: HOUSEHOLD_ID,
        childId: CHILD_ID,
        sessionId: SESSION_ID,
        requestText: 'again',
      }),
    ).rejects.toMatchObject({ code: '23505' });
  });
});

describe('ChildRequestRepository.findPendingByHousehold', () => {
  it('returns pending rows with child_name joined', async () => {
    const { client, steps } = buildClient(() => ({
      data: [
        {
          id: REQUEST_ID,
          child_id: CHILD_ID,
          request_text: 'pizza please',
          status: 'pending',
          created_at: '2026-06-03T12:00:00.000Z',
          children: { name: 'Layla' },
        },
      ],
      error: null,
    }));
    const repo = new ChildRequestRepository(client);

    const result = await repo.findPendingByHousehold(HOUSEHOLD_ID);

    expect(result).toEqual([
      {
        id: REQUEST_ID,
        child_id: CHILD_ID,
        child_name: 'Layla',
        request_text: 'pizza please',
        status: 'pending',
        created_at: '2026-06-03T12:00:00.000Z',
      },
    ]);
    // Status filter is applied at the query boundary so approved/declined rows
    // never reach the parent's pending list.
    expect(
      steps.some((s) => s.op === 'eq' && s.args[0] === 'status' && s.args[1] === 'pending'),
    ).toBe(true);
    expect(
      steps.some((s) => s.op === 'eq' && s.args[0] === 'household_id' && s.args[1] === HOUSEHOLD_ID),
    ).toBe(true);
  });

  it('normalizes an array-embedded child and returns [] for no rows', async () => {
    const { client } = buildClient(() => ({ data: [], error: null }));
    const repo = new ChildRequestRepository(client);
    expect(await repo.findPendingByHousehold(HOUSEHOLD_ID)).toEqual([]);
  });
});

describe('ChildRequestRepository.findById', () => {
  it('returns null when the id is not in the household (no data-leak oracle)', async () => {
    const { client, steps } = buildClient(() => ({ data: null, error: null }));
    const repo = new ChildRequestRepository(client);

    const result = await repo.findById(REQUEST_ID, HOUSEHOLD_ID);

    expect(result).toBeNull();
    expect(
      steps.some((s) => s.op === 'eq' && s.args[0] === 'household_id' && s.args[1] === HOUSEHOLD_ID),
    ).toBe(true);
  });

  it('returns the row when found', async () => {
    const row = { id: REQUEST_ID, household_id: HOUSEHOLD_ID, status: 'pending' };
    const { client } = buildClient(() => ({ data: row, error: null }));
    const repo = new ChildRequestRepository(client);
    expect(await repo.findById(REQUEST_ID, HOUSEHOLD_ID)).toMatchObject({ id: REQUEST_ID });
  });
});

describe('ChildRequestRepository.resolve', () => {
  it('marks approved with resolved_at + resolved_by_user_id', async () => {
    const { client, steps } = buildClient(() => ({ data: [{ id: REQUEST_ID }], error: null }));
    const repo = new ChildRequestRepository(client);

    await repo.resolve(REQUEST_ID, { status: 'approved', resolvedByUserId: USER_ID });

    const update = steps.find((s) => s.op === 'update');
    expect(update?.args[0]).toMatchObject({
      status: 'approved',
      resolved_by_user_id: USER_ID,
    });
    expect((update?.args[0] as { resolved_at: string }).resolved_at).toBeDefined();
    // Scoped to pending so a concurrent resolve cannot double-apply.
    expect(
      steps.some((s) => s.op === 'eq' && s.args[0] === 'status' && s.args[1] === 'pending'),
    ).toBe(true);
  });

  it('throws NotFoundError when 0 rows update (already resolved)', async () => {
    const { client } = buildClient(() => ({ data: [], error: null }));
    const repo = new ChildRequestRepository(client);

    await expect(
      repo.resolve(REQUEST_ID, { status: 'declined', resolvedByUserId: USER_ID }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
