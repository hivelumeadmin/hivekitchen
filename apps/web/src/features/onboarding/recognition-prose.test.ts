import { describe, it, expect } from 'vitest';
import type { KitchenMap } from '@hivekitchen/types';
import { buildRecognitionProse } from './recognition-prose.js';

// Minimal authoritative-projection fixture (mirrors KitchenMapHero.test). Only
// the fields the prose builder reads are populated.
function makeMap(overrides: Partial<KitchenMap>): KitchenMap {
  const base = {
    household: {
      id: '00000000-0000-4000-8000-000000000001',
      tier: 'standard',
      timezone: 'UTC',
      display_name: null,
      cultural_identifiers: [],
      dietary_preferences: [],
      declared_allergens: [],
    },
    caregivers: [],
    children: [],
    cultural: { collective_identity: null, notes: [] },
    memory: { nodes: [] },
    allergens: [],
    dietary: [],
    food_preferences: [],
    favorite_lunches: [],
    rules: [],
    meta: { generated_at: '2026-07-01T00:00:00.000Z', version: 1 },
  };
  return { ...base, ...overrides } as unknown as KitchenMap;
}

function child(name: string, age_band: string) {
  return {
    id: `id-${name}`,
    name,
    age_band,
    declared_allergens: [],
    cultural_identifiers: [],
    dietary_preferences: [],
    bag_composition_pattern: null,
    school_policies: [],
  };
}

describe('buildRecognitionProse', () => {
  it('returns no segments for a null projection', () => {
    expect(buildRecognitionProse(null)).toEqual([]);
  });

  it('omits every category that has no data (never "you told me nothing about…")', () => {
    expect(buildRecognitionProse(makeMap({}))).toEqual([]);
  });

  it('plays back the family with age bands, joined naturally', () => {
    const map = makeMap({
      children: [child('Layla', 'preteen'), child('Adam', 'teen')] as never,
    });
    const family = buildRecognitionProse(map).find((s) => s.key === 'family');
    expect(family?.text).toBe("You're cooking for Layla (pre-teen) and Adam (teen).");
  });

  it('plays back allergens deduped across household and per-child rows', () => {
    const map = makeMap({
      household: { ...makeMap({}).household, declared_allergens: ['peanut'] },
      allergens: [{ child_id: 'id-Maya', allergen: 'peanut' }] as never,
      children: [{ ...child('Maya', 'child'), declared_allergens: ['dairy'] }] as never,
    });
    const safety = buildRecognitionProse(map).find((s) => s.key === 'safety');
    expect(safety?.text).toBe("I'm keeping peanut and dairy off every plate.");
  });

  it('plays back taste from dietary, cultural, and liked preferences', () => {
    const map = makeMap({
      household: {
        ...makeMap({}).household,
        dietary_preferences: ['vegetarian'],
        cultural_identifiers: ['south_indian'],
      },
      food_preferences: [
        { child_id: null, item: 'dosa', valence: 'loves', enforcement: 'default' },
        { child_id: null, item: 'okra', valence: 'dislikes', enforcement: 'default' },
      ] as never,
    });
    const taste = buildRecognitionProse(map).find((s) => s.key === 'taste');
    expect(taste?.text).toBe('You lean toward vegetarian, south_indian, and dosa.');
  });

  it('deduplicates taste tags case-insensitively', () => {
    const map = makeMap({
      household: {
        ...makeMap({}).household,
        dietary_preferences: ['Vegetarian'],
      },
      food_preferences: [
        { child_id: null, item: 'vegetarian', valence: 'loves', enforcement: 'default' },
      ] as never,
    });
    const taste = buildRecognitionProse(map).find((s) => s.key === 'taste');
    expect(taste?.text).toBe('You lean toward Vegetarian.');
  });

  it('plays back the starting-line lunches', () => {
    const map = makeMap({
      favorite_lunches: [
        { item: 'Idli', position: 0 },
        { item: 'Lemon rice', position: 1 },
      ] as never,
    });
    const lunches = buildRecognitionProse(map).find((s) => s.key === 'lunches');
    expect(lunches?.text).toBe("We'll start the week from Idli and Lemon rice.");
  });
});
