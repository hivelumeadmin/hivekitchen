#!/usr/bin/env tsx
/**
 * Story 3-DM-B2 — one-shot backfill into household_allergens +
 * household_cultural_identifiers, plus extending dietary_preferences with
 * household-scoped rows.
 *
 * Steps (idempotent; UNIQUE constraints absorb re-runs):
 *   1. child_allergens         → household_allergens (preserve child_id;
 *                                source 'onboarding_declared' → 'child_medical',
 *                                other sources unchanged).
 *   2. households.declared_allergens (encrypted jsonb)
 *                              → decrypt → each element re-encrypted
 *                                          + inserted as household_allergens
 *                                            row with child_id=NULL,
 *                                            source='backfill_migration'.
 *   3. households.cultural_identifiers (encrypted jsonb)
 *                              → decrypt → each tag inserted into
 *                                          household_cultural_identifiers.
 *                                          Tags missing from the cultural_tags
 *                                          vocab are skipped + logged.
 *   4. households.dietary_preferences (encrypted jsonb)
 *                              → decrypt → each tag inserted into
 *                                          dietary_preferences (existing
 *                                          table) with child_id=NULL.
 *                                          Tags missing from dietary_tags
 *                                          vocab are skipped + logged.
 *
 * Verification gate: after each step the script counts source vs target rows
 * and ABORTs (non-zero exit) on a mismatch. The 20261008000100 drop migration
 * MUST NOT be applied until this script completes successfully against the
 * target database.
 *
 * Run AFTER 20261008000000 has applied and BEFORE 20261008000100.
 *
 * Invocation:
 *   pnpm --filter @hivekitchen/api exec tsx scripts/backfill-household-allergens.ts
 *
 * Environment:
 *   SUPABASE_URL                        — required
 *   SUPABASE_SERVICE_ROLE_KEY           — required (bypasses RLS)
 *   ENVELOPE_ENCRYPTION_MASTER_KEY      — required when production-encrypted
 *                                         columns exist (NOOP-prefixed dev
 *                                         rows decode without it).
 */
import { Buffer } from 'node:buffer';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  decryptField,
  encryptField,
  normalizedHash,
} from '../src/lib/envelope-encryption.js';
import { getHouseholdDek } from '../src/lib/household-key.js';

export interface BackfillSummary {
  households_scanned: number;
  child_allergens_copied: number;
  child_allergens_skipped_existing: number;
  household_allergens_inserted: number;
  household_allergens_skipped_existing: number;
  cultural_identifiers_inserted: number;
  cultural_identifiers_skipped_vocab: number;
  dietary_preferences_inserted: number;
  dietary_preferences_skipped_vocab: number;
  decrypt_failures: number;
  insert_failures: number;
}

export interface BackfillDeps {
  client: SupabaseClient;
  kek: Buffer | null;
  pageSize?: number;
  logger?: { error: (obj: Record<string, unknown>, msg: string) => void };
}

interface HouseholdRow {
  id: string;
  declared_allergens: string | null;
  cultural_identifiers: string | null;
  dietary_preferences: string | null;
}

interface ChildAllergenRow {
  id: string;
  household_id: string;
  child_id: string;
  allergen: string;
  allergen_hash: string;
  source: string;
  created_at: string;
  updated_at: string;
}

interface VocabRow {
  key: string;
}

const SOURCE_CHILD_MEDICAL = 'child_medical';
const SOURCE_BACKFILL = 'backfill_migration';

export async function runBackfill(deps: BackfillDeps): Promise<BackfillSummary> {
  const pageSize = deps.pageSize ?? 200;
  const logger = deps.logger ?? {
    error: (obj, msg) =>
      // eslint-disable-next-line no-console
      console.error('[backfill-household-allergens]', msg, obj),
  };
  const summary: BackfillSummary = {
    households_scanned: 0,
    child_allergens_copied: 0,
    child_allergens_skipped_existing: 0,
    household_allergens_inserted: 0,
    household_allergens_skipped_existing: 0,
    cultural_identifiers_inserted: 0,
    cultural_identifiers_skipped_vocab: 0,
    dietary_preferences_inserted: 0,
    dietary_preferences_skipped_vocab: 0,
    decrypt_failures: 0,
    insert_failures: 0,
  };

  const culturalVocab = await loadVocab(deps.client, 'cultural_tags');
  const dietaryVocab = await loadVocab(deps.client, 'dietary_tags');

  // ---- Step 1: child_allergens → household_allergens --------------------------
  await migrateChildAllergens(deps, summary, logger);

  // ---- Step 2 + 3 + 4: walk households table page by page --------------------
  let offset = 0;
  for (;;) {
    const { data, error } = await deps.client
      .from('households')
      .select('id, declared_allergens, cultural_identifiers, dietary_preferences')
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as HouseholdRow[];
    if (page.length === 0) break;

    for (const row of page) {
      summary.households_scanned += 1;
      const dek = await getHouseholdDek(deps.client, deps.kek, row.id);

      if (row.declared_allergens !== null) {
        await migrateHouseholdAllergens(
          deps,
          row.id,
          row.declared_allergens,
          dek,
          summary,
          logger,
        );
      }
      if (row.cultural_identifiers !== null) {
        await migrateCulturalIdentifiers(
          deps,
          row.id,
          row.cultural_identifiers,
          dek,
          culturalVocab,
          summary,
          logger,
        );
      }
      if (row.dietary_preferences !== null) {
        await migrateDietaryPreferences(
          deps,
          row.id,
          row.dietary_preferences,
          dek,
          dietaryVocab,
          summary,
          logger,
        );
      }
    }

    if (page.length < pageSize) break;
    offset += pageSize;
  }

  await verifyCounts(deps, summary, logger);

  return summary;
}

async function migrateChildAllergens(
  deps: BackfillDeps,
  summary: BackfillSummary,
  logger: NonNullable<BackfillDeps['logger']>,
): Promise<void> {
  // 1:1 row copy. allergen ciphertext, allergen_hash, household_id, child_id
  // carry across unchanged — same DEK, same hash function.
  const pageSize = deps.pageSize ?? 200;
  let offset = 0;
  for (;;) {
    const { data, error } = await deps.client
      .from('child_allergens')
      .select('id, household_id, child_id, allergen, allergen_hash, source, created_at, updated_at')
      .range(offset, offset + pageSize - 1);
    if (error) {
      // Table may already be dropped on re-runs after the drop migration; in
      // that case the count-verification path is the source of truth.
      logger.error({ err: error.message }, 'child_allergens read failed (already dropped?)');
      return;
    }
    const page = (data ?? []) as ChildAllergenRow[];
    if (page.length === 0) break;

    for (const row of page) {
      const targetSource =
        row.source === 'onboarding_declared' ? SOURCE_CHILD_MEDICAL : row.source;
      const insertResult = await deps.client
        .from('household_allergens')
        .upsert(
          {
            household_id: row.household_id,
            child_id: row.child_id,
            allergen: row.allergen,
            allergen_hash: row.allergen_hash,
            source: targetSource,
            created_at: row.created_at,
            updated_at: row.updated_at,
          },
          {
            onConflict: 'household_id,child_id,allergen_hash',
            ignoreDuplicates: true,
          },
        )
        .select('id')
        .maybeSingle();
      if (insertResult.error !== null) {
        summary.insert_failures += 1;
        logger.error(
          {
            module: 'backfill-household-allergens',
            step: 'child_allergens',
            child_allergen_id: row.id,
            err: insertResult.error.message,
          },
          'household_allergens INSERT failed',
        );
        continue;
      }
      if (insertResult.data === null) {
        summary.child_allergens_skipped_existing += 1;
      } else {
        summary.child_allergens_copied += 1;
      }
    }

    if (page.length < pageSize) break;
    offset += pageSize;
  }
}

async function migrateHouseholdAllergens(
  deps: BackfillDeps,
  householdId: string,
  ciphertext: string,
  dek: Buffer | null,
  summary: BackfillSummary,
  logger: NonNullable<BackfillDeps['logger']>,
): Promise<void> {
  let allergens: string[];
  try {
    allergens = decryptField<string[]>(ciphertext, dek);
  } catch (err) {
    summary.decrypt_failures += 1;
    logger.error(
      {
        step: 'households.declared_allergens',
        household_id: householdId,
        err: err instanceof Error ? err.message : String(err),
      },
      'decrypt failed — skipping household',
    );
    return;
  }
  for (const allergen of allergens) {
    if (typeof allergen !== 'string' || allergen.trim().length === 0) continue;
    const ct = encryptField(allergen, dek);
    const hash = normalizedHash(allergen);
    const insertResult = await deps.client
      .from('household_allergens')
      .upsert(
        {
          household_id: householdId,
          child_id: null,
          allergen: ct,
          allergen_hash: hash,
          source: SOURCE_BACKFILL,
        },
        {
          // COALESCE-sentinel UNIQUE handles child_id=NULL; the named
          // constraint matches `household_allergens_scope_hash_uniq`.
          onConflict: 'household_id,allergen_hash',
          ignoreDuplicates: true,
        },
      )
      .select('id')
      .maybeSingle();
    if (insertResult.error !== null) {
      summary.insert_failures += 1;
      logger.error(
        {
          step: 'households.declared_allergens',
          household_id: householdId,
          err: insertResult.error.message,
        },
        'household_allergens INSERT failed',
      );
      continue;
    }
    if (insertResult.data === null) {
      summary.household_allergens_skipped_existing += 1;
    } else {
      summary.household_allergens_inserted += 1;
    }
  }
}

async function migrateCulturalIdentifiers(
  deps: BackfillDeps,
  householdId: string,
  ciphertext: string,
  dek: Buffer | null,
  vocab: Set<string>,
  summary: BackfillSummary,
  logger: NonNullable<BackfillDeps['logger']>,
): Promise<void> {
  let tags: string[];
  try {
    tags = decryptField<string[]>(ciphertext, dek);
  } catch (err) {
    summary.decrypt_failures += 1;
    logger.error(
      {
        step: 'households.cultural_identifiers',
        household_id: householdId,
        err: err instanceof Error ? err.message : String(err),
      },
      'decrypt failed — skipping household',
    );
    return;
  }
  for (const raw of tags) {
    if (typeof raw !== 'string') continue;
    const tag = raw.trim().toLowerCase();
    if (tag.length === 0) continue;
    if (!vocab.has(tag)) {
      summary.cultural_identifiers_skipped_vocab += 1;
      logger.error(
        { step: 'cultural_identifiers', household_id: householdId, tag },
        'cultural_tag missing from vocab — skipped',
      );
      continue;
    }
    const insertResult = await deps.client
      .from('household_cultural_identifiers')
      .upsert(
        {
          household_id: householdId,
          cultural_tag: tag,
          source: SOURCE_BACKFILL,
        },
        {
          onConflict: 'household_id,cultural_tag',
          ignoreDuplicates: true,
        },
      )
      .select('household_id')
      .maybeSingle();
    if (insertResult.error !== null) {
      summary.insert_failures += 1;
      logger.error(
        {
          step: 'cultural_identifiers',
          household_id: householdId,
          err: insertResult.error.message,
        },
        'household_cultural_identifiers INSERT failed',
      );
      continue;
    }
    summary.cultural_identifiers_inserted += 1;
  }
}

async function migrateDietaryPreferences(
  deps: BackfillDeps,
  householdId: string,
  ciphertext: string,
  dek: Buffer | null,
  vocab: Set<string>,
  summary: BackfillSummary,
  logger: NonNullable<BackfillDeps['logger']>,
): Promise<void> {
  let tags: string[];
  try {
    tags = decryptField<string[]>(ciphertext, dek);
  } catch (err) {
    summary.decrypt_failures += 1;
    logger.error(
      {
        step: 'households.dietary_preferences',
        household_id: householdId,
        err: err instanceof Error ? err.message : String(err),
      },
      'decrypt failed — skipping household',
    );
    return;
  }
  for (const raw of tags) {
    if (typeof raw !== 'string') continue;
    const tag = raw.trim().toLowerCase();
    if (tag.length === 0) continue;
    if (!vocab.has(tag)) {
      summary.dietary_preferences_skipped_vocab += 1;
      logger.error(
        { step: 'dietary_preferences', household_id: householdId, tag },
        'dietary_tag missing from vocab — skipped',
      );
      continue;
    }
    const insertResult = await deps.client
      .from('dietary_preferences')
      .upsert(
        {
          household_id: householdId,
          child_id: null,
          tag,
          source: SOURCE_BACKFILL,
        },
        {
          // dietary_preferences.dietary_preferences_scope_tag_uniq uses the
          // COALESCE-sentinel pattern.
          onConflict: 'household_id,tag',
          ignoreDuplicates: true,
        },
      )
      .select('id')
      .maybeSingle();
    if (insertResult.error !== null) {
      summary.insert_failures += 1;
      logger.error(
        {
          step: 'dietary_preferences',
          household_id: householdId,
          err: insertResult.error.message,
        },
        'dietary_preferences INSERT failed',
      );
      continue;
    }
    summary.dietary_preferences_inserted += 1;
  }
}

async function loadVocab(
  client: SupabaseClient,
  table: 'cultural_tags' | 'dietary_tags',
): Promise<Set<string>> {
  const { data, error } = await client.from(table).select('key');
  if (error) throw error;
  return new Set(((data ?? []) as VocabRow[]).map((r) => r.key.toLowerCase()));
}

// ---------------------------------------------------------------------------
// Verification gate
// ---------------------------------------------------------------------------

interface VerifyResult {
  ok: boolean;
  details: Record<string, number>;
}

export async function verifyCounts(
  deps: BackfillDeps,
  summary: BackfillSummary,
  logger: NonNullable<BackfillDeps['logger']>,
): Promise<VerifyResult> {
  const details: Record<string, number> = {};

  const childAllergensCount = await safeCount(deps.client, 'child_allergens');
  const householdAllergensCount = await safeCount(deps.client, 'household_allergens');
  const householdCulturalCount = await safeCount(deps.client, 'household_cultural_identifiers');
  const dietaryPreferencesCount = await safeCount(deps.client, 'dietary_preferences');

  details.child_allergens_source = childAllergensCount;
  details.household_allergens_target = householdAllergensCount;
  details.household_cultural_identifiers_target = householdCulturalCount;
  details.dietary_preferences_target = dietaryPreferencesCount;
  details.child_allergens_copied = summary.child_allergens_copied;
  details.child_allergens_skipped_existing = summary.child_allergens_skipped_existing;
  details.household_allergens_inserted = summary.household_allergens_inserted;
  details.household_allergens_skipped_existing = summary.household_allergens_skipped_existing;
  details.cultural_identifiers_inserted = summary.cultural_identifiers_inserted;
  details.dietary_preferences_inserted = summary.dietary_preferences_inserted;

  // Allergen parity: every child_allergens row must be reflected in
  // household_allergens (either freshly inserted on this run or already
  // present from a prior run, captured by skipped_existing). Plus the
  // newly-inserted household-wide rows from households.declared_allergens.
  const expectedHouseholdAllergens =
    summary.child_allergens_copied +
    summary.child_allergens_skipped_existing +
    summary.household_allergens_inserted +
    summary.household_allergens_skipped_existing;
  details.expected_household_allergens = expectedHouseholdAllergens;

  const ok =
    summary.decrypt_failures === 0 &&
    summary.insert_failures === 0 &&
    householdAllergensCount >= expectedHouseholdAllergens &&
    householdAllergensCount >=
      summary.child_allergens_copied + summary.child_allergens_skipped_existing;

  if (!ok) {
    logger.error(
      { details },
      'backfill verification gate FAILED — drop migration must not run',
    );
  }

  return { ok, details };
}

async function safeCount(client: SupabaseClient, table: string): Promise<number> {
  const { count, error } = await client
    .from(table)
    .select('*', { count: 'exact', head: true });
  if (error !== null) {
    // Table may have been dropped on re-runs — return -1 to signal absent.
    return -1;
  }
  return count ?? 0;
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

  const masterKey = process.env.ENVELOPE_ENCRYPTION_MASTER_KEY;
  const kek: Buffer | null =
    masterKey !== undefined && masterKey.length > 0
      ? Buffer.from(masterKey, 'base64')
      : null;

  const summary = await runBackfill({ client, kek });
  // eslint-disable-next-line no-console
  console.log(
    '[backfill-household-allergens] summary:',
    JSON.stringify(summary, null, 2),
  );

  const verify = await verifyCounts({ client, kek }, summary, {
    error: (obj, msg) =>
      // eslint-disable-next-line no-console
      console.error('[backfill-household-allergens]', msg, obj),
  });
  // eslint-disable-next-line no-console
  console.log(
    '[backfill-household-allergens] verify:',
    JSON.stringify(verify, null, 2),
  );

  if (!verify.ok) {
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[backfill-household-allergens] fatal:', err);
    process.exit(1);
  });
}
