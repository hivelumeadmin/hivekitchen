import { describe, it, expect } from 'vitest';
import {
  RecipeSearchInputSchema,
  RecipeSearchOutputSchema,
  RecipeFetchInputSchema,
  RecipeFetchOutputSchema,
} from './recipe.js';

const UUID1 = '00000000-0000-4000-8000-000000000001';
const UUID2 = '00000000-0000-4000-8000-000000000002';

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

describe('RecipeSearchOutputSchema', () => {
  it('round-trips with one preview', () => {
    const r = RecipeSearchOutputSchema.safeParse({
      results: [
        {
          id: UUID1,
          name: 'Lentil dal',
          tags: ['vegetarian'],
          allergen_flags: [],
          prep_time_minutes: 25,
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('rejects when results is missing', () => {
    expect(RecipeSearchOutputSchema.safeParse({}).success).toBe(false);
  });
});

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

describe('RecipeFetchOutputSchema', () => {
  it('round-trips a fully-specified detail', () => {
    const r = RecipeFetchOutputSchema.safeParse({
      id: UUID1,
      name: 'Lentil dal',
      description: 'Warm yellow dal with rice',
      ingredients: [
        { name: 'red lentils', quantity: '1 cup', allergens: [] },
        { name: 'rice', quantity: '1 cup', allergens: [] },
      ],
      prep_time_minutes: 25,
      instructions: 'Simmer.',
      tags: ['vegetarian'],
      allergen_flags: [],
    });
    expect(r.success).toBe(true);
  });

  it('rejects missing ingredients array', () => {
    expect(
      RecipeFetchOutputSchema.safeParse({
        id: UUID1,
        name: 'Lentil dal',
        description: '',
        prep_time_minutes: 25,
        instructions: '',
        tags: [],
        allergen_flags: [],
      }).success,
    ).toBe(false);
  });
});
