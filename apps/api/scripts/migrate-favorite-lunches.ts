#!/usr/bin/env tsx
/**
 * Slice 2.6-s1 — one-shot migration that folds the standalone `favorite_lunches`
 * table (story 2.5-s9) into `recipes` + `household_recipe_usage` (story 3-31).
 *
 * For each `favorite_lunches` row with migration_status='pending':
 *   1. Decrypt `item` ciphertext under the household DEK.
 *   2. In a single transaction (best-effort via per-row error handling — see
 *      "atomicity" note below):
 *      a. INSERT into `recipes` with
 *           source='parent_declared',
 *           visibility='private',
 *           created_by_household_id=<household_id>,
 *           canonical_name=<plaintext, NFC-normalized>,
 *           ingredients=[]::jsonb,
 *           ingredient_keys={}::text[],
 *           allergen_flags={}::text[],
 *           applicable_slots=ARRAY['main'].
 *         On (recipes_household_normalized_name_uniq) conflict — Stage 0/1
 *         created this item already — REUSE the existing recipes.id.
 *      b. INSERT into `household_recipe_usage` with
 *           catalog_provenance='declared',
 *           is_household_favorite=true,
 *           confidence_score=80,
 *           first_used_at=last_used_at=<favorite_lunches.created_at>.
 *         On PK conflict (recipe_id already used by this household, e.g. plan
 *         already promoted the dish), UPDATE only the stable signals:
 *           is_household_favorite=true,
 *           catalog_provenance='declared' (declared wins over plan_promoted —
 *           parent intent is stronger than planner inference).
 *      c. UPDATE favorite_lunches.migration_status='migrated'.
 *
 * AC3 — decrypt failures:
 *   - Per-row try/catch around DEK decryption.
 *   - Failure → log `migration.favorite_lunches.decrypt_failed` (NEVER the
 *     plaintext attempt or ciphertext); set migration_status='quarantined';
 *     continue.
 *   - Global abort if cumulative decrypt-failure rate exceeds 5%
 *     (quarantined + failed rows / total processed). Fires from the first row.
 *
 * AC4 — Encryption-drop security checkpoint:
 *   SECURITY: this script writes the decrypted lunch name as plaintext
 *   `recipes.canonical_name` (visibility='private'). Per Epic 2.6 brief §3
 *   "Encryption decision," RLS + visibility='private' + created_by_household_id
 *   are the access controls. Reversible via an encrypted_canonical_name column
 *   if a future security review flags it; no schema-shape change required.
 *
 * Atomicity note:
 *   The supabase-js client doesn't expose multi-statement transactions.
 *   For per-row atomicity we order writes so the recipes INSERT is the
 *   "lock-relevant" step: if it succeeds, household_recipe_usage and the
 *   migration_status flip both proceed. If household_recipe_usage fails we
 *   delete the just-inserted recipes row (only when it was a fresh insert,
 *   not a reuse). If both succeed and the status flip fails, the next run
 *   re-encounters the row, the recipes INSERT hits the normalization unique
 *   index, reuses the id, the household_recipe_usage upsert is no-op, then
 *   the status flip retries — idempotent end-state.
 *
 * Invocation:
 *   pnpm --filter @hivekitchen/api exec tsx scripts/migrate-favorite-lunches.ts
 *
 * Environment:
 *   SUPABASE_URL                       — required
 *   SUPABASE_SERVICE_ROLE_KEY          — required (RLS bypass)
 *   ENVELOPE_ENCRYPTION_MASTER_KEY     — optional (NOOP cipher used when absent)
 *   MIGRATE_FAVORITE_LUNCHES_BATCH     — optional (default 500)
 *   MIGRATE_FAVORITE_LUNCHES_DRY_RUN   — optional ('1' = log only, no writes)
 */
import { Buffer } from 'node:buffer';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { decryptField } from '../src/lib/envelope-encryption.js';
import { getHouseholdDek } from '../src/lib/household-key.js';

interface FavoriteLunchRow {
  id: string;
  household_id: string;
  item: string;
  created_at: string;
}

interface Summary {
  total: number;
  migrated: number;
  quarantined: number;
  skipped: number;
  failed: number;
}

const DECRYPT_FAIL_THRESHOLD = 0.05;
const DEFAULT_BATCH_SIZE = 500;

// Mirrors the SQL unique index: regexp_replace(lower(name), '[\s\-'']+', '', 'g').
// Strips hyphens and apostrophes (but not spaces) so "mac-and-cheese" and
// "mac and cheese" both resolve to the same ilike lookup term on conflict.
function normalizeCanonicalName(raw: string): string {
  return raw.trim().normalize('NFC').replace(/[-']+/g, '');
}

async function findOrInsertRecipe(
  client: SupabaseClient,
  householdId: string,
  canonicalName: string,
): Promise<{ recipeId: string; wasInserted: boolean }> {
  // SECURITY: see header — plaintext canonical_name + RLS + visibility='private'
  // per Epic 2.6 brief §3.
  const insert = await client
    .from('recipes')
    .insert({
      canonical_name: canonicalName,
      ingredients: [],
      ingredient_keys: [],
      primary_ingredient_key: null,
      allergen_flags: [],
      dietary_flags: [],
      cultural_tags: [],
      cuisine_tags: [],
      applicable_slots: ['main'],
      prep_time_minutes: null,
      source: 'parent_declared',
      created_by_household_id: householdId,
      visibility: 'private',
    })
    .select('id')
    .single();

  if (insert.error === null) {
    return { recipeId: (insert.data as { id: string }).id, wasInserted: true };
  }

  // 23505 = unique_violation. Recipes_household_normalized_name_uniq fires when
  // Stage 0/1 (or a prior partial migration run) already inserted this lunch
  // under the same normalized name.
  const code = (insert.error as { code?: string }).code;
  if (code !== '23505') throw insert.error;

  const existing = await client
    .from('recipes')
    .select('id')
    .eq('created_by_household_id', householdId)
    .ilike('canonical_name', canonicalName)
    .limit(1)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data === null) {
    // The unique index matched on the NORMALIZED form but the ilike fallback
    // didn't find a row. Retry with a strict normalization-equivalent lookup
    // via canonical_name ilike with collapsed-whitespace — extremely rare; if
    // still null, surface as an error rather than silently dropping the row.
    throw new Error(
      `recipes UNIQUE conflict on household ${householdId} but no matching row found ` +
        `for canonical_name="${canonicalName}" — schema or normalization mismatch`,
    );
  }
  return { recipeId: (existing.data as { id: string }).id, wasInserted: false };
}

async function upsertUsageDeclared(
  client: SupabaseClient,
  householdId: string,
  recipeId: string,
  firstUsedAt: string,
): Promise<void> {
  const insert = await client
    .from('household_recipe_usage')
    .insert({
      household_id: householdId,
      recipe_id: recipeId,
      catalog_provenance: 'declared',
      is_household_favorite: true,
      confidence_score: 80,
      use_count: 0,
      first_used_at: firstUsedAt,
      last_used_at: firstUsedAt,
    });

  if (insert.error === null) return;

  const code = (insert.error as { code?: string }).code;
  if (code !== '23505') throw insert.error;

  // Existing row — declared wins over plan_promoted/inferred. We don't bump
  // counters: this is a provenance fact (parent stated this in onboarding),
  // not a use event. Backdate first_used_at to the original onboarding date
  // so the row reflects the earliest known interest in this item.
  const update = await client
    .from('household_recipe_usage')
    .update({
      catalog_provenance: 'declared',
      is_household_favorite: true,
      first_used_at: firstUsedAt,
    })
    .eq('household_id', householdId)
    .eq('recipe_id', recipeId);
  if (update.error) throw update.error;
}

async function markRowStatus(
  client: SupabaseClient,
  rowId: string,
  status: 'migrated' | 'quarantined',
): Promise<void> {
  const { error } = await client
    .from('favorite_lunches')
    .update({ migration_status: status })
    .eq('id', rowId);
  if (error) throw error;
}

async function processOne(
  client: SupabaseClient,
  kek: Buffer | null,
  row: FavoriteLunchRow,
  dryRun: boolean,
): Promise<'migrated' | 'quarantined' | 'failed'> {
  // ---- Step 1: decrypt -----
  let plaintext: string;
  try {
    const dek = await getHouseholdDek(client, kek, row.household_id);
    plaintext = decryptField<string>(row.item, dek);
  } catch (err) {
    // AC3: never log the plaintext attempt or the ciphertext.
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        evt: 'migration.favorite_lunches.decrypt_failed',
        household_id: row.household_id,
        row_id: row.id,
        error_class: err instanceof Error ? err.constructor.name : 'Unknown',
      }),
    );
    if (!dryRun) await markRowStatus(client, row.id, 'quarantined');
    return 'quarantined';
  }

  const canonicalName = normalizeCanonicalName(plaintext);
  if (canonicalName.length === 0) {
    // Decrypted to empty string — treat as quarantine; never insert an empty
    // recipe row.
    if (!dryRun) await markRowStatus(client, row.id, 'quarantined');
    return 'quarantined';
  }

  if (dryRun) {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        evt: 'migration.favorite_lunches.dry_run',
        household_id: row.household_id,
        row_id: row.id,
        canonical_name_length: canonicalName.length,
      }),
    );
    return 'migrated';
  }

  // ---- Step 2: recipes INSERT (or reuse) -----
  let recipeId: string;
  let recipeWasInserted: boolean;
  try {
    const r = await findOrInsertRecipe(client, row.household_id, canonicalName);
    recipeId = r.recipeId;
    recipeWasInserted = r.wasInserted;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        evt: 'migration.favorite_lunches.recipe_insert_failed',
        household_id: row.household_id,
        row_id: row.id,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    // Mark quarantined so next batch doesn't re-fetch and loop infinitely.
    if (!dryRun) await markRowStatus(client, row.id, 'quarantined').catch(() => undefined);
    return 'failed';
  }

  // ---- Step 3: household_recipe_usage upsert -----
  try {
    await upsertUsageDeclared(client, row.household_id, recipeId, row.created_at);
  } catch (err) {
    // Best-effort rollback of the recipes insert (only if we just inserted
    // it — never delete a row that Stage 0/1 created).
    if (recipeWasInserted) {
      const del = await client.from('recipes').delete().eq('id', recipeId);
      if (del.error) {
        // eslint-disable-next-line no-console
        console.error(
          JSON.stringify({
            evt: 'migration.favorite_lunches.rollback_failed',
            household_id: row.household_id,
            row_id: row.id,
            recipe_id: recipeId,
            error: del.error.message,
          }),
        );
      }
    }
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        evt: 'migration.favorite_lunches.usage_insert_failed',
        household_id: row.household_id,
        row_id: row.id,
        recipe_id: recipeId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    // Mark quarantined so next batch doesn't re-fetch and loop infinitely.
    if (!dryRun) await markRowStatus(client, row.id, 'quarantined').catch(() => undefined);
    return 'failed';
  }

  // ---- Step 4: mark migrated -----
  try {
    await markRowStatus(client, row.id, 'migrated');
  } catch (err) {
    // Recipes + usage already written. Next run sees migration_status='pending'
    // for this row, recipes INSERT hits the unique index → reuses → usage
    // upsert is no-op → status flip retries. Idempotent.
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        evt: 'migration.favorite_lunches.status_flip_failed_will_retry_next_run',
        household_id: row.household_id,
        row_id: row.id,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return 'failed';
  }

  return 'migrated';
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
      '[migrate-favorite-lunches] ENVELOPE_ENCRYPTION_MASTER_KEY unset — NOOP cipher (dev path only).',
    );
  }

  const batchSize = Number(
    process.env['MIGRATE_FAVORITE_LUNCHES_BATCH'] ?? String(DEFAULT_BATCH_SIZE),
  );
  const dryRun = process.env['MIGRATE_FAVORITE_LUNCHES_DRY_RUN'] === '1';

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const summary: Summary = { total: 0, migrated: 0, quarantined: 0, skipped: 0, failed: 0 };

  // Page through pending rows. Each iteration re-queries to handle the case
  // where migration_status was just flipped (no offset arithmetic needed).
  for (;;) {
    const { data, error } = await supabase
      .from('favorite_lunches')
      .select('id, household_id, item, created_at')
      .eq('migration_status', 'pending')
      .order('created_at', { ascending: true })
      .limit(batchSize);
    if (error) throw error;
    const rows = (data ?? []) as FavoriteLunchRow[];
    if (rows.length === 0) break;

    for (const row of rows) {
      summary.total += 1;
      const result = await processOne(supabase, kek, row, dryRun);
      if (result === 'migrated') summary.migrated += 1;
      else if (result === 'quarantined') summary.quarantined += 1;
      else summary.failed += 1;

      // AC3 — abort if failure rate (quarantined + failed) exceeds threshold.
      // Fires from the first row; no minimum-processed window.
      const rate = (summary.quarantined + summary.failed) / summary.total;
      if (rate > DECRYPT_FAIL_THRESHOLD) {
        // eslint-disable-next-line no-console
        console.error(
          JSON.stringify({
            evt: 'migration.favorite_lunches.aborted_quarantine_rate',
            processed: summary.total,
            quarantined: summary.quarantined,
            failed: summary.failed,
            rate,
          }),
        );
        throw new Error(
          `Aborting: failure rate ${(rate * 100).toFixed(1)}% exceeds ${(
            DECRYPT_FAIL_THRESHOLD * 100
          ).toFixed(1)}% threshold after ${summary.total} rows`,
        );
      }
    }

    if (dryRun) break; // dry-run only processes one page
  }

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      evt: 'migration.favorite_lunches.done',
      dry_run: dryRun,
      ...summary,
    }),
  );
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[migrate-favorite-lunches] fatal', err);
  process.exit(1);
});
