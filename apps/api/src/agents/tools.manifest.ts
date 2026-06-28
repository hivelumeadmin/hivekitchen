import type { ZodTypeAny } from 'zod';
import { NotImplementedError } from '../common/errors.js';
import {
  AllergyCheckInputSchema,
  AllergyCheckOutputSchema,
  ChildSignalInputSchema,
  ChildSignalOutputSchema,
  CulturalLookupInputSchema,
  CulturalLookupOutputSchema,
  MemoryNoteInputSchema,
  MemoryNoteOutputSchema,
  MemoryRecallInputSchema,
  MemoryRecallOutputSchema,
  PantryReadInputSchema,
  PantryReadOutputSchema,
  PlanComposeTreeInputSchema,
  PlanComposeTreeOutputSchema,
  RecipeDiscoverInputSchema,
  RecipeDiscoverOutputSchema,
  RecipeFetchInputSchema,
  RecipeFetchOutputSchema,
  RecipeSearchInputSchema,
  RecipeSearchOutputSchema,
} from '@hivekitchen/contracts';

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: ZodTypeAny;
  outputSchema: ZodTypeAny;
  maxLatencyMs: number;
  fn: (input: unknown) => Promise<unknown>;
}

// Stub spec factory: every tool entry in TOOL_MANIFEST starts with a fn that
// throws — DomainOrchestrator overwrites each entry with the real wired spec
// in its constructor. The CI lint from Story 1.9 enforces the presence of all
// 5 required fields including maxLatencyMs.
function stubSpec(
  name: string,
  description: string,
  inputSchema: ZodTypeAny,
  outputSchema: ZodTypeAny,
  maxLatencyMs: number,
  wireMessage: string,
): ToolSpec {
  return {
    name,
    description,
    inputSchema,
    outputSchema,
    maxLatencyMs,
    fn: async (): Promise<unknown> => {
      throw new NotImplementedError(wireMessage);
    },
  };
}

const allergyCheckStubSpec = stubSpec(
  'allergy.check',
  'Advisory allergy check — runs same engine as authoritative guardrail. Tool-cleared is not guardrail-cleared.',
  AllergyCheckInputSchema,
  AllergyCheckOutputSchema,
  150,
  'allergy.check not wired — DomainOrchestrator constructor must inject createAllergyCheckSpec(allergyGuardrailService, redis)',
);

const memoryNoteStubSpec = stubSpec(
  'memory.note',
  'Write a new memory node sourced from agent context (preference, rhythm, allergy, etc.).',
  MemoryNoteInputSchema,
  MemoryNoteOutputSchema,
  200,
  'memory.note not wired — DomainOrchestrator constructor must inject createMemoryNoteSpec(memoryService)',
);

const memoryRecallStubSpec = stubSpec(
  'memory.recall',
  'Read memory nodes for the household. Optionally filter by facet. Used by the planner to retrieve preferences, rhythms, and constraints.',
  MemoryRecallInputSchema,
  MemoryRecallOutputSchema,
  200,
  'memory.recall not wired — DomainOrchestrator constructor must inject createMemoryRecallSpec(memoryService, redis)',
);

const recipeSearchStubSpec = stubSpec(
  'recipe.search',
  'Search recipes by natural-language query. Returns previews with allergen flags for up to max_results recipes.',
  RecipeSearchInputSchema,
  RecipeSearchOutputSchema,
  300,
  'recipe.search not wired — DomainOrchestrator constructor must inject createRecipeSearchSpec(recipeService, redis)',
);

const recipeFetchStubSpec = stubSpec(
  'recipe.fetch',
  'Fetch full recipe detail including all ingredients with allergen annotations.',
  RecipeFetchInputSchema,
  RecipeFetchOutputSchema,
  100,
  'recipe.fetch not wired — DomainOrchestrator constructor must inject createRecipeFetchSpec(recipeService, redis)',
);

// Story 3-31 — recipe.discover stub. Higher latency budget than search/fetch
// because the live wiring fans out to Tavily + LLM extraction. Per-planWeek
// closure is built in DomainOrchestrator.planWeek (not the constructor) so
// it can carry the run's requestId for audit correlation.
const recipeDiscoverStubSpec = stubSpec(
  'recipe.discover',
  'Discover candidate recipes from the public web (Allrecipes / RecipeTin Eats) shaped to the household profile. Call ONLY when recipe.search returns too few results.',
  RecipeDiscoverInputSchema,
  RecipeDiscoverOutputSchema,
  8000,
  'recipe.discover not wired — DomainOrchestrator.planWeek must inject createRecipeDiscoverSpec(recipeService, discoverDeps, redis) per run',
);

const pantryReadStubSpec = stubSpec(
  'pantry.read',
  'Read current pantry inventory for the household. Used by the planner to prefer ingredients already on hand.',
  PantryReadInputSchema,
  PantryReadOutputSchema,
  80,
  'pantry.read not wired — DomainOrchestrator constructor must inject createPantryReadSpec(pantryService, redis)',
);

const planComposeStubSpec = stubSpec(
  'plan.compose',
  "Assemble the final weekly plan structure from the planner's day-level meal decisions. Returns a validated WeeklyPlan ready for guardrail evaluation.",
  PlanComposeTreeInputSchema,
  PlanComposeTreeOutputSchema,
  2000,
  'plan.compose not wired — DomainOrchestrator constructor must inject createPlanComposeSpec(planService, redis)',
);

const culturalLookupStubSpec = stubSpec(
  'cultural.lookup',
  'Look up confirmed and active cultural templates for the household. Used by the planner to honour cultural constraints when composing meals.',
  CulturalLookupInputSchema,
  CulturalLookupOutputSchema,
  80,
  'cultural.lookup not wired — DomainOrchestrator constructor must inject createCulturalLookupSpec(culturalPriorService, redis)',
);

// Story 4-S11 — child_signal stub. Real wiring is injected per-construction in
// the DomainOrchestrator constructor (needs the child-preferences + children
// repositories + redis). Registered here so the tool-manifest CI lint (Story
// 1.9) sees a complete entry for the name exported by child-signal.tools.ts.
const childSignalStubSpec = stubSpec(
  'child_signal',
  'Get per-child recipe preference signals from recent emoji ratings. Call once at the start of each planning run.',
  ChildSignalInputSchema,
  ChildSignalOutputSchema,
  200,
  'child_signal not wired — DomainOrchestrator constructor must inject createChildSignalSpec(childPrefsRepo, childrenRepo, redis)',
);

// Slice 2.7-s4 — the seven onboarding tool stubs (household.set_name,
// allergen.declare, dietary.declare, cuisine.declare, food_preference.declare,
// favorite_lunch.add, rule.set) were deleted from this manifest. They were dead
// duplicates: the real, fully-wired specs are built per-turn by
// createOnboardingToolSpecs() in tools/onboarding.tools.ts (the single source of
// truth), and the planner — the only consumer of TOOL_MANIFEST — never offered
// onboarding tools. Two definitions of the same tool names was a maintenance trap.

export const TOOL_MANIFEST = new Map<string, ToolSpec>([
  ['allergy.check', allergyCheckStubSpec],
  ['memory.note', memoryNoteStubSpec],
  ['memory.recall', memoryRecallStubSpec],
  ['recipe.search', recipeSearchStubSpec],
  ['recipe.fetch', recipeFetchStubSpec],
  ['recipe.discover', recipeDiscoverStubSpec],
  ['pantry.read', pantryReadStubSpec],
  ['plan.compose', planComposeStubSpec],
  ['cultural.lookup', culturalLookupStubSpec],
  ['child_signal', childSignalStubSpec],
]);
