import type { FastifyBaseLogger } from 'fastify';
import { describe, it, expect } from 'vitest';
import { BagCompositionPatternSchema } from '@hivekitchen/contracts';
import type {
  AllergenTagRow,
  CuisineTagRow,
  DietaryTagRow,
  CulturalTagRow,
} from '@hivekitchen/types';
import { VocabularyService } from '../vocabulary/vocabulary.service.js';
import type { RawVocabularyData, VocabularyRepository } from '../vocabulary/vocabulary.repository.js';
import {
  buildM2AllergenChips,
  buildM3TasteChips,
  buildM4BagChips,
  M3_DIETARY_CHIP_KEYS,
  M3_CUISINE_CHIP_KEYS,
} from './onboarding-chips.js';

// ===========================================================================
// Slice 2.7-s5 — chip-source drift guard.
// ===========================================================================
// The hand-copied chip lists used to be kept in sync with their tool/vocab
// keys by comments ("copied verbatim from Moment2Page.tsx", "mirror
// BagCompositionPatternSchema exactly") — three silent drift points with no
// test. This is the drift guard the comments never had: it asserts the
// generated chip KEY SETS equal the accepted tool/vocab keys for M2/M3/M4.
//
// The vocabulary fixture below mirrors the seed migration
// (supabase/migrations/20260820000100 + 20260902000400) for the rows the chips
// touch. If ops add a FALCPA allergen, the M2 set-equality assertion fails
// until it is reflected here AND in onboarding-chips.ts — making the drift
// loud instead of silent.
// ===========================================================================

const NOW = '2026-06-26T00:00:00.000Z';

function allergen(
  key: string,
  rule_class: AllergenTagRow['rule_class'],
  sort_order: number,
): AllergenTagRow {
  return {
    key,
    display_name: key,
    rule_class,
    legal_jurisdiction: [],
    severity_default: 'block',
    alias_keys: [],
    display_icon: null,
    description: null,
    is_active: true,
    sort_order,
    created_at: NOW,
    updated_at: NOW,
  };
}

function dietary(key: string, sort_order: number): DietaryTagRow {
  return {
    key,
    display_name: key,
    category: 'plant_based',
    implies: [],
    conflicts_with: [],
    description: null,
    is_active: true,
    sort_order,
    created_at: NOW,
    updated_at: NOW,
  };
}

function cuisine(key: string, sort_order: number): CuisineTagRow {
  return {
    key,
    display_name: key,
    parent_key: null,
    region: null,
    description: null,
    is_active: true,
    sort_order,
    created_at: NOW,
    updated_at: NOW,
  };
}

// FALCPA-9 (the M2 chip set) in seed sort_order, plus two non-FALCPA rows that
// must NOT appear in M2 chips (proves the rule_class filter).
const FALCPA_KEYS = ['peanut', 'tree_nut', 'dairy', 'egg', 'wheat', 'soy', 'fish', 'shellfish', 'sesame'];
const ALLERGEN_ROWS: AllergenTagRow[] = [
  ...FALCPA_KEYS.map((k, i) => allergen(k, 'falcpa', (i + 1) * 10)),
  allergen('mustard', 'extended', 100),
  allergen('gluten', 'sensitivity', 200),
];

// All M3 chip dietary/cuisine keys + a few extra active vocab rows the chips do
// NOT surface (the curated subset is intentionally narrower than the vocab).
const DIETARY_ROWS: DietaryTagRow[] = [
  ...M3_DIETARY_CHIP_KEYS.map((k, i) => dietary(k, (i + 1) * 10)),
  dietary('jain', 1000),
  dietary('keto', 1010),
];

const CUISINE_ROWS: CuisineTagRow[] = [
  ...M3_CUISINE_CHIP_KEYS.map((k, i) => cuisine(k, (i + 1) * 10)),
  cuisine('thai', 1000),
  cuisine('french', 1010),
];

const CULTURAL_ROWS: CulturalTagRow[] = [];

function makeVocabularyService(): VocabularyService {
  const data: RawVocabularyData = {
    allergens: ALLERGEN_ROWS,
    dietary: DIETARY_ROWS,
    cultural: CULTURAL_ROWS,
    cuisines: CUISINE_ROWS,
  };
  const repo = { loadAll: async (): Promise<RawVocabularyData> => data } as unknown as VocabularyRepository;
  const logger = { info: () => undefined } as unknown as FastifyBaseLogger;
  return new VocabularyService(repo, logger);
}

describe('onboarding chip drift guard — M2 (allergen vocabulary)', () => {
  it('generated M2 chip keys ≡ the active FALCPA allergen keys', async () => {
    const vocab = makeVocabularyService();
    await vocab.load();

    const chips = buildM2AllergenChips(vocab.snapshot());
    const keys = (chips.options ?? []).map((o) => o.key);

    // First option is the exclusive control key, not a vocab key.
    expect(keys[0]).toBe('none');
    const allergenKeys = keys.slice(1);

    // Set-equality with the active FALCPA set — drift here is loud.
    expect(new Set(allergenKeys)).toEqual(new Set(FALCPA_KEYS));
    // Non-FALCPA allergens are excluded.
    expect(allergenKeys).not.toContain('mustard');
    expect(allergenKeys).not.toContain('gluten');
  });

  it('every generated M2 chip key is accepted by allergen.declare (validateAllergens)', async () => {
    const vocab = makeVocabularyService();
    await vocab.load();
    const allergenKeys = (buildM2AllergenChips(vocab.snapshot()).options ?? [])
      .map((o) => o.key)
      .filter((k) => k !== 'none');
    expect(() => vocab.validateAllergens(allergenKeys)).not.toThrow();
  });

  it('falls back to the canonical FALCPA-9 when no snapshot is available', () => {
    const keys = (buildM2AllergenChips(undefined).options ?? []).map((o) => o.key);
    expect(keys[0]).toBe('none');
    expect(new Set(keys.slice(1))).toEqual(new Set(FALCPA_KEYS));
  });
});

describe('onboarding chip drift guard — M3 (dietary + cuisine vocabulary)', () => {
  it('every M3 dietary chip key is active + accepted by dietary.declare', async () => {
    const vocab = makeVocabularyService();
    await vocab.load();
    for (const key of M3_DIETARY_CHIP_KEYS) {
      expect(vocab.isActive('dietary', key), `dietary key ${key}`).toBe(true);
    }
    expect(() => vocab.validateDietary([...M3_DIETARY_CHIP_KEYS])).not.toThrow();
  });

  it('every M3 cuisine chip key is active + accepted by cuisine.declare', async () => {
    const vocab = makeVocabularyService();
    await vocab.load();
    for (const key of M3_CUISINE_CHIP_KEYS) {
      expect(vocab.isActive('cuisine', key), `cuisine key ${key}`).toBe(true);
    }
    expect(() => vocab.validateCuisine([...M3_CUISINE_CHIP_KEYS])).not.toThrow();
  });

  it('the M3 chip option keys are exactly the dietary set followed by the cuisine set', () => {
    const keys = (buildM3TasteChips().options ?? []).map((o) => o.key);
    expect(keys).toEqual([...M3_DIETARY_CHIP_KEYS, ...M3_CUISINE_CHIP_KEYS]);
  });
});

describe('onboarding chip drift guard — M4 (BagCompositionPatternSchema)', () => {
  it('generated M4 chip keys ≡ the contract enum options', () => {
    const keys = (buildM4BagChips().options ?? []).map((o) => o.key);
    expect(keys).toEqual([...BagCompositionPatternSchema.options]);
  });
});
