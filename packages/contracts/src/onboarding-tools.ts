import { z } from 'zod';
import { AgeBandSchema, BagCompositionPatternSchema } from './children.js';
import { EnforcementLevelSchema } from './enforcement.js';

// ===========================================================================
// Onboarding agent tool I/O
// ===========================================================================
// Slice C (Epic 2) — three foundational tools:
//   child.upsert       — create/update a child row by case-insensitive name
//   cultural.note      — register a cultural prior with state='suggested'
//   memory.note        — write a memory node + provenance
//
// Slice 2-s27 — household-level food identity:
//   household.upsert   — household-scoped cultural/dietary/declared_allergens
//
// Slice 2.5-s1 — seven new structured tools (registered as stubs; wired in
// 2.5-s4 alongside the agent prompt v2 that knows how to call them):
//   household.set_name        — Moment 1 household label
//   allergen.declare          — per-row child allergen (one row per call)
//   dietary.declare           — structured dietary identity (per-child or hh)
//   cuisine.declare           — cuisine identifier via cultural_priors
//   food_preference.declare   — open-vocab likes/dislikes/refuses
//   favorite_lunch.add        — Moment 5 cold-start seed
//   rule.set                  — household_rules row
//
// Tag arrays in these schemas are loosely constrained ("array of short
// strings") — strict vocabulary validation lives in VocabularyService at
// the handler boundary so the agent gets a clear error message when it
// emits an unknown tag, rather than a Zod refusal-to-parse.
// ===========================================================================

// ---- Shared --------------------------------------------------------------

const TagArraySchema = z.array(z.string().min(1).max(64)).max(50);

// ---- child.upsert --------------------------------------------------------

export const ChildUpsertInputSchema = z.object({
  /**
   * Display name. Used as the idempotency key (case-insensitive match
   * within household). The agent should always use the name the parent
   * spoke — not a guessed-canonical form.
   */
  name: z.string().trim().min(1).max(100),

  /** From AddChildBodySchema. Mirrors the children.age_band column. */
  age_band: AgeBandSchema,

  /** Allergen tag keys. Service validates against allergen_tags.
   *  PATCH SEMANTICS: omitting this field on an update preserves the
   *  existing array. Pass an explicit array (including []) to overwrite. */
  declared_allergens: TagArraySchema.optional(),

  /** Cultural tag keys. Service validates against cultural_tags.
   *  PATCH SEMANTICS: see declared_allergens. */
  cultural_identifiers: TagArraySchema.optional(),

  /** Dietary tag keys. Service validates against dietary_tags; the implies-
   *  closure is expanded server-side, the agent emits the narrowest tag.
   *  PATCH SEMANTICS: see declared_allergens. */
  dietary_preferences: TagArraySchema.optional(),

  /** Slice 2.5-s1 — parent-stated bag composition pattern captured in
   *  Moment 4. The four-way enum mirrors the schema in kitchen-map.ts.
   *  Omitted on update means "preserve existing". Coexists with the legacy
   *  per-slot booleans (which remain the planner-facing source of truth). */
  bag_composition_pattern: BagCompositionPatternSchema.nullish(),
});

export const ChildUpsertOutputSchema = z.object({
  child_id: z.string().uuid(),
  /** Matches the resolved canonical name (the value stored after dedup). */
  name: z.string(),
  /** True when an existing child row was updated, false when a new row was
   *  inserted. Useful for distinguishing INSERT vs UPDATE in audit logs. */
  was_existing: z.boolean(),
  /** Allergens the agent passed that are not in the active vocabulary.
   *  Each has been saved as a memory.note with node_type='allergy' so
   *  the information is not lost. The agent may acknowledge these naturally
   *  rather than apologising about a technical failure. */
  unknown_allergens_noted: z.array(z.string()).optional(),
});

// ---- cultural.note -------------------------------------------------------

// Mirrors cultural_priors row constraints; the service writes with
// state='suggested' regardless of agent intent — ratification is a
// separate user action (slice 2-s25).
export const CulturalNoteInputSchema = z.object({
  /** From cultural_tags vocabulary. Service validates is_active=true. */
  key: z.string().min(1).max(64),

  /** Human-readable label the agent saw on the cultural_tags row.
   *  Service may override with the canonical display_name. */
  label: z.string().min(1).max(128),

  /** 0–100. How confident the agent is the household identifies with
   *  this template. */
  confidence: z.number().int().min(0).max(100),

  /** 0–100. How often signals for this template appeared in the
   *  conversation. NOT zero-sum across templates. */
  presence: z.number().int().min(0).max(100),

  /** Slice 2.5-s1 — enforcement strength. Defaults to 'just_for_context'
   *  to preserve backwards-compatibility with agent versions that don't
   *  emit it (matches today's shipped advisory-only behaviour). */
  enforcement: EnforcementLevelSchema.default('just_for_context'),
});

export const CulturalNoteOutputSchema = z.object({
  prior_id: z.string().uuid(),
  /** True when an existing row was updated, false when newly inserted. */
  was_existing: z.boolean(),
});

// ---- memory.note ---------------------------------------------------------

// Mirrors memory_nodes.node_type enum (narrowed in slice 2.5-s2 migration
// 20260904000300). The four removed types ('preference', 'cultural_rhythm',
// 'allergy', 'school_policy') are now routed through the structured tools
// (food_preference.declare, cultural.note + cuisine.declare with
// enforcement, allergen.declare). All pre-existing rows were backfilled and
// soft-forgotten in migration 20260904000100.
export const MemoryNoteFromOnboardingNodeTypeSchema = z.enum([
  'rhythm',
  'child_obsession',
  'other',
]);

export const MemoryNoteFromOnboardingInputSchema = z.object({
  node_type: MemoryNoteFromOnboardingNodeTypeSchema,
  /** Short facet label (≤200 chars). E.g. 'palate', 'family_rhythm'. */
  facet: z.string().trim().min(1).max(200),
  /** The note itself (≤2000 chars). Plain prose the agent extracted from
   *  the conversation, written in third person about the family. */
  prose_text: z.string().trim().min(1).max(2000),
  /** When the note is about a specific child, the child_id returned by a
   *  prior child.upsert call. Null/omitted for household-wide rhythms.
   *  Prefer subject_child_name when calling in the same iteration as
   *  child.upsert — child_id isn't available until the next iteration
   *  because tool calls within one iteration run in parallel. */
  subject_child_id: z.string().uuid().nullish(),
  /** Alternative to subject_child_id: pass the child's display name and
   *  the service resolves to the child_id via case-insensitive match
   *  within the household. Useful when memory.note fires in the SAME
   *  iteration as child.upsert (parallel tool execution — child_id not
   *  yet available). If both id and name are provided, id wins. */
  subject_child_name: z.string().trim().min(1).max(100).nullish(),
  /** 0.0–1.0. Defaults to 0.8 at the service layer when omitted. */
  confidence: z.number().min(0).max(1).nullish(),
});

export const MemoryNoteFromOnboardingOutputSchema = z.object({
  node_id: z.string().uuid(),
  created_at: z.string().datetime({ offset: true }),
});

// ===========================================================================
// Slice 2.5-s1 — seven new structured tools
// ===========================================================================

// ---- household.set_name --------------------------------------------------

export const HouseholdSetNameInputSchema = z.object({
  display_name: z.string().trim().min(1).max(120),
});

export const HouseholdSetNameOutputSchema = z.object({
  household_id: z.string().uuid(),
});

// ---- allergen.declare ----------------------------------------------------
//
// One allergen per call. Lets the agent fire parallel calls (one per
// allergen the parent named), keeps each audit row crisp, and makes
// idempotency trivial at the DB layer (unique on (child_id, allergen_hash)).
// Exactly one of child_id / child_name must be present.

export const AllergenDeclareInputSchema = z
  .object({
    child_id: z.string().uuid().nullish(),
    child_name: z.string().trim().min(1).max(100).nullish(),
    allergen: z.string().trim().min(1).max(64),
    source: z
      .enum(['onboarding_declared', 'parent_edited'])
      .default('onboarding_declared'),
  })
  .refine(
    (v) => {
      const hasId = v.child_id !== null && v.child_id !== undefined;
      const hasName = v.child_name !== null && v.child_name !== undefined;
      return !(hasId && hasName); // must NOT supply both — but neither is OK (household scope)
    },
    {
      message:
        'provide at most one of child_id or child_name — omit both to declare a household-wide allergen (no child attribution)',
      path: ['child_id'],
    },
  );

export const AllergenDeclareOutputSchema = z.object({
  // uuid() is too strict — the HouseholdAllergensRepository adapter returns ''
  // for the conflict path (row exists, id not re-fetched). The agent doesn't
  // use this field for follow-up calls; it's audit-log context only.
  child_allergen_id: z.string(),
  was_existing: z.boolean(),
});

// ---- dietary.declare -----------------------------------------------------

export const DietaryDeclareInputSchema = z.object({
  /** Null = household-scoped (the default post-Epic-2.5). */
  child_id: z.string().uuid().nullish(),
  /** Validated against dietary_tags vocabulary at handler boundary. */
  tag: z.string().trim().min(1).max(64),
  enforcement: EnforcementLevelSchema,
  /** Slice 2.7-s5 — replaces the `[CHIP_PROMPT:elevation:…]` prose sentinel.
   *  When the model judges the parent's enforcement language strong but
   *  ambiguous ("strictly Halal — is that a hard rule?"), it records its
   *  best-guess `enforcement` AND sets this true; the service then renders the
   *  three-option ratification chip from the structured tool RESULT (never from
   *  a regex over the prose), so it cannot half-leak into the visible message.
   *  Strict-null-safe (s2): optional fields serialize as anyOf:[…,null] and the
   *  agent null-strips before this schema parses. */
  request_ratification: z.boolean().nullish(),
  source: z
    .enum(['onboarding_declared', 'parent_edited'])
    .default('onboarding_declared'),
});

export const DietaryDeclareOutputSchema = z.object({
  dietary_id: z.string().uuid(),
  was_existing: z.boolean(),
  /** Slice 2.7-s5 — echoes the input `request_ratification`. The service reads
   *  this off the tool-call result to decide whether to render the M3
   *  ratification chip. Present only when the model asked for ratification. */
  ratification_requested: z.boolean().optional(),
});

// ---- cuisine.declare -----------------------------------------------------
//
// Shares the underlying cultural_priors row with cultural.note — both write
// to the same table. cultural.note is for cultural/religious identity;
// cuisine.declare is for cuisine preferences (e.g. 'south_indian',
// 'levantine'). The agent picks the right tool based on the prompt
// (decision lives in 2.5-s4's prompt, not the contract).

export const CuisineDeclareInputSchema = z.object({
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(128),
  confidence: z.number().int().min(0).max(100),
  presence: z.number().int().min(0).max(100),
  enforcement: EnforcementLevelSchema.default('just_for_context'),
  /** Slice 2.7-s5 — same ratification channel as dietary.declare. See that
   *  schema's note. Strict-null-safe (s2). */
  request_ratification: z.boolean().nullish(),
});

export const CuisineDeclareOutputSchema = z.object({
  prior_id: z.string().uuid(),
  was_existing: z.boolean(),
  /** Slice 2.7-s5 — echoes the input `request_ratification` so the service can
   *  render the M3 ratification chip from the structured result. */
  ratification_requested: z.boolean().optional(),
});

// ---- food_preference.declare ---------------------------------------------
//
// Open-vocab item (the agent may emit any free-text food name). child_id
// null = household-wide preference. At least one of child_id / child_name
// is allowed but both null is also valid (household-scoped).

export const FoodPreferenceDeclareInputSchema = z.object({
  child_id: z.string().uuid().nullish(),
  child_name: z.string().trim().min(1).max(100).nullish(),
  item: z.string().trim().min(1).max(128),
  valence: z.enum(['loves', 'likes', 'neutral', 'dislikes', 'refuses']),
  enforcement: EnforcementLevelSchema.default('soft'),
  source: z
    .enum(['onboarding_declared', 'memory_promoted', 'parent_edited'])
    .default('onboarding_declared'),
});

export const FoodPreferenceDeclareOutputSchema = z.object({
  food_preference_id: z.string().uuid(),
  was_existing: z.boolean(),
});

// ---- favorite_lunch.add --------------------------------------------------
//
// Household-scoped cold-start seed (FR124). Idempotency on
// (household_id, lower(decrypted_item)) at the DB layer.

export const FavoriteLunchAddInputSchema = z.object({
  item: z.string().trim().min(1).max(128),
});

export const FavoriteLunchAddOutputSchema = z.object({
  favorite_lunch_id: z.string().uuid(),
  position: z.number().int().nonnegative(),
});

// ---- rule.set ------------------------------------------------------------
//
// custom_label is required iff rule_type='custom'. Enforced via .refine().

export const RuleSetInputSchema = z
  .object({
    rule_type: z.enum([
      'no_pork',
      'no_alcohol',
      'no_beef',
      'no_overnight_leftovers',
      'no_microwave_at_school',
      'custom',
    ]),
    custom_label: z.string().trim().min(1).max(120).nullish(),
    enforcement: EnforcementLevelSchema.default('strong'),
    source: z
      .enum(['onboarding_declared', 'parent_edited'])
      .default('onboarding_declared'),
  })
  .refine(
    (v) =>
      !(
        v.rule_type === 'custom' &&
        (v.custom_label === null || v.custom_label === undefined || v.custom_label.length === 0)
      ),
    {
      message: "custom_label is required when rule_type='custom'",
      path: ['custom_label'],
    },
  )
  .refine(
    (v) =>
      !(
        v.rule_type !== 'custom' &&
        v.custom_label !== null &&
        v.custom_label !== undefined
      ),
    {
      message: "custom_label must be omitted (or null) when rule_type is not 'custom'",
      path: ['custom_label'],
    },
  );

export const RuleSetOutputSchema = z.object({
  household_rule_id: z.string().uuid(),
  was_existing: z.boolean(),
});

// ===========================================================================
// NOTE: HouseholdUpsertInputSchema / HouseholdUpsertOutputSchema live in
// household-profile.ts (introduced by slice 2-s27). The household.upsert
// tool factory in apps/api/.../onboarding.tools.ts imports them from there
// via the @hivekitchen/contracts barrel.
// ===========================================================================
