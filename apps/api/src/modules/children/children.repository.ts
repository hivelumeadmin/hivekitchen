import type { Buffer } from 'node:buffer';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BagCompositionPattern } from '@hivekitchen/types';
import { BaseRepository } from '../../repository/base.repository.js';
import { decryptField, encryptField } from '../../lib/envelope-encryption.js';
import { getHouseholdDek, getOrCreateHouseholdDek } from '../../lib/household-key.js';
import type { ChildAllergensRepository } from './child-allergens.repository.js';

export interface InsertChildParams {
  household_id: string;
  name: string;
  age_band: 'toddler' | 'child' | 'preteen' | 'teen';
  school_policy_notes: string | null;
  declared_allergens: string[];
  cultural_identifiers: string[];
  dietary_preferences: string[];
  bag_composition_pattern?: BagCompositionPattern | null | undefined;
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
  bag_composition_pattern: BagCompositionPattern | null;
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
  bag_composition_pattern: string | null;
  created_at: string;
}

const CHILD_COLUMNS =
  'id, household_id, name, age_band, school_policy_notes, declared_allergens, cultural_identifiers, dietary_preferences, allergen_rule_version, bag_composition, bag_composition_pattern, created_at';

interface RepositoryLogger {
  error: (obj: Record<string, unknown>, msg: string) => void;
}

export class ChildrenRepository extends BaseRepository {
  // Slice 2.6-s8 — declared_allergens reads + writes now route through the
  // structured child_allergens table. The legacy children.declared_allergens
  // column is written as encryptField([], dek) for column-shape parity and
  // is no longer read by the response shape. childAllergensRepo is required
  // (not nullable) so the cutover is enforced — every caller wiring up the
  // repository must wire it.
  constructor(
    client: SupabaseClient,
    private readonly kek: Buffer | null,
    private readonly log: RepositoryLogger,
    private readonly childAllergensRepo: ChildAllergensRepository,
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
    // Slice 2.6-s8 — legacy column is written as an encrypted empty array
    // for column-shape parity; the canonical store is `child_allergens`.
    const insertRow: Record<string, unknown> = {
      household_id: params.household_id,
      name: params.name,
      age_band: params.age_band,
      school_policy_notes: params.school_policy_notes,
      declared_allergens: encryptField([], dek),
      cultural_identifiers: encryptField(params.cultural_identifiers, dek),
      dietary_preferences: encryptField(params.dietary_preferences, dek),
    };
    if (params.bag_composition_pattern !== undefined) {
      insertRow.bag_composition_pattern = params.bag_composition_pattern;
    }
    const { data, error } = await this.client
      .from('children')
      .insert(insertRow)
      .select(CHILD_COLUMNS)
      .single();
    if (error) throw error;
    const row = data as ChildRow;
    for (const allergen of params.declared_allergens) {
      await this.childAllergensRepo.declareIfNew(
        params.household_id,
        row.id,
        allergen,
        'onboarding_declared',
      );
    }
    const decoded = this.decryptRow(row, dek);
    // Surface the just-declared allergens on the response so callers (REST
    // POST /v1/households/:id/children) see what they posted without a
    // follow-up round-trip.
    return { ...decoded, declared_allergens: [...params.declared_allergens] };
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
    const decoded = this.decryptRow(data as ChildRow, dek);
    // Slice 2.6-s8 — overlay declared_allergens from child_allergens. The
    // legacy column decode is discarded.
    const allergenRows = await this.childAllergensRepo.findByHousehold(householdId);
    const allergens = allergenRows
      .filter((r) => r.child_id === childId)
      .map((r) => r.allergen);
    return { ...decoded, declared_allergens: allergens };
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
    // Slice 2.6-s8 — fetch every child's allergens once and group by child_id;
    // the legacy column decode is discarded.
    const allergenRows = await this.childAllergensRepo.findByHousehold(householdId);
    const allergensByChild = new Map<string, string[]>();
    for (const r of allergenRows) {
      const list = allergensByChild.get(r.child_id) ?? [];
      list.push(r.allergen);
      allergensByChild.set(r.child_id, list);
    }
    // Isolate per-row decryption: a single corrupt row (e.g. from a DEK race)
    // is skipped rather than crashing the entire household list.
    return rows.reduce<DecryptedChildRow[]>((acc, r) => {
      try {
        const decoded = this.decryptRow(r, dek);
        acc.push({
          ...decoded,
          declared_allergens: allergensByChild.get(r.id) ?? [],
        });
      } catch {
        // Log child ID only — no ciphertext in logs.
        this.log.error({ childId: r.id }, 'failed to decrypt child row — row skipped');
      }
      return acc;
    }, []);
  }

  // Story 3.20 — lightweight read used by the plan-generation worker.
  // Skips envelope decryption because the planner only needs each child's
  // name + bag composition; allergens / cultural identifiers travel through
  // the allergy guardrail and cultural-prior services on a separate path.
  async findBagCompositionsByHousehold(
    householdId: string,
  ): Promise<Array<{ child_id: string; name: string; bag_composition: BagComposition }>> {
    const { data, error } = await this.client
      .from('children')
      .select('id, name, bag_composition')
      .eq('household_id', householdId);
    if (error) throw error;
    type Row = { id: string; name: string; bag_composition: RawBagComposition };
    return ((data as Row[] | null) ?? []).map((row) => ({
      child_id: row.id,
      name: row.name,
      bag_composition: parseBagComposition(row.bag_composition),
    }));
  }

  // Story 3.27 — variant-eligible children for the planning week. Until Epic 4
  // ships real rating counts on lunch_link_sessions, this is a flat boolean
  // column on `children` flipped by ops / Lumi. Plain-text reads (no decrypt).
  async findVariantEligibleByHousehold(
    householdId: string,
  ): Promise<Array<{ child_id: string; name: string }>> {
    const { data, error } = await this.client
      .from('children')
      .select('id, name')
      .eq('household_id', householdId)
      .eq('variant_eligible', true);
    if (error) throw error;
    type Row = { id: string; name: string };
    return ((data as Row[] | null) ?? []).map((row) => ({
      child_id: row.id,
      name: row.name,
    }));
  }

  /**
   * Slice C — update the encrypted profile fields on an existing child.
   * Mirrors insert()'s encryption discipline. Used by ChildrenService.upsertByName
   * for the onboarding agent's idempotent child.upsert tool. Returns null
   * when no row matched (id + household_id pair was wrong).
   *
   * Slice 2.5-s8 — bag_composition_pattern is PATCH-merged into the row only
   * when explicitly provided. undefined keeps the column out of the UPDATE
   * statement entirely (preserves the existing value); an explicit value (or
   * null) writes the column. The (id, household_id) WHERE clause is the
   * cross-household safety guard — a token from a different household cannot
   * overwrite this row.
   */
  async updateProfile(params: {
    id: string;
    household_id: string;
    name: string;
    age_band: InsertChildParams['age_band'];
    school_policy_notes: string | null;
    declared_allergens: string[];
    cultural_identifiers: string[];
    dietary_preferences: string[];
    bag_composition_pattern?: BagCompositionPattern | null | undefined;
  }): Promise<DecryptedChildRow | null> {
    const dek = await this.getHouseholdDek(params.household_id);
    // Slice 2.6-s8 — legacy column always written as encrypted []. The actual
    // per-child allergen state lives in child_allergens; the update path adds
    // declared allergens with source='parent_edited' (per AC3) so subsequent
    // re-mentions by the agent are auditable separately from initial
    // onboarding declarations.
    const updateRow: Record<string, unknown> = {
      name: params.name,
      age_band: params.age_band,
      school_policy_notes: params.school_policy_notes,
      declared_allergens: encryptField([], dek),
      cultural_identifiers: encryptField(params.cultural_identifiers, dek),
      dietary_preferences: encryptField(params.dietary_preferences, dek),
      updated_at: new Date().toISOString(),
    };
    if (params.bag_composition_pattern !== undefined) {
      updateRow.bag_composition_pattern = params.bag_composition_pattern;
    }
    const { data, error } = await this.client
      .from('children')
      .update(updateRow)
      .eq('id', params.id)
      .eq('household_id', params.household_id)
      .select(CHILD_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    if (data === null) return null;
    // Replace semantics: wipe existing rows then re-declare the incoming set.
    // Without the delete, removing an allergen from the UI would have no effect.
    await this.childAllergensRepo.deleteByChild(params.household_id, params.id);
    for (const allergen of params.declared_allergens) {
      await this.childAllergensRepo.declareIfNew(
        params.household_id,
        params.id,
        allergen,
        'parent_edited',
      );
    }
    const decoded = this.decryptRow(data as ChildRow, dek);
    // Surface the union of pre-existing + just-declared allergens. Re-read
    // is the safest source of truth since declared_allergens here is the
    // incremental set the agent supplied, not the complete list.
    const allergenRows = await this.childAllergensRepo.findByHousehold(params.household_id);
    const allergens = allergenRows
      .filter((r) => r.child_id === params.id)
      .map((r) => r.allergen);
    return { ...decoded, declared_allergens: allergens };
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
    const decoded = this.decryptRow(data as ChildRow, dek);
    const allergenRows = await this.childAllergensRepo.findByHousehold(householdId);
    const allergens = allergenRows.filter((r) => r.child_id === id).map((r) => r.allergen);
    return { ...decoded, declared_allergens: allergens };
  }

  private decryptRow(row: ChildRow, dek: Buffer | null): DecryptedChildRow {
    return {
      id: row.id,
      household_id: row.household_id,
      name: row.name,
      age_band: row.age_band,
      school_policy_notes: row.school_policy_notes,
      // Slice 2.6-s8 — legacy children.declared_allergens column is no longer
      // a read source. The caller (insert / updateProfile / findById /
      // findByHouseholdId) overlays the canonical value from child_allergens
      // before returning. Always emit [] here; skipping the legacy decrypt
      // avoids a spurious failure mode if a pre-2.6-s8 row hasn't been
      // touched by the backfill yet.
      declared_allergens: [],
      cultural_identifiers: decryptArrayField(row.cultural_identifiers, dek),
      dietary_preferences: decryptArrayField(row.dietary_preferences, dek),
      allergen_rule_version: row.allergen_rule_version,
      bag_composition: parseBagComposition(row.bag_composition),
      bag_composition_pattern: (row.bag_composition_pattern as BagCompositionPattern | null) ?? null,
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
