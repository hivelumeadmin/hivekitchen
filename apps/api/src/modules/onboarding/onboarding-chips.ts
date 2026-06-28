// ===========================================================================
// Slice 2.7-s5 — Chips as a single deterministic, tested source
// ===========================================================================
// Before this slice the M2/M3/M4 chip option lists were hand-copied literal
// arrays inside `momentToChipConfig`, kept in sync with their tool/vocab keys
// by comments ("copied verbatim from Moment2Page.tsx", "mirror
// BagCompositionPatternSchema exactly") — three silent drift points with no
// test. This module makes the chip KEY SETS derive from their source of truth:
//   - M2 allergen keys  → the FALCPA subset of the allergen vocabulary,
//   - M4 bag keys       → BagCompositionPatternSchema (the contract enum),
//   - M3 dietary/cuisine keys → curated subsets, validated against the
//     dietary/cuisine vocabulary by the drift test (the full active vocab is
//     ~90 rows — far more than the curated onboarding chip set; the curation
//     itself is a product decision, but every curated key must be a live,
//     tool-accepted vocab key).
//
// The DISPLAY LABELS stay hand-authored UX copy (e.g. wheat → "Wheat / gluten",
// gluten_free → "Gluten-free", main_plus_extra → "Main + sides") — they are NOT
// the vocabulary `display_name` and must not be derived from it. The drift
// guard is therefore key-only: `onboarding-chips.drift.test.ts` asserts the
// generated KEYS ≡ the accepted tool/vocab keys for M2/M3/M4.
// ===========================================================================

import {
  BagCompositionPatternSchema,
  type ChipConfig,
  type ChipOption,
} from '@hivekitchen/contracts';
import type { VocabularySnapshot } from '@hivekitchen/types';

// ---- M2 — allergens (FALCPA subset of the allergen vocabulary) -------------

// Curated UX labels for the FALCPA allergen chips. Keyed by vocab key; the
// builder falls back to the vocabulary display_name for any newly-added FALCPA
// allergen that has no curated label yet (so a fresh INSERT still lights up a
// chip — AC1 — rather than vanishing).
const M2_ALLERGEN_LABELS: Readonly<Record<string, string>> = {
  peanut: 'Peanut',
  tree_nut: 'Tree nuts',
  dairy: 'Dairy',
  egg: 'Eggs',
  soy: 'Soy',
  wheat: 'Wheat / gluten',
  fish: 'Fish',
  shellfish: 'Shellfish',
  sesame: 'Sesame',
};

// The exclusive "no known allergens" option. NOT a vocabulary key — a control
// key the client mutually-excludes against the rest (AC6) and the service maps
// to "fire no allergen.declare".
export const M2_NONE_OPTION: ChipOption = { key: 'none', label: 'No known allergens' };

// Curated DISPLAY ORDER for the known FALCPA allergens (matches Moment2Page.tsx
// and the eval goldens — notably soy BEFORE wheat, which the vocab sort_order
// does not). Used directly as the fallback when no snapshot is available, and
// as the leading order when generating from a snapshot; any newly-added FALCPA
// allergen not listed here is appended after, in vocab sort_order, so it still
// lights up (AC1). The drift test asserts this set ≡ the active FALCPA set.
const M2_ALLERGEN_ORDER: readonly string[] = [
  'peanut', 'tree_nut', 'dairy', 'egg', 'soy', 'wheat', 'fish', 'shellfish', 'sesame',
];

export function m2AllergenLabel(key: string, displayName?: string): string {
  return M2_ALLERGEN_LABELS[key] ?? displayName ?? key;
}

/**
 * Builds the M2 allergen chip set from the live allergen vocabulary: the active
 * `rule_class='falcpa'` rows, in the curated display order (new keys appended
 * in sort_order), prefixed with the exclusive "no known allergens" option.
 * Adding a FALCPA allergen to the vocabulary lights up its chip automatically
 * (AC1).
 *
 * When `snapshot` is undefined or contains no FALCPA rows (the eval vocab fake
 * returns an empty snapshot), falls back to the canonical curated FALCPA-9 set
 * so the chip behaviour is identical to the pre-slice literal list.
 */
export function buildM2AllergenChips(snapshot?: VocabularySnapshot): ChipConfig {
  const falcpa = (snapshot?.allergen_tags ?? []).filter(
    (t) => t.is_active && t.rule_class === 'falcpa',
  );

  let options: ChipOption[];
  if (falcpa.length === 0) {
    options = M2_ALLERGEN_ORDER.map((k) => ({ key: k, label: m2AllergenLabel(k) }));
  } else {
    const byKey = new Map(falcpa.map((t) => [t.key, t]));
    // Curated-order keys that exist in the vocab first…
    const ordered = M2_ALLERGEN_ORDER.filter((k) => byKey.has(k));
    // …then any new FALCPA keys not in the curated order, by sort_order.
    const extras = falcpa
      .filter((t) => !M2_ALLERGEN_ORDER.includes(t.key))
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((t) => t.key);
    options = [...ordered, ...extras].map((k) => ({
      key: k,
      label: m2AllergenLabel(k, byKey.get(k)?.display_name),
    }));
  }

  return { mode: 'choice', options: [M2_NONE_OPTION, ...options] };
}

// ---- M3 — dietary + cuisine identity (curated vocabulary subset) -----------
//
// Curated KEY subsets of dietary_tags / cuisine_tags. These are a deliberate
// product curation (the full active vocab is ~90 rows); the drift test asserts
// each key is active in its vocabulary AND accepted by dietary.declare /
// cuisine.declare. Labels are curated UX copy.

export const M3_DIETARY_CHIP_KEYS: readonly string[] = [
  'halal', 'kosher', 'vegetarian', 'vegan', 'pescatarian', 'gluten_free', 'dairy_free',
];

export const M3_CUISINE_CHIP_KEYS: readonly string[] = [
  'south_indian', 'north_indian', 'east_african', 'caribbean', 'levantine',
  'italian', 'mexican', 'japanese', 'chinese', 'mediterranean',
];

const M3_CHIP_LABELS: Readonly<Record<string, string>> = {
  // Dietary identity
  halal: 'Halal',
  kosher: 'Kosher',
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
  pescatarian: 'Pescatarian',
  gluten_free: 'Gluten-free',
  dairy_free: 'Dairy-free',
  // Cuisine identity
  south_indian: 'South Indian',
  north_indian: 'North Indian',
  east_african: 'East African',
  caribbean: 'Caribbean',
  levantine: 'Levantine',
  italian: 'Italian',
  mexican: 'Mexican',
  japanese: 'Japanese',
  chinese: 'Chinese',
  mediterranean: 'Mediterranean',
};

const M3_DIETARY_KEY_SET = new Set(M3_DIETARY_CHIP_KEYS);
const M3_CUISINE_KEY_SET = new Set(M3_CUISINE_CHIP_KEYS);

/** M3 — dietary + cuisine choice chips with first-class Skip (M3 is optional). */
export function buildM3TasteChips(): ChipConfig {
  const options: ChipOption[] = [...M3_DIETARY_CHIP_KEYS, ...M3_CUISINE_CHIP_KEYS].map((k) => ({
    key: k,
    label: M3_CHIP_LABELS[k] ?? k,
  }));
  return { mode: 'choice', options, skip_label: 'Skip this moment' };
}

export function isM3DietaryKey(key: string): boolean {
  return M3_DIETARY_KEY_SET.has(key);
}

export function isM3CuisineKey(key: string): boolean {
  return M3_CUISINE_KEY_SET.has(key);
}

export function m3ChipLabel(key: string): string {
  return M3_CHIP_LABELS[key] ?? key;
}

// ---- M4 — bag composition (BagCompositionPatternSchema enum) ----------------

const M4_BAG_LABELS: Readonly<Record<string, string>> = {
  main_only: 'Main only',
  main_plus_snack: 'Main + snack',
  main_plus_extra: 'Main + sides',
  main_plus_snack_plus_extra: 'Full bag',
};

/** M4 — single-select bag-composition action chips, derived from the contract
 *  enum so adding a pattern lights up its chip automatically (AC1). */
export function buildM4BagChips(): ChipConfig {
  const options: ChipOption[] = BagCompositionPatternSchema.options.map((k) => ({
    key: k,
    label: M4_BAG_LABELS[k] ?? k,
  }));
  return { mode: 'action', options };
}

export function m4BagLabel(key: string): string {
  return M4_BAG_LABELS[key] ?? key;
}

// ---- Ratification (M3 enforcement gradient) --------------------------------
//
// Slice 2.7-s5 — rendered when a dietary.declare / cuisine.declare tool RESULT
// carries ratification_requested=true (replaces the [CHIP_PROMPT:elevation:…]
// prose sentinel). Single-select, no skip — the soft path is "just-context".
export const RATIFICATION_CHIPS: ChipConfig = {
  mode: 'action',
  options: [
    { key: 'always-respect', label: 'Always respect' },
    { key: 'prefer', label: 'Prefer when possible' },
    { key: 'just-context', label: 'Just for context' },
  ],
};

// ---- Zero-call acknowledgment templates (Option A, AC2) --------------------
//
// When a parent answers a moment entirely by tapping chips (no free text), the
// service applies the tool calls deterministically and fills one of these
// templates — zero conversational LLM calls. Decided by Menon 2026-06-26.

/** M2: list the household-wide allergens noted, or acknowledge "no allergens". */
export function m2AckTemplate(allergenLabels: readonly string[]): string {
  if (allergenLabels.length === 0) {
    return 'Good to know — no allergens to keep out of the plans, then.';
  }
  return `Got it — I've noted ${formatList(allergenLabels)} to keep out of every plan.`;
}

/** M3: acknowledge the selected dietary/cuisine identity, or a skip. */
export function m3AckTemplate(selectionLabels: readonly string[]): string {
  if (selectionLabels.length === 0) {
    return 'Of course — we can always fill that in later.';
  }
  return `Lovely — ${formatList(selectionLabels)} noted.`;
}

/** M4: acknowledge the chosen bag pattern. */
export function m4AckTemplate(bagLabel: string): string {
  return `Perfect — ${bagLabel} it is.`;
}

function formatList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}
