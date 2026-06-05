import { describe, it, expect } from 'vitest';
import { scrubForSharing } from './payload-scrubber.js';

const FIXTURE = {
  child_name: 'Layla',
  declared_allergens: ['peanut'],
  cultural_identifiers: ['bengali'],
  dietary_preferences: ['no-meat-tue'],
  child_rating: 4,
  // Non-sensitive recipe fields that must survive:
  recipe_id: 'rec-abc123',
  recipe_name: 'Pasta Primavera',
  prep_time_minutes: 20,
  ingredients: [{ name: 'pasta', amount: '200g' }],
};

describe('scrubForSharing', () => {
  it('strips all five Safety-Classified-Sensitive fields', () => {
    const result = scrubForSharing(FIXTURE);
    expect(result).not.toHaveProperty('child_name');
    expect(result).not.toHaveProperty('declared_allergens');
    expect(result).not.toHaveProperty('cultural_identifiers');
    expect(result).not.toHaveProperty('dietary_preferences');
    expect(result).not.toHaveProperty('child_rating');
  });

  it('preserves all non-sensitive recipe fields intact', () => {
    const result = scrubForSharing(FIXTURE);
    expect(result.recipe_id).toBe('rec-abc123');
    expect(result.recipe_name).toBe('Pasta Primavera');
    expect(result.prep_time_minutes).toBe(20);
    expect(result.ingredients).toEqual([{ name: 'pasta', amount: '200g' }]);
  });

  it('does not mutate the original payload', () => {
    const original = { ...FIXTURE };
    scrubForSharing(original);
    expect(original).toHaveProperty('child_name', 'Layla');
    expect(original).toHaveProperty('declared_allergens');
  });

  it('passes a payload with no sensitive fields through unchanged', () => {
    const safe = { recipe_id: 'rec-xyz', calories: 350 };
    expect(scrubForSharing(safe)).toEqual({ recipe_id: 'rec-xyz', calories: 350 });
  });

  it('returns an empty object for a payload of only sensitive fields', () => {
    const pii = { child_name: 'Layla', declared_allergens: ['peanut'] };
    expect(scrubForSharing(pii)).toEqual({});
  });
});
