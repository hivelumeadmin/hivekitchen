import type { FastifyBaseLogger } from 'fastify';
import {
  ChildUpsertInputSchema,
  ChildUpsertOutputSchema,
  CulturalNoteInputSchema,
  CulturalNoteOutputSchema,
  MemoryNoteFromOnboardingInputSchema,
  MemoryNoteFromOnboardingOutputSchema,
} from '@hivekitchen/contracts';
import type { ChildrenService } from '../../modules/children/children.service.js';
import type { CulturalPriorRepository } from '../../modules/cultural-priors/cultural-prior.repository.js';
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
  memoryService: MemoryService;
  vocabularyService: VocabularyService;
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
      const declared_allergens =
        parsed.declared_allergens === undefined
          ? undefined
          : deps.vocabularyService.validateAllergens(parsed.declared_allergens);
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
        },
      });

      ctx.logger.info(
        {
          module: 'onboarding-tools',
          action: 'child.upsert',
          household_id: ctx.householdId,
          user_id: ctx.userId,
          child_id: result.child.id,
          was_existing: result.was_existing,
        },
        'child.upsert handled',
      );

      const output = ChildUpsertOutputSchema.parse({
        child_id: result.child.id,
        name: result.child.name,
        was_existing: result.was_existing,
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
      });

      ctx.logger.info(
        {
          module: 'onboarding-tools',
          action: 'cultural.note',
          household_id: ctx.householdId,
          user_id: ctx.userId,
          key: parsed.key,
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
      "Tuesdays'). For child-specific notes (allergies, refusals, obsessions), pass " +
      'subject_child_id from a prior child.upsert call. For household-wide patterns, ' +
      'omit subject_child_id. node_type values: preference, rhythm, cultural_rhythm, ' +
      'allergy, child_obsession, school_policy, other.',
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

// ---- Factory bundle ------------------------------------------------------

/**
 * Convenience: build all three tool specs for a given (householdId, userId)
 * context. The OnboardingService calls this per turn and passes the returned
 * array to OnboardingAgent.respond().
 */
export function createOnboardingToolSpecs(
  ctx: OnboardingToolContext,
  deps: OnboardingToolDeps,
): ToolSpec[] {
  return [
    createChildUpsertToolSpec(ctx, deps),
    createCulturalNoteToolSpec(ctx, deps),
    createMemoryNoteToolSpec(ctx, deps),
  ];
}
