import type { CulturalTemplateKey } from '../../../services/cultural-calendar.service.js';
import type { ChildSignalOutput } from '@hivekitchen/types';
import type { PlannerContext, PlannerRecipeCandidate } from './assemble.js';

const CULTURAL_TEMPLATE_DISPLAY_NAMES: Record<CulturalTemplateKey, string> = {
  halal: 'Halal',
  kosher: 'Kosher',
  hindu_vegetarian: 'Hindu vegetarian',
  south_asian: 'South Asian',
  east_african: 'East African',
  caribbean: 'Caribbean',
};

// Story 3.18 — translates the structured cultural context into the
// natural-language lines the planner agent receives in its user message.
// Returns an empty list for silence-mode households so the prompt stays
// neutral.
export function buildCulturalContextLines(ctx: PlannerContext): string[] {
  const context = ctx.culturalContext;
  if (context === undefined) return [];

  const lines: string[] = [];

  if (context.culturalTemplates.length > 0) {
    const displayNames = context.culturalTemplates.map(
      (k) => CULTURAL_TEMPLATE_DISPLAY_NAMES[k] ?? k,
    );
    lines.push(
      `Cultural templates ratified by this household: ${displayNames.join(', ')}.`,
    );
  }

  if (context.observances.length > 0) {
    lines.push('Upcoming cultural observances during this plan week:');
    for (const o of context.observances) {
      const range = o.start_date === o.end_date
        ? o.start_date
        : `${o.start_date} – ${o.end_date}`;
      const notes = o.dietary_notes !== null && o.dietary_notes.length > 0
        ? ` ${o.dietary_notes}`
        : '';
      const templateName = CULTURAL_TEMPLATE_DISPLAY_NAMES[o.cultural_template] ?? o.cultural_template;
      const recurrenceSuffix = o.observance_name === 'Shabbat' ? ', recurs weekly' : '';
      lines.push(`- ${o.observance_name} (${templateName}${recurrenceSuffix}): ${range}.${notes}`);
    }
  }

  if (context.l0Preferences.length > 0) {
    lines.push('Household food preferences (apply silently — no confirmation needed):');
    for (const p of context.l0Preferences) {
      lines.push(`- ${p}`);
    }
  }

  if (context.culturalObligations.length > 0) {
    lines.push('Cultural obligations (required — do not override):');
    for (const p of context.culturalObligations) {
      lines.push(`- ${p}`);
    }
  }

  if (context.l1MethodPriors.length > 0) {
    lines.push('Preparation priors (soft signals — prefer but not required):');
    for (const p of context.l1MethodPriors) {
      lines.push(`- ${p}`);
    }
  }

  return lines;
}

// Story 3.20 — formats per-child bag composition as planner context lines.
// The planner must omit plan_slots entries for inactive slots; emitting items
// with empty ingredients would break the guardrail's `min(1)` invariant and
// feel to the parent like the slot is still "live but blank".
export function buildBagCompositionLines(ctx: PlannerContext): string[] {
  const compositions = ctx.bagCompositions;
  if (compositions === undefined || compositions.length === 0) return [];
  // Story 3-S40: Snack is server-assigned (SnackRotationService) — do not show
  // Snack ON/OFF to the planner. Only Extra opt-in matters for the LLM path.
  const lines: string[] = ['Per-child bag composition (Main is always active — never skip Main):'];
  for (const c of compositions) {
    const extra = c.extra ? 'ON' : 'OFF';
    lines.push(`- ${c.child_name} (${c.child_id}): Extra ${extra}`);
  }
  lines.push(
    'Emit slot rows only for active slots. Do not produce an Extra slot when Extra is OFF. Do not produce Snack slots — they are filled server-side.',
  );
  return lines;
}

// Story 3.21 — formats per-child Extra pin/ban rules + the household's
// custom Extra library as planner context lines. Pins are forward-looking
// preferences ("always include a fruit"), bans are hard prohibitions
// ("never propose a sweet treat"). Library items are parent-authored named
// options the planner should prefer when they fulfil a pinned type.
export function buildExtraRulesLines(ctx: PlannerContext): string[] {
  const rules = ctx.extraRules;
  const libraryItems = ctx.extraLibraryItems;
  const hasRules = rules !== undefined && rules.some((r) => r.pins.length > 0 || r.bans.length > 0);
  const hasLibrary = libraryItems !== undefined && libraryItems.length > 0;
  if (!hasRules && !hasLibrary) return [];

  const lines: string[] = [];

  if (hasRules && rules !== undefined) {
    lines.push('Per-child Extra slot pin/ban rules:');
    for (const r of rules) {
      if (r.pins.length === 0 && r.bans.length === 0) continue;
      const parts: string[] = [];
      if (r.pins.length > 0) {
        parts.push(`always include one of [${r.pins.join(', ')}]`);
      }
      if (r.bans.length > 0) {
        parts.push(`never propose [${r.bans.join(', ')}]`);
      }
      lines.push(`- ${r.child_name} (${r.child_id}): ${parts.join('; ')}.`);
    }
  }

  if (hasLibrary && libraryItems !== undefined) {
    const summary = libraryItems
      .map((i) => `${i.name} (${i.component_type})`)
      .join(', ');
    lines.push(
      `Household custom Extra items available (prefer these when they match a pinned component type): ${summary}.`,
    );
  }

  return lines;
}

// Story 3.22 — translates high-activity Extra proposals into prompt context.
// The planner is told to propose ONE Extra item only on the named day for
// children whose Extra slot is normally OFF, overriding the bag-composition
// suppression rule for that single day. Parent confirmation UX for the
// proposed item is deferred — the MVP commits the planner's proposal and
// relies on the swap path for opt-out.
export function buildExtraProposalLines(ctx: PlannerContext): string[] {
  const proposals = ctx.extraProposals;
  if (proposals === undefined || proposals.length === 0) return [];
  const lines: string[] = [
    'High-activity day Extra proposals (Lumi-suggested — propose Extra ONLY on the named day, even when Extra is OFF for that child):',
  ];
  for (const p of proposals) {
    lines.push(
      `- On ${p.override_date}, ${p.child_name} (${p.child_id}) has a ${p.context_type}. Add one Extra item for that day only; do not add Extra on other days for this child.`,
    );
  }
  return lines;
}

// Story 3.29 — sovereignty mode context. In 'alternating' mode the planner
// rotates the leading tradition by day. In 'unified' mode (default) the
// planner is invited to surface `degraded_reason: "CULTURAL_INTERSECTION_EMPTY"`
// on the plan.compose output when honoring every rule simultaneously yields
// fewer than 3 distinct protein options. Silence-mode households (no
// ratified cultural templates) skip both branches — there is no intersection
// to collapse and no traditions to rotate.
export function buildSovereigntyContextLines(ctx: PlannerContext): string[] {
  const mode = ctx.sovereigntyMode;
  const culturalContext = ctx.culturalContext;
  const hasTemplates =
    culturalContext !== undefined && culturalContext.culturalTemplates.length > 0;
  if (!hasTemplates) return [];
  if (mode === 'alternating') {
    return [
      'ALTERNATING SOVEREIGNTY MODE: This household rotates cultural lead by day. ' +
        "Each day, follow ONE tradition's rules completely. Rotate through represented traditions across the week. " +
        'Do not attempt to honor all traditions simultaneously on any single day.',
    ];
  }
  // unified (default) — degraded-reason invitation.
  return [
    'If the intersection of all household cultural and dietary rules leaves fewer than 3 distinct protein options, ' +
      'include "degraded_reason": "CULTURAL_INTERSECTION_EMPTY" in the plan.compose output.',
  ];
}

// Story 3.27 — invites the planner to include AT MOST ONE preparation-method
// variant proposal in the plan output, targeting an item one of these children
// has rated before. Variants are preparation-method changes (baked vs.
// pan-fried, raw vs. roasted) — NEVER ingredient substitutions. The proposal
// is rendered on the affected day's PlanTile in `pending-input` state until
// the parent confirms or rejects it.
export function buildVariantEligibilityLines(ctx: PlannerContext): string[] {
  const children = ctx.variantEligibleChildren;
  if (children === undefined || children.length === 0) return [];
  const names = children.map((c) => `${c.child_name} (${c.child_id})`).join(', ');
  return [
    `Variant active-learning candidates: ${names}.`,
    'If you can identify a preparation-method variant for an item these children have had before ' +
      '(e.g., "baked" instead of "pan-fried", "roasted" instead of "raw"), include it as `variant_proposal` ' +
      'in your plan output with fields: child_id, day, slot, base_method, variant_method, variant_description. ' +
      'ONE proposal MAXIMUM per plan. Do NOT propose ingredient substitutions — variants are preparation-method ' +
      'changes only.',
  ];
}

// Story 3-S32 — renders the household's KitchenMap as a structured context
// block injected as the first element of the planner's user message. Placing
// it first maximises OpenAI auto-prefix cache hit rate across turns within
// the same planning loop (stable content at the leading edge of the cache
// prefix window). Returns '' when children is empty (incomplete onboarding).
export function renderPlannerKitchenMapBlock(ctx: PlannerContext): string {
  const map = ctx.kitchenMap;
  if (map === undefined || map.children.length === 0) return '';

  // Escape free-text scalars so quotes/newlines can't break the YAML block.
  // JSON.stringify yields a double-quoted, fully-escaped string that is also
  // valid YAML (YAML is a JSON superset). `oneLine` collapses newlines for the
  // markdown-list lines in <household_memory>, which aren't quoted.
  const yamlStr = (s: string): string => JSON.stringify(s);
  const oneLine = (s: string): string => s.replace(/\s*\n\s*/g, ' ').trim();

  // Build household YAML section
  const strongRules = map.rules
    .filter((r) => r.enforcement === 'non_negotiable' || r.enforcement === 'strong')
    .map((r) => {
      const type = r.rule_type === 'custom' && r.custom_label ? r.custom_label : r.rule_type;
      return `    - { type: ${yamlStr(type)}, enforcement: "${r.enforcement}" }`;
    });

  const childNameById = new Map(map.children.map((c) => [c.id, c.name]));

  const childrenYaml = map.children.map((c) => {
    const lines: string[] = [
      `  - id: "${c.id}"`,
      `    name: ${yamlStr(c.name)}`,
      `    age_band: "${c.age_band}"`,
      `    bag_composition: { snack: ${c.bag_composition.snack}, extra: ${c.bag_composition.extra} }`,
      `    declared_allergens: ${JSON.stringify(c.declared_allergens)}`,
      `    dietary_preferences: ${JSON.stringify(c.dietary_preferences)}`,
      `    school_policies: ${JSON.stringify(c.school_policies)}`,
      `    extra_rules: { pinned: ${JSON.stringify(c.extra_rules.pinned)}, banned: ${JSON.stringify(c.extra_rules.banned)} }`,
    ];
    return lines.join('\n');
  });

  const culturalActive = map.cultural.active.map((p) => yamlStr(p.key)).join(', ');

  // Top 10 favourites by confidence_score
  const topFavourites = [...map.recipes.favourites]
    .sort((a, b) => b.confidence_score - a.confidence_score)
    .slice(0, 10)
    .map((r) => {
      const lastUsed = r.last_used_at ? r.last_used_at.slice(0, 10) : '';
      return `    - { name: ${yamlStr(r.canonical_name)}, cuisine_tags: ${JSON.stringify(r.cuisine_tags)}, confidence: ${r.confidence_score}, last_used_at: "${lastUsed}" }`;
    });

  // Banned recipe names (cap at 20)
  const bannedNames = map.recipes.banned.slice(0, 20).map((r) => r.canonical_name);

  const householdSection = [
    'household:',
    `  display_name: ${map.household.display_name != null ? yamlStr(map.household.display_name) : 'null'}`,
    `  timezone: "${map.household.timezone}"`,
    `  declared_allergens: ${JSON.stringify(map.household.declared_allergens)}`,
    `  dietary_preferences: ${JSON.stringify(map.household.dietary_preferences)}`,
    `  cultural_identifiers: ${JSON.stringify(map.household.cultural_identifiers)}`,
    strongRules.length > 0 ? `  rules:\n${strongRules.join('\n')}` : '  rules: []',
  ].join('\n');

  const childrenSection = `children:\n${childrenYaml.join('\n')}`;

  const culturalSection = [
    'cultural:',
    `  active: [${culturalActive}]`,
    '  suggested: []',
  ].join('\n');

  const recipesSection = [
    'recipes:',
    ...(topFavourites.length > 0 ? ['  favourites:', ...topFavourites] : ['  favourites: []']),
    `  banned: ${JSON.stringify(bannedNames)}`,
  ].join('\n');

  const userProfile = [
    '<user_profile>',
    '---',
    householdSection,
    '',
    childrenSection,
    '',
    culturalSection,
    '',
    recipesSection,
    '---',
    '</user_profile>',
  ].join('\n');

  // Build household_memory section
  const memoryLines: string[] = [];

  // Group memory nodes by type
  const rhythmNodes = map.memory.nodes.filter((n) => n.node_type === 'rhythm' && n.prose_text);
  const obsessionNodes = map.memory.nodes.filter((n) => n.node_type === 'child_obsession' && n.prose_text);
  const otherNodes = map.memory.nodes.filter((n) => n.node_type === 'other' && n.prose_text);

  const allNodes = [...rhythmNodes, ...obsessionNodes, ...otherNodes].slice(0, 20);

  if (allNodes.length > 0) {
    const byType = new Map<string, typeof allNodes>();
    for (const node of allNodes) {
      // 'CHILD OBSESSIONS' (not 'PER-CHILD FOOD PREFERENCES') so this memory-node
      // group does not collide with the food_preferences header pushed below.
      const group = node.node_type === 'rhythm'
        ? 'PREFERENCES AND RHYTHMS'
        : node.node_type === 'child_obsession'
        ? 'CHILD OBSESSIONS'
        : 'OTHER';
      if (!byType.has(group)) byType.set(group, []);
      byType.get(group)!.push(node);
    }
    for (const [group, nodes] of byType) {
      memoryLines.push(`${group}:`);
      for (const n of nodes) {
        memoryLines.push(`- ${oneLine(n.prose_text)}`);
      }
    }
  }

  // Per-child food preferences
  const prefsByChild = new Map<string | null, typeof map.food_preferences>();
  for (const fp of map.food_preferences) {
    const key = fp.child_id;
    if (!prefsByChild.has(key)) prefsByChild.set(key, []);
    prefsByChild.get(key)!.push(fp);
  }

  const childPrefLines: string[] = [];
  for (const [childId, prefs] of prefsByChild) {
    if (childId === null) continue;
    const childName = childNameById.get(childId) ?? childId;
    for (const p of prefs) {
      childPrefLines.push(`- ${oneLine(childName)}: ${p.valence} ${oneLine(p.item)} (enforcement: ${p.enforcement})`);
    }
  }

  if (childPrefLines.length > 0) {
    memoryLines.push('PER-CHILD FOOD PREFERENCES:');
    memoryLines.push(...childPrefLines);
  }

  const householdMemory = [
    '<household_memory>',
    ...memoryLines,
    '</household_memory>',
  ].join('\n');

  const memoryPolicy = [
    '<memory_policy>',
    'Context precedence (highest → lowest):',
    '1. Per-child declared_allergens and non_negotiable rules — NEVER override. These are absolute.',
    '2. Rating signals from child_signal tool (current week recency) — override food_preferences for this plan.',
    '3. food_preferences and memory nodes above — default preference bias.',
    '4. cultural.active templates — apply to all children unless child has an explicit exception.',
    '5. Absence of a signal does NOT mean dislike (FR125). Never infer dislike from missing data.',
    '</memory_policy>',
  ].join('\n');

  return [userProfile, householdMemory, memoryPolicy].join('\n\n');
}

// Story 3-S36 — renders the pre-loaded child rating signals as a <child_signals>
// block so the planner biases toward liked recipes without a child_signal turn.
// Strips characters that could prematurely close XML-like prompt blocks or
// inject newline-separated directives from user-controlled string fields.
const sanitizePromptField = (s: string): string => s.replace(/[<>\n]/g, ' ').trim();

// Grouped per child (liked / disliked), with the family_liked summary and the
// FR125 absence-neutrality note. Returns '' when there are no signals at all
// (the planner then treats preferences as "no data", never as a constraint).
export function renderPlannerChildSignalsBlock(ctx: PlannerContext): string {
  const signals = ctx.childSignals;
  if (
    signals === undefined ||
    (signals.per_child.length === 0 && signals.family_liked.length === 0)
  ) {
    return '';
  }

  const itemLabel = (i: { recipe_name: string; slot_kind: string }): string =>
    `${sanitizePromptField(i.recipe_name)} (${sanitizePromptField(i.slot_kind)})`;

  const lines: string[] = ['<child_signals>'];
  for (const child of signals.per_child) {
    const parts: string[] = [];
    if (child.liked.length > 0) {
      parts.push(`liked [${child.liked.map(itemLabel).join(', ')}]`);
    }
    if (child.disliked.length > 0) {
      parts.push(`disliked [${child.disliked.map(itemLabel).join(', ')}]`);
    }
    lines.push(`${sanitizePromptField(child.child_name)}: ${parts.length > 0 ? parts.join('; ') : '(no recent signals)'}`);
  }
  if (signals.family_liked.length > 0) {
    const fam = signals.family_liked
      .map((f) => `${sanitizePromptField(f.recipe_name)} (${sanitizePromptField(f.slot_kind)}, ${String(f.child_count)} children)`)
      .join(', ');
    lines.push(`family_liked: ${fam}`);
  }
  lines.push('NOTE: absence of a signal = no data; never infer dislike from absence (FR125).');
  lines.push('</child_signals>');
  return lines.join('\n');
}

// Story 3-S36 — renders the pre-loaded pantry snapshot as a <pantry> block. The
// planner favours on-hand ingredients before introducing new shopping. Returns
// '' when nothing is on hand (no pantry data → no block).
export function renderPlannerPantryBlock(ctx: PlannerContext): string {
  const snapshot = ctx.pantrySnapshot;
  if (snapshot === undefined || snapshot.on_hand.length === 0) return '';
  return ['<pantry>', `on_hand: [${snapshot.on_hand.join(', ')}]`, '</pantry>'].join('\n');
}

// Story 3-S36 — renders the pre-assembled candidate recipe slate as a
// <recipe_candidates> block, grouped by slot suitability. Each candidate carries
// allergen flags + key ingredients inline so the planner can judge fit without a
// recipe.fetch turn.
// Story 3.5-s3 — each candidate is prefixed with a stable short handle (m1, m2,…
// for mains; e1, e2,… for extras). The planner emits the handle as recipe_id;
// plan.compose resolves it deterministically to a catalog UUID from the returned
// handleMap (no DB fuzzy match). Returns { block: '', handleMap } when all three
// groups are empty (the planner then falls back to recipe.search/discover).
export function renderPlannerRecipeCandidatesBlock(
  ctx: PlannerContext,
): { block: string; handleMap: Map<string, string> } {
  const slate = ctx.recipeCandidates;
  if (slate === undefined) return { block: '', handleMap: new Map() };

  // m* / e* namespaces cannot collide by construction; snack is server-assigned
  // and never emitted here, so it gets no handle.
  const handleMap = new Map<string, string>();
  slate.main.forEach((c, i) => handleMap.set(`m${String(i + 1)}`, c.id));
  slate.extra.forEach((c, i) => handleMap.set(`e${String(i + 1)}`, c.id));

  if (slate.main.length === 0 && slate.snack.length === 0 && slate.extra.length === 0) {
    return { block: '', handleMap };
  }

  const renderCandidate = (handle: string, c: PlannerRecipeCandidate): string =>
    `  - { handle: ${handle}, name: ${JSON.stringify(c.name)}, cuisine: ${JSON.stringify(c.cuisine_tags)}, ` +
    `allergens: ${JSON.stringify(c.allergen_flags)}, ` +
    `key_ingredients: ${JSON.stringify(c.key_ingredients)}, confidence: ${String(c.confidence)} }`;

  const renderGroup = (
    label: string,
    prefix: 'm' | 'e',
    items: readonly PlannerRecipeCandidate[],
  ): string =>
    items.length === 0
      ? `${label}: []`
      : [
          `${label}:`,
          ...items.map((c, i) => renderCandidate(`${prefix}${String(i + 1)}`, c)),
        ].join('\n');

  // Story 3-S40: snack group omitted — snacks are assigned server-side by
  // SnackRotationService, not by the LLM from the candidate slate.
  const block = [
    '<recipe_candidates>',
    renderGroup('main', 'm', slate.main),
    renderGroup('extra', 'e', slate.extra),
    '</recipe_candidates>',
  ].join('\n');

  return { block, handleMap };
}
