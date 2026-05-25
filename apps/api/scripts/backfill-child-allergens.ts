#!/usr/bin/env tsx
/**
 * Slice 2.6-s8 — one-shot backfill for the per-child allergen cutover.
 *
 * Reads every household's legacy `children.declared_allergens` JSONB column,
 * decrypts each child's array under the household DEK, and inserts one row
 * per allergen into `child_allergens` with `source='backfill_migration'`.
 *
 * Idempotent — the UNIQUE (child_id, allergen_hash) constraint on
 * `child_allergens` collapses re-runs to `skipped_existing` increments
 * rather than duplicate rows.
 *
 * Run BEFORE deploying the code change that switches the guardrail to
 * read from `child_allergens` only (the deploy is sequenced — see
 * AC7 in the story file). Pre-2.5 households whose allergens live solely
 * in the legacy column would otherwise become invisible to the guardrail
 * for a few seconds during the read-cutover deploy.
 *
 * Invocation:
 *   pnpm --filter @hivekitchen/api exec tsx scripts/backfill-child-allergens.ts
 *
 * Environment:
 *   SUPABASE_URL                       — required
 *   SUPABASE_SERVICE_ROLE_KEY          — required
 *   ENVELOPE_ENCRYPTION_MASTER_KEY     — optional (NOOP cipher used when absent)
 */
import { Buffer } from 'node:buffer';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ChildAllergensRepository } from '../src/modules/children/child-allergens.repository.js';
import { decryptField } from '../src/lib/envelope-encryption.js';
import { getHouseholdDek } from '../src/lib/household-key.js';

export interface BackfillSummary {
  households_scanned: number;
  children_scanned: number;
  allergens_migrated: number;
  skipped_existing: number;
  decrypt_failures: number;
}

export interface BackfillDeps {
  client: SupabaseClient;
  kek: Buffer | null;
  repo: ChildAllergensRepository;
  // Pagination size — exposed for tests; production uses the default.
  pageSize?: number;
  // Logger shim — defaults to console. Tests inject a recorder.
  logger?: { error: (obj: Record<string, unknown>, msg: string) => void };
}

/**
 * Pure-function entry point. Production main() wires up Supabase + KEK and
 * calls this; tests construct a mock client + repo and call it directly.
 */
export async function runBackfill(deps: BackfillDeps): Promise<BackfillSummary> {
  const pageSize = deps.pageSize ?? 100;
  const logger = deps.logger ?? {
    // eslint-disable-next-line no-console
    error: (obj, msg) => console.error('[backfill]', msg, obj),
  };
  const summary: BackfillSummary = {
    households_scanned: 0,
    children_scanned: 0,
    allergens_migrated: 0,
    skipped_existing: 0,
    decrypt_failures: 0,
  };

  let offset = 0;
  for (;;) {
    const { data, error } = await deps.client
      .from('households')
      .select('id')
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
    if (page.length === 0) break;

    for (const householdId of page) {
      summary.households_scanned += 1;
      try {
        await backfillOneHousehold(deps, householdId, summary);
      } catch (err) {
        // Whole-household failures (DEK unwrap, network) count as decrypt
        // failures so the operator notices and re-runs after fixing. Per-
        // child failures are accounted for inside backfillOneHousehold.
        summary.decrypt_failures += 1;
        logger.error({ household_id: householdId, err }, 'household backfill failed');
      }
    }

    if (page.length < pageSize) break;
    offset += pageSize;
  }

  return summary;
}

async function backfillOneHousehold(
  deps: BackfillDeps,
  householdId: string,
  summary: BackfillSummary,
): Promise<void> {
  const logger = deps.logger ?? {
    // eslint-disable-next-line no-console
    error: (obj, msg) => console.error('[backfill]', msg, obj),
  };

  const { data, error } = await deps.client
    .from('children')
    .select('id, declared_allergens')
    .eq('household_id', householdId);
  if (error) throw error;
  const children = (data ?? []) as Array<{ id: string; declared_allergens: string | null }>;
  if (children.length === 0) return;

  // Lazy DEK fetch — pre-2.5 households with no encrypted_dek and no
  // ciphertext (all-null legacy column) skip the round-trip entirely.
  let dek: Buffer | null | undefined;

  for (const child of children) {
    summary.children_scanned += 1;
    if (child.declared_allergens === null) continue;

    if (dek === undefined) {
      dek = await getHouseholdDek(deps.client, deps.kek, householdId);
    }

    let allergens: string[];
    try {
      allergens = decryptField<string[]>(child.declared_allergens, dek);
    } catch (err) {
      summary.decrypt_failures += 1;
      logger.error(
        { household_id: householdId, child_id: child.id, err },
        'child declared_allergens decrypt failed — skipped',
      );
      continue;
    }

    for (const allergen of allergens) {
      const { inserted } = await deps.repo.declareIfNew(
        householdId,
        child.id,
        allergen,
        'backfill_migration',
      );
      if (inserted) summary.allergens_migrated += 1;
      else summary.skipped_existing += 1;
    }
  }
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

  const client = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const repo = new ChildAllergensRepository(client, kek);

  const summary = await runBackfill({ client, kek, repo });

  // eslint-disable-next-line no-console
  console.log('[backfill] summary:', summary);
}

// Allow the file to be imported by tests without auto-invoking main().
// `tsx scripts/backfill-child-allergens.ts` still triggers it through the
// import.meta.url === entry point check.
const entryUrl = `file://${process.argv[1] ?? ''}`.replace(/\\/g, '/');
if (import.meta.url === entryUrl) {
  main().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error('[backfill] fatal', err);
    process.exit(1);
  });
}
