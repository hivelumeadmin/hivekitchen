import { describe, it, expect } from 'vitest';
import type { FamilyLanguageTerm } from '@hivekitchen/types';
import { FamilyLanguageRepository } from './family-language.repository.js';
import { FAMILY_LANGUAGE_RATIFY_THRESHOLD } from './family-language.detector.js';

const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';

interface MockState {
  terms: FamilyLanguageTerm[];
}

// Minimal in-memory Supabase mock for the single `households` row this repo
// reads/writes. select→eq→maybeSingle returns the current terms; update→eq
// writes them back (the chain after .eq is thenable, mirroring supabase-js).
function buildMockSupabase(state: MockState) {
  return {
    from(table: string) {
      if (table !== 'households') throw new Error(`unexpected table: ${table}`);
      return {
        select() {
          const chain = {
            eq() {
              return chain;
            },
            maybeSingle: async () => ({
              data: { preferred_family_language_terms: state.terms },
              error: null,
            }),
          };
          return chain;
        },
        update(updates: { preferred_family_language_terms: FamilyLanguageTerm[] }) {
          return {
            eq(_column: string, _value: unknown) {
              state.terms = updates.preferred_family_language_terms;
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
}

function buildRepo(initial: FamilyLanguageTerm[] = []) {
  const state: MockState = { terms: initial };
  const repo = new FamilyLanguageRepository(
    buildMockSupabase(state) as unknown as ConstructorParameters<typeof FamilyLanguageRepository>[0],
  );
  return { repo, state };
}

const THRESHOLD = FAMILY_LANGUAGE_RATIFY_THRESHOLD;

describe('FamilyLanguageRepository.recordUsage', () => {
  it('first sighting below threshold creates a candidate with no crossing', async () => {
    const { repo, state } = buildRepo();

    const { newlyCandidate } = await repo.recordUsage(
      HOUSEHOLD_ID,
      [{ term: 'Nani', maps_to: 'grandmother', occurrences: 1 }],
      THRESHOLD,
    );

    expect(newlyCandidate).toHaveLength(0);
    expect(state.terms).toHaveLength(1);
    expect(state.terms[0]).toMatchObject({ term: 'Nani', usage_count: 1, state: 'candidate' });
  });

  it('a bump that crosses the threshold returns the term in newlyCandidate exactly once', async () => {
    const { repo } = buildRepo([
      {
        term: 'Nani',
        maps_to: 'grandmother',
        usage_count: 1,
        state: 'candidate',
        first_seen_at: '2026-06-08T10:00:00.000Z',
        ratified_at: null,
      },
    ]);

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
    const { repo, state } = buildRepo();

    const { newlyCandidate } = await repo.recordUsage(
      HOUSEHOLD_ID,
      [{ term: 'Nani', maps_to: 'grandmother', occurrences: 2 }],
      THRESHOLD,
    );

    expect(newlyCandidate.map((t) => t.term)).toEqual(['Nani']);
    expect(state.terms[0]!.usage_count).toBe(2);
  });

  it('bumps an active term without re-prompting or demoting', async () => {
    const { repo, state } = buildRepo([
      {
        term: 'Nani',
        maps_to: 'grandmother',
        usage_count: 5,
        state: 'active',
        first_seen_at: '2026-06-08T10:00:00.000Z',
        ratified_at: '2026-06-08T10:05:00.000Z',
      },
    ]);

    const { newlyCandidate } = await repo.recordUsage(
      HOUSEHOLD_ID,
      [{ term: 'Nani', maps_to: 'grandmother', occurrences: 1 }],
      THRESHOLD,
    );

    expect(newlyCandidate).toHaveLength(0);
    expect(state.terms[0]!.usage_count).toBe(6);
    expect(state.terms[0]!.state).toBe('active');
  });
});

describe('FamilyLanguageRepository.ratify', () => {
  function candidate(): FamilyLanguageTerm {
    return {
      term: 'Nani',
      maps_to: 'grandmother',
      usage_count: 2,
      state: 'candidate',
      first_seen_at: '2026-06-08T10:00:00.000Z',
      ratified_at: null,
    };
  }

  it('opt_in transitions candidate → active and stamps ratified_at', async () => {
    const { repo, state } = buildRepo([candidate()]);

    const { updated, from } = await repo.ratify(HOUSEHOLD_ID, 'Nani', 'opt_in');

    expect(from).toBe('candidate');
    expect(updated?.state).toBe('active');
    expect(updated?.ratified_at).not.toBeNull();
    expect(state.terms[0]!.state).toBe('active');
  });

  it('opt_in is idempotent on an active term (no transition, from null)', async () => {
    const { repo } = buildRepo([{ ...candidate(), state: 'active', ratified_at: '2026-06-08T10:05:00.000Z' }]);

    const { updated, from } = await repo.ratify(HOUSEHOLD_ID, 'Nani', 'opt_in');

    expect(from).toBeNull();
    expect(updated?.state).toBe('active');
  });

  it('forget transitions candidate → forgotten', async () => {
    const { repo } = buildRepo([candidate()]);

    const { updated, from } = await repo.ratify(HOUSEHOLD_ID, 'Nani', 'forget');

    expect(from).toBe('candidate');
    expect(updated?.state).toBe('forgotten');
  });

  it('forget is a NO-OP on an active term (forward-only ratchet, state stays active)', async () => {
    const { repo, state } = buildRepo([{ ...candidate(), state: 'active', ratified_at: '2026-06-08T10:05:00.000Z' }]);

    const { updated, from } = await repo.ratify(HOUSEHOLD_ID, 'Nani', 'forget');

    expect(from).toBeNull();
    expect(updated?.state).toBe('active');
    expect(state.terms[0]!.state).toBe('active');
  });

  it('returns {updated:null, from:null} for an unknown term', async () => {
    const { repo } = buildRepo([]);

    const result = await repo.ratify(HOUSEHOLD_ID, 'Lola', 'opt_in');

    expect(result).toEqual({ updated: null, from: null });
  });
});

// Review patch (5-S10, D2): the per-household async lock serializes read-modify-write
// so a concurrent recordUsage cannot write back a stale `candidate` snapshot over a
// freshly-ratified `active` term (forward-only invariant). This mock models real DB
// semantics: each read returns an independent SNAPSHOT (deep copy) after a latency
// gap — exactly the conditions under which an unguarded read-modify-write would
// demote the term.
describe('FamilyLanguageRepository concurrency (forward-only under races)', () => {
  function buildSnapshotRepo(initial: FamilyLanguageTerm[]) {
    const state: MockState = { terms: initial };
    const mock = {
      from(table: string) {
        if (table !== 'households') throw new Error(`unexpected table: ${table}`);
        return {
          select() {
            const chain = {
              eq() {
                return chain;
              },
              maybeSingle: async () => {
                await new Promise((r) => setTimeout(r, 5));
                return {
                  data: { preferred_family_language_terms: state.terms.map((t) => ({ ...t })) },
                  error: null,
                };
              },
            };
            return chain;
          },
          update(updates: { preferred_family_language_terms: FamilyLanguageTerm[] }) {
            return {
              async eq() {
                await new Promise((r) => setTimeout(r, 5));
                state.terms = updates.preferred_family_language_terms;
                return { error: null };
              },
            };
          },
        };
      },
    };
    const repo = new FamilyLanguageRepository(
      mock as unknown as ConstructorParameters<typeof FamilyLanguageRepository>[0],
    );
    return { repo, state };
  }

  it('a concurrent recordUsage never demotes a term being ratified to active', async () => {
    const { repo, state } = buildSnapshotRepo([
      {
        term: 'Nani',
        maps_to: 'grandmother',
        usage_count: 2,
        state: 'candidate',
        first_seen_at: '2026-06-08T10:00:00.000Z',
        ratified_at: null,
      },
    ]);

    await Promise.all([
      repo.ratify(HOUSEHOLD_ID, 'Nani', 'opt_in'),
      repo.recordUsage(
        HOUSEHOLD_ID,
        [{ term: 'Nani', maps_to: 'grandmother', occurrences: 1 }],
        THRESHOLD,
      ),
    ]);

    // Forward-only: the term must remain active, and the concurrent bump is not lost.
    expect(state.terms[0]!.state).toBe('active');
    expect(state.terms[0]!.usage_count).toBe(3);
  });
});
