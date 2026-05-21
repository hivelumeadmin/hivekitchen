import type { Buffer } from 'node:buffer';
import type { SupabaseClient } from '@supabase/supabase-js';
import { encryptField, normalizedHash } from '../../lib/envelope-encryption.js';
import { getOrCreateHouseholdDek } from '../../lib/household-key.js';

// Slice 2.5-s7 — Household-wide rules with two-path idempotency:
//   - Non-custom rules: UNIQUE (household_id, rule_type) WHERE rule_type <> 'custom'
//   - Custom rules:     UNIQUE (household_id, custom_label_hash) WHERE rule_type = 'custom'
//
// `custom_label` is AES-256-GCM ciphertext under the household DEK; the
// `custom_label_hash` is SHA-256(lower(trim(plaintext))). Both must be NULL
// on non-custom rules (CHECK constraint at the DB layer).
//
// Partial-index onConflict can be refused by PostgREST/Supabase (42P10);
// the fallback mirrors DietaryPreferencesRepository's pattern.

const UNIQUE_VIOLATION_CODE = '23505';
const NO_UNIQUE_CONSTRAINT_CODE = '42P10';

function pgErrorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

export type RuleType =
  | 'no_pork'
  | 'no_alcohol'
  | 'no_beef'
  | 'no_overnight_leftovers'
  | 'no_microwave_at_school'
  | 'custom';

interface BaseRow {
  household_id: string;
  rule_type: RuleType;
  custom_label: string | null;
  custom_label_hash: string | null;
  enforcement: string;
  source: string;
  updated_at: string;
}

export class HouseholdRulesRepository {
  constructor(
    private readonly client: SupabaseClient,
    private readonly kek: Buffer | null,
  ) {}

  async declare(
    householdId: string,
    ruleType: RuleType,
    customLabel: string | null,
    enforcement: string,
    source: string,
  ): Promise<{ household_rule_id: string; was_existing: boolean }> {
    if (ruleType === 'custom') {
      if (customLabel === null || customLabel.length === 0) {
        throw new Error('household_rules.declare: custom rules require a custom_label');
      }
    } else if (customLabel !== null) {
      throw new Error(
        `household_rules.declare: non-custom rule_type '${ruleType}' must not carry a custom_label`,
      );
    }

    let customLabelCipher: string | null = null;
    let customLabelHash: string | null = null;
    if (ruleType === 'custom' && customLabel !== null) {
      const dek = await getOrCreateHouseholdDek(this.client, this.kek, householdId);
      customLabelCipher = encryptField(customLabel, dek);
      customLabelHash = normalizedHash(customLabel);
    }

    const baseRow: BaseRow = {
      household_id: householdId,
      rule_type: ruleType,
      custom_label: customLabelCipher,
      custom_label_hash: customLabelHash,
      enforcement,
      source,
      updated_at: new Date().toISOString(),
    };

    if (ruleType !== 'custom') {
      return this.upsertOrFallback(baseRow, 'household_id,rule_type', 'rule_type');
    }
    return this.upsertOrFallback(baseRow, 'household_id,custom_label_hash', 'custom_label_hash');
  }

  private async upsertOrFallback(
    baseRow: BaseRow,
    onConflict: string,
    fallbackKey: 'rule_type' | 'custom_label_hash',
  ): Promise<{ household_rule_id: string; was_existing: boolean }> {
    const { data, error } = await this.client
      .from('household_rules')
      .upsert(baseRow, { onConflict, ignoreDuplicates: false })
      .select('id, created_at, updated_at')
      .maybeSingle();

    if (error === null || error === undefined) {
      if (data === null) {
        throw new Error('household_rules.declare: no row returned');
      }
      const row = data as { id: string; created_at: string; updated_at: string };
      const was_existing =
        Math.abs(new Date(row.updated_at).getTime() - new Date(row.created_at).getTime()) > 1000;
      return { household_rule_id: row.id, was_existing };
    }

    if (pgErrorCode(error) !== NO_UNIQUE_CONSTRAINT_CODE) {
      throw new Error(
        `household_rules.declare: ${(error as { message?: string }).message ?? 'unknown error'}`,
      );
    }
    return this.declareViaInsertFallback(baseRow, fallbackKey);
  }

  private async declareViaInsertFallback(
    baseRow: BaseRow,
    fallbackKey: 'rule_type' | 'custom_label_hash',
  ): Promise<{ household_rule_id: string; was_existing: boolean }> {
    const { data: inserted, error: insertErr } = await this.client
      .from('household_rules')
      .insert(baseRow)
      .select('id')
      .maybeSingle();

    if (insertErr === null || insertErr === undefined) {
      if (inserted === null) {
        throw new Error('household_rules.declare: insert returned no row');
      }
      return {
        household_rule_id: (inserted as { id: string }).id,
        was_existing: false,
      };
    }

    if (pgErrorCode(insertErr) !== UNIQUE_VIOLATION_CODE) {
      throw new Error(
        `household_rules.declare: ${(insertErr as { message?: string }).message ?? 'unknown error'}`,
      );
    }

    const fallbackValue = baseRow[fallbackKey];
    if (fallbackValue === null) {
      throw new Error(
        `household_rules.declare: fallback key ${fallbackKey} is null — should not be reachable`,
      );
    }
    const { data: existing, error: selectErr } = await this.client
      .from('household_rules')
      .select('id')
      .eq('household_id', baseRow.household_id)
      .eq(fallbackKey, fallbackValue as string)
      .maybeSingle();

    if (selectErr !== null && selectErr !== undefined) {
      throw new Error(
        `household_rules.declare: ${(selectErr as { message?: string }).message ?? 'unknown error'}`,
      );
    }
    if (existing === null) {
      throw new Error('household_rules.declare: conflict claimed but no row found');
    }
    const existingId = (existing as { id: string }).id;

    // Refresh enforcement/source on the existing row so a re-declare with
    // stronger enforcement (e.g. soft → non_negotiable) is reflected.
    await this.client
      .from('household_rules')
      .update({
        enforcement: baseRow.enforcement,
        source: baseRow.source,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingId);

    return { household_rule_id: existingId, was_existing: true };
  }
}
