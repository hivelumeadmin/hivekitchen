import type { Buffer } from 'node:buffer';
import type { FastifyBaseLogger } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BagCompositionPattern } from '@hivekitchen/types';
import { BaseRepository } from '../../repository/base.repository.js';
import { decryptField } from '../../lib/envelope-encryption.js';
import { getHouseholdDek } from '../../lib/household-key.js';

// ---------------------------------------------------------------------------
// Raw shape — what the repository returns. The composer maps this into the
// canonical KitchenMap projection.
// ---------------------------------------------------------------------------

interface RawHouseholdRow {
  id: string;
  tier: string;
  tier_variant: string;
  timezone: string;
  kitchen_map_version: number;
  // Slice 2.5-s1 — parent-chosen household label (nullable for mid-onboarding).
  display_name: string | null;
  // Slice 2-s27 — household-level food identity (cultural / dietary /
  // declared_allergens). These are projected for the composer AFTER
  // application-layer decryption — the columns on disk hold ciphertext.
  cultural_identifiers: string[];
  dietary_preferences: string[];
  declared_allergens: string[];
}

export interface RawCaregiverRow {
  user_id: string;
  role: 'primary_parent' | 'secondary_caregiver' | 'guest_author' | 'ops';
  display_name: string | null;
  cultural_language: string | null;
}

export interface RawChildRow {
  id: string;
  name: string; // decrypted by the repository
  age_band: 'toddler' | 'child' | 'preteen' | 'teen';
  declared_allergens: string[]; // decrypted from jsonb-ciphertext
  cultural_identifiers: string[];
  dietary_preferences: string[];
  // Story 3-DM-B1 — bag_composition booleans are derived in the composer from
  // bag_composition_pattern (the column post-B1). The raw row carries the enum
  // directly; downstream readers call bagCompositionFromPattern when they need
  // the boolean struct.
  bag_composition_pattern: BagCompositionPattern;
  extra_rules: { pins: string[]; bans: string[] };
}

export interface RawCulturalPriorRow {
  key: string;
  label: string;
  tier: 'L1' | 'L2' | 'L3';
  state: string; // state enum widened — composer validates against contract
  confidence: number;
  presence: number;
  // Slice 2.5-s1 — enforcement strength. Existing rows default to
  // 'just_for_context' per the migration; the composer falls back to that
  // value for any row with a missing/rogue enforcement.
  enforcement: string;
}

export interface RawMemoryNodeRow {
  node_type: string;
  facet: string;
  prose_text: string;
  subject_child_id: string | null;
}

export interface RawSchoolPolicyRow {
  child_id: string;
  policy_type: string;
  policy_description: string | null;
  slot_scope: 'bag_wide' | 'main' | 'snack' | 'extra';
}

interface RawExtraLibraryItemRow {
  id: string;
  name: string;
  component_type: string;
}

export interface RawFavouriteRecipeRow {
  recipe_id: string;
  canonical_name: string;
  primary_ingredient_key: string | null;
  cuisine_tags: string[];
  confidence_score: number;
  is_household_favorite: boolean;
  is_household_banned: boolean;
  // Slice 2.6-s1 — household-level catalog provenance from
  // household_recipe_usage.catalog_provenance. Surfaces into KitchenMap.recipes
  // entries AND drives the favorite_lunches projection (parent-stated rows
  // are the cold-start seed).
  catalog_provenance: string;
  use_count: number;
  last_used_at: string;
}

// ---- Slice 2.5-s1 — five new structured signal raw shapes ----------------

export interface RawAllergenRow {
  child_id: string;
  allergen: string; // decrypted by the repository
  source:
    | 'onboarding_declared'
    | 'memory_promoted'
    | 'vocabulary_inferred'
    | 'parent_edited'
    | 'backfill_migration';
}

export interface RawDietaryRow {
  child_id: string | null;
  tag: string;
  enforcement: string;
  source:
    | 'onboarding_declared'
    | 'vocabulary_inferred'
    | 'parent_edited'
    | 'backfill_migration';
}

export interface RawFoodPreferenceRow {
  child_id: string | null;
  item: string; // decrypted by the repository
  valence: 'loves' | 'likes' | 'neutral' | 'dislikes' | 'refuses';
  enforcement: string;
  source:
    | 'onboarding_declared'
    | 'memory_promoted'
    | 'rating_signal'
    | 'parent_edited'
    | 'backfill_migration';
}

export interface RawRuleRow {
  rule_type:
    | 'no_pork'
    | 'no_alcohol'
    | 'no_beef'
    | 'no_overnight_leftovers'
    | 'no_microwave_at_school'
    | 'custom';
  custom_label: string | null; // decrypted by the repository when present
  enforcement: string;
  source:
    | 'onboarding_declared'
    | 'memory_promoted'
    | 'parent_edited'
    | 'backfill_migration';
}

export interface RawKitchenMapData {
  household: RawHouseholdRow;
  caregivers: RawCaregiverRow[];
  children: RawChildRow[];
  cultural_priors: RawCulturalPriorRow[];
  memory_nodes: RawMemoryNodeRow[];
  school_policies: RawSchoolPolicyRow[];
  extra_library: RawExtraLibraryItemRow[];
  recipe_usage: RawFavouriteRecipeRow[];
  // Slice 2.5-s1 — five new top-level arrays. Empty for existing households
  // until the moment slices (2.5-s5+) start populating them.
  allergens: RawAllergenRow[];
  dietary: RawDietaryRow[];
  food_preferences: RawFoodPreferenceRow[];
  rules: RawRuleRow[];
}

// ---------------------------------------------------------------------------
// Raw DB row shapes (before decryption / projection)
// ---------------------------------------------------------------------------

interface EncryptedChildRow {
  id: string;
  name: string;
  age_band: 'toddler' | 'child' | 'preteen' | 'teen';
  bag_composition_pattern: BagCompositionPattern;
}

// Story 15-s5 — extra rules moved off `children` into child_extra_rules rows.
interface RawExtraRuleRow {
  child_id: string;
  rule: 'pin' | 'ban';
  component_type: string;
}

interface JoinedRecipeFields {
  canonical_name: string;
  primary_ingredient_key: string | null;
  cuisine_tags: string[];
}

interface UsageJoinRow {
  recipe_id: string;
  confidence_score: number;
  is_household_favorite: boolean;
  is_household_banned: boolean;
  // Slice 2.6-s1 — exposed for the favorite_lunches projection derivation.
  catalog_provenance: string;
  use_count: number;
  last_used_at: string;
  // PostgREST returns the joined relation as an array (or null) regardless
  // of cardinality. household_recipe_usage → recipes is many-to-one, so we
  // always take the first element when present.
  recipes: JoinedRecipeFields[] | JoinedRecipeFields | null;
}

interface EncryptedChildAllergenRow {
  child_id: string;
  allergen: string;
  source: RawAllergenRow['source'];
}

interface EncryptedFoodPreferenceRow {
  child_id: string | null;
  item: string;
  valence: RawFoodPreferenceRow['valence'];
  enforcement: string;
  source: RawFoodPreferenceRow['source'];
}

interface DietaryRow {
  child_id: string | null;
  tag: string;
  enforcement: string;
  source: RawDietaryRow['source'];
}

interface EncryptedHouseholdRuleRow {
  rule_type: RawRuleRow['rule_type'];
  custom_label: string | null;
  enforcement: string;
  source: RawRuleRow['source'];
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

const HOUSEHOLD_COLUMNS =
  'id, tier, tier_variant, timezone, kitchen_map_version, display_name';
const CAREGIVER_COLUMNS = 'id, role, display_name, cultural_language';
// Story 3-DM-B2 — declared_allergens, cultural_identifiers, dietary_preferences
// were dropped from children (migration 20261008000100); per-child values now
// come from household_allergens / household_cultural_identifiers /
// dietary_preferences satellite tables.
// Story 15-s5 — extra_rules dropped from children (migration 20261035000500);
// per-child pins/bans now come from the child_extra_rules satellite table.
const CHILD_COLUMNS = 'id, name, age_band, bag_composition_pattern';
const EXTRA_RULE_COLUMNS = 'child_id, rule, component_type';
const HOUSEHOLD_CULTURAL_COLUMNS = 'cultural_tag';
const HOUSEHOLD_ALLERGEN_COLUMNS = 'allergen, source';
const CULTURAL_PRIOR_COLUMNS = 'key, label, tier, state, confidence, presence, enforcement';
const MEMORY_COLUMNS = 'node_type, facet, prose_text, subject_child_id';
const SCHOOL_POLICY_COLUMNS = 'child_id, policy_type, policy_description, slot_scope';
const EXTRA_LIBRARY_COLUMNS = 'id, name, component_type';
// Slice 2.6-s1 — catalog_provenance added so the composer can derive both
// the recipes block AND the favorite_lunches projection from a single query.
const USAGE_JOIN_COLUMNS =
  'recipe_id, confidence_score, is_household_favorite, is_household_banned, catalog_provenance, use_count, last_used_at, recipes(canonical_name, primary_ingredient_key, cuisine_tags)';
const CHILD_ALLERGEN_COLUMNS = 'child_id, allergen, source';
const FOOD_PREFERENCE_COLUMNS = 'child_id, item, valence, enforcement, source';
const DIETARY_COLUMNS = 'child_id, tag, enforcement, source';
const HOUSEHOLD_RULE_COLUMNS = 'rule_type, custom_label, enforcement, source';

/**
 * Slice A0.5 — fans out parallel reads across every source table that
 * contributes to the Kitchen Map projection. Decrypts envelope-encrypted
 * child columns (name + the three jsonb tag arrays) using the household's
 * DEK so the composer sees plaintext.
 *
 * Slice 2.5-s1 — extended with five new satellite queries:
 *   child_allergens, food_preferences, dietary_preferences (the table —
 *   distinct from households.dietary_preferences column), favorite_lunches,
 *   household_rules.
 * Allergens, food preference items, favorite lunch items, and custom_label
 * are envelope-encrypted; the repository decrypts them inline.
 */
export class KitchenMapRepository extends BaseRepository {
  constructor(
    client: SupabaseClient,
    private readonly kek: Buffer | null,
    private readonly logger: FastifyBaseLogger,
  ) {
    super(client);
  }

  async loadRaw(householdId: string): Promise<RawKitchenMapData | null> {
    // Pre-fetch the DEK once so the children decryption pass doesn't
    // serialise multiple lookups.
    const dekPromise = getHouseholdDek(this.client, this.kek, householdId);

    const [
      householdRes,
      caregiversRes,
      childrenRes,
      culturalRes,
      memoryRes,
      schoolPoliciesRes,
      extraRulesRes,
      extraLibraryRes,
      usageRes,
      allergensRes,
      foodPreferencesRes,
      dietaryRes,
      rulesRes,
      householdCulturalRes,
      householdAllergensRes,
    ] = await Promise.all([
      this.client.from('households').select(HOUSEHOLD_COLUMNS).eq('id', householdId).maybeSingle(),
      this.client.from('users').select(CAREGIVER_COLUMNS).eq('current_household_id', householdId),
      this.client.from('children').select(CHILD_COLUMNS).eq('household_id', householdId),
      this.client.from('cultural_priors').select(CULTURAL_PRIOR_COLUMNS).eq('household_id', householdId),
      this.client
        .from('memory_nodes')
        .select(MEMORY_COLUMNS)
        .eq('household_id', householdId)
        .is('soft_forget_at', null)
        .eq('hard_forgotten', false),
      this.fetchSchoolPoliciesForHousehold(householdId),
      this.fetchExtraRulesForHousehold(householdId),
      this.client.from('extra_library').select(EXTRA_LIBRARY_COLUMNS).eq('household_id', householdId),
      // Slice 2.6-s1 — single source of truth: the favorite_lunches projection
      // is derived in the composer from these same usage rows. The standalone
      // favorite_lunches table is dropped (migration 20260908000200).
      this.client
        .from('household_recipe_usage')
        .select(USAGE_JOIN_COLUMNS)
        .eq('household_id', householdId),
      // Per-child allergens only; household-wide (child_id IS NULL) are in householdAllergensRes.
      this.client.from('household_allergens').select(CHILD_ALLERGEN_COLUMNS).eq('household_id', householdId).not('child_id', 'is', null),
      this.client.from('food_preferences').select(FOOD_PREFERENCE_COLUMNS).eq('household_id', householdId),
      this.client.from('dietary_preferences').select(DIETARY_COLUMNS).eq('household_id', householdId),
      this.client.from('household_rules').select(HOUSEHOLD_RULE_COLUMNS).eq('household_id', householdId),
      // Story 3-DM-B2 — household_cultural_identifiers replaces households.cultural_identifiers.
      this.client.from('household_cultural_identifiers').select(HOUSEHOLD_CULTURAL_COLUMNS).eq('household_id', householdId),
      // Story 3-DM-B2 — household-wide allergens (child_id IS NULL) replace households.declared_allergens.
      this.client.from('household_allergens').select(HOUSEHOLD_ALLERGEN_COLUMNS).eq('household_id', householdId).is('child_id', null),
    ]);

    if (householdRes.error) throw householdRes.error;
    if (caregiversRes.error) throw caregiversRes.error;
    if (childrenRes.error) throw childrenRes.error;
    if (culturalRes.error) throw culturalRes.error;
    if (memoryRes.error) throw memoryRes.error;
    if (extraLibraryRes.error) throw extraLibraryRes.error;
    if (usageRes.error) throw usageRes.error;
    if (allergensRes.error) throw allergensRes.error;
    if (foodPreferencesRes.error) throw foodPreferencesRes.error;
    if (dietaryRes.error) throw dietaryRes.error;
    if (rulesRes.error) throw rulesRes.error;
    if (householdCulturalRes.error) throw householdCulturalRes.error;
    if (householdAllergensRes.error) throw householdAllergensRes.error;

    if (householdRes.data === null) {
      return null;
    }

    const dek = await dekPromise;

    // Slice 2.6-s8 — decrypt child_allergens once; the projection is consumed
    // BOTH by the top-level `allergens` array AND by the per-child
    // declared_allergens read source.
    const decryptedAllergens = this.decryptAllergens(
      (allergensRes.data ?? []) as EncryptedChildAllergenRow[],
      dek,
      householdId,
    );

    const householdRaw = householdRes.data as {
      id: string;
      tier: string;
      tier_variant: string;
      timezone: string;
      kitchen_map_version: number;
      display_name: string | null;
    };

    // Story 3-DM-B2 — household identity now comes from satellite tables,
    // not from the dropped encrypted columns on households.
    const householdCulturalTags = (householdCulturalRes.data ?? []) as Array<{ cultural_tag: string }>;
    const householdAllergenRows = (householdAllergensRes.data ?? []) as Array<{ allergen: string; source: RawAllergenRow['source'] }>;
    const dietaryAllRows = (dietaryRes.data ?? []) as DietaryRow[];

    const householdDeclaredAllergens: string[] = [];
    for (const r of householdAllergenRows) {
      try {
        householdDeclaredAllergens.push(decryptField<string>(r.allergen, dek));
      } catch (err) {
        this.logger.warn(
          { err, module: 'kitchen-map', action: 'kitchen_map.household_allergen_decrypt_failed', household_id: householdId },
          'kitchen-map household allergen decryption failed — row skipped',
        );
      }
    }

    return {
      household: {
        id: householdRaw.id,
        tier: householdRaw.tier,
        tier_variant: householdRaw.tier_variant,
        timezone: householdRaw.timezone,
        kitchen_map_version: householdRaw.kitchen_map_version,
        display_name: householdRaw.display_name,
        cultural_identifiers: householdCulturalTags.map((r) => r.cultural_tag),
        dietary_preferences: dietaryAllRows.filter((r) => r.child_id === null).map((r) => r.tag),
        declared_allergens: householdDeclaredAllergens,
      },
      caregivers: ((caregiversRes.data ?? []) as Array<{
        id: string;
        role: RawCaregiverRow['role'];
        display_name: string | null;
        cultural_language: string | null;
      }>).map((u) => ({
        user_id: u.id,
        role: u.role,
        display_name: u.display_name,
        cultural_language: u.cultural_language,
      })),
      children: this.decryptChildren(
        (childrenRes.data ?? []) as EncryptedChildRow[],
        dek,
        decryptedAllergens,
        dietaryAllRows,
        extraRulesRes,
      ),
      cultural_priors: (culturalRes.data ?? []) as RawCulturalPriorRow[],
      memory_nodes: (memoryRes.data ?? []) as RawMemoryNodeRow[],
      school_policies: schoolPoliciesRes,
      extra_library: (extraLibraryRes.data ?? []) as RawExtraLibraryItemRow[],
      recipe_usage: this.projectUsageRows((usageRes.data ?? []) as unknown as UsageJoinRow[]),
      // Slice 2.5-s1 — five new top-level arrays. Decrypt the encrypted
      // text columns inline; rows that fail decryption are dropped with
      // a warn log, matching the children decryption skip pattern.
      // Slice 2.6-s8 — decryptedAllergens is computed above and reused.
      allergens: decryptedAllergens,
      dietary: dietaryAllRows,
      food_preferences: this.decryptFoodPreferences(
        (foodPreferencesRes.data ?? []) as EncryptedFoodPreferenceRow[],
        dek,
        householdId,
      ),
      rules: this.decryptHouseholdRules(
        (rulesRes.data ?? []) as EncryptedHouseholdRuleRow[],
        dek,
        householdId,
      ),
    };
  }

  /**
   * Application-layer bump for the rare `households` column writers
   * (Stripe tier change, timezone update) that satellite-table triggers
   * don't cover. Calls the bump_kitchen_map_version_for_household() RPC
   * defined in migration 20260514000000.
   */
  async bumpVersion(householdId: string): Promise<void> {
    const { error } = await this.client.rpc('bump_kitchen_map_version_for_household', {
      p_household_id: householdId,
    });
    if (error) throw error;
  }

  // ---- Helpers ------------------------------------------------------------

  private async fetchSchoolPoliciesForHousehold(
    householdId: string,
  ): Promise<RawSchoolPolicyRow[]> {
    // school_policies has child_id only — fan the household's children into
    // an `IN` filter so we keep it single-roundtrip.
    const { data: kids, error: kidsErr } = await this.client
      .from('children')
      .select('id')
      .eq('household_id', householdId);
    if (kidsErr) throw kidsErr;
    const childIds = (kids ?? []).map((k) => (k as { id: string }).id);
    if (childIds.length === 0) return [];

    const { data, error } = await this.client
      .from('school_policies')
      .select(SCHOOL_POLICY_COLUMNS)
      .in('child_id', childIds)
      .eq('is_active', true);
    if (error) throw error;
    return (data ?? []) as RawSchoolPolicyRow[];
  }

  // Story 15-s5 — mirrors fetchSchoolPoliciesForHousehold: child_extra_rules
  // carries child_id only, so fan the household's children into an `IN` filter.
  private async fetchExtraRulesForHousehold(householdId: string): Promise<RawExtraRuleRow[]> {
    const { data: kids, error: kidsErr } = await this.client
      .from('children')
      .select('id')
      .eq('household_id', householdId);
    if (kidsErr) throw kidsErr;
    const childIds = (kids ?? []).map((k) => (k as { id: string }).id);
    if (childIds.length === 0) return [];

    const { data, error } = await this.client
      .from('child_extra_rules')
      .select(EXTRA_RULE_COLUMNS)
      .in('child_id', childIds)
      .order('component_type', { ascending: true });
    if (error) throw error;
    return (data ?? []) as RawExtraRuleRow[];
  }

  private decryptChildren(
    rows: EncryptedChildRow[],
    dek: Buffer | null,
    childAllergens: RawAllergenRow[],
    dietaryRows: DietaryRow[],
    extraRuleRows: RawExtraRuleRow[],
  ): RawChildRow[] {
    const extraRulesByChild = new Map<string, { pins: string[]; bans: string[] }>();
    for (const r of extraRuleRows) {
      const entry = extraRulesByChild.get(r.child_id) ?? { pins: [], bans: [] };
      if (r.rule === 'pin') entry.pins.push(r.component_type);
      else entry.bans.push(r.component_type);
      extraRulesByChild.set(r.child_id, entry);
    }

    const allergensByChild = new Map<string, string[]>();
    for (const r of childAllergens) {
      const list = allergensByChild.get(r.child_id) ?? [];
      list.push(r.allergen);
      allergensByChild.set(r.child_id, list);
    }

    // Story 3-DM-B2 — per-child dietary prefs come from the dietary_preferences
    // table (child_id non-null rows) rather than the dropped children column.
    const dietaryByChild = new Map<string, string[]>();
    for (const r of dietaryRows) {
      if (r.child_id === null) continue;
      const list = dietaryByChild.get(r.child_id) ?? [];
      list.push(r.tag);
      dietaryByChild.set(r.child_id, list);
    }

    const out: RawChildRow[] = [];
    for (const row of rows) {
      try {
        // Story 3-DM-B2 — ChildrenRepository.insert() now stores name as raw
        // plaintext (no encryptField call). Pre-3-DM-B2 rows may still hold
        // AES-GCM ciphertext or NOOP-encoded values.
        //   1. Try decryptField: handles NOOP and AES when the DEK is present.
        //   2. If that throws AND the value looks like a plain human-readable
        //      name (no base64 padding, short), use it directly — this is the
        //      post-3-DM-B2 plaintext case.
        //   3. If the value looks like opaque ciphertext (contains '=' padding
        //      or is suspiciously long) and we have no DEK, skip the row so
        //      the agent doesn't see garbled text.
        let name: string;
        try {
          name = decryptField<string>(row.name, dek);
        } catch {
          // Heuristic: AES-GCM ciphertext stored as base64 is always ≥ 40
          // chars and typically contains '+', '/', or '=' padding. A child
          // name is short and human-readable. If the raw value fails both
          // checks it is stale encrypted data we cannot recover — skip.
          const looksLikeCiphertext = row.name.length > 60 ||
            row.name.includes('+') || row.name.includes('/') || row.name.includes('=');
          if (looksLikeCiphertext) {
            throw new Error(
              `child name appears to be encrypted ciphertext but DEK is unavailable (child_id=${row.id}). ` +
              'Set ENVELOPE_ENCRYPTION_MASTER_KEY or delete the stale row.',
            );
          }
          name = row.name;
        }
        out.push({
          id: row.id,
          name,
          age_band: row.age_band,
          declared_allergens: allergensByChild.get(row.id) ?? [],
          cultural_identifiers: [],
          dietary_preferences: dietaryByChild.get(row.id) ?? [],
          bag_composition_pattern: row.bag_composition_pattern,
          extra_rules: extraRulesByChild.get(row.id) ?? { pins: [], bans: [] },
        });
      } catch (err) {
        this.logger.error(
          { err, module: 'kitchen-map', action: 'kitchen_map.child_decrypt_failed', child_id: row.id },
          'kitchen-map child decryption failed — row skipped',
        );
      }
    }
    return out;
  }

  private decryptAllergens(
    rows: EncryptedChildAllergenRow[],
    dek: Buffer | null,
    householdId: string,
  ): RawAllergenRow[] {
    const out: RawAllergenRow[] = [];
    for (const row of rows) {
      try {
        out.push({
          child_id: row.child_id,
          allergen: decryptField<string>(row.allergen, dek),
          source: row.source,
        });
      } catch (err) {
        this.logger.error(
          {
            err,
            module: 'kitchen-map',
            action: 'kitchen_map.allergen_decrypt_failed',
            household_id: householdId,
            child_id: row.child_id,
          },
          'kitchen-map household_allergens decryption failed — row skipped',
        );
      }
    }
    return out;
  }

  private decryptFoodPreferences(
    rows: EncryptedFoodPreferenceRow[],
    dek: Buffer | null,
    householdId: string,
  ): RawFoodPreferenceRow[] {
    const out: RawFoodPreferenceRow[] = [];
    for (const row of rows) {
      try {
        out.push({
          child_id: row.child_id,
          item: decryptField<string>(row.item, dek),
          valence: row.valence,
          enforcement: row.enforcement,
          source: row.source,
        });
      } catch (err) {
        this.logger.error(
          {
            err,
            module: 'kitchen-map',
            action: 'kitchen_map.food_preference_decrypt_failed',
            household_id: householdId,
            child_id: row.child_id,
          },
          'kitchen-map food_preferences decryption failed — row skipped',
        );
      }
    }
    return out;
  }

  private decryptHouseholdRules(
    rows: EncryptedHouseholdRuleRow[],
    dek: Buffer | null,
    householdId: string,
  ): RawRuleRow[] {
    const out: RawRuleRow[] = [];
    for (const row of rows) {
      try {
        const custom_label =
          row.custom_label === null ? null : decryptField<string>(row.custom_label, dek);
        out.push({
          rule_type: row.rule_type,
          custom_label,
          enforcement: row.enforcement,
          source: row.source,
        });
      } catch (err) {
        this.logger.error(
          {
            err,
            module: 'kitchen-map',
            action: 'kitchen_map.household_rule_decrypt_failed',
            household_id: householdId,
            rule_type: row.rule_type,
          },
          'kitchen-map household_rules decryption failed — row skipped',
        );
      }
    }
    return out;
  }

  private projectUsageRows(rows: UsageJoinRow[]): RawFavouriteRecipeRow[] {
    const out: RawFavouriteRecipeRow[] = [];
    for (const r of rows) {
      // PostgREST sometimes types the joined relation as an array. Normalise.
      const joined: JoinedRecipeFields | undefined = Array.isArray(r.recipes)
        ? r.recipes[0]
        : (r.recipes ?? undefined);
      // Skip entries where the FK target no longer exists (ON DELETE SET
      // NULL means the joined row may be missing) — without recipe metadata
      // there's nothing useful to project.
      if (joined === undefined) continue;
      out.push({
        recipe_id: r.recipe_id,
        canonical_name: joined.canonical_name,
        primary_ingredient_key: joined.primary_ingredient_key,
        cuisine_tags: joined.cuisine_tags ?? [],
        confidence_score: r.confidence_score,
        is_household_favorite: r.is_household_favorite,
        is_household_banned: r.is_household_banned,
        // Slice 2.6-s1 — pass through; composer coerces rogue values.
        catalog_provenance: r.catalog_provenance,
        use_count: r.use_count,
        last_used_at: r.last_used_at,
      });
    }
    return out;
  }

}
