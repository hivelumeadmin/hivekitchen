import type { Buffer } from 'node:buffer';
import type { FastifyBaseLogger } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository } from '../../repository/base.repository.js';
import { decryptField } from '../../lib/envelope-encryption.js';
import { getHouseholdDek } from '../../lib/household-key.js';

// ---------------------------------------------------------------------------
// Raw shape — what the repository returns. The composer maps this into the
// canonical KitchenMap projection.
// ---------------------------------------------------------------------------

export interface RawHouseholdRow {
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
  bag_composition: { main: boolean; snack: boolean; extra: boolean };
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

export interface RawExtraLibraryItemRow {
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

export interface RawFavoriteLunchRow {
  item: string; // decrypted by the repository
  provenance: 'onboarding_seed' | 'parent_added' | 'plan_promoted';
  position: number;
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
  favorite_lunches: RawFavoriteLunchRow[];
  rules: RawRuleRow[];
}

// ---------------------------------------------------------------------------
// Raw DB row shapes (before decryption / projection)
// ---------------------------------------------------------------------------

interface EncryptedChildRow {
  id: string;
  name: string;
  age_band: 'toddler' | 'child' | 'preteen' | 'teen';
  declared_allergens: string;
  cultural_identifiers: string;
  dietary_preferences: string;
  bag_composition: { main?: unknown; snack?: unknown; extra?: unknown } | string | null;
  extra_rules: { pins?: unknown; bans?: unknown } | null;
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

interface EncryptedFavoriteLunchRow {
  item: string;
  provenance: RawFavoriteLunchRow['provenance'];
  position: number;
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
  'id, tier, tier_variant, timezone, kitchen_map_version, display_name, cultural_identifiers, dietary_preferences, declared_allergens';
const CAREGIVER_COLUMNS = 'id, role, display_name, cultural_language';
const CHILD_COLUMNS =
  'id, name, age_band, declared_allergens, cultural_identifiers, dietary_preferences, bag_composition, extra_rules';
const CULTURAL_PRIOR_COLUMNS = 'key, label, tier, state, confidence, presence, enforcement';
const MEMORY_COLUMNS = 'node_type, facet, prose_text, subject_child_id';
const SCHOOL_POLICY_COLUMNS = 'child_id, policy_type, policy_description, slot_scope';
const EXTRA_LIBRARY_COLUMNS = 'id, name, component_type';
const USAGE_JOIN_COLUMNS =
  'recipe_id, confidence_score, is_household_favorite, is_household_banned, use_count, last_used_at, recipes(canonical_name, primary_ingredient_key, cuisine_tags)';
const CHILD_ALLERGEN_COLUMNS = 'child_id, allergen, source';
const FOOD_PREFERENCE_COLUMNS = 'child_id, item, valence, enforcement, source';
const DIETARY_COLUMNS = 'child_id, tag, enforcement, source';
const FAVORITE_LUNCH_COLUMNS = 'item, provenance, position';
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
      extraLibraryRes,
      usageRes,
      allergensRes,
      foodPreferencesRes,
      dietaryRes,
      favoriteLunchesRes,
      rulesRes,
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
      this.client.from('extra_library').select(EXTRA_LIBRARY_COLUMNS).eq('household_id', householdId),
      this.client
        .from('household_recipe_usage')
        .select(USAGE_JOIN_COLUMNS)
        .eq('household_id', householdId),
      this.client.from('child_allergens').select(CHILD_ALLERGEN_COLUMNS).eq('household_id', householdId),
      this.client.from('food_preferences').select(FOOD_PREFERENCE_COLUMNS).eq('household_id', householdId),
      this.client.from('dietary_preferences').select(DIETARY_COLUMNS).eq('household_id', householdId),
      this.client.from('favorite_lunches').select(FAVORITE_LUNCH_COLUMNS).eq('household_id', householdId).order('position', { ascending: true }),
      this.client.from('household_rules').select(HOUSEHOLD_RULE_COLUMNS).eq('household_id', householdId),
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
    if (favoriteLunchesRes.error) throw favoriteLunchesRes.error;
    if (rulesRes.error) throw rulesRes.error;

    if (householdRes.data === null) {
      return null;
    }

    const dek = await dekPromise;

    // Slice 2-s27 — decrypt the three household-level columns. NULL on
    // any column reads back as []. A decrypt failure is logged and treated
    // as [] (mirror of the children decrypt-skip pattern) — never crash the
    // whole map on a single corrupt cell.
    const householdRaw = householdRes.data as {
      id: string;
      tier: string;
      tier_variant: string;
      timezone: string;
      kitchen_map_version: number;
      display_name: string | null;
      cultural_identifiers: string | null;
      dietary_preferences: string | null;
      declared_allergens: string | null;
    };

    return {
      household: {
        id: householdRaw.id,
        tier: householdRaw.tier,
        tier_variant: householdRaw.tier_variant,
        timezone: householdRaw.timezone,
        kitchen_map_version: householdRaw.kitchen_map_version,
        display_name: householdRaw.display_name,
        cultural_identifiers: this.decryptHouseholdArrayColumn(
          householdRaw.cultural_identifiers,
          dek,
          'cultural_identifiers',
          householdId,
        ),
        dietary_preferences: this.decryptHouseholdArrayColumn(
          householdRaw.dietary_preferences,
          dek,
          'dietary_preferences',
          householdId,
        ),
        declared_allergens: this.decryptHouseholdArrayColumn(
          householdRaw.declared_allergens,
          dek,
          'declared_allergens',
          householdId,
        ),
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
      children: this.decryptChildren((childrenRes.data ?? []) as EncryptedChildRow[], dek),
      cultural_priors: (culturalRes.data ?? []) as RawCulturalPriorRow[],
      memory_nodes: (memoryRes.data ?? []) as RawMemoryNodeRow[],
      school_policies: schoolPoliciesRes,
      extra_library: (extraLibraryRes.data ?? []) as RawExtraLibraryItemRow[],
      recipe_usage: this.projectUsageRows((usageRes.data ?? []) as unknown as UsageJoinRow[]),
      // Slice 2.5-s1 — five new top-level arrays. Decrypt the encrypted
      // text columns inline; rows that fail decryption are dropped with
      // a warn log, matching the children decryption skip pattern.
      allergens: this.decryptAllergens(
        (allergensRes.data ?? []) as EncryptedChildAllergenRow[],
        dek,
        householdId,
      ),
      dietary: (dietaryRes.data ?? []) as DietaryRow[],
      food_preferences: this.decryptFoodPreferences(
        (foodPreferencesRes.data ?? []) as EncryptedFoodPreferenceRow[],
        dek,
        householdId,
      ),
      favorite_lunches: this.decryptFavoriteLunches(
        (favoriteLunchesRes.data ?? []) as EncryptedFavoriteLunchRow[],
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

  private decryptChildren(rows: EncryptedChildRow[], dek: Buffer | null): RawChildRow[] {
    // decryptField() handles both real AES-GCM ciphertext (dek required) and
    // NOOP-prefixed dev-mode rows (dek may be null) internally — call it
    // unconditionally rather than branching on dek === null, otherwise
    // NOOP-prefixed payloads get JSON.parse'd as a literal string.
    const out: RawChildRow[] = [];
    for (const row of rows) {
      try {
        out.push({
          id: row.id,
          name: decryptField<string>(row.name, dek),
          age_band: row.age_band,
          declared_allergens: decryptField<string[]>(row.declared_allergens, dek),
          cultural_identifiers: decryptField<string[]>(row.cultural_identifiers, dek),
          dietary_preferences: decryptField<string[]>(row.dietary_preferences, dek),
          bag_composition: this.normaliseBagComposition(row.bag_composition),
          extra_rules: this.normaliseExtraRules(row.extra_rules),
        });
      } catch (err) {
        // Single corrupt row — skip rather than crash the whole map.
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
          'kitchen-map child_allergens decryption failed — row skipped',
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

  private decryptFavoriteLunches(
    rows: EncryptedFavoriteLunchRow[],
    dek: Buffer | null,
    householdId: string,
  ): RawFavoriteLunchRow[] {
    const out: RawFavoriteLunchRow[] = [];
    for (const row of rows) {
      try {
        out.push({
          item: decryptField<string>(row.item, dek),
          provenance: row.provenance,
          position: row.position,
        });
      } catch (err) {
        this.logger.error(
          {
            err,
            module: 'kitchen-map',
            action: 'kitchen_map.favorite_lunch_decrypt_failed',
            household_id: householdId,
          },
          'kitchen-map favorite_lunches decryption failed — row skipped',
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
        use_count: r.use_count,
        last_used_at: r.last_used_at,
      });
    }
    return out;
  }

  private normaliseBagComposition(
    raw: EncryptedChildRow['bag_composition'],
  ): { main: boolean; snack: boolean; extra: boolean } {
    if (raw === null || raw === undefined) {
      return { main: true, snack: false, extra: false };
    }
    const obj = typeof raw === 'string' ? this.parseObject(raw) : raw;
    return {
      main: obj?.main === true || obj?.main === undefined ? true : Boolean(obj.main),
      snack: Boolean(obj?.snack),
      extra: Boolean(obj?.extra),
    };
  }

  private normaliseExtraRules(
    raw: EncryptedChildRow['extra_rules'],
  ): { pins: string[]; bans: string[] } {
    if (raw === null || raw === undefined) {
      return { pins: [], bans: [] };
    }
    return {
      pins: Array.isArray(raw.pins)
        ? raw.pins.filter((v): v is string => typeof v === 'string')
        : [],
      bans: Array.isArray(raw.bans)
        ? raw.bans.filter((v): v is string => typeof v === 'string')
        : [],
    };
  }

  private parseObject(raw: string): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  // Slice 2-s27 — decrypt one of the household-level food-identity columns.
  // NULL → []; corrupt cell → [] with a warn log.
  private decryptHouseholdArrayColumn(
    stored: string | null,
    dek: Buffer | null,
    fieldName: string,
    householdId: string,
  ): string[] {
    if (stored === null) return [];
    try {
      return decryptField<string[]>(stored, dek);
    } catch (err) {
      this.logger.error(
        {
          err,
          module: 'kitchen-map',
          action: 'kitchen_map.household_field_decrypt_failed',
          household_id: householdId,
          field: fieldName,
        },
        'kitchen-map household-field decryption failed — projected as []',
      );
      return [];
    }
  }
}
