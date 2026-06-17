import type { Redis } from 'ioredis';
import {
  PlanComposeTreeInputSchema,
  PlanComposeTreeOutputSchema,
} from '@hivekitchen/contracts';
import { recordToolLatency } from '../../observability/tool-latency.histogram.js';
import type { ToolSpec } from '../tools.manifest.js';
import type { PlansService } from '../../modules/plans/plans.service.js';
import type { RecipeService } from '../../modules/recipe/recipe.service.js';

export const MANIFESTED_TOOL_NAMES = ['plan.compose'] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Tree-shape planner tool. Operates on the canonical 4-table tree
// (main_assignments + days[].slots[].variations). The PLANNER_PROMPT in
// apps/api/src/agents/prompts/planner.prompt.ts is the matching prompt.
export function createPlanComposeSpec(planService: PlansService, redis: Redis, recipeService: RecipeService): ToolSpec {
  return {
    name: 'plan.compose',
    description:
      "Assemble the final weekly plan as the canonical tree (main_assignments + days[].slots[].variations). main_assignment_sequence is the symbolic 1..6 handle that variations on main slots reference; snack/extra slots carry recipe_id (recipe name or UUID) directly. Returns a validated tree ready for guardrail evaluation and atomic commit_plan() RPC submission.",
    inputSchema: PlanComposeTreeInputSchema,
    outputSchema: PlanComposeTreeOutputSchema,
    maxLatencyMs: 4000,
    fn: async (input: unknown) => {
      const start = Date.now();
      try {
        const parsed = PlanComposeTreeInputSchema.parse(input);

        // Resolve any recipe_id values that are recipe names (not UUIDs) to
        // their catalog UUIDs. The model is more reliable at producing recipe
        // names than at copying long UUID strings from the conversation history.
        const householdId = parsed.household_id;
        const nameCache = new Map<string, string>(); // name → UUID

        async function resolveRecipeId(value: string): Promise<string> {
          if (UUID_RE.test(value)) return value; // already a UUID
          if (nameCache.has(value)) return nameCache.get(value)!;
          const id = await recipeService.findIdByName(value, householdId);
          if (id == null) {
            throw new Error(
              `Recipe not found in catalog: "${value}". ` +
              `Use the exact name from a recipe.search, recipe.fetch, or recipe.discover result.`,
            );
          }
          nameCache.set(value, id);
          return id;
        }

        // Resolve main_assignments
        for (const assignment of parsed.main_assignments) {
          assignment.recipe_id = await resolveRecipeId(assignment.recipe_id);
        }
        // Resolve snack/extra slot recipe_ids
        for (const day of parsed.days) {
          for (const slot of day.slots) {
            if (slot.recipe_id !== undefined) {
              slot.recipe_id = await resolveRecipeId(slot.recipe_id);
            }
          }
        }

        const result = await planService.composeTree(parsed);
        // Slice 5-S9 — "reasoning" is planner metadata, not part of the
        // structural tree, so PlanComposeTreeInputSchema strips it from `parsed`.
        // Recover it from the raw tool args and merge it into the output the
        // orchestrator parses. Defensively truncated to the schema max (600) so a
        // long rationale can never fail the whole plan.compose call.
        const rawReasoning = (input as { reasoning?: unknown }).reasoning;
        const withReasoning =
          typeof rawReasoning === 'string' && rawReasoning.length > 0
            ? { ...result, reasoning: rawReasoning.slice(0, 600) }
            : result;
        return PlanComposeTreeOutputSchema.parse(withReasoning);
      } finally {
        try {
          await recordToolLatency(redis, 'plan.compose', Date.now() - start);
        } catch {
          // latency recording is observability-only; do not mask the tool result
        }
      }
    },
  };
}
