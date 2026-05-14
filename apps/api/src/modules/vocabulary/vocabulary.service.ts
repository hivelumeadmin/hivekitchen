import type { FastifyBaseLogger } from 'fastify';
import type {
  AllergenTagRow,
  CulturalTagRow,
  CuisineTagRow,
  DietaryTagRow,
  VocabularySnapshot,
} from '@hivekitchen/types';
import type { VocabularyRepository } from './vocabulary.repository.js';

export type VocabularyCategory = 'allergen' | 'dietary' | 'cultural' | 'cuisine';

const IMPLIES_SAFETY_BOUND = 32; // dietary implies-closure traversal cap
const PARENT_SAFETY_BOUND = 8; // cuisine parent-chain traversal cap

/**
 * Slice A0.5 — in-memory cache of the four vocabulary tables.
 *
 * Loaded once at startup via the Fastify plugin. Provides O(1) lookups,
 * alias resolution for allergens, implies-closure expansion for dietary
 * tags, and parent-chain expansion for cuisines.
 *
 * Callers that write tag arrays to recipes / children / etc. validate
 * via this service before persisting. Postgres can't FK array elements,
 * so this is the enforcement boundary.
 *
 * Refresh: call `load()` again to pick up vocabulary changes. Today this
 * happens only at startup; if ops add vocabulary at runtime, restart the
 * API. A future enhancement would subscribe to Postgres NOTIFY events
 * for the *_tags tables and call load() reactively.
 */
export class VocabularyService {
  private allergens = new Map<string, AllergenTagRow>();
  private allergenAliases = new Map<string, string>(); // alias key → canonical key
  private dietary = new Map<string, DietaryTagRow>();
  private cultural = new Map<string, CulturalTagRow>();
  private cuisines = new Map<string, CuisineTagRow>();
  private loadedAt: string | null = null;

  constructor(
    private readonly repository: VocabularyRepository,
    private readonly logger: FastifyBaseLogger,
  ) {}

  /** Populates all four maps from the DB. Replaces any existing data. */
  async load(): Promise<void> {
    const raw = await this.repository.loadAll();

    this.allergens.clear();
    this.allergenAliases.clear();
    for (const row of raw.allergens) {
      this.allergens.set(row.key, row);
      if (row.is_active) {
        for (const alias of row.alias_keys) {
          this.allergenAliases.set(alias, row.key);
        }
      }
    }

    this.dietary.clear();
    for (const row of raw.dietary) {
      this.dietary.set(row.key, row);
    }

    this.cultural.clear();
    for (const row of raw.cultural) {
      this.cultural.set(row.key, row);
    }

    this.cuisines.clear();
    for (const row of raw.cuisines) {
      this.cuisines.set(row.key, row);
    }

    this.loadedAt = new Date().toISOString();
    this.logger.info(
      {
        module: 'vocabulary',
        action: 'vocabulary.loaded',
        counts: {
          allergens: this.allergens.size,
          dietary: this.dietary.size,
          cultural: this.cultural.size,
          cuisines: this.cuisines.size,
        },
      },
      'vocabulary loaded',
    );
  }

  /** True if the given tag exists in the vocabulary (active or not). */
  includes(category: VocabularyCategory, key: string): boolean {
    switch (category) {
      case 'allergen':
        return this.allergens.has(key);
      case 'dietary':
        return this.dietary.has(key);
      case 'cultural':
        return this.cultural.has(key);
      case 'cuisine':
        return this.cuisines.has(key);
    }
  }

  /** True if the tag exists AND is active. */
  isActive(category: VocabularyCategory, key: string): boolean {
    const row = this.row(category, key);
    return row?.is_active ?? false;
  }

  row(
    category: VocabularyCategory,
    key: string,
  ): AllergenTagRow | DietaryTagRow | CulturalTagRow | CuisineTagRow | undefined {
    switch (category) {
      case 'allergen':
        return this.allergens.get(key);
      case 'dietary':
        return this.dietary.get(key);
      case 'cultural':
        return this.cultural.get(key);
      case 'cuisine':
        return this.cuisines.get(key);
    }
  }

  /**
   * Resolves an allergen alias to its canonical key, or returns the input
   * if already canonical. Returns undefined when neither.
   *   resolveAllergen('peanut')     → 'peanut'
   *   resolveAllergen('groundnut')  → 'peanut'
   *   resolveAllergen('unicorn')    → undefined
   */
  resolveAllergen(input: string): string | undefined {
    if (this.allergens.has(input)) return input;
    return this.allergenAliases.get(input);
  }

  /**
   * Validates each input is a known active allergen tag (or alias), returning
   * the deduplicated set of canonical keys. Throws on any unknown key.
   */
  validateAllergens(keys: readonly string[]): string[] {
    const resolved = new Set<string>();
    for (const k of keys) {
      const r = this.resolveAllergen(k);
      if (r === undefined || !this.isActive('allergen', r)) {
        throw new Error(`Unknown or inactive allergen tag: ${k}`);
      }
      resolved.add(r);
    }
    return [...resolved];
  }

  /** Validates each input is a known active dietary tag. Throws on unknown. */
  validateDietary(keys: readonly string[]): string[] {
    for (const k of keys) {
      if (!this.isActive('dietary', k)) {
        throw new Error(`Unknown or inactive dietary tag: ${k}`);
      }
    }
    return [...new Set(keys)];
  }

  /** Validates each input is a known active cultural tag. Throws on unknown. */
  validateCultural(keys: readonly string[]): string[] {
    for (const k of keys) {
      if (!this.isActive('cultural', k)) {
        throw new Error(`Unknown or inactive cultural tag: ${k}`);
      }
    }
    return [...new Set(keys)];
  }

  /** Validates each input is a known active cuisine tag. Throws on unknown. */
  validateCuisine(keys: readonly string[]): string[] {
    for (const k of keys) {
      if (!this.isActive('cuisine', k)) {
        throw new Error(`Unknown or inactive cuisine tag: ${k}`);
      }
    }
    return [...new Set(keys)];
  }

  /**
   * Expands the implies-closure for a set of dietary tags.
   *
   *   expandImpliesClosure(['vegan']) →
   *     ['vegan', 'vegetarian', 'dairy_free', 'egg_free']
   *
   * Used by RecipesService at write time so the agent only has to emit the
   * narrowest tag and the service fans it out. Bounded by IMPLIES_SAFETY_BOUND
   * to defend against cycles in malformed `implies` graphs.
   */
  expandImpliesClosure(keys: readonly string[]): string[] {
    const result = new Set<string>(keys);
    let safety = IMPLIES_SAFETY_BOUND;
    let changed = true;
    while (changed && safety-- > 0) {
      changed = false;
      for (const k of Array.from(result)) {
        const tag = this.dietary.get(k);
        if (!tag) continue;
        for (const implied of tag.implies) {
          if (!result.has(implied)) {
            result.add(implied);
            changed = true;
          }
        }
      }
    }
    return [...result];
  }

  /**
   * Expands a set of cuisine tags to include all ancestors in the parent
   * hierarchy.
   *
   *   expandCuisineParents(['north_indian']) →
   *     ['north_indian', 'south_asian', 'asian']
   *
   * Used by RecipesService at write time so a recipe tagged with the
   * narrowest cuisine becomes discoverable at every level of the region
   * hierarchy without recursive CTEs at read time.
   */
  expandCuisineParents(keys: readonly string[]): string[] {
    const result = new Set<string>(keys);
    for (const k of keys) {
      let current = this.cuisines.get(k);
      let safety = PARENT_SAFETY_BOUND;
      while (current?.parent_key && safety-- > 0) {
        if (result.has(current.parent_key)) break;
        result.add(current.parent_key);
        current = this.cuisines.get(current.parent_key);
      }
    }
    return [...result];
  }

  /**
   * Returns the current vocabulary snapshot — used by agent prompt
   * augmentation. Lightweight: just maps over the in-memory caches.
   */
  snapshot(): VocabularySnapshot {
    return {
      allergen_tags: [...this.allergens.values()],
      dietary_tags: [...this.dietary.values()],
      cultural_tags: [...this.cultural.values()],
      cuisine_tags: [...this.cuisines.values()],
      loaded_at: this.loadedAt ?? new Date(0).toISOString(),
    };
  }
}
