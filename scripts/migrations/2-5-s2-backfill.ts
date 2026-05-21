#!/usr/bin/env tsx
/**
 * Slice 2.5-s2 — JSONB → structured-table backfill.
 *
 * Reads each household's encrypted JSONB arrays and inserts the decoded
 * entries into the structured signal tables added in 2.5-s1:
 *   - children.declared_allergens     → child_allergens
 *   - children.dietary_preferences    → dietary_preferences
 *   - children.cultural_identifiers   → cultural_priors  (tier='L2', state='suggested')
 *   - households.cultural_identifiers → cultural_priors  (tier='L1', state='suggested')
 *
 * The SQL migration 20260904000100 has already handled the memory_nodes
 * backfill (cultural_rhythm → cultural_priors) plus soft-forgetting of the
 * deprecated node_types — this script only owns the work that can't be
 * done in pure SQL because the source columns are envelope-encrypted.
 *
 * Idempotency: each insert uses either ON CONFLICT DO NOTHING (cultural_
 * priors, dietary_preferences) or a manual existence probe on the unique
 * (child_id, allergen_hash) index (child_allergens). Safe to re-run.
 *
 * Decision (resolves story Q2): all backfilled cultural_priors enter at
 * state='suggested' regardless of whether the source was child- or
 * household-scoped. Ratification to 'active' is the job of Moment 3
 * (slice 2.5-s7), not this backfill — emitting 'active' here would put
 * legacy onboarding declarations in the "ratified" bucket before the
 * household has gone through the chaptered conversation.
 *
 * Decision (resolves story Q1): keys are kebab-cased lower(trim(facet))
 * with non-alnum-underscore runs collapsed to '-', then trimmed and
 * capped at 64 chars. Matches the cultural_tags vocabulary key shape.
 *
 * Note on the cultural_priors.key CHECK constraint: the constraint still
 * restricts keys to ('halal','kosher','hindu_vegetarian','south_asian',
 * 'east_african','caribbean'). Values that don't match are skipped here
 * (logged as skipped_unmappable) — the SQL migration applies the same
 * filter for the memory_nodes pass.
 *
 * Invocation:
 *   npx tsx scripts/migrations/2-5-s2-backfill.ts
 *
 * Environment:
 *   SUPABASE_URL                       — required
 *   SUPABASE_SERVICE_ROLE_KEY          — required
 *   ENVELOPE_ENCRYPTION_MASTER_KEY     — optional (NOOP cipher when absent)
 */
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  decryptField,
  encryptField,
  normalizedHash,
} from '../../apps/api/src/lib/envelope-encryption.js';
import { getHouseholdDek } from '../../apps/api/src/lib/household-key.js';

const CULTURAL_PRIORS_KEY_CHECK_SET = new Set([
  'halal',
  'kosher',
  'hindu_vegetarian',
  'south_asian',
  'east_african',
  'caribbean',
]);

interface HouseholdRow {
  id: string;
  cultural_identifiers: string | null;
}

interface ChildRow {
  id: string;
  household_id: string;
  declared_allergens: string | null;
  dietary_preferences: string | null;
  cultural_identifiers: string | null;
}

interface Counters {
  allergens_inserted: number;
  allergens_skipped: number;
  dietary_inserted: number;
  dietary_skipped: number;
  cultural_inserted: number;
  cultural_skipped: number;
  cultural_unmappable: number;
  households_processed: number;
  errors: number;
}

function newCounters(): Counters {
  return {
    allergens_inserted: 0,
    allergens_skipped: 0,
    dietary_inserted: 0,
    dietary_skipped: 0,
    cultural_inserted: 0,
    cultural_skipped: 0,
    cultural_unmappable: 0,
    households_processed: 0,
    errors: 0,
  };
}

function logErr(msg: string, ctx: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.error(`[2.5-s2-backfill] ${msg}`, ctx);
}

function logInfo(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[2.5-s2-backfill] ${msg}`);
}

function deriveKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function safeDecryptArray(
  ciphertext: string | null,
  dek: Buffer | null,
  ctx: Record<string, unknown>,
  counters: Counters,
): string[] {
  if (ciphertext === null) return [];
  try {
    const parsed = decryptField<unknown>(ciphertext, dek);
    if (!Array.isArray(parsed)) {
      counters.errors += 1;
      logErr('decrypt produced non-array JSON — treating as empty', { ...ctx, type: typeof parsed });
      return [];
    }
    return parsed.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  } catch (err) {
    counters.errors += 1;
    logErr('decrypt failed — treating as empty', { ...ctx, err: String(err) });
    return [];
  }
}

async function backfillChildAllergens(
  supabase: SupabaseClient,
  child: ChildRow,
  dek: Buffer | null,
  counters: Counters,
): Promise<void> {
  const allergens = safeDecryptArray(child.declared_allergens, dek, {
    pass: 'child_allergens',
    household_id: child.household_id,
    child_id: child.id,
  }, counters);
  if (allergens.length === 0) return;

  for (const raw of allergens) {
    const allergen = raw.trim();
    if (allergen.length === 0) continue;
    const hash = normalizedHash(allergen);

    const { data: existing, error: probeErr } = await supabase
      .from('child_allergens')
      .select('id')
      .eq('child_id', child.id)
      .eq('allergen_hash', hash)
      .limit(1)
      .maybeSingle();
    if (probeErr) {
      counters.errors += 1;
      logErr('probe failed for child_allergens', {
        household_id: child.household_id,
        child_id: child.id,
        allergen,
        err: String(probeErr.message ?? probeErr),
      });
      continue;
    }
    if (existing !== null) {
      counters.allergens_skipped += 1;
      continue;
    }

    const ciphertext = encryptField(allergen, dek);
    const { error: insErr } = await supabase.from('child_allergens').insert({
      household_id: child.household_id,
      child_id: child.id,
      allergen: ciphertext,
      allergen_hash: hash,
      source: 'backfill_migration',
    });
    if (insErr) {
      const code = (insErr as { code?: string }).code;
      if (code === '23505') {
        counters.allergens_skipped += 1;
        continue;
      }
      counters.errors += 1;
      logErr('insert failed for child_allergens', {
        household_id: child.household_id,
        child_id: child.id,
        allergen,
        err: String(insErr.message ?? insErr),
      });
      continue;
    }
    counters.allergens_inserted += 1;
  }
}

async function backfillChildDietary(
  supabase: SupabaseClient,
  child: ChildRow,
  dek: Buffer | null,
  counters: Counters,
): Promise<void> {
  const tags = safeDecryptArray(child.dietary_preferences, dek, {
    pass: 'dietary_preferences',
    household_id: child.household_id,
    child_id: child.id,
  }, counters);
  if (tags.length === 0) return;

  const unique = Array.from(new Set(tags.map((t) => t.trim()).filter((t) => t.length > 0)));
  for (const tag of unique) {
    const { error: insErr } = await supabase.from('dietary_preferences').insert({
      household_id: child.household_id,
      child_id: child.id,
      tag,
      enforcement: 'default',
      source: 'backfill_migration',
    });
    if (insErr) {
      const code = (insErr as { code?: string }).code;
      if (code === '23505') {
        counters.dietary_skipped += 1;
        continue;
      }
      counters.errors += 1;
      logErr('insert failed for dietary_preferences', {
        household_id: child.household_id,
        child_id: child.id,
        tag,
        err: String(insErr.message ?? insErr),
      });
      continue;
    }
    counters.dietary_inserted += 1;
  }
}

async function backfillCultural(
  supabase: SupabaseClient,
  household_id: string,
  tags: string[],
  tier: 'L1' | 'L2',
  confidence: number,
  presence: number,
  counters: Counters,
): Promise<void> {
  for (const raw of tags) {
    const key = deriveKey(raw);
    if (key.length === 0) continue;
    if (!CULTURAL_PRIORS_KEY_CHECK_SET.has(key)) {
      counters.cultural_unmappable += 1;
      continue;
    }

    const { error: insErr } = await supabase.from('cultural_priors').insert({
      household_id,
      key,
      label: raw.slice(0, 128),
      state: 'suggested',
      tier,
      presence,
      confidence,
      enforcement: 'just_for_context',
    });
    if (insErr) {
      const code = (insErr as { code?: string }).code;
      if (code === '23505') {
        counters.cultural_skipped += 1;
        continue;
      }
      counters.errors += 1;
      logErr('insert failed for cultural_priors', {
        household_id,
        key,
        tier,
        err: String(insErr.message ?? insErr),
      });
      continue;
    }
    counters.cultural_inserted += 1;
  }
}

async function processHousehold(
  supabase: SupabaseClient,
  kek: Buffer | null,
  household: HouseholdRow,
  counters: Counters,
): Promise<void> {
  let dek: Buffer | null;
  try {
    dek = await getHouseholdDek(supabase, kek, household.id);
  } catch (err) {
    counters.errors += 1;
    logErr('getHouseholdDek failed', { household_id: household.id, err: String(err) });
    return;
  }

  const { data: childRows, error: childErr } = await supabase
    .from('children')
    .select('id, household_id, declared_allergens, dietary_preferences, cultural_identifiers')
    .eq('household_id', household.id);
  if (childErr) {
    counters.errors += 1;
    logErr('children fetch failed', {
      household_id: household.id,
      err: String(childErr.message ?? childErr),
    });
    return;
  }
  const children = (childRows ?? []) as ChildRow[];

  for (const child of children) {
    await backfillChildAllergens(supabase, child, dek, counters);
    await backfillChildDietary(supabase, child, dek, counters);
    const tags = safeDecryptArray(child.cultural_identifiers, dek, {
      pass: 'child_cultural_identifiers',
      household_id: child.household_id,
      child_id: child.id,
    }, counters);
    await backfillCultural(supabase, child.household_id, tags, 'L2', 80, 70, counters);
  }

  const householdTags = safeDecryptArray(household.cultural_identifiers, dek, {
    pass: 'household_cultural_identifiers',
    household_id: household.id,
  }, counters);
  await backfillCultural(supabase, household.id, householdTags, 'L1', 90, 70, counters);

  counters.households_processed += 1;
}

interface SqlMigrationCounts {
  culturalRhythmBackfilled: number;
  softForgottenCulturalRhythm: number;
  softForgottenProseTypes: number;
}

async function querySqlMigrationCounts(supabase: SupabaseClient): Promise<SqlMigrationCounts> {
  const result: SqlMigrationCounts = {
    culturalRhythmBackfilled: 0,
    softForgottenCulturalRhythm: 0,
    softForgottenProseTypes: 0,
  };
  try {
    const { data, error } = await supabase
      .from('memory_provenance')
      .select('source_ref')
      .eq('source_type', 'import');
    if (error || !data) return result;
    for (const row of data) {
      const ref = row.source_ref as Record<string, string>;
      if (ref['migration'] !== '2.5-s2') continue;
      if (ref['target_table'] === 'cultural_priors') {
        result.culturalRhythmBackfilled += 1;
      } else if (ref['action'] === 'soft_forget_no_backfill_target') {
        const reason = ref['reason'] ?? '';
        if (reason === 'cultural_rhythm_key_not_in_check_set') {
          result.softForgottenCulturalRhythm += 1;
        } else {
          result.softForgottenProseTypes += 1;
        }
      }
    }
  } catch {
    // non-fatal: summary will show 0 counts with a note to query manually
    logErr('querySqlMigrationCounts failed — memory_nodes counts will show 0', {});
  }
  return result;
}

async function main(): Promise<void> {
  const url = process.env['SUPABASE_URL'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }

  const kekHex = process.env['ENVELOPE_ENCRYPTION_MASTER_KEY'];
  const kek = kekHex && kekHex.length > 0 ? Buffer.from(kekHex, 'hex') : null;
  if (kek === null) {
    logInfo(
      'ENVELOPE_ENCRYPTION_MASTER_KEY is unset (or empty) — backfill will use the NOOP cipher (dev path).',
    );
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const counters = newCounters();

  const BATCH_SIZE = 500;
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('households')
      .select('id, cultural_identifiers')
      .range(offset, offset + BATCH_SIZE - 1);
    if (error) {
      throw new Error(`households fetch failed: ${String(error.message ?? error)}`);
    }
    const page = (data ?? []) as HouseholdRow[];
    for (const h of page) {
      await processHousehold(supabase, kek, h, counters);
    }
    if (page.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  if (counters.households_processed === 0) {
    logErr(
      'WARNING: no households were processed — verify SUPABASE_URL points to the correct environment and the service role has read access to the households table',
      {},
    );
  }

  const sqlCounts = await querySqlMigrationCounts(supabase);

  // eslint-disable-next-line no-console
  console.log(
    [
      '2.5-s2 backfill complete',
      `  households processed: ${String(counters.households_processed)}`,
      `  child_allergens inserted: ${String(counters.allergens_inserted)}  (skipped: ${String(counters.allergens_skipped)})`,
      `  dietary_preferences inserted: ${String(counters.dietary_inserted)}  (skipped: ${String(counters.dietary_skipped)})`,
      `  cultural_priors inserted: ${String(counters.cultural_inserted)}  (skipped: ${String(counters.cultural_skipped)}, unmappable: ${String(counters.cultural_unmappable)})`,
      `  memory_nodes cultural_rhythm backfilled: ${String(sqlCounts.culturalRhythmBackfilled)}`,
      `  memory_nodes soft-forgotten (cultural_rhythm): ${String(sqlCounts.softForgottenCulturalRhythm)}`,
      `  memory_nodes soft-forgotten (preference|allergy|school_policy): ${String(sqlCounts.softForgottenProseTypes)}`,
      `  errors: ${String(counters.errors)}  (see stderr for details)`,
    ].join('\n'),
  );

  process.exit(counters.errors > 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  logErr('fatal', { err: String(err) });
  process.exit(1);
});
