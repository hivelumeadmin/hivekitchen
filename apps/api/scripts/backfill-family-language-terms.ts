#!/usr/bin/env tsx
/**
 * Story 15-s6 — cutover backfill + verification gate for retiring
 * `households.preferred_family_language_terms` (canonical data model v2 §2,
 * §4.1, §5 row 7, §8 step 3).
 *
 * The JSONB array of {term, maps_to, usage_count, state, first_seen_at,
 * ratified_at} objects is replaced by one `family_language_terms` row per term.
 * This script copies every surviving entry into a row before the drop migration
 * removes the column. It is a STRUCTURAL COPY, not a re-derivation: every field
 * carries over verbatim, including `state` and `ratified_at`.
 *
 * Steps:
 *   1. Backfill — each array element becomes a (household_id, term) row.
 *      Elements with no usable term are nothing to migrate and are skipped
 *      (counted + warned). Elements that carry a term but would violate a DB
 *      constraint (term/maps_to outside 1–40 chars, non-integer or negative
 *      usage_count, unknown state, missing first_seen_at) are skipped BEFORE the
 *      batch is built — one CHECK violation inside a batched upsert aborts the
 *      whole statement, the exact bug 15-s4's review caught — and they are
 *      deliberately still counted as expected by the gate below, so the run
 *      fails and a human looks before the column disappears.
 *      Idempotent: the upsert targets the (household_id, term) unique index with
 *      ON CONFLICT DO NOTHING, so a re-run never double-inserts and never
 *      clobbers a term a parent has since ratified or forgotten through the live
 *      RPCs.
 *   2. Verification gate — stronger than the existence-only parity 15-s4 and
 *      15-s5 used. The set of (household_id, term) pairs from the JSONB must
 *      equal the set of `family_language_terms` rows in BOTH directions
 *      (missing_term_row / orphan_term_row), AND every matched pair must agree
 *      on `state` and `usage_count` (state_mismatch / usage_count_mismatch).
 *      `state` carries the forward-only ratchet invariant (UX-DR47): an `active`
 *      term silently landing as `candidate` is a correctness bug that set
 *      equality alone cannot see. Any difference exits non-zero. There is no
 *      skip-on-error escape hatch: an unverifiable database is a failed cutover.
 *
 * The diff prints household_id + maps_to + reason. It deliberately does NOT
 * print `term`: the family-language word itself is the culturally sensitive
 * field and is never written to audit either (family-language.routes.ts) —
 * `maps_to` is its English equivalent and is the field the audit trail already
 * carries, so it is enough to locate a row without logging the parent's word.
 * (AC #2 sketched this the other way round; the established 5-S10 PII doctrine
 * wins — see the story's Dev Agent Record.)
 *
 * ⚠️ RUN BEFORE the drop migration (20261036000100_drop_preferred_family_language_terms),
 * never after — `verifyParity` reads `households.preferred_family_language_terms`
 * and cannot run once the column is gone. The drop must not be applied until
 * this gate has passed against the target database.
 *
 * Invocation:
 *   pnpm --filter @hivekitchen/api exec tsx scripts/backfill-family-language-terms.ts
 *
 * Environment:
 *   SUPABASE_URL              — required
 *   SUPABASE_SERVICE_ROLE_KEY — required (bypasses RLS)
 *
 * No KEK is needed: terms are plaintext, same as `school_policies.policy_description`.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface ScriptDeps {
  client: SupabaseClient;
  pageSize?: number;
  logger?: { warn: (obj: Record<string, unknown>, msg: string) => void };
}

export interface BackfillSummary {
  households_scanned: number;
  skipped_empty: number;
  skipped_invalid: number;
  skipped_duplicate: number;
  terms_inserted: number;
  skipped_existing: number;
}

export type MismatchReason =
  | 'missing_term_row'
  | 'orphan_term_row'
  | 'state_mismatch'
  | 'usage_count_mismatch'
  | 'ratified_at_mismatch';

// Identity + the audit-safe English equivalent only — the family-language term
// itself is never printed.
export interface ParityMismatch {
  household_id: string;
  maps_to: string;
  reason: MismatchReason;
}

export interface ParityResult {
  ok: boolean;
  jsonb_entries: number;
  term_rows: number;
  matched: number;
  mismatches: ParityMismatch[];
}

interface HouseholdTermsRow {
  id: string;
  preferred_family_language_terms: unknown;
}

interface TermRow {
  household_id: string;
  term: string;
  maps_to: string;
  usage_count: number;
  state: string;
  first_seen_at: string;
  ratified_at: string | null;
}

const DEFAULT_PAGE_SIZE = 500;
const MAX_REPORTED_MISMATCHES = 50;
// family_language_terms CHECK (char_length BETWEEN 1 AND 40) on both text
// columns, mirroring FamilyLanguageTermSchema. The backfill must not trust that
// every historical array entry went through the validated write path.
const MAX_TEXT_LENGTH = 40;
const VALID_STATES = new Set(['candidate', 'active', 'forgotten']);

// Every paged scan orders by a stable key: repeated offset/limit calls without
// an ORDER BY can reshuffle tied rows between pages and silently skip records.
async function loadHouseholds(deps: ScriptDeps): Promise<HouseholdTermsRow[]> {
  const pageSize = deps.pageSize ?? DEFAULT_PAGE_SIZE;
  const rows: HouseholdTermsRow[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await deps.client
      .from('households')
      .select('id, preferred_family_language_terms')
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as HouseholdTermsRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

async function loadTermRows(deps: ScriptDeps): Promise<TermRow[]> {
  const pageSize = deps.pageSize ?? DEFAULT_PAGE_SIZE;
  const rows: TermRow[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await deps.client
      .from('family_language_terms')
      .select('household_id, term, maps_to, usage_count, state, first_seen_at, ratified_at')
      .order('household_id', { ascending: true })
      .order('term', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as TermRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

// Tolerant decode of the JSONB column. PostgREST returns it pre-parsed, but a
// raw string, a null, or a rogue shape must not abort the cutover — the entries
// we can read are still worth migrating.
function readElements(raw: unknown): Record<string, unknown>[] {
  let parsed: unknown = raw ?? [];
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (e): e is Record<string, unknown> => typeof e === 'object' && e !== null && !Array.isArray(e),
  );
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' ? v : Number.NaN);

// JSON-encoded so no delimiter can be forged by a term containing the separator.
// (15-s5 shipped a raw-delimiter key built with literal NUL bytes; a plain
// JSON array is unambiguous and stays readable in a diff.)
const key = (householdId: string, term: string): string => JSON.stringify([householdId, term]);

function isInsertable(t: TermRow): boolean {
  return (
    t.term.length >= 1 &&
    t.term.length <= MAX_TEXT_LENGTH &&
    t.maps_to.length >= 1 &&
    t.maps_to.length <= MAX_TEXT_LENGTH &&
    Number.isInteger(t.usage_count) &&
    t.usage_count >= 0 &&
    VALID_STATES.has(t.state) &&
    t.first_seen_at.length > 0
  );
}

// Every (household, term) pair the JSONB says should exist as a row. Entries
// with no usable term are excluded — there is nothing to migrate and nothing to
// verify. Entries that carry a term but fail a DB constraint ARE included, so
// the parity gate fails on them and a human looks before the column drops.
function expectedTerms(households: HouseholdTermsRow[]): {
  terms: TermRow[];
  skipped_empty: number;
  skipped_duplicate: number;
} {
  const terms: TermRow[] = [];
  let skipped_empty = 0;
  let skipped_duplicate = 0;
  const seen = new Set<string>();

  for (const household of households) {
    for (const element of readElements(household.preferred_family_language_terms)) {
      const term = str(element.term);
      if (term.length === 0) {
        skipped_empty += 1;
        continue;
      }
      const k = key(household.id, term);
      if (seen.has(k)) {
        skipped_duplicate += 1;
        continue;
      }
      seen.add(k);
      terms.push({
        household_id: household.id,
        term,
        maps_to: str(element.maps_to),
        usage_count: num(element.usage_count),
        state: str(element.state),
        first_seen_at: str(element.first_seen_at),
        ratified_at: typeof element.ratified_at === 'string' ? element.ratified_at : null,
      });
    }
  }

  return { terms, skipped_empty, skipped_duplicate };
}

export async function runBackfill(deps: ScriptDeps): Promise<BackfillSummary> {
  const households = await loadHouseholds(deps);
  const { terms, skipped_empty, skipped_duplicate } = expectedTerms(households);

  const summary: BackfillSummary = {
    households_scanned: households.length,
    skipped_empty,
    skipped_invalid: 0,
    skipped_duplicate,
    terms_inserted: 0,
    skipped_existing: 0,
  };

  // Constraint-filter BEFORE building the batch: a single CHECK violation inside
  // a batched upsert aborts the entire statement, so one bad element would
  // otherwise take every other term on the page down with it.
  const candidates = terms.filter((t) => {
    if (isInsertable(t)) return true;
    summary.skipped_invalid += 1;
    return false;
  });

  if (summary.skipped_empty > 0) {
    deps.logger?.warn(
      { skipped_empty: summary.skipped_empty, households_scanned: summary.households_scanned },
      'family-language backfill skipped elements with no term — nothing to migrate',
    );
  }

  if (summary.skipped_invalid > 0) {
    deps.logger?.warn(
      {
        skipped_invalid: summary.skipped_invalid,
        max_text_length: MAX_TEXT_LENGTH,
        households_scanned: summary.households_scanned,
      },
      'family-language backfill skipped elements violating a family_language_terms constraint — the parity gate will fail on them',
    );
  }

  if (summary.skipped_duplicate > 0) {
    deps.logger?.warn(
      { skipped_duplicate: summary.skipped_duplicate },
      'family-language backfill collapsed duplicate terms within a household',
    );
  }

  if (candidates.length > 0) {
    // ignoreDuplicates → ON CONFLICT DO NOTHING against
    // family_language_terms_household_term_idx. A row that already exists is
    // left exactly as it is — including a state a parent changed through the
    // ratify RPC after an earlier run.
    const { data, error } = await deps.client
      .from('family_language_terms')
      .upsert(candidates, { onConflict: 'household_id,term', ignoreDuplicates: true })
      .select('household_id');
    if (error) throw error;
    summary.terms_inserted = (data ?? []).length;
    summary.skipped_existing = candidates.length - summary.terms_inserted;
  }

  return summary;
}

export async function verifyParity(deps: ScriptDeps): Promise<ParityResult> {
  const { terms } = expectedTerms(await loadHouseholds(deps));
  const expected = new Map(terms.map((t) => [key(t.household_id, t.term), t]));

  const actualRows = await loadTermRows(deps);
  const actual = new Map(actualRows.map((r) => [key(r.household_id, r.term), r]));

  const result: ParityResult = {
    ok: true,
    jsonb_entries: expected.size,
    term_rows: actual.size,
    matched: 0,
    mismatches: [],
  };

  for (const [k, source] of expected) {
    const row = actual.get(k);
    if (row === undefined) {
      result.mismatches.push({
        household_id: source.household_id,
        maps_to: source.maps_to,
        reason: 'missing_term_row',
      });
      continue;
    }

    result.matched += 1;

    // The forward-only ratchet lives in `state`; a divergence here means the
    // copy did not preserve a safety invariant, not merely that a row is absent.
    if (row.state !== source.state) {
      result.mismatches.push({
        household_id: source.household_id,
        maps_to: source.maps_to,
        reason: 'state_mismatch',
      });
    }
    if (row.usage_count !== source.usage_count) {
      result.mismatches.push({
        household_id: source.household_id,
        maps_to: source.maps_to,
        reason: 'usage_count_mismatch',
      });
    }
    // ratified_at is a structurally-copied field like state/usage_count — a
    // divergence means the copy lost the "when did this ratchet" fact, not
    // merely that a row is absent.
    if (row.ratified_at !== source.ratified_at) {
      result.mismatches.push({
        household_id: source.household_id,
        maps_to: source.maps_to,
        reason: 'ratified_at_mismatch',
      });
    }
  }

  for (const [k, row] of actual) {
    if (!expected.has(k)) {
      result.mismatches.push({
        household_id: row.household_id,
        maps_to: row.maps_to,
        reason: 'orphan_term_row',
      });
    }
  }

  result.ok = result.mismatches.length === 0;
  return result;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url === undefined || serviceKey === undefined) {
    // eslint-disable-next-line no-console
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
    process.exit(1);
  }
  const client = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const logger = {
    warn: (obj: Record<string, unknown>, msg: string) =>
      // eslint-disable-next-line no-console
      console.warn('[backfill-family-language-terms]', msg, obj),
  };

  const summary = await runBackfill({ client, logger });
  // eslint-disable-next-line no-console
  console.log('[backfill-family-language-terms] summary:', JSON.stringify(summary, null, 2));

  const parity = await verifyParity({ client, logger });
  // eslint-disable-next-line no-console
  console.log(
    '[backfill-family-language-terms] parity:',
    JSON.stringify(
      {
        ...parity,
        mismatches: parity.mismatches.slice(0, MAX_REPORTED_MISMATCHES),
        mismatches_total: parity.mismatches.length,
      },
      null,
      2,
    ),
  );

  if (!parity.ok) {
    // eslint-disable-next-line no-console
    console.error(
      '[backfill-family-language-terms] PARITY GATE FAILED — do NOT apply the drop migration',
    );
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[backfill-family-language-terms] fatal:', err);
    process.exit(1);
  });
}
