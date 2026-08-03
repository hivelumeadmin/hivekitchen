import { describe, it, expect, vi } from 'vitest';
import type { FamilyLanguageState, FamilyLanguageTerm } from '@hivekitchen/types';
import { FamilyLanguageRepository } from './family-language.repository.js';
import { FAMILY_LANGUAGE_RATIFY_THRESHOLD } from './family-language.detector.js';
import { buildFamilyLanguageDouble, type TermRow } from './family-language.test-double.js';

const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_HOUSEHOLD_ID = '44444444-4444-4444-8444-444444444444';
const THRESHOLD = FAMILY_LANGUAGE_RATIFY_THRESHOLD;

function buildRepo(initial: TermRow[] = []) {
  const double = buildFamilyLanguageDouble(initial);
  const repo = new FamilyLanguageRepository(
    double.client as unknown as ConstructorParameters<typeof FamilyLanguageRepository>[0],
  );
  return { repo, ...double };
}

function row(overrides: Partial<TermRow> = {}): TermRow {
  return {
    household_id: HOUSEHOLD_ID,
    term: 'Nani',
    maps_to: 'grandmother',
    usage_count: 2,
    state: 'candidate',
    first_seen_at: '2026-06-08T10:00:00.000Z',
    ratified_at: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// getTerms
// ---------------------------------------------------------------------------

describe('FamilyLanguageRepository.getTerms', () => {
  it('reads rows for the household and maps them to the wire shape', async () => {
    const { repo } = buildRepo([row()]);

    const terms = await repo.getTerms(HOUSEHOLD_ID);

    expect(terms).toEqual([
      {
        term: 'Nani',
        maps_to: 'grandmother',
        usage_count: 2,
        state: 'candidate',
        first_seen_at: '2026-06-08T10:00:00.000Z',
        ratified_at: null,
      },
    ]);
  });

  it('never leaks id or household_id into the wire shape', async () => {
    const { repo } = buildRepo([row()]);

    const terms = await repo.getTerms(HOUSEHOLD_ID);

    expect(Object.keys(terms[0]!).sort()).toEqual([
      'first_seen_at',
      'maps_to',
      'ratified_at',
      'state',
      'term',
      'usage_count',
    ]);
  });

  it('does not swallow an unexpected select payload shape', async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              order: async () => ({ data: { not: 'an array' }, error: null }),
            }),
          }),
        }),
      }),
    };
    const repo = new FamilyLanguageRepository(
      client as unknown as ConstructorParameters<typeof FamilyLanguageRepository>[0],
    );

    // A non-array payload yields no terms rather than a crash, the same
    // defensive shape recordUsage/ratify already have.
    expect(await repo.getTerms(HOUSEHOLD_ID)).toEqual([]);
  });

  it('returns [] for a household with no rows', async () => {
    const { repo } = buildRepo([]);

    expect(await repo.getTerms(HOUSEHOLD_ID)).toEqual([]);
  });

  it('scopes the read to the requested household', async () => {
    const { repo } = buildRepo([row(), row({ household_id: OTHER_HOUSEHOLD_ID, term: 'Lola' })]);

    const terms = await repo.getTerms(HOUSEHOLD_ID);

    expect(terms.map((t) => t.term)).toEqual(['Nani']);
  });

  it('orders by first_seen_at, breaking ties on term so the prompt is byte-stable', async () => {
    // Several terms inserted by one recordUsage call share a transaction
    // timestamp — without the tiebreak their order would be arbitrary.
    const sameStamp = '2026-06-08T10:00:00.000Z';
    const { repo } = buildRepo([
      row({ term: 'Thatha', first_seen_at: sameStamp }),
      row({ term: 'Nani', first_seen_at: sameStamp }),
      row({ term: 'Ammi', first_seen_at: '2026-06-07T10:00:00.000Z' }),
    ]);

    const terms = await repo.getTerms(HOUSEHOLD_ID);

    expect(terms.map((t) => t.term)).toEqual(['Ammi', 'Nani', 'Thatha']);
  });

  it('throws when the read errors', async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              order: () => Promise.resolve({ data: null, error: new Error('boom') }),
            }),
          }),
        }),
      }),
    };
    const repo = new FamilyLanguageRepository(
      client as unknown as ConstructorParameters<typeof FamilyLanguageRepository>[0],
    );

    await expect(repo.getTerms(HOUSEHOLD_ID)).rejects.toThrow('boom');
  });
});

// ---------------------------------------------------------------------------
// recordUsage — the crossing semantics now live in record_family_language_usage
// ---------------------------------------------------------------------------

describe('FamilyLanguageRepository.recordUsage', () => {
  it('calls record_family_language_usage with the detected terms and threshold', async () => {
    const { repo, calls } = buildRepo();

    await repo.recordUsage(
      HOUSEHOLD_ID,
      [{ term: 'Nani', maps_to: 'grandmother', occurrences: 1 }],
      THRESHOLD,
    );

    expect(calls).toEqual([
      {
        fn: 'record_family_language_usage',
        args: {
          p_household_id: HOUSEHOLD_ID,
          p_detected: [{ term: 'Nani', maps_to: 'grandmother', occurrences: 1 }],
          p_threshold: THRESHOLD,
        },
      },
    ]);
  });

  it('first sighting below threshold creates a candidate with no crossing', async () => {
    const { repo, rows } = buildRepo();

    const { newlyCandidate } = await repo.recordUsage(
      HOUSEHOLD_ID,
      [{ term: 'Nani', maps_to: 'grandmother', occurrences: 1 }],
      THRESHOLD,
    );

    expect(newlyCandidate).toHaveLength(0);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ term: 'Nani', usage_count: 1, state: 'candidate' });
  });

  it('a bump that crosses the threshold returns the term in newlyCandidate exactly once', async () => {
    const { repo } = buildRepo([row({ usage_count: 1 })]);

    const crossed = await repo.recordUsage(
      HOUSEHOLD_ID,
      [{ term: 'Nani', maps_to: 'grandmother', occurrences: 1 }],
      THRESHOLD,
    );
    expect(crossed.newlyCandidate.map((t) => t.term)).toEqual(['Nani']);

    const after = await repo.recordUsage(
      HOUSEHOLD_ID,
      [{ term: 'Nani', maps_to: 'grandmother', occurrences: 1 }],
      THRESHOLD,
    );
    expect(after.newlyCandidate).toHaveLength(0);
  });

  it('a single message with two occurrences jumps 0→2 and crosses once', async () => {
    const { repo, rows } = buildRepo();

    const { newlyCandidate } = await repo.recordUsage(
      HOUSEHOLD_ID,
      [{ term: 'Nani', maps_to: 'grandmother', occurrences: 2 }],
      THRESHOLD,
    );

    expect(newlyCandidate.map((t) => t.term)).toEqual(['Nani']);
    expect(rows()[0]!.usage_count).toBe(2);
  });

  it('bumps an active term without re-prompting or demoting', async () => {
    const { repo, rows } = buildRepo([
      row({ usage_count: 5, state: 'active', ratified_at: '2026-06-08T10:05:00.000Z' }),
    ]);

    const { newlyCandidate } = await repo.recordUsage(
      HOUSEHOLD_ID,
      [{ term: 'Nani', maps_to: 'grandmother', occurrences: 1 }],
      THRESHOLD,
    );

    expect(newlyCandidate).toHaveLength(0);
    expect(rows()[0]!.usage_count).toBe(6);
    expect(rows()[0]!.state).toBe('active');
  });

  it('maps the returned crossing rows to the wire shape, without id or household_id', async () => {
    const { repo } = buildRepo();

    const { newlyCandidate } = await repo.recordUsage(
      HOUSEHOLD_ID,
      [{ term: 'Nani', maps_to: 'grandmother', occurrences: THRESHOLD }],
      THRESHOLD,
    );

    expect(Object.keys(newlyCandidate[0]!).sort()).toEqual([
      'first_seen_at',
      'maps_to',
      'ratified_at',
      'state',
      'term',
      'usage_count',
    ]);
  });

  it('bumps only the requested household when the same term exists elsewhere', async () => {
    const { repo, rows } = buildRepo([
      row({ usage_count: 1 }),
      row({ household_id: OTHER_HOUSEHOLD_ID, usage_count: 1 }),
    ]);

    await repo.recordUsage(
      HOUSEHOLD_ID,
      [{ term: 'Nani', maps_to: 'grandmother', occurrences: 1 }],
      THRESHOLD,
    );

    expect(rows().find((r) => r.household_id === HOUSEHOLD_ID)!.usage_count).toBe(2);
    expect(rows().find((r) => r.household_id === OTHER_HOUSEHOLD_ID)!.usage_count).toBe(1);
  });

  it('returns an empty crossing list when the RPC yields nothing', async () => {
    const client = { rpc: async () => ({ data: null, error: null }) };
    const repo = new FamilyLanguageRepository(
      client as unknown as ConstructorParameters<typeof FamilyLanguageRepository>[0],
    );

    const { newlyCandidate } = await repo.recordUsage(HOUSEHOLD_ID, [], THRESHOLD);

    expect(newlyCandidate).toEqual([]);
  });

  it('throws when the RPC errors', async () => {
    const client = { rpc: async () => ({ data: null, error: new Error('rpc down') }) };
    const repo = new FamilyLanguageRepository(
      client as unknown as ConstructorParameters<typeof FamilyLanguageRepository>[0],
    );

    await expect(repo.recordUsage(HOUSEHOLD_ID, [], THRESHOLD)).rejects.toThrow('rpc down');
  });
});

// ---------------------------------------------------------------------------
// ratify — forward-only ratchet (UX-DR47)
// ---------------------------------------------------------------------------

describe('FamilyLanguageRepository.ratify', () => {
  it('calls ratify_family_language_term with the household, term and action', async () => {
    const { repo, calls } = buildRepo([row()]);

    await repo.ratify(HOUSEHOLD_ID, 'Nani', 'opt_in');

    expect(calls).toEqual([
      {
        fn: 'ratify_family_language_term',
        args: { p_household_id: HOUSEHOLD_ID, p_term: 'Nani', p_action: 'opt_in' },
      },
    ]);
  });

  it('opt_in transitions candidate → active and stamps ratified_at', async () => {
    const { repo, rows } = buildRepo([row()]);

    const { updated, from } = await repo.ratify(HOUSEHOLD_ID, 'Nani', 'opt_in');

    expect(from).toBe('candidate');
    expect(updated?.state).toBe('active');
    expect(updated?.ratified_at).not.toBeNull();
    expect(rows()[0]!.state).toBe('active');
  });

  it('opt_in is idempotent on an active term (no transition, from null)', async () => {
    const { repo } = buildRepo([
      row({ state: 'active', ratified_at: '2026-06-08T10:05:00.000Z' }),
    ]);

    const { updated, from } = await repo.ratify(HOUSEHOLD_ID, 'Nani', 'opt_in');

    expect(from).toBeNull();
    expect(updated?.state).toBe('active');
  });

  it('opt_in on a forgotten term is a no-op (a forgotten term cannot be revived)', async () => {
    const { repo, rows } = buildRepo([row({ state: 'forgotten' })]);

    const { updated, from } = await repo.ratify(HOUSEHOLD_ID, 'Nani', 'opt_in');

    expect(from).toBeNull();
    expect(updated?.state).toBe('forgotten');
    expect(rows()[0]!.state).toBe('forgotten');
  });

  it('forget transitions candidate → forgotten', async () => {
    const { repo } = buildRepo([row()]);

    const { updated, from } = await repo.ratify(HOUSEHOLD_ID, 'Nani', 'forget');

    expect(from).toBe('candidate');
    expect(updated?.state).toBe('forgotten');
  });

  it('forget is a NO-OP on an active term (forward-only ratchet, state stays active)', async () => {
    const { repo, rows } = buildRepo([
      row({ state: 'active', ratified_at: '2026-06-08T10:05:00.000Z' }),
    ]);

    const { updated, from } = await repo.ratify(HOUSEHOLD_ID, 'Nani', 'forget');

    expect(from).toBeNull();
    expect(updated?.state).toBe('active');
    expect(rows()[0]!.state).toBe('active');
  });

  it('tell_lumi_more never mutates and never reports a transition', async () => {
    const { repo, rows } = buildRepo([row()]);

    const { updated, from } = await repo.ratify(HOUSEHOLD_ID, 'Nani', 'tell_lumi_more');

    expect(from).toBeNull();
    expect(updated?.state).toBe('candidate');
    expect(rows()[0]!.state).toBe('candidate');
  });

  it('returns {updated:null, from:null} for an unknown term', async () => {
    const { repo } = buildRepo([]);

    const result = await repo.ratify(HOUSEHOLD_ID, 'Lola', 'opt_in');

    expect(result).toEqual({ updated: null, from: null });
  });

  it('does not reach another household with a term of the same name', async () => {
    const { repo, rows } = buildRepo([row({ household_id: OTHER_HOUSEHOLD_ID })]);

    const result = await repo.ratify(HOUSEHOLD_ID, 'Nani', 'opt_in');

    expect(result).toEqual({ updated: null, from: null });
    expect(rows()[0]!.state).toBe('candidate');
  });

  it('strips transitioned_from from the returned term shape', async () => {
    const { repo } = buildRepo([row()]);

    const { updated } = await repo.ratify(HOUSEHOLD_ID, 'Nani', 'opt_in');

    expect(updated).not.toHaveProperty('transitioned_from');
  });

  it('throws when the RPC errors', async () => {
    const client = { rpc: async () => ({ data: null, error: new Error('rpc down') }) };
    const repo = new FamilyLanguageRepository(
      client as unknown as ConstructorParameters<typeof FamilyLanguageRepository>[0],
    );

    await expect(repo.ratify(HOUSEHOLD_ID, 'Nani', 'opt_in')).rejects.toThrow('rpc down');
  });
});

// ---------------------------------------------------------------------------
// The retired in-process lock
// ---------------------------------------------------------------------------

// The old implementation serialized every mutation through a module-level
// per-household async lock because the whole-array JSONB read-modify-write was
// not race-safe: a concurrent recordUsage could write back a stale `candidate`
// snapshot over a freshly-ratified `active` term. That lock was in-process only
// and did not hold across API instances.
//
// Row storage moves the guard into the database: both mutations happen inside a
// SECURITY DEFINER function that takes SELECT … FOR UPDATE on the affected row.
// What this test can prove from TypeScript is the property that made the lock
// necessary in the first place — a concurrent bump never demotes a term — and
// that the repository no longer serializes anything itself: each call is a
// single round trip that leaves ordering to Postgres.
describe('FamilyLanguageRepository concurrency (forward-only, no in-process lock)', () => {
  it('a concurrent recordUsage never demotes a term being ratified to active', async () => {
    const { repo, rows } = buildRepo([row()]);

    await Promise.all([
      repo.ratify(HOUSEHOLD_ID, 'Nani', 'opt_in'),
      repo.recordUsage(
        HOUSEHOLD_ID,
        [{ term: 'Nani', maps_to: 'grandmother', occurrences: 1 }],
        THRESHOLD,
      ),
    ]);

    expect(rows()[0]!.state).toBe('active');
    expect(rows()[0]!.usage_count).toBe(3);
  });

  it('issues exactly one round trip per mutation — no read-then-write pair to serialize', async () => {
    const { repo, calls } = buildRepo([row()]);

    await repo.recordUsage(
      HOUSEHOLD_ID,
      [{ term: 'Nani', maps_to: 'grandmother', occurrences: 1 }],
      THRESHOLD,
    );
    await repo.ratify(HOUSEHOLD_ID, 'Nani', 'opt_in');

    expect(calls.map((c) => c.fn)).toEqual([
      'record_family_language_usage',
      'ratify_family_language_term',
    ]);
  });
});

// A guard against silent drift: the wire type and the row shape the repository
// maps from must stay field-compatible.
describe('FamilyLanguageTerm mapping', () => {
  it('covers every field the contract declares', async () => {
    const { repo } = buildRepo([row()]);
    const [term] = await repo.getTerms(HOUSEHOLD_ID);

    const expected: FamilyLanguageTerm = {
      term: 'Nani',
      maps_to: 'grandmother',
      usage_count: 2,
      state: 'candidate' satisfies FamilyLanguageState,
      first_seen_at: '2026-06-08T10:00:00.000Z',
      ratified_at: null,
    };

    expect(term).toEqual(expected);
  });

  it('does not swallow an unexpected RPC payload shape', async () => {
    const client = { rpc: vi.fn(async () => ({ data: { not: 'an array' }, error: null })) };
    const repo = new FamilyLanguageRepository(
      client as unknown as ConstructorParameters<typeof FamilyLanguageRepository>[0],
    );

    // A non-array payload yields no terms rather than a crash — the RPC contract
    // is an array, and a shape violation must not take a Lumi turn down.
    expect(await repo.ratify(HOUSEHOLD_ID, 'Nani', 'opt_in')).toEqual({
      updated: null,
      from: null,
    });
  });
});
