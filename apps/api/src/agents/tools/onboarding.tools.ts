import type { FastifyBaseLogger } from 'fastify';
import {
  AllergenDeclareInputSchema,
  AllergenDeclareOutputSchema,
  ChildUpsertInputSchema,
  ChildUpsertOutputSchema,
  CuisineDeclareInputSchema,
  CuisineDeclareOutputSchema,
  CulturalNoteInputSchema,
  CulturalNoteOutputSchema,
  DietaryDeclareInputSchema,
  DietaryDeclareOutputSchema,
  FavoriteLunchAddInputSchema,
  FavoriteLunchAddOutputSchema,
  FoodPreferenceDeclareInputSchema,
  FoodPreferenceDeclareOutputSchema,
  HouseholdSetNameInputSchema,
  HouseholdSetNameOutputSchema,
  HouseholdUpsertInputSchema,
  HouseholdUpsertOutputSchema,
  MemoryNoteFromOnboardingInputSchema,
  MemoryNoteFromOnboardingOutputSchema,
  RuleSetInputSchema,
  RuleSetOutputSchema,
} from '@hivekitchen/contracts';
import type { ChildAllergensRepository } from '../../modules/children/child-allergens.repository.js';
import type { HouseholdAllergensRepository } from '../../modules/households/household-allergens.repository.js';
import type { ChildrenService } from '../../modules/children/children.service.js';
import type { CulturalPriorRepository } from '../../modules/cultural-priors/cultural-prior.repository.js';
import type { DietaryPreferencesRepository } from '../../modules/dietary-preferences/dietary-preferences.repository.js';
import type { FoodPreferencesRepository } from '../../modules/food-preferences/food-preferences.repository.js';
import type { SignalsService } from '../../modules/signals/signals.service.js';
import type { RecipesRepository } from '../../modules/recipe/recipes.repository.js';
import type { HouseholdRulesRepository, RuleType } from '../../modules/household-rules/household-rules.repository.js';
import type { HouseholdsService } from '../../modules/households/households.service.js';
import type { MemoryService } from '../../modules/memory/memory.service.js';
import type { VocabularyService } from '../../modules/vocabulary/vocabulary.service.js';
import type { ToolSpec } from '../tools.manifest.js';

// ===========================================================================
// Slice C — Onboarding agent tool specs
// ===========================================================================
// Three tools the OnboardingAgent invokes during text-mode interviews:
//   child.upsert   → ChildrenService.upsertByName (idempotent by name)
//   cultural.note  → CulturalPriorRepository.noteSuggested (no-op on conflict)
//   memory.note    → MemoryService.noteFromAgent
//
// Vocabulary enforcement: tag arrays are validated against VocabularyService
// at the handler boundary. Unknown / inactive tags throw with a clear error
// that the agent receives as a tool-call result and can recover from.
//
// Per-request context (householdId, userId) is closure-captured by the
// factory functions — each request constructs its own tool spec bundle.
// ===========================================================================

// Slice 2.7-s4 — onboarding tools are deliberately NOT in TOOL_MANIFEST: the
// specs are built per-turn by createOnboardingToolSpecs() and the planner (the
// manifest's only consumer) never offers them. The empty list opts this file
// out of the manifest cross-check (scripts/check-tool-manifest.ts).
/** @public consumed dynamically by scripts/check-tool-manifest.ts */
export const MANIFESTED_TOOL_NAMES = [] as const;

export interface OnboardingToolContext {
  householdId: string;
  userId: string;
  /** Pino logger bound to the request id; service-level audit context lives
   *  separately in the calling service. */
  logger: FastifyBaseLogger;
}

export interface OnboardingToolDeps {
  childrenService: ChildrenService;
  culturalPriorRepository: CulturalPriorRepository;
  householdsService: HouseholdsService;
  memoryService: MemoryService;
  vocabularyService: VocabularyService;
  // Slice 2.5-s6 — structured per-child allergen + dietary writes wired into
  // allergen.declare / dietary.declare. Required: the tool factories throw
  // at runtime if these are not provided.
  childAllergensRepository: ChildAllergensRepository;
  // Direct access to household_allergens for household-scope (null child_id) writes.
  householdAllergensRepository: HouseholdAllergensRepository;
  dietaryPreferencesRepository: DietaryPreferencesRepository;
  // Slice 2.5-s7 — structured food-preference + rule writers for
  // food_preference.declare / rule.set. Cuisine.declare reuses
  // culturalPriorRepository (shared cultural_priors table).
  foodPreferencesRepository: FoodPreferencesRepository;
  // Story 15-s2 — signals-log dual-write beside food_preference.declare.
  // Optional (legacy test deps omit it); record() never throws.
  signalsService?: Pick<SignalsService, 'record'>;
  householdRulesRepository: HouseholdRulesRepository;
  // Slice 2.6-s1 — replaced FavoriteLunchesRepository (2.5-s9). The M5 hot
  // path now writes to the canonical recipes catalog via RecipesRepository
  // .declareForHousehold(); the standalone favorite_lunches table is dropped
  // by migration 20260908000200.
  recipesRepository: RecipesRepository;
}

// ---- child.upsert --------------------------------------------------------

export function createChildUpsertToolSpec(
  ctx: OnboardingToolContext,
  deps: OnboardingToolDeps,
): ToolSpec {
  return {
    name: 'child.upsert',
    description:
      'Create or update a child profile in the household. Use this whenever a parent ' +
      'mentions a specific child by name during the interview. Idempotent within the ' +
      'household — passing the same name on a second call updates the existing record ' +
      "(don't worry about duplicates). Returns child_id which you should pass as " +
      'subject_child_id on any follow-up memory.note about that specific child ' +
      '(allergy, food preference, refusal, etc.).',
    inputSchema: ChildUpsertInputSchema,
    outputSchema: ChildUpsertOutputSchema,
    maxLatencyMs: 1500,
    fn: async (input: unknown) => {
      const parsed = ChildUpsertInputSchema.parse(input);

      // PATCH semantics: validate tag arrays only when the agent provided
      // them. undefined means "no update" → service preserves existing.
      // An explicit empty array is a deliberate clear; the validator handles
      // it (no entries to validate, returns []).
      //
      // Allergens: partition into known (save to declared_allergens) and
      // unknown (save as memory.note). Unknown allergens must NOT throw —
      // a thrown error propagates through the agent framework as a tool
      // failure, causing Lumi to apologise to the user instead of proceeding.
      const unknownAllergenKeys: string[] = [];
      let declared_allergens: string[] | undefined = undefined;

      if (parsed.declared_allergens !== undefined) {
        const known: string[] = [];
        for (const key of parsed.declared_allergens) {
          const resolved = deps.vocabularyService.resolveAllergen(key);
          if (resolved !== undefined && deps.vocabularyService.isActive('allergen', resolved)) {
            known.push(resolved);
          } else {
            unknownAllergenKeys.push(key);
          }
        }
        declared_allergens = [...new Set(known)];
      }

      const cultural_identifiers =
        parsed.cultural_identifiers === undefined
          ? undefined
          : deps.vocabularyService.validateCultural(parsed.cultural_identifiers);
      const dietary_preferences =
        parsed.dietary_preferences === undefined
          ? undefined
          : deps.vocabularyService.expandImpliesClosure(
              // Expand implies-closure server-side — agent emits the narrowest
              // tag (e.g. 'vegan') and the service fans it out
              // (+ 'vegetarian', 'dairy_free', 'egg_free'). Saves prompt tokens
              // and keeps the implies graph canonical.
              deps.vocabularyService.validateDietary(parsed.dietary_preferences),
            );

      const result = await deps.childrenService.upsertByName({
        householdId: ctx.householdId,
        body: {
          name: parsed.name,
          age_band: parsed.age_band,
          school_policy_notes: parsed.school_policy_notes,
          declared_allergens,
          cultural_identifiers,
          dietary_preferences,
          // Slice 2.5-s8 — Moment 4 bag composition pattern. PATCH semantics
          // preserved end-to-end: undefined skips the column entirely so the
          // agent can mention a child mid-conversation without clobbering an
          // earlier-stated pattern.
          bag_composition_pattern: parsed.bag_composition_pattern,
        },
      });

      // Save each unrecognised allergen as a memory.note so the information
      // is not lost. Fire-and-forget errors are tolerated — the child row is
      // already committed and a failed provenance note must not roll it back.
      for (const allergen of unknownAllergenKeys) {
        ctx.logger.warn(
          {
            module: 'onboarding-tools',
            action: 'child.upsert.unknown_allergen',
            household_id: ctx.householdId,
            child_id: result.child.id,
            allergen,
          },
          'unknown allergen tag — saving as memory.note',
        );
        await deps.memoryService.noteFromAgent({
          householdId: ctx.householdId,
          nodeType: 'other',
          facet: 'allergen',
          proseText: `${parsed.name} has an allergy or sensitivity to ${allergen}.`,
          subjectChildId: result.child.id,
          confidence: 0.85,
          sourceRef: { tool: 'child.upsert', allergen, reason: 'not_in_vocabulary' },
        });
      }

      ctx.logger.info(
        {
          module: 'onboarding-tools',
          action: 'child.upsert',
          household_id: ctx.householdId,
          user_id: ctx.userId,
          child_id: result.child.id,
          was_existing: result.was_existing,
          unknown_allergens: unknownAllergenKeys,
        },
        'child.upsert handled',
      );

      const output = ChildUpsertOutputSchema.parse({
        child_id: result.child.id,
        name: result.child.name,
        was_existing: result.was_existing,
        unknown_allergens_noted: unknownAllergenKeys.length > 0 ? unknownAllergenKeys : undefined,
      });
      return output;
    },
  };
}

// ---- cultural.note -------------------------------------------------------

export function createCulturalNoteToolSpec(
  ctx: OnboardingToolContext,
  deps: OnboardingToolDeps,
): ToolSpec {
  return {
    name: 'cultural.note',
    description:
      'Record a suggested cultural identity for this household based on what the parent ' +
      "has mentioned (e.g. 'we celebrate Diwali', 'Friday is the family curry night'). " +
      "Always set state='suggested' — ratification is a separate parent action later. " +
      "Use the canonical cultural_tag keys (the system prompt lists them). " +
      'Idempotent: calling twice for the same key is a no-op.',
    inputSchema: CulturalNoteInputSchema,
    outputSchema: CulturalNoteOutputSchema,
    maxLatencyMs: 800,
    fn: async (input: unknown) => {
      const parsed = CulturalNoteInputSchema.parse(input);

      // Validate that the key exists in the cultural_tags vocabulary.
      // Don't expand parents here — the cultural_priors table tracks declared
      // templates, not the inferred hierarchy.
      deps.vocabularyService.validateCultural([parsed.key]);

      const result = await deps.culturalPriorRepository.noteSuggested(ctx.householdId, {
        key: parsed.key,
        label: parsed.label,
        confidence: parsed.confidence,
        presence: parsed.presence,
        // Slice 2.5-s7 — persist parent-language-derived enforcement strength.
        // Schema defaults to 'just_for_context'; M3 elevation chip flow can
        // raise this to 'strong' or 'non_negotiable'.
        enforcement: parsed.enforcement,
      });

      ctx.logger.info(
        {
          module: 'onboarding-tools',
          action: 'cultural.note',
          household_id: ctx.householdId,
          user_id: ctx.userId,
          key: parsed.key,
          enforcement: parsed.enforcement,
          prior_id: result.id,
          was_existing: result.was_existing,
        },
        'cultural.note handled',
      );

      const output = CulturalNoteOutputSchema.parse({
        prior_id: result.id,
        was_existing: result.was_existing,
      });
      return output;
    },
  };
}

// ---- memory.note ---------------------------------------------------------

export function createMemoryNoteToolSpec(
  ctx: OnboardingToolContext,
  deps: OnboardingToolDeps,
): ToolSpec {
  return {
    name: 'memory.note',
    description:
      'Record a memory node about this household. Use for facts that should inform ' +
      "future planning but aren't structured fields (e.g. 'Friday is leftover night', " +
      "'the kids love yogurt-based snacks', 'they avoid heavy proteins on swim-practice " +
      "Tuesdays'). For child-specific notes, pass subject_child_id from a prior " +
      'child.upsert call. For household-wide patterns, omit subject_child_id. ' +
      'node_type values: rhythm (family eating patterns/routines), child_obsession ' +
      '(strong single-food fixation), other (anything not captured by a structured tool).',
    inputSchema: MemoryNoteFromOnboardingInputSchema,
    outputSchema: MemoryNoteFromOnboardingOutputSchema,
    maxLatencyMs: 800,
    fn: async (input: unknown) => {
      const parsed = MemoryNoteFromOnboardingInputSchema.parse(input);

      // Resolve subject_child_id from subject_child_name when needed.
      // If both are provided, id wins. If only name is provided, look up
      // by case-insensitive match within the household. If name is
      // provided but no match, log a warn and leave subject_child_id null
      // (memory is still recorded as household-wide — safer than
      // throwing and forcing the agent to recover).
      let subjectChildId: string | null = parsed.subject_child_id ?? null;
      if (subjectChildId === null && parsed.subject_child_name) {
        subjectChildId = await deps.childrenService.findChildIdByName(
          ctx.householdId,
          parsed.subject_child_name,
        );
        if (subjectChildId === null) {
          ctx.logger.warn(
            {
              module: 'onboarding-tools',
              action: 'memory.note.unresolved_child_name',
              household_id: ctx.householdId,
              subject_child_name: parsed.subject_child_name,
            },
            'memory.note: subject_child_name did not match any child in household — recording as household-wide',
          );
        }
      }

      const result = await deps.memoryService.noteFromAgent({
        householdId: ctx.householdId,
        nodeType: parsed.node_type,
        facet: parsed.facet,
        proseText: parsed.prose_text,
        subjectChildId,
        confidence: parsed.confidence ?? 0.8,
        sourceRef: {
          source_type: 'onboarding_turn',
          user_id: ctx.userId,
        },
      });

      ctx.logger.info(
        {
          module: 'onboarding-tools',
          action: 'memory.note',
          household_id: ctx.householdId,
          user_id: ctx.userId,
          node_id: result.node_id,
          node_type: parsed.node_type,
          subject_child_id: parsed.subject_child_id ?? null,
        },
        'memory.note handled',
      );

      const output = MemoryNoteFromOnboardingOutputSchema.parse({
        node_id: result.node_id,
        created_at: result.created_at,
      });
      return output;
    },
  };
}

// ---- household.upsert ----------------------------------------------------

// Slice 2-s27 — household-level food-identity facts (cultural identifiers,
// dietary preferences, household-wide declared allergens) live on the
// household row, not duplicated across every child. This tool is the agent's
// PATCH-style writer for those fields. PATCH semantics mirror child.upsert:
// omit a field to preserve, empty array to clear, non-empty array to replace.

export function createHouseholdUpsertToolSpec(
  ctx: OnboardingToolContext,
  deps: OnboardingToolDeps,
): ToolSpec {
  return {
    name: 'household.upsert',
    description:
      'Record household-level food identity. Use this for facts that describe ' +
      'the whole home — cultural identity, dietary rules, religious or cultural ' +
      'allergen exclusions. Example triggers: "we\'re a halal household" → set ' +
      'dietary_preferences=["halal"]; "we don\'t eat pork" → set ' +
      'declared_allergens=["pork"]; "we\'re Malayali" → set cultural_identifiers=' +
      '["south_asian","malayali"]. PATCH semantics: only include fields you are ' +
      'updating; omitting a field preserves the existing value; passing an empty ' +
      'array clears it. Do NOT use this for per-child facts — use child.upsert ' +
      'for medical allergies, names, and ages. Tag values are validated against ' +
      'the household vocabulary (the system prompt lists the active sets). ' +
      'ALLERGEN ACCUMULATION: if you are adding allergens across multiple turns, ' +
      'use declared_allergens_add (NOT declared_allergens) so you do not silently ' +
      'overwrite allergens recorded in a previous turn. declared_allergens_add ' +
      'merges items into the existing list. declared_allergens replaces the full ' +
      'list — only use it when you have the complete set. The two fields are ' +
      'mutually exclusive in a single call.',
    inputSchema: HouseholdUpsertInputSchema,
    outputSchema: HouseholdUpsertOutputSchema,
    maxLatencyMs: 1200,
    fn: async (input: unknown) => {
      const parsed = HouseholdUpsertInputSchema.parse(input);

      if (parsed.declared_allergens !== undefined && parsed.declared_allergens_add !== undefined) {
        throw new Error(
          'declared_allergens and declared_allergens_add are mutually exclusive — use declared_allergens_add to add items, declared_allergens to replace the full list',
        );
      }

      let result;
      if (parsed.declared_allergens_add !== undefined) {
        result = await deps.householdsService.addAllergens(
          ctx.householdId,
          parsed.declared_allergens_add,
          {
            cultural_identifiers: parsed.cultural_identifiers,
            dietary_preferences: parsed.dietary_preferences,
          },
        );
      } else {
        result = await deps.householdsService.patchProfile(ctx.householdId, {
          cultural_identifiers: parsed.cultural_identifiers,
          dietary_preferences: parsed.dietary_preferences,
          declared_allergens: parsed.declared_allergens,
        });
      }

      ctx.logger.info(
        {
          module: 'onboarding-tools',
          action: 'household.upsert',
          household_id: ctx.householdId,
          user_id: ctx.userId,
          changed_fields: [
            parsed.cultural_identifiers !== undefined ? 'cultural_identifiers' : null,
            parsed.dietary_preferences !== undefined ? 'dietary_preferences' : null,
            parsed.declared_allergens !== undefined ? 'declared_allergens' : null,
            parsed.declared_allergens_add !== undefined ? 'declared_allergens_add' : null,
          ].filter((v): v is string => v !== null),
          cultural_count: result.cultural_identifiers.length,
          dietary_count: result.dietary_preferences.length,
          allergen_count: result.declared_allergens.length,
        },
        'household.upsert handled',
      );

      return HouseholdUpsertOutputSchema.parse({
        household_id: result.id,
        was_existing: true,
      });
    },
  };
}

// ===========================================================================
// Slice 2.5-s1 — seven new structured tools (stub factories)
// ===========================================================================
// Each factory validates input via the Zod schema, emits a Pino info log
// with the structured payload, and returns a deterministic-shaped stub
// success response. Full DB-writing implementations land alongside the
// moment slices (2.5-s5 through 2.5-s9) that actually need them.
//
// IMPORTANT: these factories are NOT included in createOnboardingToolSpecs
// below — they're not yet exposed to OpenAI. Slice 2.5-s4 (agent prompt v2)
// is the slice that adds them to the array returned to the agent.

// ---- household.set_name --------------------------------------------------

export function createHouseholdSetNameToolSpec(
  ctx: OnboardingToolContext,
  deps: OnboardingToolDeps,
): ToolSpec {
  return {
    name: 'household.set_name',
    description:
      "Set the parent-chosen household label (e.g. 'The Menons'). Captured in " +
      'Moment 1 of Epic 2.5 onboarding. Single field, low ambiguity — call this ' +
      'as soon as the parent names the household.',
    inputSchema: HouseholdSetNameInputSchema,
    outputSchema: HouseholdSetNameOutputSchema,
    maxLatencyMs: 300,
    fn: async (input: unknown) => {
      const parsed = HouseholdSetNameInputSchema.parse(input);
      await deps.householdsService.setDisplayName(ctx.householdId, parsed.display_name);
      ctx.logger.info(
        {
          module: 'onboarding-tools',
          action: 'household.set_name',
          household_id: ctx.householdId,
          user_id: ctx.userId,
          display_name_length: parsed.display_name.length,
        },
        'household.set_name handled',
      );
      return HouseholdSetNameOutputSchema.parse({ household_id: ctx.householdId });
    },
  };
}

// ---- allergen.declare ----------------------------------------------------

export function createAllergenDeclareToolSpec(
  ctx: OnboardingToolContext,
  deps: OnboardingToolDeps,
): ToolSpec {
  return {
    name: 'allergen.declare',
    description:
      'Declare an allergen. One allergen per call. ' +
      'SCOPE: omit child_id and child_name entirely to write a HOUSEHOLD-WIDE row ' +
      '(applies to all family members — use this for M2 chip selections where the ' +
      "parent hasn't attributed the allergen to a specific child). " +
      'Pass child_name (or child_id) ONLY when the parent explicitly attributes ' +
      'the allergen to one child ("Adi also has shellfish"). ' +
      "Use this for medical allergens only; 'hates X' uses food_preference.declare.",
    inputSchema: AllergenDeclareInputSchema,
    outputSchema: AllergenDeclareOutputSchema,
    // 2.5-s6: bumped from 120 (stub) to cover DEK fetch + encrypt + DB upsert.
    maxLatencyMs: 800,
    fn: async (input: unknown) => {
      const parsed = AllergenDeclareInputSchema.parse(input);

      const hasId = parsed.child_id !== null && parsed.child_id !== undefined;
      const hasName = parsed.child_name !== null && parsed.child_name !== undefined;

      // Household-scope path: no child attribution → write with child_id = null.
      if (!hasId && !hasName) {
        const result = await deps.householdAllergensRepository.declareIfNew({
          household_id: ctx.householdId,
          child_id: null,
          allergen: parsed.allergen,
          source: parsed.source,
        });
        ctx.logger.info(
          {
            module: 'onboarding-tools',
            action: 'allergen.declare',
            household_id: ctx.householdId,
            user_id: ctx.userId,
            scope: 'household',
            source: parsed.source,
            inserted: result.inserted,
            allergen: 'REDACTED',
          },
          'allergen.declare (household-scope) handled',
        );
        return AllergenDeclareOutputSchema.parse({
          child_allergen_id: '',
          was_existing: !result.inserted,
        });
      }

      // Per-child path: resolve child_id from id or name.
      let childId: string;
      if (hasId) {
        // Verify the child belongs to this household. getChild throws NotFoundError
        // when the (householdId, childId) pair doesn't exist in children table,
        // preventing cross-household writes if the agent supplies a stale UUID.
        await deps.childrenService.getChild({ householdId: ctx.householdId, childId: parsed.child_id as string });
        childId = parsed.child_id as string;
      } else {
        const resolved = await deps.childrenService.findChildIdByName(
          ctx.householdId,
          parsed.child_name as string,
        );
        if (resolved === null) {
          throw new Error(
            `allergen.declare: child "${parsed.child_name as string}" not found in household ${ctx.householdId} — ` +
              'call child.upsert first to register the child, then declare their allergen',
          );
        }
        childId = resolved;
      }

      const result = await deps.childAllergensRepository.declare(
        ctx.householdId,
        childId,
        parsed.allergen,
        parsed.source,
      );

      // Guardrail — allergen plaintext is medical PII; do NOT include
      // parsed.allergen in this log. The repository owns the encrypted
      // payload; provenance lives in DB row source + audit log.
      ctx.logger.info(
        {
          module: 'onboarding-tools',
          action: 'allergen.declare',
          household_id: ctx.householdId,
          user_id: ctx.userId,
          scope: 'child',
          child_id: childId,
          source: parsed.source,
          was_existing: result.was_existing,
          allergen: 'REDACTED',
        },
        'allergen.declare (child-scope) handled',
      );

      return AllergenDeclareOutputSchema.parse({
        child_allergen_id: result.child_allergen_id,
        was_existing: result.was_existing,
      });
    },
  };
}

// ---- dietary.declare -----------------------------------------------------

export function createDietaryDeclareToolSpec(
  ctx: OnboardingToolContext,
  deps: OnboardingToolDeps,
): ToolSpec {
  return {
    name: 'dietary.declare',
    description:
      "Declare a dietary identity tag (e.g. 'halal', 'vegetarian'). Pass " +
      'child_id=null for household-scoped (the default post-Epic-2.5) or a ' +
      'specific child_id for the rare per-child override case. enforcement is ' +
      "required — typically 'strong' or 'non_negotiable' for religious dietary " +
      "rules, 'default' for family preferences.",
    inputSchema: DietaryDeclareInputSchema,
    outputSchema: DietaryDeclareOutputSchema,
    // 2.5-s6: bumped from 100 (stub) to cover real DB upsert + fallback path.
    maxLatencyMs: 400,
    fn: async (input: unknown) => {
      const parsed = DietaryDeclareInputSchema.parse(input);

      // Throws if tag is not in the active dietary vocabulary; the agent
      // receives the failure as a tool-call error and recovers by retrying
      // with a vocabulary-valid tag.
      deps.vocabularyService.validateDietary([parsed.tag]);

      const result = await deps.dietaryPreferencesRepository.declare(
        ctx.householdId,
        parsed.child_id ?? null,
        parsed.tag,
        parsed.enforcement,
        parsed.source,
      );

      // Slice 2.7-s5 — replaces the [CHIP_PROMPT:elevation:…] prose sentinel.
      // Echo the model's ratification request back on the structured result so
      // the service renders the M3 ratification chip from this value (never
      // from a regex over the prose).
      const ratificationRequested = parsed.request_ratification === true;

      ctx.logger.info(
        {
          module: 'onboarding-tools',
          action: 'dietary.declare',
          household_id: ctx.householdId,
          user_id: ctx.userId,
          child_scoped: parsed.child_id !== null && parsed.child_id !== undefined,
          tag: parsed.tag,
          enforcement: parsed.enforcement,
          request_ratification: ratificationRequested,
          was_existing: result.was_existing,
        },
        'dietary.declare handled',
      );

      return DietaryDeclareOutputSchema.parse({
        dietary_id: result.dietary_id,
        was_existing: result.was_existing,
        ratification_requested: ratificationRequested ? true : undefined,
      });
    },
  };
}

// ---- cuisine.declare -----------------------------------------------------

export function createCuisineDeclareToolSpec(
  ctx: OnboardingToolContext,
  deps: OnboardingToolDeps,
): ToolSpec {
  return {
    name: 'cuisine.declare',
    description:
      "Register a cuisine preference identifier (e.g. 'south_indian', " +
      "'levantine'). Shares the cultural_priors table with cultural.note — " +
      'cuisine.declare is for cuisine preference, cultural.note is for ' +
      'cultural/religious identity. enforcement defaults to ' +
      "'just_for_context' for cuisine preferences (advisory, not gating).",
    inputSchema: CuisineDeclareInputSchema,
    outputSchema: CuisineDeclareOutputSchema,
    // Slice 2.5-s7 — bumped from 100 (stub) to cover real cultural_priors
    // upsert + the cuisine-tags vocabulary validation.
    maxLatencyMs: 600,
    fn: async (input: unknown) => {
      const parsed = CuisineDeclareInputSchema.parse(input);

      // Vocabulary gate — throws on unknown key. The agent recovers by
      // retrying with a vocabulary-valid cuisine key; the error message
      // includes the unknown key so the agent can self-correct.
      deps.vocabularyService.validateCuisine([parsed.key]);

      const result = await deps.culturalPriorRepository.noteSuggested(ctx.householdId, {
        key: parsed.key,
        label: parsed.label,
        confidence: parsed.confidence,
        presence: parsed.presence,
        enforcement: parsed.enforcement,
      });

      // Slice 2.7-s5 — same structured ratification channel as dietary.declare.
      const ratificationRequested = parsed.request_ratification === true;

      ctx.logger.info(
        {
          module: 'onboarding-tools',
          action: 'cuisine.declare',
          household_id: ctx.householdId,
          user_id: ctx.userId,
          key: parsed.key,
          enforcement: parsed.enforcement,
          request_ratification: ratificationRequested,
          prior_id: result.id,
          was_existing: result.was_existing,
        },
        'cuisine.declare handled',
      );

      return CuisineDeclareOutputSchema.parse({
        prior_id: result.id,
        was_existing: result.was_existing,
        ratification_requested: ratificationRequested ? true : undefined,
      });
    },
  };
}

// ---- food_preference.declare ---------------------------------------------

export function createFoodPreferenceDeclareToolSpec(
  ctx: OnboardingToolContext,
  deps: OnboardingToolDeps,
): ToolSpec {
  return {
    name: 'food_preference.declare',
    description:
      'Record a like/dislike/refuses food preference. Open vocabulary (free-' +
      'text item name accepted). Pass child_id or child_name for per-child ' +
      'preferences; omit both for household-wide. valence values: loves, ' +
      "likes, neutral, dislikes, refuses. enforcement defaults to 'soft'. " +
      "USE THIS for 'X hates broccoli' — NOT allergen.declare (which is " +
      'medical-only).',
    inputSchema: FoodPreferenceDeclareInputSchema,
    outputSchema: FoodPreferenceDeclareOutputSchema,
    // Slice 2.5-s7 — bumped from 120 (stub) to cover DEK fetch + encrypt +
    // upsert (+ 42P10 fallback in the worst case).
    maxLatencyMs: 800,
    fn: async (input: unknown) => {
      const parsed = FoodPreferenceDeclareInputSchema.parse(input);

      // Resolve child_id: schema allows BOTH null (household-scoped is valid).
      // When child_id is supplied: verify cross-household safety via getChild.
      // When only child_name is supplied: case-insensitive lookup; throws if
      // not found so the agent re-routes through child.upsert first.
      let resolvedChildId: string | null = null;
      const hasId = parsed.child_id !== null && parsed.child_id !== undefined;
      const hasName = parsed.child_name !== null && parsed.child_name !== undefined;
      if (hasId) {
        await deps.childrenService.getChild({
          householdId: ctx.householdId,
          childId: parsed.child_id as string,
        });
        resolvedChildId = parsed.child_id as string;
      } else if (hasName) {
        const resolved = await deps.childrenService.findChildIdByName(
          ctx.householdId,
          parsed.child_name as string,
        );
        if (resolved === null) {
          throw new Error(
            `food_preference.declare: child "${parsed.child_name as string}" not found in household ${ctx.householdId} — ` +
              'call child.upsert first to register the child, then declare their preference',
          );
        }
        resolvedChildId = resolved;
      }
      // else: both null → household-wide preference (null child_id is valid)

      const result = await deps.foodPreferencesRepository.declare(
        ctx.householdId,
        resolvedChildId,
        parsed.item,
        parsed.valence,
        parsed.enforcement,
        parsed.source,
      );

      // Story 15-s2 — dual-write to the append-only signals log. The service
      // encrypts `item` before insert (mirrors food_preferences.item at-rest
      // encryption) and never throws into the tool loop.
      await deps.signalsService?.record({
        household_id: ctx.householdId,
        child_id: resolvedChildId,
        subject_ref: null,
        payload: {
          kind: 'preference_edit',
          item: parsed.item,
          valence: parsed.valence,
          enforcement: parsed.enforcement,
          scope: resolvedChildId === null ? 'household' : 'child',
        },
        occurred_at: new Date().toISOString(),
        source: 'app',
      });

      // Guardrail — `item` is encrypted at rest under household DEK. The
      // plaintext item may be culturally specific; keep it out of Pino logs.
      ctx.logger.info(
        {
          module: 'onboarding-tools',
          action: 'food_preference.declare',
          household_id: ctx.householdId,
          user_id: ctx.userId,
          child_scoped: resolvedChildId !== null,
          valence: parsed.valence,
          enforcement: parsed.enforcement,
          was_existing: result.was_existing,
          item: 'REDACTED',
        },
        'food_preference.declare handled',
      );

      return FoodPreferenceDeclareOutputSchema.parse({
        food_preference_id: result.food_preference_id,
        was_existing: result.was_existing,
      });
    },
  };
}

// ---- favorite_lunch.add --------------------------------------------------

export function createFavoriteLunchAddToolSpec(
  ctx: OnboardingToolContext,
  deps: OnboardingToolDeps,
): ToolSpec {
  return {
    name: 'favorite_lunch.add',
    description:
      'Append a favorite lunch item to the household cold-start seed ' +
      '(Moment 5). Household-scoped only. Target: 10 items to satisfy FR124 ' +
      'completion gate. Idempotent on item: re-emitting the same item is a no-op.',
    inputSchema: FavoriteLunchAddInputSchema,
    outputSchema: FavoriteLunchAddOutputSchema,
    // Slice 2.6-s1 — backing store moved from `favorite_lunches` to the
    // canonical `recipes` + `household_recipe_usage` infrastructure (story
    // 3-31). Latency budget covers two writes (recipes INSERT + usage
    // upsert) and an idempotency conflict-recovery path.
    maxLatencyMs: 800,
    fn: async (input: unknown) => {
      const parsed = FavoriteLunchAddInputSchema.parse(input);

      // SECURITY: writes the trimmed, NFC-normalized label as plaintext
      // `recipes.canonical_name` (visibility='private'). Plaintext acceptance
      // documented in Epic 2.6 brief §3 "Encryption decision"; RLS +
      // visibility='private' + created_by_household_id are the access controls.
      const result = await deps.recipesRepository.declareForHousehold(
        ctx.householdId,
        parsed.item,
      );

      // Position is derived from the declared-favourite count. household_recipe_usage
      // has no per-row position column; the 0-based index is a display hint only.
      const declaredCount = await deps.recipesRepository.countDeclaredFavorites(
        ctx.householdId,
      );
      const position = Math.max(0, declaredCount - 1);

      // Item plaintext is culturally specific (e.g. "Khichdi thermos") — do
      // NOT log it. item_length is structured and safe.
      ctx.logger.info(
        {
          module: 'onboarding-tools',
          action: 'favorite_lunch.add',
          household_id: ctx.householdId,
          user_id: ctx.userId,
          item_length: parsed.item.length,
          position,
          recipe_id: result.recipeId,
          recipe_was_inserted: result.recipeWasInserted,
          usage_was_existing: result.usageWasExisting,
        },
        'favorite_lunch.add handled',
      );

      return FavoriteLunchAddOutputSchema.parse({
        // Slice 2.6-s1 — `favorite_lunch_id` field now carries the recipes.id.
        // Output field name preserved for stability of the agent's tool surface.
        favorite_lunch_id: result.recipeId,
        position,
      });
    },
  };
}

// ---- rule.set ------------------------------------------------------------

export function createRuleSetToolSpec(
  ctx: OnboardingToolContext,
  deps: OnboardingToolDeps,
): ToolSpec {
  return {
    name: 'rule.set',
    description:
      'Set a household-wide rule. rule_type values: no_pork, no_alcohol, ' +
      'no_beef, no_overnight_leftovers, no_microwave_at_school, custom. ' +
      "custom_label REQUIRED when rule_type='custom', omitted otherwise. " +
      "enforcement defaults to 'strong'. One row per rule_type per household " +
      '(non-custom); one row per unique custom_label per household.',
    inputSchema: RuleSetInputSchema,
    outputSchema: RuleSetOutputSchema,
    // Slice 2.5-s7 — bumped from 100 (stub) to cover DEK fetch (custom path)
    // + upsert.
    maxLatencyMs: 600,
    fn: async (input: unknown) => {
      const parsed = RuleSetInputSchema.parse(input);

      // RuleSetInputSchema's .refine already enforces custom_label xor
      // non-custom at the input boundary; the repository enforces it again
      // as defence-in-depth.
      const result = await deps.householdRulesRepository.declare(
        ctx.householdId,
        parsed.rule_type as RuleType,
        parsed.custom_label ?? null,
        parsed.enforcement,
        parsed.source,
      );

      // Custom labels may be culturally specific (e.g. "no sattvic-violating
      // foods on Tuesdays") — do NOT log the plaintext. Non-custom rule_type
      // is structured and safe to log.
      ctx.logger.info(
        {
          module: 'onboarding-tools',
          action: 'rule.set',
          household_id: ctx.householdId,
          user_id: ctx.userId,
          rule_type: parsed.rule_type,
          enforcement: parsed.enforcement,
          custom_label: parsed.rule_type === 'custom' ? 'REDACTED' : null,
          was_existing: result.was_existing,
        },
        'rule.set handled',
      );

      return RuleSetOutputSchema.parse({
        household_rule_id: result.household_rule_id,
        was_existing: result.was_existing,
      });
    },
  };
}

// ---- Factory bundle ------------------------------------------------------

/**
 * Convenience: build the full tool spec bundle for a given (householdId,
 * userId) context. The OnboardingService calls this per turn and passes the
 * returned array to OnboardingAgent.respond().
 *
 * Slice 2.5-s5 completes the 2.5-s4 bundle — the seven new structured tools
 * (household.set_name, allergen.declare, dietary.declare, cuisine.declare,
 * food_preference.declare, favorite_lunch.add, rule.set) are exposed alongside
 * the original four. household.set_name is fully wired (real DB write).
 * The remaining six retain their 2.5-s1 stub implementations until the moment
 * slices (2.5-s6 through 2.5-s9) wire them to real persistence.
 * Total: 11 tools.
 */
export function createOnboardingToolSpecs(
  ctx: OnboardingToolContext,
  deps: OnboardingToolDeps,
): ToolSpec[] {
  return [
    createChildUpsertToolSpec(ctx, deps),
    createCulturalNoteToolSpec(ctx, deps),
    createMemoryNoteToolSpec(ctx, deps),
    createHouseholdUpsertToolSpec(ctx, deps),
    createHouseholdSetNameToolSpec(ctx, deps),
    createAllergenDeclareToolSpec(ctx, deps),
    createDietaryDeclareToolSpec(ctx, deps),
    createCuisineDeclareToolSpec(ctx, deps),
    createFoodPreferenceDeclareToolSpec(ctx, deps),
    createFavoriteLunchAddToolSpec(ctx, deps),
    createRuleSetToolSpec(ctx, deps),
  ];
}
