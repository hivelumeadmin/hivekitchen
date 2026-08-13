import { BaseRepository } from '../../repository/base.repository.js';

// Slice 16-s1 — read/write repository for `onboarding_chip_suggestions`.
//
// Household-scoped, no confidence/provenance columns (unlike the recipes
// catalog) — a suggestion is either persisted (survived the allergen filter)
// or it isn't; blocked suggestions never reach this table, they only reach
// the block log.
//
// Schema reference: 20261040000000_create_onboarding_chip_suggestions.sql

export interface OnboardingChipSuggestionRow {
  id: string;
  household_id: string;
  label: string;
  cuisine_tags: string[];
  dietary_flags: string[];
  allergen_flags: string[];
  primary_starch: string | null;
  primary_protein: string | null;
  created_at: string;
}

export interface OnboardingChipSuggestionInsert {
  label: string;
  cuisine_tags: string[];
  dietary_flags: string[];
  allergen_flags: string[];
  primary_starch: string | null;
  primary_protein: string | null;
}

const SUGGESTION_COLUMNS =
  'id, household_id, label, cuisine_tags, dietary_flags, allergen_flags, primary_starch, primary_protein, created_at';

export class OnboardingChipSuggestionRepository extends BaseRepository {
  /**
   * The M5 chip source read. All survivors for a household — the filter that
   * decides what's a survivor runs upstream of this repository, at
   * generation time.
   */
  async findAllForHousehold(householdId: string): Promise<OnboardingChipSuggestionRow[]> {
    const { data, error } = await this.client
      .from('onboarding_chip_suggestions')
      .select(SUGGESTION_COLUMNS)
      .eq('household_id', householdId);
    if (error) throw error;
    return (data ?? []) as OnboardingChipSuggestionRow[];
  }

  /**
   * Chip-key resolution: a tapped chip's key is a suggestion id, and
   * favorite_lunch.add takes a label, not an id. Checked before the
   * recipes-repository fallback (declared favourites keep their recipes.id).
   */
  async findById(id: string): Promise<OnboardingChipSuggestionRow | null> {
    const { data, error } = await this.client
      .from('onboarding_chip_suggestions')
      .select(SUGGESTION_COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data as OnboardingChipSuggestionRow | null;
  }

  async insertMany(
    householdId: string,
    items: readonly OnboardingChipSuggestionInsert[],
  ): Promise<OnboardingChipSuggestionRow[]> {
    if (items.length === 0) return [];
    const rows = items.map((item) => ({ household_id: householdId, ...item }));
    const { data, error } = await this.client
      .from('onboarding_chip_suggestions')
      .insert(rows)
      .select(SUGGESTION_COLUMNS);
    if (error) throw error;
    return (data ?? []) as OnboardingChipSuggestionRow[];
  }
}
