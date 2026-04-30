import type { Buffer } from 'node:buffer';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository } from '../../repository/base.repository.js';
import { decryptField, encryptField } from '../../lib/envelope-encryption.js';
import { getHouseholdDek, getOrCreateHouseholdDek } from '../../lib/household-key.js';

export interface InsertChildParams {
  household_id: string;
  name: string;
  age_band: 'toddler' | 'child' | 'preteen' | 'teen';
  school_policy_notes: string | null;
  declared_allergens: string[];
  cultural_identifiers: string[];
  dietary_preferences: string[];
}

export interface BagComposition {
  main: true;
  snack: boolean;
  extra: boolean;
}

export interface DecryptedChildRow {
  id: string;
  household_id: string;
  name: string;
  age_band: 'toddler' | 'child' | 'preteen' | 'teen';
  school_policy_notes: string | null;
  declared_allergens: string[];
  cultural_identifiers: string[];
  dietary_preferences: string[];
  allergen_rule_version: string;
  bag_composition: BagComposition;
  created_at: string;
}

// PostgREST returns JSONB columns as already-parsed JS values, so
// bag_composition is typed as the structured object — not a string. The DB
// CHECK constraint guarantees main=true on every row, but we still narrow it
// defensively in decryptRow rather than asserting.
type RawBagComposition =
  | { main?: unknown; snack?: unknown; extra?: unknown }
  | string
  | null;

interface ChildRow {
  id: string;
  household_id: string;
  name: string;
  age_band: 'toddler' | 'child' | 'preteen' | 'teen';
  school_policy_notes: string | null;
  declared_allergens: string;
  cultural_identifiers: string;
  dietary_preferences: string;
  allergen_rule_version: string;
  bag_composition: RawBagComposition;
  created_at: string;
}

const CHILD_COLUMNS =
  'id, household_id, name, age_band, school_policy_notes, declared_allergens, cultural_identifiers, dietary_preferences, allergen_rule_version, bag_composition, created_at';

interface RepositoryLogger {
  error: (obj: Record<string, unknown>, msg: string) => void;
}

export class ChildrenRepository extends BaseRepository {
  constructor(
    client: SupabaseClient,
    private readonly kek: Buffer | null,
    private readonly log: RepositoryLogger,
  ) {
    super(client);
  }

  async getOrCreateHouseholdDek(householdId: string): Promise<Buffer | null> {
    return getOrCreateHouseholdDek(this.client, this.kek, householdId);
  }

  async getHouseholdDek(householdId: string): Promise<Buffer | null> {
    return getHouseholdDek(this.client, this.kek, householdId);
  }

  async insert(params: InsertChildParams): Promise<DecryptedChildRow> {
    const dek = await this.getOrCreateHouseholdDek(params.household_id);
    const insertRow = {
      household_id: params.household_id,
      name: params.name,
      age_band: params.age_band,
      school_policy_notes: params.school_policy_notes,
      declared_allergens: encryptField(params.declared_allergens, dek),
      cultural_identifiers: encryptField(params.cultural_identifiers, dek),
      dietary_preferences: encryptField(params.dietary_preferences, dek),
    };
    const { data, error } = await this.client
      .from('children')
      .insert(insertRow)
      .select(CHILD_COLUMNS)
      .single();
    if (error) throw error;
    return this.decryptRow(data as ChildRow, dek);
  }

  async findById(householdId: string, childId: string): Promise<DecryptedChildRow | null> {
    const { data, error } = await this.client
      .from('children')
      .select(CHILD_COLUMNS)
      .eq('household_id', householdId)
      .eq('id', childId)
      .maybeSingle();
    if (error) throw error;
    if (data === null) return null;
    const dek = await this.getHouseholdDek(householdId);
    return this.decryptRow(data as ChildRow, dek);
  }

  async findByHouseholdId(householdId: string): Promise<DecryptedChildRow[]> {
    const { data, error } = await this.client
      .from('children')
      .select(CHILD_COLUMNS)
      .eq('household_id', householdId);
    if (error) throw error;
    const rows = (data as ChildRow[] | null) ?? [];
    if (rows.length === 0) return [];
    const dek = await this.getHouseholdDek(householdId);
    // Isolate per-row decryption: a single corrupt row (e.g. from a DEK race)
    // is skipped rather than crashing the entire household list.
    return rows.reduce<DecryptedChildRow[]>((acc, r) => {
      try {
        acc.push(this.decryptRow(r, dek));
      } catch {
        // Log child ID only — no ciphertext in logs.
        this.log.error({ childId: r.id }, 'failed to decrypt child row — row skipped');
      }
      return acc;
    }, []);
  }

  async updateBagComposition(
    id: string,
    householdId: string,
    composition: { snack: boolean; extra: boolean },
  ): Promise<DecryptedChildRow | null> {
    // Scope the update by both id and household_id so a token from a
    // different household cannot overwrite this row. Zero rows updated
    // collapses to null and the caller raises 403.
    const next: BagComposition = {
      main: true,
      snack: composition.snack,
      extra: composition.extra,
    };
    const { data, error } = await this.client
      .from('children')
      .update({ bag_composition: next, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('household_id', householdId)
      .select(CHILD_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    if (data === null) return null;
    const dek = await this.getHouseholdDek(householdId);
    return this.decryptRow(data as ChildRow, dek);
  }

  private decryptRow(row: ChildRow, dek: Buffer | null): DecryptedChildRow {
    return {
      id: row.id,
      household_id: row.household_id,
      name: row.name,
      age_band: row.age_band,
      school_policy_notes: row.school_policy_notes,
      declared_allergens: decryptArrayField(row.declared_allergens, dek),
      cultural_identifiers: decryptArrayField(row.cultural_identifiers, dek),
      dietary_preferences: decryptArrayField(row.dietary_preferences, dek),
      allergen_rule_version: row.allergen_rule_version,
      bag_composition: parseBagComposition(row.bag_composition),
      created_at: row.created_at,
    };
  }
}

function decryptArrayField(value: string, dek: Buffer | null): string[] {
  return decryptField<string[]>(value, dek);
}

// PostgREST returns JSONB pre-parsed, but if a future driver or test fixture
// hands us a raw string we accept it. Defaults absorb a missing column
// (e.g. row written before the migration ran in a developer-local DB).
function parseBagComposition(raw: RawBagComposition): BagComposition {
  let parsed: unknown = raw ?? {};
  if (typeof raw === 'string') {
    parsed = JSON.parse(raw);
  }
  const obj: { main?: unknown; snack?: unknown; extra?: unknown } =
    typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as { main?: unknown; snack?: unknown; extra?: unknown })
      : {};
  return {
    main: true,
    snack: obj.snack === undefined ? true : Boolean(obj.snack),
    extra: obj.extra === undefined ? true : Boolean(obj.extra),
  };
}
