import { describe, it, expect } from 'vitest';
import { composeEditorialProse } from './brief-state.composer.js';
import type { ClearedAllergyEntry, PlanTileSummary } from '@hivekitchen/types';

// Story 13-s4 — deterministic editorial prose. NO LLM: composeEditorialProse is
// a pure function over the already-computed tile + cleared-allergy projections.
// These tests pin the exact templated strings so a copy regression is caught.

const CHILD_A = '44444444-4444-4444-8444-444444444444';
const CHILD_B = '55555555-5555-4555-8555-555555555555';

function mainItem(name: string, childId = CHILD_A): PlanTileSummary['items'][number] {
  return {
    plan_item_id: null,
    child_id: childId,
    slot: 'main',
    ingredients: [],
    name,
  };
}

function tile(
  day: PlanTileSummary['day'],
  items: PlanTileSummary['items'],
  paused = false,
): PlanTileSummary {
  return {
    day,
    items,
    paused,
    lunch_link_suppressed_children: [],
    child_ratings: {},
  };
}

function cleared(childName: string, allergen: string, childId = CHILD_A): ClearedAllergyEntry {
  return { child_id: childId, child_name: childName, allergen };
}

describe('composeEditorialProse', () => {
  it('templates an easy-week headline + leftover line when a main repeats', () => {
    const result = composeEditorialProse({
      tileSummaries: [
        tile('monday', [mainItem('Pasta Bake')]),
        tile('tuesday', [mainItem('Pasta Bake')]),
        tile('wednesday', [mainItem('Rice Bowls')]),
      ],
      clearedAllergies: [],
    });

    expect(result.moment_headline).toBe('An easy week.');
    expect(result.lumi_note).toBe('You cook 2 times, not 3 — 1 day runs on leftovers.');
  });

  it('weaves a cleared-allergen memory phrase into the note (single child, multiple allergens)', () => {
    const result = composeEditorialProse({
      tileSummaries: [
        tile('monday', [mainItem('Rice Bowls')]),
        tile('tuesday', [mainItem('Tacos')]),
      ],
      clearedAllergies: [cleared('Maya', 'peanuts'), cleared('Maya', 'dairy')],
    });

    expect(result.moment_headline).toBe('Your week, ready.');
    expect(result.lumi_note).toBe(
      "2 lunch days, planned and ready. Maya's meals are peanuts and dairy-free — I kept that in mind.",
    );
  });

  it('emits separate per-child sentences for multiple children with different allergens', () => {
    const result = composeEditorialProse({
      tileSummaries: [
        tile('monday', [mainItem('Rice Bowls')]),
        tile('tuesday', [mainItem('Tacos')]),
        tile('wednesday', [mainItem('Soup', CHILD_B)], true),
      ],
      clearedAllergies: [cleared('Maya', 'peanuts'), cleared('Sam', 'eggs', CHILD_B)],
    });

    expect(result.lumi_note).toBe(
      "2 lunch days, planned and ready. Maya's meals are peanuts-free — I kept that in mind. Sam's meals are eggs-free — I kept that in mind. Wednesday is paused, just as you asked.",
    );
  });

  it('falls back to the day-count line when no main names are resolved', () => {
    const result = composeEditorialProse({
      tileSummaries: [
        tile('monday', [{ plan_item_id: null, child_id: CHILD_A, slot: 'main', ingredients: [] }]),
      ],
      clearedAllergies: [],
    });

    expect(result.moment_headline).toBe('Your week, ready.');
    expect(result.lumi_note).toBe('1 lunch day, planned and ready.');
  });

  it('uses day-count line (not cook-count) when only some tiles have named mains', () => {
    // P1: partial catalog — 3 active tiles but only 2 have names; should not
    // claim "cook N times, not 3" because the count would be wrong.
    const result = composeEditorialProse({
      tileSummaries: [
        tile('monday', [mainItem('Pasta Bake')]),
        tile('tuesday', [mainItem('Pasta Bake')]),
        tile('wednesday', [{ plan_item_id: null, child_id: CHILD_A, slot: 'main', ingredients: [] }]),
      ],
      clearedAllergies: [],
    });

    expect(result.moment_headline).toBe('Your week, ready.');
    expect(result.lumi_note).toBe('3 lunch days, planned and ready.');
  });

  it('returns a neutral but non-empty answer for an empty plan', () => {
    const result = composeEditorialProse({ tileSummaries: [], clearedAllergies: [] });

    expect(result.moment_headline).toBe("Your week's ready.");
    expect(result.lumi_note).toBe('Your week is planned and ready.');
  });

  it('does not produce a contradictory note when all tiles are paused', () => {
    // P2: "planned and ready" + "all days paused" would directly contradict.
    const result = composeEditorialProse({
      tileSummaries: [
        tile('monday', [mainItem('Pasta Bake')], true),
        tile('tuesday', [mainItem('Pasta Bake')], true),
      ],
      clearedAllergies: [],
    });

    expect(result.lumi_note).toBe('Monday and Tuesday are paused, just as you asked.');
    expect(result.lumi_note).not.toMatch(/planned and ready/);
  });

  it('is deterministic — same input yields byte-identical output', () => {
    const input = {
      tileSummaries: [tile('monday', [mainItem('Pasta Bake')]), tile('tuesday', [mainItem('Pasta Bake')])],
      clearedAllergies: [cleared('Maya', 'peanuts')],
    };

    expect(composeEditorialProse(input)).toEqual(composeEditorialProse(input));
  });
});
