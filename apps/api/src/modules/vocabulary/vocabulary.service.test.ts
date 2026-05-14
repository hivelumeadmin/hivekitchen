import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type {
  AllergenTagRow,
  CulturalTagRow,
  CuisineTagRow,
  DietaryTagRow,
} from '@hivekitchen/types';
import { VocabularyService } from './vocabulary.service.js';
import type { RawVocabularyData, VocabularyRepository } from './vocabulary.repository.js';

const NOW = '2026-05-14T10:00:00.000Z';

function row<T>(partial: Partial<T> & Pick<T, keyof T & string>): T {
  return partial as T;
}

function allergen(partial: Partial<AllergenTagRow> & { key: string }): AllergenTagRow {
  return {
    key: partial.key,
    display_name: partial.display_name ?? partial.key,
    rule_class: partial.rule_class ?? 'falcpa',
    legal_jurisdiction: partial.legal_jurisdiction ?? [],
    severity_default: partial.severity_default ?? 'block',
    alias_keys: partial.alias_keys ?? [],
    display_icon: partial.display_icon ?? null,
    description: partial.description ?? null,
    is_active: partial.is_active ?? true,
    sort_order: partial.sort_order ?? 100,
    created_at: NOW,
    updated_at: NOW,
  };
}

function dietary(partial: Partial<DietaryTagRow> & { key: string }): DietaryTagRow {
  return {
    key: partial.key,
    display_name: partial.display_name ?? partial.key,
    category: partial.category ?? 'plant_based',
    implies: partial.implies ?? [],
    conflicts_with: partial.conflicts_with ?? [],
    description: partial.description ?? null,
    is_active: partial.is_active ?? true,
    sort_order: partial.sort_order ?? 100,
    created_at: NOW,
    updated_at: NOW,
  };
}

function cultural(partial: Partial<CulturalTagRow> & { key: string }): CulturalTagRow {
  return {
    key: partial.key,
    display_name: partial.display_name ?? partial.key,
    parent_key: partial.parent_key ?? null,
    is_template: partial.is_template ?? false,
    observance_calendar: partial.observance_calendar ?? null,
    description: partial.description ?? null,
    is_active: partial.is_active ?? true,
    sort_order: partial.sort_order ?? 100,
    created_at: NOW,
    updated_at: NOW,
  };
}

function cuisine(partial: Partial<CuisineTagRow> & { key: string }): CuisineTagRow {
  return {
    key: partial.key,
    display_name: partial.display_name ?? partial.key,
    parent_key: partial.parent_key ?? null,
    region: partial.region ?? null,
    description: partial.description ?? null,
    is_active: partial.is_active ?? true,
    sort_order: partial.sort_order ?? 100,
    created_at: NOW,
    updated_at: NOW,
  };
}

function makeRepository(data: RawVocabularyData): VocabularyRepository {
  return { loadAll: vi.fn().mockResolvedValue(data) } as unknown as VocabularyRepository;
}

function makeLogger(): FastifyBaseLogger {
  const fn = vi.fn();
  return {
    info: fn,
    warn: fn,
    error: fn,
    debug: fn,
    fatal: fn,
    trace: fn,
    child: () => makeLogger(),
    level: 'info',
    silent: () => {},
  } as unknown as FastifyBaseLogger;
}

describe('VocabularyService — load', () => {
  it('builds the in-memory maps from the repository data', async () => {
    const data: RawVocabularyData = {
      allergens: [allergen({ key: 'peanut', alias_keys: ['groundnut'] })],
      dietary: [dietary({ key: 'vegan' })],
      cultural: [cultural({ key: 'halal' })],
      cuisines: [cuisine({ key: 'italian' })],
    };
    const svc = new VocabularyService(makeRepository(data), makeLogger());
    await svc.load();

    expect(svc.includes('allergen', 'peanut')).toBe(true);
    expect(svc.includes('dietary', 'vegan')).toBe(true);
    expect(svc.includes('cultural', 'halal')).toBe(true);
    expect(svc.includes('cuisine', 'italian')).toBe(true);
  });

  it("includes returns false for unknown keys", async () => {
    const svc = new VocabularyService(
      makeRepository({ allergens: [], dietary: [], cultural: [], cuisines: [] }),
      makeLogger(),
    );
    await svc.load();
    expect(svc.includes('allergen', 'unicorn')).toBe(false);
  });
});

describe('VocabularyService — allergen aliases', () => {
  let svc: VocabularyService;

  beforeEach(async () => {
    svc = new VocabularyService(
      makeRepository({
        allergens: [allergen({ key: 'peanut', alias_keys: ['groundnut', 'arachis'] })],
        dietary: [],
        cultural: [],
        cuisines: [],
      }),
      makeLogger(),
    );
    await svc.load();
  });

  it('resolves a canonical key to itself', () => {
    expect(svc.resolveAllergen('peanut')).toBe('peanut');
  });

  it('resolves an alias to its canonical key', () => {
    expect(svc.resolveAllergen('groundnut')).toBe('peanut');
    expect(svc.resolveAllergen('arachis')).toBe('peanut');
  });

  it('returns undefined for unknown inputs', () => {
    expect(svc.resolveAllergen('unicorn')).toBeUndefined();
  });

  it('validateAllergens dedupes + canonicalises', () => {
    const result = svc.validateAllergens(['peanut', 'groundnut', 'arachis']);
    expect(result).toEqual(['peanut']);
  });

  it('validateAllergens throws on unknown', () => {
    expect(() => svc.validateAllergens(['unicorn'])).toThrowError(/Unknown.*allergen/);
  });

  it('validateAllergens rejects inactive allergens', async () => {
    const s = new VocabularyService(
      makeRepository({
        allergens: [allergen({ key: 'retired', is_active: false })],
        dietary: [],
        cultural: [],
        cuisines: [],
      }),
      makeLogger(),
    );
    await s.load();
    expect(() => s.validateAllergens(['retired'])).toThrowError(/inactive/);
  });
});

describe('VocabularyService — dietary implies-closure', () => {
  it("expands 'vegan' to its implied closure", async () => {
    const svc = new VocabularyService(
      makeRepository({
        allergens: [],
        dietary: [
          dietary({ key: 'vegan', implies: ['vegetarian', 'dairy_free', 'egg_free'] }),
          dietary({ key: 'vegetarian' }),
          dietary({ key: 'dairy_free' }),
          dietary({ key: 'egg_free' }),
        ],
        cultural: [],
        cuisines: [],
      }),
      makeLogger(),
    );
    await svc.load();
    const expanded = svc.expandImpliesClosure(['vegan']);
    expect(new Set(expanded)).toEqual(new Set(['vegan', 'vegetarian', 'dairy_free', 'egg_free']));
  });

  it('handles transitive implies (jain → vegetarian → ...)', async () => {
    const svc = new VocabularyService(
      makeRepository({
        allergens: [],
        dietary: [
          dietary({ key: 'jain', implies: ['vegetarian', 'dairy_free'] }),
          dietary({ key: 'vegetarian', implies: ['no_meat'] }), // contrived chain
          dietary({ key: 'dairy_free' }),
          dietary({ key: 'no_meat' }),
        ],
        cultural: [],
        cuisines: [],
      }),
      makeLogger(),
    );
    await svc.load();
    const expanded = svc.expandImpliesClosure(['jain']);
    expect(new Set(expanded)).toEqual(new Set(['jain', 'vegetarian', 'dairy_free', 'no_meat']));
  });

  it('is bounded against cycles', async () => {
    const svc = new VocabularyService(
      makeRepository({
        allergens: [],
        dietary: [
          dietary({ key: 'a', implies: ['b'] }),
          dietary({ key: 'b', implies: ['a'] }),
        ],
        cultural: [],
        cuisines: [],
      }),
      makeLogger(),
    );
    await svc.load();
    const expanded = svc.expandImpliesClosure(['a']);
    expect(new Set(expanded)).toEqual(new Set(['a', 'b']));
  });

  it('passes through unknown tags (validation is a separate step)', async () => {
    const svc = new VocabularyService(
      makeRepository({ allergens: [], dietary: [], cultural: [], cuisines: [] }),
      makeLogger(),
    );
    await svc.load();
    expect(svc.expandImpliesClosure(['something_unknown'])).toEqual(['something_unknown']);
  });
});

describe('VocabularyService — cuisine parent fan-out', () => {
  let svc: VocabularyService;

  beforeEach(async () => {
    svc = new VocabularyService(
      makeRepository({
        allergens: [],
        dietary: [],
        cultural: [],
        cuisines: [
          cuisine({ key: 'asian' }),
          cuisine({ key: 'south_asian', parent_key: 'asian' }),
          cuisine({ key: 'north_indian', parent_key: 'south_asian' }),
          cuisine({ key: 'punjabi', parent_key: 'north_indian' }),
          cuisine({ key: 'european' }),
          cuisine({ key: 'mediterranean', parent_key: 'european' }),
          cuisine({ key: 'italian', parent_key: 'mediterranean' }),
        ],
      }),
      makeLogger(),
    );
    await svc.load();
  });

  it('expands a leaf cuisine up the hierarchy', () => {
    const expanded = svc.expandCuisineParents(['punjabi']);
    expect(new Set(expanded)).toEqual(new Set(['punjabi', 'north_indian', 'south_asian', 'asian']));
  });

  it('handles multiple inputs without duplicates', () => {
    const expanded = svc.expandCuisineParents(['north_indian', 'italian']);
    expect(new Set(expanded)).toEqual(
      new Set(['north_indian', 'south_asian', 'asian', 'italian', 'mediterranean', 'european']),
    );
  });

  it('top-level keys (no parent) return only themselves', () => {
    expect(svc.expandCuisineParents(['asian'])).toEqual(['asian']);
  });

  it('passes through unknown keys', () => {
    expect(svc.expandCuisineParents(['fictional_cuisine'])).toEqual(['fictional_cuisine']);
  });
});

describe('VocabularyService — snapshot', () => {
  it('returns the current snapshot with loaded_at timestamp', async () => {
    const svc = new VocabularyService(
      makeRepository({
        allergens: [allergen({ key: 'peanut' })],
        dietary: [dietary({ key: 'vegan' })],
        cultural: [],
        cuisines: [],
      }),
      makeLogger(),
    );
    await svc.load();
    const snap = svc.snapshot();
    expect(snap.allergen_tags).toHaveLength(1);
    expect(snap.dietary_tags).toHaveLength(1);
    expect(snap.cultural_tags).toHaveLength(0);
    expect(snap.cuisine_tags).toHaveLength(0);
    expect(Date.parse(snap.loaded_at)).toBeGreaterThan(0);
  });
});

// row helper not strictly needed but kept to suppress unused-import warning
// in case the type tooling tightens.
row;
