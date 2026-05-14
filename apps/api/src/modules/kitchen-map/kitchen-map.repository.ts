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
}

export interface RawMemoryNodeRow {
  node_type: string;
  facet: string;
  prose_text: string;
  subject_child_id: string | null;
}

export interface RawSchoolPolicyRow {
  child_id: string;
  policy_text: string;
}

export interface RawAllergyRuleRow {
  household_id: string | null; // null = system FALCPA reference row
  child_id: string | null;
  allergen: string;
  rule_type: 'falcpa' | 'parent_declared';
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

export interface RawKitchenMapData {
  household: RawHouseholdRow;
  caregivers: RawCaregiverRow[];
  children: RawChildRow[];
  cultural_priors: RawCulturalPriorRow[];
  memory_nodes: RawMemoryNodeRow[];
  school_policies: RawSchoolPolicyRow[];
  allergy_rules: RawAllergyRuleRow[];
  extra_library: RawExtraLibraryItemRow[];
  recipe_usage: RawFavouriteRecipeRow[];
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

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

const HOUSEHOLD_COLUMNS = 'id, tier, tier_variant, timezone, kitchen_map_version';
const CAREGIVER_COLUMNS = 'id, role, display_name, cultural_language';
const CHILD_COLUMNS =
  'id, name, age_band, declared_allergens, cultural_identifiers, dietary_preferences, bag_composition, extra_rules';
const CULTURAL_PRIOR_COLUMNS = 'key, label, tier, state, confidence, presence';
const MEMORY_COLUMNS = 'node_type, facet, prose_text, subject_child_id';
const SCHOOL_POLICY_COLUMNS = 'child_id, policy_text';
const ALLERGY_RULE_COLUMNS = 'household_id, child_id, allergen, rule_type';
const EXTRA_LIBRARY_COLUMNS = 'id, name, component_type';
const USAGE_JOIN_COLUMNS =
  'recipe_id, confidence_score, is_household_favorite, is_household_banned, use_count, last_used_at, recipes(canonical_name, primary_ingredient_key, cuisine_tags)';

/**
 * Slice A0.5 — fans out parallel reads across every source table that
 * contributes to the Kitchen Map projection. Decrypts envelope-encrypted
 * child columns (name + the three jsonb tag arrays) using the household's
 * DEK so the composer sees plaintext.
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
      allergyRulesRes,
      extraLibraryRes,
      usageRes,
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
      this.fetchAllergyRulesForHousehold(householdId),
      this.client.from('extra_library').select(EXTRA_LIBRARY_COLUMNS).eq('household_id', householdId),
      this.client
        .from('household_recipe_usage')
        .select(USAGE_JOIN_COLUMNS)
        .eq('household_id', householdId),
    ]);

    if (householdRes.error) throw householdRes.error;
    if (caregiversRes.error) throw caregiversRes.error;
    if (childrenRes.error) throw childrenRes.error;
    if (culturalRes.error) throw culturalRes.error;
    if (memoryRes.error) throw memoryRes.error;
    if (extraLibraryRes.error) throw extraLibraryRes.error;
    if (usageRes.error) throw usageRes.error;

    if (householdRes.data === null) {
      return null;
    }

    const dek = await dekPromise;

    return {
      household: householdRes.data as RawHouseholdRow,
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
      allergy_rules: allergyRulesRes,
      extra_library: (extraLibraryRes.data ?? []) as RawExtraLibraryItemRow[],
      recipe_usage: this.projectUsageRows((usageRes.data ?? []) as unknown as UsageJoinRow[]),
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
      .in('child_id', childIds);
    if (error) throw error;
    return (data ?? []) as RawSchoolPolicyRow[];
  }

  private async fetchAllergyRulesForHousehold(
    householdId: string,
  ): Promise<RawAllergyRuleRow[]> {
    // Two queries: FALCPA reference rows (household_id IS NULL) plus the
    // household's own parent-declared rows. Avoids a PostgREST `.or()`
    // filter that would interpolate the householdId into a query string.
    const [system, household] = await Promise.all([
      this.client.from('allergy_rules').select(ALLERGY_RULE_COLUMNS).is('household_id', null),
      this.client.from('allergy_rules').select(ALLERGY_RULE_COLUMNS).eq('household_id', householdId),
    ]);
    if (system.error) throw system.error;
    if (household.error) throw household.error;
    return [
      ...((system.data ?? []) as RawAllergyRuleRow[]),
      ...((household.data ?? []) as RawAllergyRuleRow[]),
    ];
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
}
