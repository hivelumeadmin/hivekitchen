import type { Redis } from 'ioredis';
import {
  PlanComposeTreeInputSchema,
  PlanComposeTreeOutputSchema,
} from '@hivekitchen/contracts';
import { recordToolLatency } from '../../observability/tool-latency.histogram.js';
import type { ToolSpec } from '../tools.manifest.js';
import type { PlansService } from '../../modules/plans/plans.service.js';
import type { RecipeService } from '../../modules/recipe/recipe.service.js';

/** @public consumed dynamically by scripts/check-tool-manifest.ts */
export const MANIFESTED_TOOL_NAMES = ['plan.compose'] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Story 3.5 — OpenAI strict structured output expresses optional fields as
// `anyOf: [<schema>, null]` (see openai.adapter.ts addStrictConstraints), so the
// model emits `null` for fields it means to omit (e.g. recipe_id on a main slot).
// PlanComposeTreeInputSchema models those fields as `.optional()` (not
// `.nullable()`) — the whole input tree is optional-not-nullable — so we drop
// null-valued keys before parsing to turn "explicit null" back into "absent".
// Recurses through objects and arrays; leaves non-null scalars untouched.
function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === null) continue;
      out[k] = stripNulls(v);
    }
    return out;
  }
  return value;
}

// Tree-shape planner tool. Operates on the canonical 4-table tree
// (main_assignments + days[].slots[].variations). The PLANNER_PROMPT in
// apps/api/src/agents/prompts/planner.prompt.ts is the matching prompt.
export function createPlanComposeSpec(
  planService: PlansService,
  redis: Redis,
  recipeService: RecipeService,
  // Story 3.5-s3 — per-run slate index (handle → catalog UUID). Present only when
  // planWeek was given a candidate slate; absent on the cold-acquisition path.
  handleIndex?: ReadonlyMap<string, string>,
): ToolSpec {
  return {
    name: 'plan.compose',
    description:
      "Assemble the final weekly plan as the canonical tree (main_assignments + days[].slots[].variations). main_assignment_sequence is the symbolic 1..6 handle that variations on main slots reference; extra slots carry recipe_id (recipe name or UUID) directly. Snack slots are assigned deterministically server-side — do NOT emit snack slots. Returns a validated tree ready for guardrail evaluation and atomic commit_plan() RPC submission.",
    inputSchema: PlanComposeTreeInputSchema,
    outputSchema: PlanComposeTreeOutputSchema,
    maxLatencyMs: 4000,
    fn: async (input: unknown) => {
      const start = Date.now();
      try {
        const parsed = PlanComposeTreeInputSchema.parse(stripNulls(input));

        // Resolve any recipe_id values that are recipe names (not UUIDs) to
        // their catalog UUIDs. The model is more reliable at producing recipe
        // names than at copying long UUID strings from the conversation history.
        const householdId = parsed.household_id;
        const nameCache = new Map<string, string>(); // name → UUID

        async function resolveRecipeId(value: string): Promise<string> {
          if (UUID_RE.test(value)) return value; // already a UUID

          // Story 3.5-s3 — handle path. The <recipe_candidates> block emits stable
          // short handles (m1, m2, … for mains; e1, e2, … for extras); the model
          // returns the handle and we resolve it from the in-memory slate index
          // with NO DB call. A handle-shaped token absent from the index is a
          // hard, non-retried error — the s2 forced-schema path guarantees this
          // can only come from a genuinely bad model choice, not a format slip,
          // so feeding it back as a self-correction turn would be pointless.
          if (handleIndex !== undefined && handleIndex.has(value)) {
            return handleIndex.get(value)!;
          }
          if (/^[me][1-9]\d*$/.test(value)) {
            throw new Error(
              `Recipe handle "${value}" not found in the candidate slate. ` +
              `Handles are m1,m2,… (main) and e1,e2,… (extra) from the <recipe_candidates> block.`,
            );
          }

          // Cold-acquisition path: a recipe surfaced at runtime by
          // recipe.search / recipe.fetch / recipe.discover (not in the slate).
          if (nameCache.has(value)) return nameCache.get(value)!;
          const id = await recipeService.findIdByName(value, householdId);
          if (id === null) {
            throw new Error(
              `Recipe not found in catalog: "${value}". ` +
              `Use the handle (m1, m2, etc.) for candidates in <recipe_candidates>, ` +
              `or the exact name from a recipe.search/fetch/discover result.`,
            );
          }
          nameCache.set(value, id);
          return id;
        }

        // Resolve main_assignments
        for (const assignment of parsed.main_assignments) {
          assignment.recipe_id = await resolveRecipeId(assignment.recipe_id);
        }
        // Resolve extra slot recipe_ids (snack slots are server-assigned — skip them)
        for (const day of parsed.days) {
          for (const slot of day.slots) {
            if (slot.slot_kind === 'snack') continue;
            if (slot.recipe_id !== undefined) {
              slot.recipe_id = await resolveRecipeId(slot.recipe_id);
            }
          }
        }

        const result = await planService.composeTree(parsed);
        // Slice 3.5-s2 — "reasoning" is now part of PlanComposeTreeInputSchema, so
        // it survives schema parsing in `parsed` (and OpenAI strict structured
        // output, which strips out-of-schema fields). Merge it into the output the
        // orchestrator returns. The schema's .max(600) already enforces the bound.
        const withReasoning =
          parsed.reasoning !== undefined && parsed.reasoning.length > 0
            ? { ...result, reasoning: parsed.reasoning }
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
