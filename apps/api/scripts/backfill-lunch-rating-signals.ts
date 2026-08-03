#!/usr/bin/env tsx
/**
 * Story 15-s3 — cutover backfill + parity gate for the child_preferences
 * projection (canonical data model v2 §4.9, §8 step 2).
 *
 * child_preferences becomes a projection over the append-only signals log.
 * Signals only started accumulating at 15-s2, so historical ratings must be
 * imported before the projection can reproduce the table.
 *
 * Steps:
 *   1. Backfill — every child_preferences row with no matching lunch_rating
 *      signal on (child_id, recipe_id, slot_kind, signal_date) is imported as
 *      a signal: payload {kind, rating, date}, subject_ref {recipe_id,
 *      slot_kind}, occurred_at = the preference's created_at (so a rebuilt
 *      projection orders identically), source='import' (the reserved enum
 *      value's designed purpose). Idempotent — safe to re-run.
 *   2. Parity gate — projectLunchRatings(all lunch_rating signals) is compared
 *      against the live child_preferences table per household, set-equality on
 *      (child_id, recipe_id, slot_kind, signal_date, signal_type). Any
 *      mismatch exits non-zero. There is no skip-on-error escape hatch: an
 *      unverifiable database is a failed cutover.
 *
 * ⚠️ DO NOT RE-RUN AFTER A FLAVOR-JOURNEY RESET (7-S7). The projection is
 * forward-apply-only: a reset hard-deletes child_preferences rows while the
 * signals behind them survive (append-only). Re-running the parity gate then
 * reports `extra_in_projection` rows, and re-running the backfill cannot undo
 * a reset. This is a CUTOVER-TIME tool only. Full replay-after-reset semantics
 * (a watermark on `children`) are recorded in deferred-work.md.
 *
 * Run AFTER 20261035000200 (create_signals) has applied.
 *
 * Invocation:
 *   pnpm --filter @hivekitchen/api exec tsx scripts/backfill-lunch-rating-signals.ts
 *
 * Environment:
 *   SUPABASE_URL              — required
 *   SUPABASE_SERVICE_ROLE_KEY — required (bypasses RLS; signals RLS is
 *                               SELECT-only, so inserts need the service role)
 *
 * No KEK is needed: lunch_rating payloads are plaintext at rest (only
 * lunch_request.text and preference_edit.item are envelope-encrypted).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SignalRow } from '@hivekitchen/types';
import { projectLunchRatings } from '../src/modules/child-preferences/child-preferences.projection.js';
import type { ChildPreferenceInsert } from '../src/modules/child-preferences/child-preferences.repository.js';
import { SignalsRepository } from '../src/modules/signals/signals.repository.js';

export interface ScriptDeps {
  client: SupabaseClient;
  pageSize?: number;
  // Forwarded to projectLunchRatings() so a live cutover run surfaces
  // skipped/unprojectable signal rows instead of silently dropping them.
  logger?: { warn: (obj: Record<string, unknown>, msg: string) => void };
}

export interface BackfillSummary {
  households_scanned: number;
  preferences_scanned: number;
  signals_inserted: number;
  skipped_existing: number;
}

export type MismatchReason =
  | 'missing_in_projection'
  | 'extra_in_projection'
  | 'signal_type_mismatch';

// Identity only — no rating values, no names, no free text.
export interface ParityMismatch {
  household_id: string;
  child_id: string;
  recipe_id: string;
  slot_kind: string;
  signal_date: string;
  reason: MismatchReason;
}

export interface ParityResult {
  ok: boolean;
  households_checked: number;
  matched: number;
  mismatches: ParityMismatch[];
}

interface PreferenceRow {
  household_id: string;
  child_id: string;
  recipe_id: string;
  slot_kind: string;
  signal_type: string;
  signal_date: string;
  created_at: string;
}

const DEFAULT_PAGE_SIZE = 500;
const MAX_REPORTED_MISMATCHES = 50;

function identityKey(parts: {
  child_id: string;
  recipe_id: string;
  slot_kind: string;
  signal_date: string;
}): string {
  return `${parts.child_id}|${parts.recipe_id}|${parts.slot_kind}|${parts.signal_date}`;
}

async function loadPreferences(
  deps: ScriptDeps,
  householdId: string | null,
): Promise<PreferenceRow[]> {
  const pageSize = deps.pageSize ?? DEFAULT_PAGE_SIZE;
  const rows: PreferenceRow[] = [];
  let offset = 0;
  for (;;) {
    let query = deps.client
      .from('child_preferences')
      .select('id, household_id, child_id, recipe_id, slot_kind, signal_type, signal_date, created_at')
      .order('id', { ascending: true });
    if (householdId !== null) query = query.eq('household_id', householdId);
    const { data, error } = await query.range(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as PreferenceRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

async function loadLunchRatingSignals(
  deps: ScriptDeps,
  householdId: string,
): Promise<SignalRow[]> {
  const pageSize = deps.pageSize ?? DEFAULT_PAGE_SIZE;
  const repository = new SignalsRepository(deps.client);
  const rows: SignalRow[] = [];
  let after: { occurredAt: string; id: string } | undefined;
  for (;;) {
    const page = await repository.findLunchRatingsByHousehold(householdId, {
      limit: pageSize,
      after,
    });
    rows.push(...page);
    if (page.length < pageSize) break;
    const last = page[page.length - 1];
    if (last === undefined) break;
    after = { occurredAt: last.occurred_at, id: last.id };
  }
  return rows;
}

async function listHouseholdIds(deps: ScriptDeps, table: 'child_preferences' | 'signals') {
  const pageSize = deps.pageSize ?? DEFAULT_PAGE_SIZE;
  const ids = new Set<string>();
  let offset = 0;
  for (;;) {
    // household_id ties are broken by id so repeated offset/limit calls scan
    // a stable order — otherwise Postgres can reshuffle tied rows between
    // calls and a household can fall in the gap between two pages.
    let query = deps.client
      .from(table)
      .select('household_id')
      .order('household_id', { ascending: true })
      .order('id', { ascending: true });
    if (table === 'signals') query = query.eq('kind', 'lunch_rating');
    const { data, error } = await query.range(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as { household_id: string }[];
    for (const row of page) ids.add(row.household_id);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return ids;
}

export async function runBackfill(deps: ScriptDeps): Promise<BackfillSummary> {
  const summary: BackfillSummary = {
    households_scanned: 0,
    preferences_scanned: 0,
    signals_inserted: 0,
    skipped_existing: 0,
  };

  for (const householdId of await listHouseholdIds(deps, 'child_preferences')) {
    summary.households_scanned += 1;
    const preferences = await loadPreferences(deps, householdId);
    summary.preferences_scanned += preferences.length;

    // A signal EXISTS for a key iff the projection produces that key — so the
    // projection is also the dedup predicate, and the two can never disagree.
    const existing = new Set(
      projectLunchRatings(await loadLunchRatingSignals(deps, householdId), deps.logger).map(
        identityKey,
      ),
    );

    const toInsert = preferences.filter((row) => !existing.has(identityKey(row)));
    summary.skipped_existing += preferences.length - toInsert.length;
    if (toInsert.length === 0) continue;

    const { error } = await deps.client.from('signals').insert(
      toInsert.map((row) => ({
        household_id: row.household_id,
        child_id: row.child_id,
        kind: 'lunch_rating',
        subject_ref: { recipe_id: row.recipe_id, slot_kind: row.slot_kind },
        payload: { kind: 'lunch_rating', rating: row.signal_type, date: row.signal_date },
        occurred_at: row.created_at,
        source: 'import',
      })),
    );
    if (error) throw error;
    summary.signals_inserted += toInsert.length;
  }

  return summary;
}

export async function verifyParity(deps: ScriptDeps): Promise<ParityResult> {
  const households = await listHouseholdIds(deps, 'child_preferences');
  for (const id of await listHouseholdIds(deps, 'signals')) households.add(id);

  const result: ParityResult = {
    ok: true,
    households_checked: 0,
    matched: 0,
    mismatches: [],
  };

  for (const householdId of households) {
    result.households_checked += 1;
    const stored = new Map<string, PreferenceRow>();
    for (const row of await loadPreferences(deps, householdId)) stored.set(identityKey(row), row);

    const projected = new Map<string, ChildPreferenceInsert>();
    for (const row of projectLunchRatings(
      await loadLunchRatingSignals(deps, householdId),
      deps.logger,
    )) {
      projected.set(identityKey(row), row);
    }

    for (const [key, row] of stored) {
      const mirror = projected.get(key);
      if (mirror === undefined) {
        result.mismatches.push({ ...describe(householdId, row), reason: 'missing_in_projection' });
      } else if (mirror.signal_type !== row.signal_type) {
        result.mismatches.push({ ...describe(householdId, row), reason: 'signal_type_mismatch' });
      } else {
        result.matched += 1;
      }
    }
    for (const [key, row] of projected) {
      if (!stored.has(key)) {
        result.mismatches.push({ ...describe(householdId, row), reason: 'extra_in_projection' });
      }
    }
  }

  result.ok = result.mismatches.length === 0;
  return result;
}

function describe(
  householdId: string,
  row: { child_id: string; recipe_id: string; slot_kind: string; signal_date: string },
): Omit<ParityMismatch, 'reason'> {
  return {
    household_id: householdId,
    child_id: row.child_id,
    recipe_id: row.recipe_id,
    slot_kind: row.slot_kind,
    signal_date: row.signal_date,
  };
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
      console.warn('[backfill-lunch-rating-signals]', msg, obj),
  };

  const summary = await runBackfill({ client, logger });
  // eslint-disable-next-line no-console
  console.log('[backfill-lunch-rating-signals] summary:', JSON.stringify(summary, null, 2));

  const parity = await verifyParity({ client, logger });
  // eslint-disable-next-line no-console
  console.log(
    '[backfill-lunch-rating-signals] parity:',
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
      '[backfill-lunch-rating-signals] PARITY GATE FAILED — child_preferences is not reproducible from the signals log',
    );
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[backfill-lunch-rating-signals] fatal:', err);
    process.exit(1);
  });
}
