import type { Buffer } from 'node:buffer';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AppetiteLevel,
  BagCompositionPattern,
  SpiceTolerance,
  TextureNeeds,
} from '@hivekitchen/types';
import { BaseRepository } from '../../repository/base.repository.js';
import { getHouseholdDek, getOrCreateHouseholdDek } from '../../lib/household-key.js';
import { bagCompositionFromPattern } from '@hivekitchen/contracts';
import type { ChildAllergensRepository } from './child-allergens.repository.js';
import { HouseholdCulturalIdentifiersRepository } from '../households/household-cultural-identifiers.repository.js';

export interface InsertChildParams {
  household_id: string;
  name: string;
  age_band: 'toddler' | 'child' | 'preteen' | 'teen';
  school_policy_notes: string | null;
  declared_allergens: string[];
  cultural_identifiers: string[];
  dietary_preferences: string[];
  bag_composition_pattern?: BagCompositionPattern | undefined;
  // Story 3-DM-B1 — variation-driving attributes. Optional on insert so
  // pre-3-DM-B1 callers compile unchanged; DB defaults supply 'normal' /
  // 'normal' / 'mild' when omitted.
  appetite_level?: AppetiteLevel;
  texture_needs?: TextureNeeds;
  spice_tolerance?: SpiceTolerance;
}

// Story 3-DM-B1: BagComposition is now a DERIVED view from
// bag_composition_pattern. The storage layer no longer carries the booleans;
// any path that needs them calls `bagCompositionFromPattern()` from
// @hivekitchen/contracts. The interface is kept for the planner / kitchen-map
// projection which still consumes the boolean struct.
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
  // Story 3-DM-B1 — variation-driving attributes (NOT NULL columns post-migration).
  appetite_level: AppetiteLevel;
  texture_needs: TextureNeeds;
  spice_tolerance: SpiceTolerance;
  // Story 3-DM-B1 — promoted enum, NOT NULL post-migration.
  bag_composition_pattern: BagCompositionPattern;
  created_at: string;
}

interface ChildRow {
  id: string;
  household_id: string;
  name: string;
  age_band: 'toddler' | 'child' | 'preteen' | 'teen';
  school_policy_notes: string | null;
  appetite_level: AppetiteLevel;
  texture_needs: TextureNeeds;
  spice_tolerance: SpiceTolerance;
  bag_composition_pattern: BagCompositionPattern;
  created_at: string;
}

const CHILD_COLUMNS =
  // Story 3-DM-B2 — the three encrypted JSONB columns (declared_allergens,
  // cultural_identifiers, dietary_preferences) are dropped. Per-child
  // allergens come from household_allergens via ChildAllergensRepository;
  // per-child cultural/dietary identity is intentionally not tracked at the
  // child row level (canonical §5: those are household-shared in the model).
  'id, household_id, name, age_band, school_policy_notes, appetite_level, texture_needs, spice_tolerance, bag_composition_pattern, created_at';

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
    // Story 3-DM-B2 — the three encrypted JSONB columns on `children` are
    // dropped. Per-child allergens live in household_allergens (via the
    // ChildAllergensRepository adapter). cultural_identifiers and
    // dietary_preferences are canonical-model household-scoped: the inputs
    // are routed to `household_cultural_identifiers` + `dietary_preferences`
    // (child_id=NULL). The response overlays both back from those tables so
    // the REST round-trip is preserved.
    const insertRow: Record<string, unknown> = {
      household_id: params.household_id,
      name: params.name,
      age_band: params.age_band,
      school_policy_notes: params.school_policy_notes,
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
    await this.writeHouseholdScopedTags(
      params.household_id,
      params.cultural_identifiers,
      params.dietary_preferences,
      'onboarding_declared',
    );
    const decoded = this.decodeRow(row);
    const householdTags = await this.readHouseholdScopedTags(params.household_id);
    return {
      ...decoded,
      declared_allergens: [...params.declared_allergens],
      cultural_identifiers: householdTags.cultural_identifiers,
      dietary_preferences: householdTags.dietary_preferences,
    };
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
    const decoded = this.decodeRow(data as ChildRow);
    const [allergenRows, householdTags] = await Promise.all([
      this.childAllergensRepo.findByHousehold(householdId),
      this.readHouseholdScopedTags(householdId),
    ]);
    const allergens = allergenRows
      .filter((r) => r.child_id === childId)
      .map((r) => r.allergen);
    return {
      ...decoded,
      declared_allergens: allergens,
      cultural_identifiers: householdTags.cultural_identifiers,
      dietary_preferences: householdTags.dietary_preferences,
    };
  }

  async findByHouseholdId(householdId: string): Promise<DecryptedChildRow[]> {
    const { data, error } = await this.client
      .from('children')
      .select(CHILD_COLUMNS)
      .eq('household_id', householdId);
    if (error) throw error;
    const rows = (data as ChildRow[] | null) ?? [];
    if (rows.length === 0) return [];
    const [allergenRows, householdTags] = await Promise.all([
      this.childAllergensRepo.findByHousehold(householdId),
      this.readHouseholdScopedTags(householdId),
    ]);
    const allergensByChild = new Map<string, string[]>();
    for (const r of allergenRows) {
      const list = allergensByChild.get(r.child_id) ?? [];
      list.push(r.allergen);
      allergensByChild.set(r.child_id, list);
    }
    return rows.map((r) => ({
      ...this.decodeRow(r),
      declared_allergens: allergensByChild.get(r.id) ?? [],
      cultural_identifiers: householdTags.cultural_identifiers,
      dietary_preferences: householdTags.dietary_preferences,
    }));
  }

  // Story 3.20 — lightweight read used by the plan-generation worker.
  // Skips envelope decryption because the planner only needs each child's
  // name + bag composition; allergens / cultural identifiers travel through
  // the allergy guardrail and cultural-prior services on a separate path.
  //
  // Story 3-DM-B1: bag_composition jsonb is dropped. We read the canonical
  // bag_composition_pattern enum and derive the boolean struct via the
  // shared contract helper so downstream callers (planner-context.loader,
  // catalog-seed.service) keep their current shape.
  async findBagCompositionsByHousehold(
    householdId: string,
  ): Promise<Array<{ child_id: string; name: string; bag_composition: BagComposition }>> {
    const { data, error } = await this.client
      .from('children')
      .select('id, name, bag_composition_pattern')
      .eq('household_id', householdId);
    if (error) throw error;
    type Row = { id: string; name: string; bag_composition_pattern: BagCompositionPattern };
    return ((data as Row[] | null) ?? []).map((row) => ({
      child_id: row.id,
      name: row.name,
      bag_composition: bagCompositionFromPattern(row.bag_composition_pattern),
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
    // Story 3-DM-B2 — encrypted children columns dropped. cultural_identifiers
    // / dietary_preferences params are accepted for API compatibility but no
    // longer persisted on the child row (canonical §5 — household-scoped).
    const updateRow: Record<string, unknown> = {
      name: params.name,
      age_band: params.age_band,
      school_policy_notes: params.school_policy_notes,
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
    // Replace semantics: wipe existing per-child allergen rows then re-declare
    // the incoming set. Without the delete, removing an allergen from the UI
    // would have no effect.
    await this.childAllergensRepo.deleteByChild(params.household_id, params.id);
    for (const allergen of params.declared_allergens) {
      await this.childAllergensRepo.declareIfNew(
        params.household_id,
        params.id,
        allergen,
        'parent_edited',
      );
    }
    await this.writeHouseholdScopedTags(
      params.household_id,
      params.cultural_identifiers,
      params.dietary_preferences,
      'parent_edited',
    );
    const decoded = this.decodeRow(data as ChildRow);
    const [allergenRows, householdTags] = await Promise.all([
      this.childAllergensRepo.findByHousehold(params.household_id),
      this.readHouseholdScopedTags(params.household_id),
    ]);
    const allergens = allergenRows
      .filter((r) => r.child_id === params.id)
      .map((r) => r.allergen);
    return {
      ...decoded,
      declared_allergens: allergens,
      cultural_identifiers: householdTags.cultural_identifiers,
      dietary_preferences: householdTags.dietary_preferences,
    };
  }

  async updateBagComposition(
    id: string,
    householdId: string,
    composition: { snack: boolean; extra: boolean },
  ): Promise<DecryptedChildRow | null> {
    const pattern: BagCompositionPattern =
      composition.snack && composition.extra
        ? 'main_plus_snack_plus_extra'
        : composition.snack
          ? 'main_plus_snack'
          : composition.extra
            ? 'main_plus_extra'
            : 'main_only';
    const { data, error } = await this.client
      .from('children')
      .update({ bag_composition_pattern: pattern, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('household_id', householdId)
      .select(CHILD_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    if (data === null) return null;
    const decoded = this.decodeRow(data as ChildRow);
    const [allergenRows, householdTags] = await Promise.all([
      this.childAllergensRepo.findByHousehold(householdId),
      this.readHouseholdScopedTags(householdId),
    ]);
    const allergens = allergenRows.filter((r) => r.child_id === id).map((r) => r.allergen);
    return {
      ...decoded,
      declared_allergens: allergens,
      cultural_identifiers: householdTags.cultural_identifiers,
      dietary_preferences: householdTags.dietary_preferences,
    };
  }

  // Story 3-DM-B2 — cultural / dietary inputs from per-child writes route to
  // household-scoped tables (canonical §5 model).
  // parent_edited → replace semantics: the submitted list is the complete
  //   intended household state; removed tags must disappear.
  // onboarding_declared → additive: multiple children may contribute tags to
  //   the shared household identity across separate insert() calls.
  private async writeHouseholdScopedTags(
    householdId: string,
    culturalTags: readonly string[],
    dietaryTags: readonly string[],
    source: 'onboarding_declared' | 'parent_edited',
  ): Promise<void> {
    const culturalRepo = new HouseholdCulturalIdentifiersRepository(this.client);
    if (source === 'parent_edited') {
      await culturalRepo.replaceSet({ household_id: householdId, tags: culturalTags, source });
      const { error: delErr } = await this.client
        .from('dietary_preferences')
        .delete()
        .eq('household_id', householdId)
        .is('child_id', null);
      if (delErr) throw delErr;
      if (dietaryTags.length > 0) {
        const rows = dietaryTags.map((tag) => ({
          household_id: householdId,
          child_id: null,
          tag,
          source,
          updated_at: new Date().toISOString(),
        }));
        const { error } = await this.client
          .from('dietary_preferences')
          .upsert(rows, { onConflict: 'household_id,tag', ignoreDuplicates: true });
        if (error) throw error;
      }
    } else {
      if (culturalTags.length > 0) {
        await culturalRepo.upsertSet({ household_id: householdId, tags: culturalTags, source });
      }
      if (dietaryTags.length > 0) {
        const rows = dietaryTags.map((tag) => ({
          household_id: householdId,
          child_id: null,
          tag,
          source,
          updated_at: new Date().toISOString(),
        }));
        const { error } = await this.client
          .from('dietary_preferences')
          .upsert(rows, { onConflict: 'household_id,tag', ignoreDuplicates: true });
        if (error) throw error;
      }
    }
  }

  private async readHouseholdScopedTags(
    householdId: string,
  ): Promise<{ cultural_identifiers: string[]; dietary_preferences: string[] }> {
    const culturalRepo = new HouseholdCulturalIdentifiersRepository(this.client);
    const [culturalTags, dietaryRes] = await Promise.all([
      culturalRepo.listTags(householdId),
      this.client
        .from('dietary_preferences')
        .select('tag')
        .eq('household_id', householdId)
        .is('child_id', null),
    ]);
    if (dietaryRes.error) throw dietaryRes.error;
    const dietaryTags = ((dietaryRes.data ?? []) as Array<{ tag: string }>).map(
      (r) => r.tag,
    );
    return { cultural_identifiers: culturalTags, dietary_preferences: dietaryTags };
  }

  private decodeRow(row: ChildRow): DecryptedChildRow {
    return {
      id: row.id,
      household_id: row.household_id,
      name: row.name,
      age_band: row.age_band,
      school_policy_notes: row.school_policy_notes,
      // Story 3-DM-B2 — encrypted JSONB columns dropped. Caller overlays
      // declared_allergens from household_allergens. cultural_identifiers
      // and dietary_preferences are not modeled at the child row level
      // (canonical §5); always emit [].
      declared_allergens: [],
      cultural_identifiers: [],
      dietary_preferences: [],
      appetite_level: row.appetite_level,
      texture_needs: row.texture_needs,
      spice_tolerance: row.spice_tolerance,
      bag_composition_pattern: row.bag_composition_pattern,
      created_at: row.created_at,
    };
  }
}

