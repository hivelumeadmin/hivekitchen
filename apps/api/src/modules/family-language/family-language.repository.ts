import type {
  FamilyLanguageRatifyAction,
  FamilyLanguageState,
  FamilyLanguageTerm,
} from '@hivekitchen/types';
import { BaseRepository } from '../../repository/base.repository.js';
import type { DetectedTerm } from './family-language.detector.js';

// Slice 5-S10 — household-scoped family-language ratchet (UX-DR47). The terms
// live in households.preferred_family_language_terms (a JSONB array). There is no
// atomic JSONB-array element upsert in supabase-js, so each mutation is a single
// read → mutate in memory → write back on the one household row.
//
// Review patch (5-S10): the read-modify-write of the WHOLE array is not lock-free
// safe — a concurrent recordUsage could write back a stale snapshot over a freshly
// ratified term and DEMOTE it (active → candidate), breaking the forward-only
// invariant. We serialize all mutations per household with a module-level async
// lock so read→mutate→write runs atomically within this process. Caveat: the lock
// is in-process only; a multi-instance deployment would still need a DB-level
// guard (optimistic version column / SELECT … FOR UPDATE). Single-process at beta.
const householdLocks = new Map<string, Promise<unknown>>();

function withHouseholdLock<T>(householdId: string, fn: () => Promise<T>): Promise<T> {
  const prev = householdLocks.get(householdId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  // Keep the chain alive but drop the entry once it settles and nothing queued
  // behind it, so the map does not grow unbounded.
  householdLocks.set(householdId, next);
  void next.finally(() => {
    if (householdLocks.get(householdId) === next) householdLocks.delete(householdId);
  });
  return next;
}

export class FamilyLanguageRepository extends BaseRepository {
  async getTerms(householdId: string): Promise<FamilyLanguageTerm[]> {
    const { data, error } = await this.client
      .from('households')
      .select('preferred_family_language_terms')
      .eq('id', householdId)
      .maybeSingle();
    if (error) throw error;
    const row = data as { preferred_family_language_terms: FamilyLanguageTerm[] | null } | null;
    return row?.preferred_family_language_terms ?? [];
  }

  // Bump usage for each detected term and surface the ones that JUST crossed the
  // ratification threshold this call. No separate `prompted` flag: the prompt
  // fires the moment usage_count crosses from `< threshold` to `>= threshold`.
  // Because each call bumps a term at most once, the crossing happens on exactly
  // one call, so each term yields a prompt exactly once. `active`/`forgotten`
  // terms only have their count bumped (never re-prompted, never demoted).
  async recordUsage(
    householdId: string,
    detected: DetectedTerm[],
    threshold: number,
  ): Promise<{ newlyCandidate: FamilyLanguageTerm[] }> {
    return withHouseholdLock(householdId, async () => {
    const terms = await this.getTerms(householdId);
    const now = new Date().toISOString();
    const newlyCandidate: FamilyLanguageTerm[] = [];

    for (const d of detected) {
      const existing = terms.find((t) => t.term === d.term);
      if (existing === undefined) {
        const created: FamilyLanguageTerm = {
          term: d.term,
          maps_to: d.maps_to,
          usage_count: d.occurrences,
          state: 'candidate',
          first_seen_at: now,
          ratified_at: null,
        };
        terms.push(created);
        if (d.occurrences >= threshold) newlyCandidate.push(created);
        continue;
      }

      const prev = existing.usage_count;
      existing.usage_count = prev + d.occurrences;

      if (existing.state === 'candidate' && prev < threshold && existing.usage_count >= threshold) {
        newlyCandidate.push(existing);
      }
    }

    await this.writeTerms(householdId, terms);
    return { newlyCandidate };
    });
  }

  // Forward-only ratchet (UX-DR47). opt_in: candidate → active (idempotent on
  // active). forget: candidate → forgotten, but a NO-OP on active (the ratchet is
  // locked — there is no demotion path). tell_lumi_more never changes state.
  // `from` is the prior state ONLY when a real transition happened — the route
  // uses it to gate the audit write; a no-op returns `from: null`.
  async ratify(
    householdId: string,
    term: string,
    action: FamilyLanguageRatifyAction,
  ): Promise<{ updated: FamilyLanguageTerm | null; from: FamilyLanguageState | null }> {
    return withHouseholdLock(householdId, async () => {
    const terms = await this.getTerms(householdId);
    const existing = terms.find((t) => t.term === term);
    if (existing === undefined) {
      return { updated: null, from: null };
    }

    if (action === 'tell_lumi_more') {
      return { updated: existing, from: null };
    }

    if (action === 'opt_in') {
      if (existing.state === 'candidate') {
        const from = existing.state;
        existing.state = 'active';
        existing.ratified_at = new Date().toISOString();
        await this.writeTerms(householdId, terms);
        return { updated: existing, from };
      }
      // active (idempotent) or forgotten (cannot opt in a forgotten term) → no-op.
      return { updated: existing, from: null };
    }

    // action === 'forget'
    if (existing.state === 'candidate') {
      const from = existing.state;
      existing.state = 'forgotten';
      await this.writeTerms(householdId, terms);
      return { updated: existing, from };
    }
    // active → forward-only lock (no demotion); forgotten → already there → no-op.
    return { updated: existing, from: null };
    });
  }

  private async writeTerms(householdId: string, terms: FamilyLanguageTerm[]): Promise<void> {
    const { error } = await this.client
      .from('households')
      .update({ preferred_family_language_terms: terms })
      .eq('id', householdId);
    if (error) throw error;
  }
}
