#!/usr/bin/env tsx
/**
 * Story pre-4-s0 — one-shot backfill that normalizes stale FALCPA allergen
 * keys to the canonical singular form introduced by slice 2.6-s7.
 *
 * Slice 2.6-s7 renamed the guardrail engine's canonical FALCPA keys from
 * plural to singular forms (`eggs` → `egg`, `tree_nuts`/`tree-nuts` →
 * `tree_nut`). `FALCPA_SYNONYMS` is keyed by canonical name; a stored
 * allergen of `'eggs'` produces `targetsFor('eggs') === ['eggs']` and the
 * full synonym list (mayo, albumin, hollandaise …) is never expanded.
 *
 * Two storage sites carry per-household allergen plaintext under the
 * household DEK:
 *   - `child_allergens.allergen`        — ciphertext, paired with
 *                                          `allergen_hash` (idempotency key).
 *   - `households.declared_allergens`   — JSONB string[] ciphertext.
 * Both are decrypted, normalized, and re-encrypted under the same DEK.
 *
 * The `child_allergens` table has a UNIQUE (child_id, allergen_hash)
 * constraint. If a row already exists for the canonical key (e.g. parent
 * declared 'egg' separately after 'eggs'), the legacy row is DELETED rather
 * than updated — keeping the table consistent and the canonical row's
 * `source` audit trail untouched.
 *
 * The `households` table has no trigger for `declared_allergens` changes
 * (migration 20260820000000_add_kitchen_map_version.sql documents this
 * intentionally — a self-trigger would recurse). After updating
 * `declared_allergens`, this script calls
 * `bump_kitchen_map_version_for_household` explicitly via RPC.
 *
 * Idempotent — re-running on already-canonical data scans rows but writes
 * nothing.
 *
 * ⚠️  NOT safe for concurrent execution — run as a single-instance job.
 *
 * Invocation:
 *   pnpm --filter @hivekitchen/api exec tsx scripts/backfill-falcpa-allergen-keys.ts [--dry-run]
 *
 * Environment:
 *   SUPABASE_URL                       — required
 *   SUPABASE_SERVICE_ROLE_KEY          — required
 *   ENVELOPE_ENCRYPTION_MASTER_KEY     — optional (NOOP cipher used when absent)
 */
import { Buffer } from 'node:buffer';
import { pathToFileURL } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  decryptField,
  encryptField,
  normalizedHash,
} from '../src/lib/envelope-encryption.js';
import { getHouseholdDek } from '../src/lib/household-key.js';

// Stale → canonical map. Only the two keys 2.6-s7 missed need rewriting; the
// remaining FALCPA_TOP_9 keys (peanut, dairy, soy, wheat, fish, shellfish,
// sesame) were already in canonical form when chips emitted them.
const KEY_MAP: Readonly<Record<string, string>> = {
  eggs: 'egg',
  'tree-nuts': 'tree_nut',
  // The engine's synonym list also contains the alternate spelling
  // 'tree_nuts' — normalize that too in case any test/dev row carries it.
  tree_nuts: 'tree_nut',
};

// P2: trim + lowercase so 'Eggs', 'TREE-NUTS', ' eggs ' all normalize correctly.
function canonicalize(key: string): string {
  const k = key.trim().toLowerCase();
  return KEY_MAP[k] ?? k;
}

export interface BackfillSummary {
  rows_scanned: number;
  rows_updated: number;
  rows_deleted_dup: number;
  rows_skipped: number;
  households_scanned: number;
  households_updated: number;
  decrypt_failures: number;
}

export interface BackfillDeps {
  client: SupabaseClient;
  kek: Buffer | null;
  dryRun: boolean;
  pageSize?: number;
  logger?: {
    info: (obj: Record<string, unknown>, msg: string) => void;
    error: (obj: Record<string, unknown>, msg: string) => void;
  };
}

interface ChildAllergenRow {
  id: string;
  household_id: string;
  child_id: string;
  allergen: string;
  allergen_hash: string;
}

interface HouseholdRow {
  id: string;
  declared_allergens: string | null;
}

export async function runBackfill(deps: BackfillDeps): Promise<BackfillSummary> {
  const pageSize = deps.pageSize ?? 100;
  const logger = deps.logger ?? defaultLogger();
  const summary: BackfillSummary = {
    rows_scanned: 0,
    rows_updated: 0,
    rows_deleted_dup: 0,
    rows_skipped: 0,
    households_scanned: 0,
    households_updated: 0,
    decrypt_failures: 0,
  };

  // DEK cache scoped to one run — keyed by household_id. `null` means "no DEK
  // (NOOP cipher path)" and is a valid cached value; `undefined` means the
  // entry hasn't been fetched yet.
  const dekCache = new Map<string, Buffer | null>();
  const getDek = async (householdId: string): Promise<Buffer | null> => {
    if (dekCache.has(householdId)) return dekCache.get(householdId) as Buffer | null;
    const dek = await getHouseholdDek(deps.client, deps.kek, householdId);
    dekCache.set(householdId, dek);
    return dek;
  };

  // ---------------------------------------------------------------------------
  // Pass 1 — child_allergens rows
  // P1: keyset pagination ordered by id — safe against rows deleted mid-scan.
  // OFFSET pagination would skip rows when deletions shift the window.
  // ---------------------------------------------------------------------------
  let lastChildAllergenId: string | null = null;
  for (;;) {
    const caBase = deps.client
      .from('child_allergens')
      .select('id, household_id, child_id, allergen, allergen_hash');
    const caFiltered = lastChildAllergenId !== null
      ? caBase.gt('id', lastChildAllergenId)
      : caBase;
    const { data, error } = await caFiltered
      .order('id', { ascending: true })
      .limit(pageSize);
    if (error) throw error;
    const page = (data ?? []) as ChildAllergenRow[];
    if (page.length === 0) break;
    lastChildAllergenId = page[page.length - 1]!.id;

    for (const row of page) {
      summary.rows_scanned += 1;
      try {
        await processChildAllergenRow(deps, getDek, row, summary, logger);
      } catch (err) {
        summary.decrypt_failures += 1;
        logger.error(
          { household_id: row.household_id, child_id: row.child_id, row_id: row.id, err },
          'child_allergens row backfill failed',
        );
      }
    }

    if (page.length < pageSize) break;
  }

  // ---------------------------------------------------------------------------
  // Pass 2 — households.declared_allergens
  // P1: keyset pagination ordered by id.
  // ---------------------------------------------------------------------------
  let lastHouseholdId: string | null = null;
  for (;;) {
    const hhBase = deps.client
      .from('households')
      .select('id, declared_allergens')
      .not('declared_allergens', 'is', null);
    const hhFiltered = lastHouseholdId !== null
      ? hhBase.gt('id', lastHouseholdId)
      : hhBase;
    const { data, error } = await hhFiltered
      .order('id', { ascending: true })
      .limit(pageSize);
    if (error) throw error;
    const page = (data ?? []) as HouseholdRow[];
    if (page.length === 0) break;
    lastHouseholdId = page[page.length - 1]!.id;

    for (const row of page) {
      summary.households_scanned += 1;
      try {
        await processHouseholdRow(deps, getDek, row, summary, logger);
      } catch (err) {
        summary.decrypt_failures += 1;
        logger.error(
          { household_id: row.id, err },
          'households.declared_allergens backfill failed',
        );
      }
    }

    if (page.length < pageSize) break;
  }

  return summary;
}

async function processChildAllergenRow(
  deps: BackfillDeps,
  getDek: (householdId: string) => Promise<Buffer | null>,
  row: ChildAllergenRow,
  summary: BackfillSummary,
  logger: NonNullable<BackfillDeps['logger']>,
): Promise<void> {
  const dek = await getDek(row.household_id);
  const plaintext = decryptField<string>(row.allergen, dek);
  const canonical = canonicalize(plaintext);
  if (canonical === plaintext) {
    summary.rows_skipped += 1;
    return;
  }

  const newHash = normalizedHash(canonical);

  // P4: dry-run performs the existence check so would_delete_stale_dup is
  // reported accurately (not as would_update), matching the live-run behaviour.
  if (deps.dryRun) {
    const { data: existing } = await deps.client
      .from('child_allergens')
      .select('id')
      .eq('child_id', row.child_id)
      .eq('household_id', row.household_id)
      .eq('allergen_hash', newHash)
      .maybeSingle();
    const wouldDelete =
      existing !== null && (existing as { id: string }).id !== row.id;
    if (wouldDelete) {
      logger.info(
        {
          household_id: row.household_id,
          child_id: row.child_id,
          row_id: row.id,
          from: plaintext,
          canonical,
        },
        'would_delete_stale_dup',
      );
      summary.rows_deleted_dup += 1;
    } else {
      logger.info(
        {
          household_id: row.household_id,
          child_id: row.child_id,
          row_id: row.id,
          from: plaintext,
          to: canonical,
        },
        'would_update child_allergens row',
      );
      summary.rows_updated += 1;
    }
    return;
  }

  // If a canonical-key row already exists for this child (parent declared
  // both 'egg' and the legacy 'eggs' at some point), delete the stale row
  // rather than fight the UNIQUE (child_id, allergen_hash) index.
  // P8: include household_id in the lookup — defensive correctness.
  const { data: existing, error: existingErr } = await deps.client
    .from('child_allergens')
    .select('id')
    .eq('child_id', row.child_id)
    .eq('household_id', row.household_id)
    .eq('allergen_hash', newHash)
    .maybeSingle();
  if (existingErr) throw existingErr;

  if (existing !== null && (existing as { id: string }).id !== row.id) {
    const { error: delErr } = await deps.client
      .from('child_allergens')
      .delete()
      .eq('id', row.id);
    if (delErr) throw delErr;
    summary.rows_deleted_dup += 1;
    logger.info(
      {
        household_id: row.household_id,
        child_id: row.child_id,
        row_id: row.id,
        from: plaintext,
        canonical,
      },
      'deleted_duplicate_stale_row',
    );
    return;
  }

  const ciphertext = encryptField(canonical, dek);
  const { error: updErr } = await deps.client
    .from('child_allergens')
    .update({
      allergen: ciphertext,
      allergen_hash: newHash,
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id);
  if (updErr) throw updErr;
  summary.rows_updated += 1;
}

async function processHouseholdRow(
  deps: BackfillDeps,
  getDek: (householdId: string) => Promise<Buffer | null>,
  row: HouseholdRow,
  summary: BackfillSummary,
  logger: NonNullable<BackfillDeps['logger']>,
): Promise<void> {
  if (row.declared_allergens === null) return;
  const dek = await getDek(row.id);
  const allergens = decryptField<string[]>(row.declared_allergens, dek);
  if (!Array.isArray(allergens)) {
    summary.decrypt_failures += 1;
    logger.error(
      { household_id: row.id },
      'declared_allergens decrypted to non-array — skipped',
    );
    return;
  }

  const normalized = allergens.map(canonicalize);

  // P7: deduplicate BEFORE computing the changed flag so that pre-existing
  // duplicate canonical entries (e.g. ['egg','egg'] — no stale key, but
  // duplicates) are also collapsed and written back.
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const v of normalized) {
    if (seen.has(v)) continue;
    seen.add(v);
    deduped.push(v);
  }

  const changed =
    deduped.length !== allergens.length ||
    deduped.some((v, i) => v !== allergens[i]);
  if (!changed) return;

  if (deps.dryRun) {
    logger.info(
      { household_id: row.id, from: allergens, to: deduped },
      'would_update households.declared_allergens',
    );
    summary.households_updated += 1;
    return;
  }

  const ciphertext = encryptField(deduped, dek);
  // P6: set updated_at consistently with child_allergens updates.
  const { error } = await deps.client
    .from('households')
    .update({ declared_allergens: ciphertext, updated_at: new Date().toISOString() })
    .eq('id', row.id);
  if (error) throw error;

  // P5: households table has no trigger for declared_allergens changes.
  // Migration 20260820000000_add_kitchen_map_version.sql documents households
  // as intentionally excluded (self-trigger would recurse); writers call the
  // RPC explicitly instead.
  const { error: rpcError } = await deps.client.rpc(
    'bump_kitchen_map_version_for_household',
    { p_household_id: row.id },
  );
  if (rpcError) throw rpcError;

  summary.households_updated += 1;
}

function defaultLogger(): NonNullable<BackfillDeps['logger']> {
  return {
    // eslint-disable-next-line no-console
    info: (obj, msg) => console.log('[backfill-falcpa]', msg, obj),
    // eslint-disable-next-line no-console
    error: (obj, msg) => console.error('[backfill-falcpa]', msg, obj),
  };
}

async function main(): Promise<void> {
  const url = process.env['SUPABASE_URL'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }

  const kekHex = process.env['ENVELOPE_ENCRYPTION_MASTER_KEY'];
  const kek = kekHex ? Buffer.from(kekHex, 'hex') : null;
  if (kek === null) {
    // eslint-disable-next-line no-console
    console.warn(
      'ENVELOPE_ENCRYPTION_MASTER_KEY is unset — backfill will use the NOOP cipher (dev path).',
    );
  }

  const dryRun = process.argv.includes('--dry-run');
  if (dryRun) {
    // eslint-disable-next-line no-console
    console.log('[backfill-falcpa] --dry-run: no writes will be issued.');
  }

  const client = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const summary = await runBackfill({ client, kek, dryRun });

  // eslint-disable-next-line no-console
  console.log('[backfill-falcpa] summary:', summary);
}

// P9: cross-platform entry guard — original string-concat approach produced
// file:// vs file:/// mismatch on Windows.
const scriptPath = process.argv[1];
if (scriptPath !== undefined && import.meta.url === pathToFileURL(scriptPath).href) {
  main().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error('[backfill-falcpa] fatal', err);
    process.exit(1);
  });
}
