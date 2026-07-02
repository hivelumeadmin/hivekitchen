import type { KitchenMap } from '@hivekitchen/types';

// Epic 13-s6 (AC5) — the recognition ending's prose playback, composed CLIENT-
// SIDE from the authoritative KitchenMap projection the hook already holds (no
// new endpoint, same fields the hero reads). Empty categories are omitted —
// Lumi never says "you told me nothing about…".

export interface RecognitionSegment {
  key: 'family' | 'safety' | 'taste' | 'lunches';
  text: string;
}

const AGE_BAND_WORD: Record<string, string> = {
  toddler: 'toddler',
  child: 'child',
  preteen: 'pre-teen',
  teen: 'teen',
};

function joinWithAnd(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function childLabel(child: KitchenMap['children'][number]): string {
  const band = AGE_BAND_WORD[child.age_band];
  return band !== undefined ? `${child.name} (${band})` : child.name;
}

// Allergens: household-wide rows + per-child rows, deduped by allergen — mirrors
// the hero's dedupe so the prose and the pills never disagree.
function allergenNames(kitchenMap: KitchenMap): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  const push = (a: string): void => {
    const key = a.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      names.push(a);
    }
  };
  for (const a of kitchenMap.household.declared_allergens ?? []) push(a);
  for (const a of kitchenMap.allergens ?? []) push(a.allergen);
  for (const c of kitchenMap.children ?? []) {
    for (const a of c.declared_allergens ?? []) push(a);
  }
  return names;
}

function tasteTags(kitchenMap: KitchenMap): string[] {
  const liked = (kitchenMap.food_preferences ?? [])
    .filter((p) => p.valence === 'loves' || p.valence === 'likes')
    .map((p) => p.item);
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const t of [
    ...(kitchenMap.household.dietary_preferences ?? []),
    ...(kitchenMap.household.cultural_identifiers ?? []),
    ...liked,
  ]) {
    if (!seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      tags.push(t);
    }
  }
  return tags;
}

export function buildRecognitionProse(kitchenMap: KitchenMap | null): RecognitionSegment[] {
  if (kitchenMap === null) return [];
  const segments: RecognitionSegment[] = [];

  const children = kitchenMap.children ?? [];
  if (children.length > 0) {
    segments.push({
      key: 'family',
      text: `You're cooking for ${joinWithAnd(children.map(childLabel))}.`,
    });
  }

  const allergens = allergenNames(kitchenMap);
  if (allergens.length > 0) {
    segments.push({
      key: 'safety',
      text: `I'm keeping ${joinWithAnd(allergens)} off every plate.`,
    });
  }

  const tastes = tasteTags(kitchenMap);
  if (tastes.length > 0) {
    segments.push({
      key: 'taste',
      text: `You lean toward ${joinWithAnd(tastes)}.`,
    });
  }

  const lunches = (kitchenMap.favorite_lunches ?? []).map((l) => l.item);
  if (lunches.length > 0) {
    segments.push({
      key: 'lunches',
      text: `We'll start the week from ${joinWithAnd(lunches)}.`,
    });
  }

  return segments;
}
