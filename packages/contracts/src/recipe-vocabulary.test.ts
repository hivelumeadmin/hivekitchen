import { describe, it, expect } from 'vitest';
import {
  AllergenTagRowSchema,
  DietaryTagRowSchema,
  CulturalTagRowSchema,
  CuisineTagRowSchema,
  VocabularySnapshotSchema,
} from './recipe-vocabulary.js';

const NOW = '2026-05-14T10:00:00.000Z';

describe('AllergenTagRowSchema', () => {
  it('round-trips a FALCPA row', () => {
    const r = AllergenTagRowSchema.safeParse({
      key: 'peanut',
      display_name: 'Peanut',
      rule_class: 'falcpa',
      legal_jurisdiction: ['US', 'EU'],
      severity_default: 'block',
      alias_keys: ['groundnut', 'arachis'],
      display_icon: null,
      description: null,
      is_active: true,
      sort_order: 10,
      created_at: NOW,
      updated_at: NOW,
    });
    expect(r.success).toBe(true);
  });

  it('rejects rule_class outside the enum', () => {
    const r = AllergenTagRowSchema.safeParse({
      key: 'mystery',
      display_name: 'Mystery',
      rule_class: 'unknown',
      legal_jurisdiction: [],
      severity_default: 'block',
      alias_keys: [],
      display_icon: null,
      description: null,
      is_active: true,
      sort_order: 1000,
      created_at: NOW,
      updated_at: NOW,
    });
    expect(r.success).toBe(false);
  });
});

describe('DietaryTagRowSchema', () => {
  it('round-trips a row with implies + conflicts_with', () => {
    const r = DietaryTagRowSchema.safeParse({
      key: 'vegan',
      display_name: 'Vegan',
      category: 'plant_based',
      implies: ['vegetarian', 'dairy_free', 'egg_free'],
      conflicts_with: ['pescatarian'],
      description: null,
      is_active: true,
      sort_order: 140,
      created_at: NOW,
      updated_at: NOW,
    });
    expect(r.success).toBe(true);
  });

  it('rejects unknown category', () => {
    const r = DietaryTagRowSchema.safeParse({
      key: 'fad',
      display_name: 'Fad',
      category: 'lifestyle',
      implies: [],
      conflicts_with: [],
      description: null,
      is_active: true,
      sort_order: 999,
      created_at: NOW,
      updated_at: NOW,
    });
    expect(r.success).toBe(false);
  });
});

describe('CulturalTagRowSchema', () => {
  it('round-trips a template row', () => {
    const r = CulturalTagRowSchema.safeParse({
      key: 'south_asian',
      display_name: 'South Asian',
      parent_key: 'asian',
      is_template: true,
      observance_calendar: 'south_asian',
      description: null,
      is_active: true,
      sort_order: 100,
      created_at: NOW,
      updated_at: NOW,
    });
    expect(r.success).toBe(true);
  });

  it('accepts null parent_key (root tag)', () => {
    const r = CulturalTagRowSchema.safeParse({
      key: 'asian',
      display_name: 'Asian',
      parent_key: null,
      is_template: false,
      observance_calendar: null,
      description: null,
      is_active: true,
      sort_order: 10,
      created_at: NOW,
      updated_at: NOW,
    });
    expect(r.success).toBe(true);
  });
});

describe('CuisineTagRowSchema', () => {
  it('round-trips a sub-region row', () => {
    const r = CuisineTagRowSchema.safeParse({
      key: 'south_asian',
      display_name: 'South Asian',
      parent_key: 'asian',
      region: 'asia',
      description: null,
      is_active: true,
      sort_order: 100,
      created_at: NOW,
      updated_at: NOW,
    });
    expect(r.success).toBe(true);
  });

  it('accepts null region (rare; mostly for top-level fusion)', () => {
    const r = CuisineTagRowSchema.safeParse({
      key: 'fusion',
      display_name: 'Fusion',
      parent_key: null,
      region: null,
      description: null,
      is_active: true,
      sort_order: 999,
      created_at: NOW,
      updated_at: NOW,
    });
    expect(r.success).toBe(true);
  });

  it('rejects unknown region', () => {
    const r = CuisineTagRowSchema.safeParse({
      key: 'martian',
      display_name: 'Martian',
      parent_key: null,
      region: 'mars',
      description: null,
      is_active: true,
      sort_order: 9999,
      created_at: NOW,
      updated_at: NOW,
    });
    expect(r.success).toBe(false);
  });
});

describe('VocabularySnapshotSchema', () => {
  it('round-trips a snapshot with empty vocabularies (degenerate but valid)', () => {
    const r = VocabularySnapshotSchema.safeParse({
      allergen_tags: [],
      dietary_tags: [],
      cultural_tags: [],
      cuisine_tags: [],
      loaded_at: NOW,
    });
    expect(r.success).toBe(true);
  });
});
