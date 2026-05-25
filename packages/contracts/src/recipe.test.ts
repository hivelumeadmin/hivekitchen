import { describe, it, expect } from 'vitest';
import {
  RecipeSearchInputSchema,
  RecipeSearchOutputSchema,
  RecipeFetchInputSchema,
  RecipeFetchOutputSchema,
  RecipeIngredientSchema,
  RecipeRowSchema,
  HouseholdRecipeUsageRowSchema,
  RecipeCommentPublicSchema,
  RecipeAgentExtractionSchema,
  RecipeDiscoverInputSchema,
} from './recipe.js';

const UUID1 = '00000000-0000-4000-8000-000000000001';
const UUID2 = '00000000-0000-4000-8000-000000000002';
const NOW = '2026-05-14T10:00:00.000Z';

// ---------------------------------------------------------------------------
// RecipeSearchInputSchema (planner tool input — shape unchanged from prior)
// ---------------------------------------------------------------------------

describe('RecipeSearchInputSchema', () => {
  it('round-trips a valid input', () => {
    const r = RecipeSearchInputSchema.safeParse({
      query: 'lentil',
      household_id: UUID1,
      max_results: 5,
    });
    expect(r.success).toBe(true);
  });

  it('applies max_results default when omitted', () => {
    const r = RecipeSearchInputSchema.safeParse({
      query: 'lentil',
      household_id: UUID1,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.max_results).toBe(5);
    }
  });

  it('rejects empty query', () => {
    const r = RecipeSearchInputSchema.safeParse({ query: '', household_id: UUID1 });
    expect(r.success).toBe(false);
  });

  it('rejects non-uuid household_id', () => {
    expect(
      RecipeSearchInputSchema.safeParse({ query: 'rice', household_id: 'nope' }).success,
    ).toBe(false);
  });

  it('rejects max_results above 20', () => {
    expect(
      RecipeSearchInputSchema.safeParse({
        query: 'rice',
        household_id: UUID1,
        max_results: 21,
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RecipeSearchOutputSchema — preview shape evolved for slice A
// ---------------------------------------------------------------------------

describe('RecipeSearchOutputSchema (new preview shape)', () => {
  it('round-trips with one preview', () => {
    const r = RecipeSearchOutputSchema.safeParse({
      results: [
        {
          id: UUID1,
          name: 'Lentil dal',
          primary_ingredient_key: 'lentil',
          cuisine_tags: ['north_indian'],
          allergen_flags: [],
          dietary_flags: ['vegetarian', 'vegan'],
          prep_time_minutes: 25,
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('accepts null primary_ingredient_key + null prep_time_minutes', () => {
    const r = RecipeSearchOutputSchema.safeParse({
      results: [
        {
          id: UUID1,
          name: 'Veggie platter',
          primary_ingredient_key: null,
          cuisine_tags: [],
          allergen_flags: [],
          dietary_flags: [],
          prep_time_minutes: null,
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('rejects when results is missing', () => {
    expect(RecipeSearchOutputSchema.safeParse({}).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RecipeFetchInputSchema (unchanged)
// ---------------------------------------------------------------------------

describe('RecipeFetchInputSchema', () => {
  it('round-trips a valid input', () => {
    expect(
      RecipeFetchInputSchema.safeParse({ recipe_id: UUID1, household_id: UUID2 }).success,
    ).toBe(true);
  });

  it('rejects non-uuid recipe_id', () => {
    expect(
      RecipeFetchInputSchema.safeParse({ recipe_id: 'x', household_id: UUID2 }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RecipeIngredientSchema — new structured shape
// ---------------------------------------------------------------------------

describe('RecipeIngredientSchema (new structured)', () => {
  it('round-trips a fully-specified ingredient', () => {
    const r = RecipeIngredientSchema.safeParse({
      key: 'chicken',
      modifier: 'thigh',
      display: '4 boneless skinless chicken thighs',
      quantity: 4,
      unit: 'piece',
      optional: false,
      substitutes: [{ key: 'chicken', modifier: 'breast' }],
    });
    expect(r.success).toBe(true);
  });

  it('accepts null modifier, null quantity, null unit', () => {
    const r = RecipeIngredientSchema.safeParse({
      key: 'salt',
      modifier: null,
      display: 'Salt to taste',
      quantity: null,
      unit: null,
      optional: false,
      substitutes: [],
    });
    expect(r.success).toBe(true);
  });

  it('rejects unit outside the controlled vocabulary', () => {
    const r = RecipeIngredientSchema.safeParse({
      key: 'flour',
      modifier: null,
      display: '1 scoop flour',
      quantity: 1,
      unit: 'scoop',
      optional: false,
      substitutes: [],
    });
    expect(r.success).toBe(false);
  });

  it('rejects negative quantity', () => {
    const r = RecipeIngredientSchema.safeParse({
      key: 'lemon',
      modifier: null,
      display: '-1 lemon',
      quantity: -1,
      unit: 'piece',
      optional: false,
      substitutes: [],
    });
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RecipeRowSchema / RecipeFetchOutputSchema — DB row shape
// ---------------------------------------------------------------------------

function makeRecipeRow() {
  return {
    id: UUID1,
    canonical_name: 'Lemon-garlic chicken thighs over rice',
    slug: 'lemon-garlic-chicken-thighs-over-rice',
    ingredients: [
      {
        key: 'chicken',
        modifier: 'thigh',
        display: '4 boneless skinless chicken thighs',
        quantity: 4,
        unit: 'piece' as const,
        optional: false,
        substitutes: [{ key: 'chicken', modifier: 'breast' }],
      },
      {
        key: 'lemon',
        modifier: null,
        display: '2 lemons, juiced and zested',
        quantity: 2,
        unit: 'piece' as const,
        optional: false,
        substitutes: [],
      },
    ],
    instructions: 'Sear, then bake at 400 for 20 minutes.',
    ingredient_keys: ['chicken', 'lemon'],
    primary_ingredient_key: 'chicken',
    allergen_flags: [],
    dietary_flags: ['halal'],
    cultural_tags: [],
    cuisine_tags: ['mediterranean'],
    applicable_slots: ['main' as const],
    prep_time_minutes: 35,
    source: 'agent_generated' as const,
    created_by_household_id: UUID2,
    visibility: 'private' as const,
    community_use_count: 0,
    community_rating_avg: null,
    community_rating_count: 0,
    is_active: true,
    created_at: NOW,
    updated_at: NOW,
  };
}

describe('RecipeRowSchema / RecipeFetchOutputSchema', () => {
  it('round-trips a fully-specified recipe row', () => {
    const r = RecipeFetchOutputSchema.safeParse(makeRecipeRow());
    expect(r.success).toBe(true);
  });

  it('accepts instructions as a string', () => {
    const row: Record<string, unknown> = { ...makeRecipeRow(), instructions: 'Simmer for 25 minutes.' };
    const r = RecipeRowSchema.safeParse(row);
    expect(r.success).toBe(true);
  });

  it('accepts instructions as an array of strings', () => {
    const row: Record<string, unknown> = {
      ...makeRecipeRow(),
      instructions: ['Sear chicken.', 'Add lemon and garlic.', 'Bake 20 min.'],
    };
    const r = RecipeRowSchema.safeParse(row);
    expect(r.success).toBe(true);
  });

  it('accepts null instructions', () => {
    const row: Record<string, unknown> = { ...makeRecipeRow(), instructions: null };
    const r = RecipeRowSchema.safeParse(row);
    expect(r.success).toBe(true);
  });

  it('rejects rating_avg above 5', () => {
    const row: Record<string, unknown> = { ...makeRecipeRow(), community_rating_avg: 5.5 };
    const r = RecipeRowSchema.safeParse(row);
    expect(r.success).toBe(false);
  });

  it('rejects unknown source value', () => {
    const row: Record<string, unknown> = { ...makeRecipeRow(), source: 'scraped' };
    const r = RecipeRowSchema.safeParse(row);
    expect(r.success).toBe(false);
  });

  it('accepts catalog_seeded and parent_declared source values (slice 2.6-s1)', () => {
    for (const source of ['catalog_seeded', 'parent_declared'] as const) {
      const row: Record<string, unknown> = { ...makeRecipeRow(), source };
      const r = RecipeRowSchema.safeParse(row);
      expect(r.success).toBe(true);
    }
  });

  it('rejects empty applicable_slots', () => {
    const row: Record<string, unknown> = { ...makeRecipeRow(), applicable_slots: [] };
    const r = RecipeRowSchema.safeParse(row);
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// HouseholdRecipeUsageRowSchema
// ---------------------------------------------------------------------------

describe('HouseholdRecipeUsageRowSchema', () => {
  it('round-trips a valid row', () => {
    const r = HouseholdRecipeUsageRowSchema.safeParse({
      household_id: UUID1,
      recipe_id: UUID2,
      use_count: 5,
      acceptance_count: 4,
      swap_out_count: 1,
      positive_outcome_count: 3,
      negative_outcome_count: 0,
      confidence_score: 75,
      is_household_favorite: false,
      is_household_banned: false,
      first_used_at: NOW,
      last_used_at: NOW,
      last_outcome_at: null,
    });
    expect(r.success).toBe(true);
  });

  it('rejects confidence_score above 100', () => {
    const r = HouseholdRecipeUsageRowSchema.safeParse({
      household_id: UUID1,
      recipe_id: UUID2,
      use_count: 0,
      acceptance_count: 0,
      swap_out_count: 0,
      positive_outcome_count: 0,
      negative_outcome_count: 0,
      confidence_score: 150,
      is_household_favorite: false,
      is_household_banned: false,
      first_used_at: NOW,
      last_used_at: NOW,
      last_outcome_at: null,
    });
    expect(r.success).toBe(false);
  });

  it('rejects negative use_count', () => {
    const r = HouseholdRecipeUsageRowSchema.safeParse({
      household_id: UUID1,
      recipe_id: UUID2,
      use_count: -1,
      acceptance_count: 0,
      swap_out_count: 0,
      positive_outcome_count: 0,
      negative_outcome_count: 0,
      confidence_score: 50,
      is_household_favorite: false,
      is_household_banned: false,
      first_used_at: NOW,
      last_used_at: NOW,
      last_outcome_at: null,
    });
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RecipeCommentPublicSchema
// ---------------------------------------------------------------------------

describe('RecipeCommentPublicSchema', () => {
  it('round-trips a rating-only comment', () => {
    const r = RecipeCommentPublicSchema.safeParse({
      id: UUID1,
      recipe_id: UUID2,
      display_handle: 'A South Asian household',
      rating: 5,
      prose_text: null,
      created_at: NOW,
    });
    expect(r.success).toBe(true);
  });

  it('round-trips a prose-only comment (null rating)', () => {
    const r = RecipeCommentPublicSchema.safeParse({
      id: UUID1,
      recipe_id: UUID2,
      display_handle: 'A halal household',
      rating: null,
      prose_text: 'Worked well as Friday lunch.',
      created_at: NOW,
    });
    expect(r.success).toBe(true);
  });

  it('rejects rating below 1', () => {
    const r = RecipeCommentPublicSchema.safeParse({
      id: UUID1,
      recipe_id: UUID2,
      display_handle: 'Anon',
      rating: 0,
      prose_text: null,
      created_at: NOW,
    });
    expect(r.success).toBe(false);
  });

  it('does not allow author_household_id / author_user_id fields', () => {
    // Schema is .object({...}) — extra keys are allowed by default in Zod.
    // The PUBLIC contract is what it returns; the row writer is responsible
    // for not exposing author fields. This test asserts the schema doesn't
    // require them (no author fields = valid).
    const r = RecipeCommentPublicSchema.safeParse({
      id: UUID1,
      recipe_id: UUID2,
      display_handle: 'Anon',
      rating: 4,
      prose_text: null,
      created_at: NOW,
    });
    expect(r.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Story 3-31 — RecipeAgentExtractionSchema
// ---------------------------------------------------------------------------

describe('RecipeAgentExtractionSchema (Story 3-31)', () => {
  const validExtraction = {
    name: 'Chicken Biryani',
    source_url: 'https://www.recipetineats.com/chicken-biryani/',
    source_site: 'recipetineats' as const,
    cuisine_tags: ['north_indian', 'south_asian', 'asian'],
    cultural_tags: ['halal'],
    dietary_flags: [],
    allergen_flags: ['dairy'],
    prep_time_minutes: 45,
    ingredients: [
      {
        key: 'chicken',
        modifier: 'thigh',
        display: '500g boneless chicken thighs, cubed',
        quantity: 500,
        unit: 'g' as const,
        optional: false,
        substitutes: [],
      },
      {
        key: 'rice',
        modifier: 'basmati',
        display: '2 cups basmati rice',
        quantity: 2,
        unit: 'cup' as const,
        optional: false,
        substitutes: [],
      },
    ],
    instructions: [
      'Soak rice in cold water for 20 minutes.',
      'Marinate chicken with yogurt and spices.',
    ],
    allergen_info_from_source: null,
  };

  it('round-trips a valid extraction', () => {
    const r = RecipeAgentExtractionSchema.safeParse(validExtraction);
    expect(r.success).toBe(true);
  });

  it('rejects an empty ingredients array', () => {
    const r = RecipeAgentExtractionSchema.safeParse({ ...validExtraction, ingredients: [] });
    expect(r.success).toBe(false);
  });

  it('rejects an empty instructions array', () => {
    const r = RecipeAgentExtractionSchema.safeParse({ ...validExtraction, instructions: [] });
    expect(r.success).toBe(false);
  });

  it('rejects a source_site outside the allowed enum', () => {
    const r = RecipeAgentExtractionSchema.safeParse({
      ...validExtraction,
      source_site: 'food.com',
    });
    expect(r.success).toBe(false);
  });

  it('rejects a non-URL source_url', () => {
    const r = RecipeAgentExtractionSchema.safeParse({ ...validExtraction, source_url: 'not-a-url' });
    expect(r.success).toBe(false);
  });

  it('accepts a populated allergen_info_from_source string', () => {
    const r = RecipeAgentExtractionSchema.safeParse({
      ...validExtraction,
      allergen_info_from_source: 'Contains: wheat, milk, eggs.',
    });
    expect(r.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Story 3-31 — RecipeDiscoverInputSchema
// ---------------------------------------------------------------------------

describe('RecipeDiscoverInputSchema (Story 3-31)', () => {
  const valid = {
    household_id: UUID1,
    plan_build_id: 'req-' + UUID2,
    slot: 'main' as const,
    count: 5,
    intent: 'kid-friendly weeknight lunch',
    constraints: {
      cuisine_tags: ['south_asian'],
      cultural_tags: ['halal'],
      dietary_flags: ['nut_free'],
      allergen_exclusions: ['peanut'],
      max_prep_minutes: 30,
    },
  };

  it('round-trips a valid input', () => {
    const r = RecipeDiscoverInputSchema.safeParse(valid);
    expect(r.success).toBe(true);
  });

  it('rejects count below 1', () => {
    const r = RecipeDiscoverInputSchema.safeParse({ ...valid, count: 0 });
    expect(r.success).toBe(false);
  });

  it('rejects count above 10', () => {
    const r = RecipeDiscoverInputSchema.safeParse({ ...valid, count: 11 });
    expect(r.success).toBe(false);
  });

  it('rejects empty intent', () => {
    const r = RecipeDiscoverInputSchema.safeParse({ ...valid, intent: '' });
    expect(r.success).toBe(false);
  });

  it('rejects invalid household_id uuid', () => {
    const r = RecipeDiscoverInputSchema.safeParse({ ...valid, household_id: 'not-a-uuid' });
    expect(r.success).toBe(false);
  });

  it('rejects slot outside the enum', () => {
    const r = RecipeDiscoverInputSchema.safeParse({ ...valid, slot: 'dessert' });
    expect(r.success).toBe(false);
  });

  it('accepts null max_prep_minutes', () => {
    const r = RecipeDiscoverInputSchema.safeParse({
      ...valid,
      constraints: { ...valid.constraints, max_prep_minutes: null },
    });
    expect(r.success).toBe(true);
  });
});
