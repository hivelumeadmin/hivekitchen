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

const SYSTEM_PROMPT = `You generate a household-personalized discovery catalog of ~50 school lunch ideas as a flat JSON object. This catalog is shown to parents at Moment 5 of onboarding — the FIRST TIME they select meals they like. Its job is to help them discover what resonates, not to predict their choices. Diversity and surprise are as important as relevance.

Layer 1 only: emit names + tags, NEVER ingredients or instructions.

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

DIVERSITY — READ THIS BEFORE GENERATING A SINGLE ITEM:

PURPOSE: The parent has NOT yet told us their favorites. This catalog is a menu of possibilities. Show range. A parent who scans it and finds something that surprises and delights them is the goal — not a list of slight variations on the same dish.

STARCH / FORMAT HARD CAPS (count across ALL 50 items):
- Rice-based dishes (fried rice, rice plates, rice bowls, congee, any dish where rice is the primary base): MAX 4 items total. "Chicken rice", "rice plate", "fried rice", "rice tiffin" all count against this cap.
- Bread / wrap / flatbread-based (sandwiches, wraps, rolls, roti rolls, burritos, pita pockets): MAX 10 items.
- Noodle / pasta-based (lo mein, pasta salad, noodle stir-fry, etc.): MAX 8 items.
- Legume / grain bowls (dal bowl, chickpea bowl, lentil stew over grain, quinoa bowl): MAX 8 items.
- Protein-forward (grilled protein + salad/veg, skewers, stuffed peppers — no dominant carb): MAX 8 items.
- Remaining items: salads, soups, finger foods, baked items, snack boxes, other formats.

CUISINE SPREAD: Every cuisine in the snapshot's cuisine_tags must appear with items in AT LEAST 2 different starch/format categories. If the snapshot lists 4 cuisines, each must contribute items in at least 2 formats. Do not let one cuisine dominate the rice cap.

NO NEAR-DUPLICATES: Two items are near-duplicates if they share the same protein AND the same starch (e.g., "Greek chicken rice" and "Caribbean chicken rice" are the same — chicken + rice — and only ONE version may appear). Vary the protein OR vary the format, not just the cuisine adjective. "Chicken wrap" and "chicken fried rice" are acceptable as a pair (different format). "Greek chicken rice" and "Senegalese chicken rice" are NOT acceptable.

DIETARY COMPLIANCE: Respect dietary_flags from the snapshot across all items.

DO NOT EMIT:
- recipe-level fields (ingredients, instructions, prep_time, cook_time)
- compound-product items requiring trust in a single packaged item (sauces, dressings, spice blends)
- items whose safety depends on a specific brand/SKU
- exotic / hard-to-source items unsuitable for a parent's quick weekday lunch packing
- more than 4 items that are predominantly rice-based (this is a hard cap, not a guideline)`;

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
    'Generate ~50 school lunch ideas for this household. DIVERSITY IS THE PRIMARY SUCCESS CRITERION — the parent will see ~20 of these as selectable chips and needs to discover options that surprise and resonate. Hard caps: ≤4 rice-based dishes total across all 50 items. NO near-duplicates — "chicken rice" appearing in two cuisines (e.g. Greek chicken rice + Caribbean chicken rice) counts as ONE dish; pick the most representative form and vary the format for the second entry. Cover every declared cuisine with items in at least 2 different format categories (wrap, noodle, legume bowl, protein-forward, soup, etc.). Return the JSON object only.',
  );
  return { system: SYSTEM_PROMPT, user: userLines.join('\n') };
}

function formatList(values: readonly string[]): string {
  if (values.length === 0) return '<none>';
  return values.join(', ');
}
