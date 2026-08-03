import type {
  FamilyLanguageRatifyAction,
  FamilyLanguageState,
  FamilyLanguageTerm,
} from '@hivekitchen/types';
import { BaseRepository } from '../../repository/base.repository.js';
import type { DetectedTerm } from './family-language.detector.js';

// Slice 5-S10 — household-scoped family-language ratchet (UX-DR47). Story 15-s6
// moved the storage from `households.preferred_family_language_terms` (a JSONB
// array) to one `family_language_terms` row per term; the public shape every
// consumer reads is unchanged.
//
// Both mutations run inside SECURITY DEFINER functions that lock the affected
// row with SELECT … FOR UPDATE. That replaces the module-level in-process async
// lock this repository used to carry, whose own comment disclosed that it did
// not hold across API instances — a stale whole-array write-back could DEMOTE a
// concurrently-ratified term (active → candidate) and break the forward-only
// ratchet. The row lock is a real cross-instance guard.

interface TermRow {
  term: string;
  maps_to: string;
  usage_count: number;
  state: FamilyLanguageState;
  first_seen_at: string;
  ratified_at: string | null;
}

interface RatifyRow extends TermRow {
  transitioned_from: FamilyLanguageState | null;
}

const TERM_COLUMNS = 'term, maps_to, usage_count, state, first_seen_at, ratified_at';

// record_family_language_usage returns whole rows (to_jsonb), so id and
// household_id ride along; the wire shape carries neither.
function toTerm(row: TermRow): FamilyLanguageTerm {
  return {
    term: row.term,
    maps_to: row.maps_to,
    usage_count: row.usage_count,
    state: row.state,
    first_seen_at: row.first_seen_at,
    ratified_at: row.ratified_at,
  };
}

export class FamilyLanguageRepository extends BaseRepository {
  async getTerms(householdId: string): Promise<FamilyLanguageTerm[]> {
    // first_seen_at mirrors the JSONB array's insertion order. It is not unique:
    // one record_family_language_usage call inserting several terms stamps them
    // all with the same transaction timestamp, so `term` breaks the tie and the
    // agent prompt stays byte-stable across reads.
    const { data, error } = await this.client
      .from('family_language_terms')
      .select(TERM_COLUMNS)
      .eq('household_id', householdId)
      .order('first_seen_at', { ascending: true })
      .order('term', { ascending: true });
    if (error) throw error;
    const rows = Array.isArray(data) ? (data as TermRow[]) : [];
    return rows.map(toTerm);
  }

  // Bump usage for each detected term and surface the ones that JUST crossed the
  // ratification threshold this call. No separate `prompted` flag: the prompt
  // fires the moment usage_count crosses from `< threshold` to `>= threshold`.
  // Because each call bumps a term at most once, the crossing happens on exactly
  // one call, so each term yields a prompt exactly once. `active`/`forgotten`
  // terms only have their count bumped (never re-prompted, never demoted). The
  // crossing logic lives in record_family_language_usage so the read of the
  // previous count and the write of the new one cannot be interleaved.
  async recordUsage(
    householdId: string,
    detected: DetectedTerm[],
    threshold: number,
  ): Promise<{ newlyCandidate: FamilyLanguageTerm[] }> {
    const { data, error } = await this.client.rpc('record_family_language_usage', {
      p_household_id: householdId,
      p_detected: detected.map((d) => ({
        term: d.term,
        maps_to: d.maps_to,
        occurrences: d.occurrences,
      })),
      p_threshold: threshold,
    });
    if (error) throw error;
    const rows = Array.isArray(data) ? (data as TermRow[]) : [];
    return { newlyCandidate: rows.map(toTerm) };
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
    const { data, error } = await this.client.rpc('ratify_family_language_term', {
      p_household_id: householdId,
      p_term: term,
      p_action: action,
    });
    if (error) throw error;

    const rows = Array.isArray(data) ? (data as RatifyRow[]) : [];
    const row = rows[0];
    // Zero rows = no such term for this household.
    if (row === undefined) return { updated: null, from: null };

    return { updated: toTerm(row), from: row.transitioned_from ?? null };
  }
}
