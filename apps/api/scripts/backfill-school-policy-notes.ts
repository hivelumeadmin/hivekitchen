#!/usr/bin/env tsx
/**
 * Story 15-s4 — cutover backfill + parity gate for retiring
 * `children.school_policy_notes` (canonical data model v2 §4.2, §8 step 3).
 *
 * The free-text column duplicates the `school_policies` table. This script
 * preserves every surviving note as a `school_policies` row before the drop
 * migration removes the column.
 *
 * Steps:
 *   1. Backfill — every child with a non-empty `school_policy_notes` gets a
 *      `school_policies` row: policy_type='note', policy_description=<trimmed
 *      text>, slot_scope='bag_wide', is_active=FALSE. Whitespace-only notes are
 *      nothing to migrate and are skipped (counted + warned), not stored as an
 *      empty row. Idempotent: the upsert uses the existing
 *      (child_id, policy_type) unique index with ON CONFLICT DO NOTHING, so a
 *      re-run never double-inserts and never clobbers a row a human has since
 *      edited or activated.
 *   2. Parity gate — the set of children with a non-empty note must equal the
 *      set of children carrying a policy_type='note' row. Any difference exits
 *      non-zero. There is no skip-on-error escape hatch: an unverifiable
 *      database is a failed cutover.
 *
 * WHY is_active=FALSE. `school_policy_notes` has never been visible to the
 * planner or the guardrail — `SchoolPoliciesRepository.findActiveByChildId`
 * filters `is_active=true`, and that is the only read path into
 * `KitchenMapRepository.loadRaw()` and `renderPlannerKitchenMapBlock`. Landing
 * these rows active would push previously-invisible free text into the planner
 * prompt as a side effect of a data-hygiene migration. Inactive preserves
 * today's behaviour exactly: the text survives, and a human can activate it
 * through PATCH /v1/children/:id/school-policies when the UX for free-text
 * policies is decided.
 *
 * ⚠️ RUN BEFORE the drop migration (20261035000300_drop_school_policy_notes),
 * never after — `verifyParity` reads `children.school_policy_notes` and cannot
 * run once the column is gone. The drop migration must not be applied until
 * this script's gate has passed against the target database.
 *
 * A `orphan_note_row` mismatch (a note row whose child has no surviving source
 * text) fails the gate deliberately. It is not data loss, but it means the two
 * representations diverged after a prior run — a human should look before the
 * column disappears.
 *
 * Invocation:
 *   pnpm --filter @hivekitchen/api exec tsx scripts/backfill-school-policy-notes.ts
 *
 * Environment:
 *   SUPABASE_URL              — required
 *   SUPABASE_SERVICE_ROLE_KEY — required (bypasses RLS)
 *
 * No KEK is needed: `school_policy_notes` and `school_policies.policy_description`
 * are both plaintext columns.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface ScriptDeps {
  client: SupabaseClient;
  pageSize?: number;
  logger?: { warn: (obj: Record<string, unknown>, msg: string) => void };
}

export interface BackfillSummary {
  children_scanned: number;
  skipped_empty: number;
  skipped_too_long: number;
  policies_inserted: number;
  skipped_existing: number;
}

export type MismatchReason = 'missing_note_row' | 'orphan_note_row';

// Identity only — the note text itself is never printed.
export interface ParityMismatch {
  child_id: string;
  reason: MismatchReason;
}

export interface ParityResult {
  ok: boolean;
  children_with_notes: number;
  note_rows: number;
  matched: number;
  mismatches: ParityMismatch[];
}

interface ChildNoteRow {
  id: string;
  school_policy_notes: string | null;
}

interface NotePolicyRow {
  child_id: string;
}

const DEFAULT_PAGE_SIZE = 500;
const MAX_REPORTED_MISMATCHES = 50;
const NOTE_POLICY_TYPE = 'note';
// school_policies.policy_description CHECK (char_length <= 500). children.school_policy_notes
// has no DB-level limit — only the API contract layer enforces this cap on writes — so a note
// predating that cap (or written via a non-API path) can still exceed it.
const MAX_POLICY_DESCRIPTION_LENGTH = 500;

// Every paged scan orders by a stable key: repeated offset/limit calls without
// an ORDER BY can reshuffle tied rows between pages and silently skip records.
async function loadChildrenWithNotes(deps: ScriptDeps): Promise<ChildNoteRow[]> {
  const pageSize = deps.pageSize ?? DEFAULT_PAGE_SIZE;
  const rows: ChildNoteRow[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await deps.client
      .from('children')
      .select('id, school_policy_notes')
      .not('school_policy_notes', 'is', null)
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as ChildNoteRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

async function loadNotePolicyChildIds(deps: ScriptDeps): Promise<Set<string>> {
  const pageSize = deps.pageSize ?? DEFAULT_PAGE_SIZE;
  const ids = new Set<string>();
  let offset = 0;
  for (;;) {
    const { data, error } = await deps.client
      .from('school_policies')
      .select('child_id')
      .eq('policy_type', NOTE_POLICY_TYPE)
      .order('child_id', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as NotePolicyRow[];
    for (const row of page) ids.add(row.child_id);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return ids;
}

// A note is worth migrating iff it has non-whitespace content.
function migratableNote(row: ChildNoteRow): string | null {
  const trimmed = (row.school_policy_notes ?? '').trim();
  return trimmed.length === 0 ? null : trimmed;
}

export async function runBackfill(deps: ScriptDeps): Promise<BackfillSummary> {
  const summary: BackfillSummary = {
    children_scanned: 0,
    skipped_empty: 0,
    skipped_too_long: 0,
    policies_inserted: 0,
    skipped_existing: 0,
  };

  const children = await loadChildrenWithNotes(deps);
  summary.children_scanned = children.length;

  const candidates: { child_id: string; policy_description: string }[] = [];
  for (const row of children) {
    const note = migratableNote(row);
    if (note === null) {
      summary.skipped_empty += 1;
      continue;
    }
    if (note.length > MAX_POLICY_DESCRIPTION_LENGTH) {
      summary.skipped_too_long += 1;
      continue;
    }
    candidates.push({ child_id: row.id, policy_description: note });
  }

  if (summary.skipped_empty > 0) {
    deps.logger?.warn(
      { skipped_empty: summary.skipped_empty, children_scanned: summary.children_scanned },
      'school_policy_notes backfill skipped whitespace-only notes — nothing to migrate',
    );
  }

  if (summary.skipped_too_long > 0) {
    deps.logger?.warn(
      {
        skipped_too_long: summary.skipped_too_long,
        max_length: MAX_POLICY_DESCRIPTION_LENGTH,
        children_scanned: summary.children_scanned,
      },
      'school_policy_notes backfill skipped notes exceeding school_policies.policy_description length limit',
    );
  }

  if (candidates.length > 0) {
    // ignoreDuplicates → ON CONFLICT DO NOTHING. A child that already carries a
    // note row keeps it verbatim, including any edit or activation a human made
    // after an earlier run. The returned rows are the ones actually inserted.
    const { data, error } = await deps.client
      .from('school_policies')
      .upsert(
        candidates.map((c) => ({
          child_id: c.child_id,
          policy_type: NOTE_POLICY_TYPE,
          policy_description: c.policy_description,
          slot_scope: 'bag_wide',
          is_active: false,
        })),
        { onConflict: 'child_id,policy_type', ignoreDuplicates: true },
      )
      .select('child_id');
    if (error) throw error;
    summary.policies_inserted = (data ?? []).length;
    summary.skipped_existing = candidates.length - summary.policies_inserted;
  }

  return summary;
}

export async function verifyParity(deps: ScriptDeps): Promise<ParityResult> {
  const children = await loadChildrenWithNotes(deps);
  const expected = new Set<string>();
  for (const row of children) {
    if (migratableNote(row) !== null) expected.add(row.id);
  }
  const actual = await loadNotePolicyChildIds(deps);

  const result: ParityResult = {
    ok: true,
    children_with_notes: expected.size,
    note_rows: actual.size,
    matched: 0,
    mismatches: [],
  };

  for (const childId of expected) {
    if (actual.has(childId)) result.matched += 1;
    else result.mismatches.push({ child_id: childId, reason: 'missing_note_row' });
  }
  for (const childId of actual) {
    if (!expected.has(childId)) {
      result.mismatches.push({ child_id: childId, reason: 'orphan_note_row' });
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
      console.warn('[backfill-school-policy-notes]', msg, obj),
  };

  const summary = await runBackfill({ client, logger });
  // eslint-disable-next-line no-console
  console.log('[backfill-school-policy-notes] summary:', JSON.stringify(summary, null, 2));

  const parity = await verifyParity({ client, logger });
  // eslint-disable-next-line no-console
  console.log(
    '[backfill-school-policy-notes] parity:',
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
      '[backfill-school-policy-notes] PARITY GATE FAILED — do NOT apply the drop migration',
    );
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[backfill-school-policy-notes] fatal:', err);
    process.exit(1);
  });
}
