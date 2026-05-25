// Slice 2.6-s3 — Stage 1 catalog seeding LLM prompt.
//
// Builds the system + user pair sent to gpt-4o (NOT mini — see story Dev Notes
// for rationale on cultural breadth + allergen discipline). The LLM emits a
// JSON object with `items: CatalogSeedItem[]` — name + tags only, NO
// ingredients. Layer 2 materialization (via RecipeAgent.discover at plan-
// commit time) populates ingredients lazily.
//
// See: _bmad-output/implementation-artifacts/2.6-s3-stage-1-async-seeding-layer-1.md

export interface CatalogSeedSnapshotChild {
  readonly name: string;
  readonly age_band: string;
}

export interface CatalogSeedSnapshot {
  readonly household_display_name: string | null;
  readonly children: readonly CatalogSeedSnapshotChild[];
  // FALCPA allergen keys (peanut, tree_nut, dairy, egg, wheat, soy, fish,
  // shellfish, sesame) AND household-declared allergens. The LLM MUST omit
  // any item that could contain any of these.
  readonly allergen_exclusions: readonly string[];
  readonly cultural_tags: readonly string[];
  readonly cuisine_tags: readonly string[];
  readonly dietary_flags: readonly string[];
  // Open-vocabulary food likes/dislikes — informational only.
  readonly food_preferences: readonly string[];
  // Distinct slot keys (main / snack / extra) the household actually uses,
  // derived from children's bag_composition_pattern.
  readonly bag_composition_slots: readonly string[];
}

const SYSTEM_PROMPT = `You generate a household-personalized catalog of ~50 school lunch ideas as a flat JSON object. Layer 1 only: emit names + tags, NEVER ingredients or instructions.

OUTPUT SHAPE — return ONLY this JSON object (no preamble, no markdown fences, no commentary):

{
  "items": [
    {
      "canonical_name": "<short dish name>",
      "allergen_flags": ["<falcpa allergen keys this item DOES contain — should be empty for almost all items because allergen-containing items must be omitted entirely>"],
      "dietary_flags": ["<vegetarian | vegan | halal | kosher | ... — only flags that genuinely apply>"],
      "cultural_tags": ["<broad cultural identifiers — south_asian, east_african, halal, ...>"],
      "cuisine_tags": ["<specific cuisines — north_indian, somali, mexican, lebanese, ...>"],
      "applicable_slots": ["main" | "snack" | "extra"]
    },
    ...
  ]
}

HARD RULES — violations make the entire output unusable:
- NO ingredients, instructions, prep_time, descriptions, notes, or any field other than the six listed above.
- AVOID ALL FALCPA allergens named in the snapshot. If a dish could plausibly contain a listed allergen (peanut, tree nut, dairy, egg, wheat, soy, fish, shellfish, sesame, or any household-declared allergen), OMIT THE ENTIRE ITEM. Do NOT trust that emitting allergen_flags: [] makes a peanut-containing dish safe — the only safe peanut dish for a peanut household is one that has been omitted from the catalog.
- canonical_name must be a short, recognizable dish name (max ~100 chars). Family-style, school-lunch-appropriate. No proper-noun brand names.
- applicable_slots is at least one of ["main", "snack", "extra"]; most items are ["main"].
- Output MUST be a single valid JSON object with the "items" key at root. No Markdown code fences. No leading or trailing prose.

DIVERSITY:
- Target approximately 50 items. No hard upper bound, no hard floor — quality over count.
- Weight strongly toward the cuisine buckets in the snapshot. If cuisines are sparse (cold-start households), still emit a culturally diverse mix.
- Respect dietary_flags from the snapshot: if the household is halal-only, do not emit pork-containing or non-halal items; if vegetarian, no meat/fish items; etc.

DO NOT EMIT:
- recipe-level fields (ingredients, instructions, prep_time, cook_time)
- compound-product items requiring trust in a single packaged item (sauces, dressings, spice blends, marinades)
- items whose safety depends on a specific brand/SKU
- exotic / hard-to-source items unsuitable for a parent's quick weekday lunch packing`;

export function buildCatalogSeedPrompt(
  snapshot: CatalogSeedSnapshot,
): { system: string; user: string } {
  const userLines: string[] = ['HOUSEHOLD SNAPSHOT'];
  if (snapshot.household_display_name !== null && snapshot.household_display_name.length > 0) {
    userLines.push(`household_label: ${snapshot.household_display_name}`);
  }
  if (snapshot.children.length > 0) {
    userLines.push('children:');
    for (const c of snapshot.children) {
      userLines.push(`  - ${c.name} (${c.age_band})`);
    }
  } else {
    userLines.push('children: <none declared>');
  }
  userLines.push(
    `allergen_exclusions (must be ABSENT from every item): ${formatList(snapshot.allergen_exclusions)}`,
  );
  userLines.push(`cultural_tags: ${formatList(snapshot.cultural_tags)}`);
  userLines.push(`cuisine_tags: ${formatList(snapshot.cuisine_tags)}`);
  userLines.push(`dietary_flags: ${formatList(snapshot.dietary_flags)}`);
  userLines.push(`food_preferences: ${formatList(snapshot.food_preferences)}`);
  userLines.push(`bag_composition_slots: ${formatList(snapshot.bag_composition_slots)}`);
  userLines.push('');
  userLines.push(
    'Generate ~50 lunch ideas calibrated to this snapshot. Return the JSON object only.',
  );
  return { system: SYSTEM_PROMPT, user: userLines.join('\n') };
}

function formatList(values: readonly string[]): string {
  if (values.length === 0) return '<none>';
  return values.join(', ');
}
