#!/usr/bin/env tsx
/**
 * Slice 2-s27 — one-shot backfill for the new household-level food-identity
 * columns introduced by migration 20260902000000.
 *
 * For each household, computes:
 *   households.cultural_identifiers = UNION of children[*].cultural_identifiers
 *   households.dietary_preferences  = UNION of children[*].dietary_preferences
 *   households.declared_allergens   = UNION of children[*].declared_allergens
 *
 * Reads the encrypted columns on children with the household DEK, builds
 * deduplicated unions, re-encrypts under the same DEK, writes back to
 * households. Idempotent — re-running produces the same result.
 *
 * Run AFTER the migration is applied and BEFORE deploying the API changes
 * that read the new household-level columns. Pre-existing households would
 * otherwise read empty arrays at the household level even though their
 * children carry data — a visible regression.
 *
 * Invocation:
 *   pnpm --filter @hivekitchen/api exec tsx scripts/backfill-household-food-identity.ts
 *
 * Environment:
 *   SUPABASE_URL                       — required
 *   SUPABASE_SERVICE_ROLE_KEY          — required
 *   ENVELOPE_ENCRYPTION_MASTER_KEY     — optional (NOOP cipher used when absent)
 */
import { Buffer } from 'node:buffer';
import { createClient } from '@supabase/supabase-js';
import { ChildAllergensRepository } from '../src/modules/children/child-allergens.repository.js';
import { ChildrenRepository } from '../src/modules/children/children.repository.js';
import { encryptField } from '../src/lib/envelope-encryption.js';
import { getOrCreateHouseholdDek } from '../src/lib/household-key.js';

interface HouseholdRow {
  id: string;
}

interface BackfillSummary {
  household_id: string;
  cultural_count: number;
  dietary_count: number;
  allergen_count: number;
  children_count: number;
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

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Minimal logger shim — only the children repository uses .error, and only
  // for per-row decrypt skips. Mirror its shape without pulling in Pino.
  const logger = {
    error: (obj: Record<string, unknown>, msg: string): void => {
      // eslint-disable-next-line no-console
      console.error('[backfill]', msg, obj);
    },
  };

  // Slice 2.6-s8 — ChildrenRepository now requires a ChildAllergensRepository
  // because declared_allergens is sourced from child_allergens. The 2-s27
  // backfill reads children.declared_allergens via findByHouseholdId; with
  // the cutover that read now returns the child_allergens-backed list, which
  // is the desired union source for the household-level rollup.
  const childAllergensRepo = new ChildAllergensRepository(supabase, kek);
  const childrenRepo = new ChildrenRepository(supabase, kek, logger, childAllergensRepo);

  // Paginate to avoid hitting Supabase/PostgREST's default 1 000-row result cap.
  const BATCH_SIZE = 500;
  const rows: HouseholdRow[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('households')
      .select('id')
      .range(offset, offset + BATCH_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as HouseholdRow[];
    rows.push(...page);
    if (page.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  // eslint-disable-next-line no-console
  console.log(`[backfill] Found ${String(rows.length)} households to process`);

  const summaries: BackfillSummary[] = [];
  let processed = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const summary = await backfillOneHousehold(supabase, childrenRepo, row.id, kek);
      summaries.push(summary);
      processed += 1;
    } catch (err) {
      failed += 1;
      // eslint-disable-next-line no-console
      console.error('[backfill] household failed', { household_id: row.id, err });
    }
  }

  // eslint-disable-next-line no-console
  console.log('[backfill] Done', {
    processed,
    failed,
    skipped_empty: summaries.filter(
      (s) => s.cultural_count + s.dietary_count + s.allergen_count === 0,
    ).length,
  });
}

async function backfillOneHousehold(
  supabase: ReturnType<typeof createClient>,
  childrenRepo: ChildrenRepository,
  householdId: string,
  kek: Buffer | null,
): Promise<BackfillSummary> {
  const children = await childrenRepo.findByHouseholdId(householdId);
  if (children.length === 0) {
    return {
      household_id: householdId,
      cultural_count: 0,
      dietary_count: 0,
      allergen_count: 0,
      children_count: 0,
    };
  }

  const cultural = uniq(children.flatMap((c) => c.cultural_identifiers));
  const dietary = uniq(children.flatMap((c) => c.dietary_preferences));
  const allergens = uniq(children.flatMap((c) => c.declared_allergens));

  if (cultural.length === 0 && dietary.length === 0 && allergens.length === 0) {
    return {
      household_id: householdId,
      cultural_count: 0,
      dietary_count: 0,
      allergen_count: 0,
      children_count: children.length,
    };
  }

  // getOrCreateHouseholdDek lazily provisions a DEK if the household doesn't
  // have one yet. With KEK null (dev/test), the household DEK is also null
  // and encryptField falls through to the NOOP path — same shape as the
  // children rows we just decrypted.
  const dek = await getOrCreateHouseholdDek(supabase, kek, householdId);

  const update: Record<string, string> = {
    cultural_identifiers: encryptField(cultural, dek),
    dietary_preferences: encryptField(dietary, dek),
    declared_allergens: encryptField(allergens, dek),
  };

  const { error } = await supabase.from('households').update(update).eq('id', householdId);
  if (error) throw error;

  // Bust the kitchen-map cache so the new household-level fields are visible
  // to the planner and agent on the next read — without this, stale empty
  // arrays would be served until an unrelated write triggers an organic bump.
  const { error: bumpErr } = await supabase.rpc('bump_kitchen_map_version_for_household', {
    p_household_id: householdId,
  });
  if (bumpErr) throw bumpErr;

  // eslint-disable-next-line no-console
  console.log('[backfill] household updated', {
    household_id: householdId,
    cultural_count: cultural.length,
    dietary_count: dietary.length,
    allergen_count: allergens.length,
    children_count: children.length,
  });

  return {
    household_id: householdId,
    cultural_count: cultural.length,
    dietary_count: dietary.length,
    allergen_count: allergens.length,
    children_count: children.length,
  };
}

function uniq(values: readonly string[]): string[] {
  // Preserve first-seen order so repeated runs produce the same JSON exactly,
  // which makes the backfill provably idempotent under byte-for-byte
  // comparison (apart from the AES nonce which is per-encrypt).
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[backfill] fatal', err);
  process.exit(1);
});
