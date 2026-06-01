import { describe, it, expect, vi } from 'vitest';
import { HouseholdAllergensRepository } from './household-allergens.repository.js';
import { encryptField } from '../../lib/envelope-encryption.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = '22222222-2222-4222-8222-222222222222';

interface UpsertSpy {
  upsertCalls: Array<{
    table: string;
    payload: Record<string, unknown>;
    onConflict: string;
    ignoreDuplicates: boolean;
    returnId: string | null;
  }>;
  selectEqCalls: Array<{ table: string; filterCol: string; filterVal: string }>;
}

function buildClient(opts: {
  rows?: Array<{
    household_id: string;
    child_id: string | null;
    allergen: string;
    source: string;
  }>;
  upsertReturns?: string | null;
}): { client: unknown; spy: UpsertSpy } {
  const spy: UpsertSpy = { upsertCalls: [], selectEqCalls: [] };

  const client = {
    from(table: string) {
      return {
        select: (_cols: string) => ({
          eq: (col: string, val: string) => {
            spy.selectEqCalls.push({ table, filterCol: col, filterVal: val });
            return Promise.resolve({ data: opts.rows ?? [], error: null });
          },
        }),
        upsert: (payload: Record<string, unknown>, options: {
          onConflict: string;
          ignoreDuplicates: boolean;
        }) => {
          const returnId = opts.upsertReturns === undefined ? 'row-uuid' : opts.upsertReturns;
          spy.upsertCalls.push({
            table,
            payload,
            onConflict: options.onConflict,
            ignoreDuplicates: options.ignoreDuplicates,
            returnId,
          });
          return {
            select: (_cols: string) => ({
              maybeSingle: () => Promise.resolve({
                data: returnId === null ? null : { id: returnId },
                error: null,
              }),
            }),
          };
        },
        delete: () => ({
          eq: (_c1: string, _v1: string) => ({
            eq: (_c2: string, _v2: string) => Promise.resolve({ error: null }),
          }),
        }),
      };
    },
  };

  return { client, spy };
}

describe('HouseholdAllergensRepository.declareIfNew', () => {
  it('writes encrypted allergen + hash; child_id passed through (per-child row)', async () => {
    const { client, spy } = buildClient({});
    const repo = new HouseholdAllergensRepository(
      client as Parameters<typeof HouseholdAllergensRepository.prototype.declareIfNew>[0] &
        ConstructorParameters<typeof HouseholdAllergensRepository>[0],
      null,
    );
    const result = await repo.declareIfNew({
      household_id: HOUSEHOLD_ID,
      child_id: CHILD_ID,
      allergen: 'peanut',
      source: 'onboarding_declared',
    });

    expect(result.inserted).toBe(true);
    expect(spy.upsertCalls).toHaveLength(1);
    const call = spy.upsertCalls[0]!;
    expect(call.table).toBe('household_allergens');
    expect(call.payload.household_id).toBe(HOUSEHOLD_ID);
    expect(call.payload.child_id).toBe(CHILD_ID);
    expect(call.payload.source).toBe('onboarding_declared');
    expect(call.onConflict).toBe('household_id,child_id,allergen_hash');
    expect(call.ignoreDuplicates).toBe(true);
    // NOOP-encrypted under null DEK; plaintext must not appear in the payload.
    expect(call.payload.allergen).toMatch(/^NOOP:/);
    expect(call.payload.allergen_hash).toBeTypeOf('string');
  });

  it('writes child_id=null when caller omits per-child attribution (household-wide rule)', async () => {
    const { client, spy } = buildClient({});
    const repo = new HouseholdAllergensRepository(
      client as ConstructorParameters<typeof HouseholdAllergensRepository>[0],
      null,
    );
    await repo.declareIfNew({
      household_id: HOUSEHOLD_ID,
      child_id: null,
      allergen: 'sesame',
      source: 'parent_edited',
    });
    expect(spy.upsertCalls[0]!.payload.child_id).toBeNull();
  });

  it('returns inserted=false on conflict-skip', async () => {
    // Conflict: maybeSingle returns null because ignoreDuplicates makes the
    // existing row inaccessible via the upsert result.
    const { client } = buildClient({ upsertReturns: null });
    const repo = new HouseholdAllergensRepository(
      client as ConstructorParameters<typeof HouseholdAllergensRepository>[0],
      null,
    );
    const result = await repo.declareIfNew({
      household_id: HOUSEHOLD_ID,
      child_id: CHILD_ID,
      allergen: 'peanut',
      source: 'parent_edited',
    });
    expect(result.inserted).toBe(false);
  });
});

describe('HouseholdAllergensRepository.findByHouseholdId', () => {
  it('decrypts every row; returns mixed household-wide + per-child shape', async () => {
    const rows = [
      {
        household_id: HOUSEHOLD_ID,
        child_id: null,
        allergen: encryptField('shellfish', null),
        source: 'parent_edited',
      },
      {
        household_id: HOUSEHOLD_ID,
        child_id: CHILD_ID,
        allergen: encryptField('peanut', null),
        source: 'child_medical',
      },
    ];
    const { client } = buildClient({ rows });
    const repo = new HouseholdAllergensRepository(
      client as ConstructorParameters<typeof HouseholdAllergensRepository>[0],
      null,
    );
    const result = await repo.findByHouseholdId(HOUSEHOLD_ID);
    expect(result).toEqual([
      { household_id: HOUSEHOLD_ID, child_id: null, allergen: 'shellfish', source: 'parent_edited' },
      { household_id: HOUSEHOLD_ID, child_id: CHILD_ID, allergen: 'peanut', source: 'child_medical' },
    ]);
  });

  it('returns [] when no rows', async () => {
    const { client } = buildClient({ rows: [] });
    const repo = new HouseholdAllergensRepository(
      client as ConstructorParameters<typeof HouseholdAllergensRepository>[0],
      null,
    );
    expect(await repo.findByHouseholdId(HOUSEHOLD_ID)).toEqual([]);
  });
});

describe('HouseholdAllergensRepository.findByHouseholdAndChild', () => {
  it('returns plaintext allergens for the requested child only', async () => {
    const rows = [
      { household_id: HOUSEHOLD_ID, child_id: null, allergen: encryptField('shellfish', null), source: 'parent_edited' },
      { household_id: HOUSEHOLD_ID, child_id: CHILD_ID, allergen: encryptField('peanut', null), source: 'child_medical' },
      { household_id: HOUSEHOLD_ID, child_id: 'other-child', allergen: encryptField('celery', null), source: 'child_medical' },
    ];
    const { client } = buildClient({ rows });
    const repo = new HouseholdAllergensRepository(
      client as ConstructorParameters<typeof HouseholdAllergensRepository>[0],
      null,
    );
    const result = await repo.findByHouseholdAndChild(HOUSEHOLD_ID, CHILD_ID);
    expect(result).toEqual(['peanut']);
  });
});

void vi;
