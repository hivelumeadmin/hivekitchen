import type { Redis } from 'ioredis';
import {
  PlanComposeInputSchema,
  PlanComposeOutputSchema,
  PlanComposeTreeInputSchema,
  PlanComposeTreeOutputSchema,
} from '@hivekitchen/contracts';
import { recordToolLatency } from '../../observability/tool-latency.histogram.js';
import type { ToolSpec } from '../tools.manifest.js';
import type { PlansService } from '../../modules/plans/plans.service.js';

// Story 3-DM-C1 Phase 5 — `plan.compose.tree` joins the manifest. Both
// names coexist during the cutover window; Phase 9 deletes `plan.compose`.
export const MANIFESTED_TOOL_NAMES = ['plan.compose', 'plan.compose.tree'] as const;

export function createPlanComposeSpec(planService: PlansService, redis: Redis): ToolSpec {
  return {
    name: 'plan.compose',
    description:
      "Assemble the final weekly plan structure from the planner's day-level meal decisions. Returns a validated WeeklyPlan ready for guardrail evaluation.",
    inputSchema: PlanComposeInputSchema,
    outputSchema: PlanComposeOutputSchema,
    maxLatencyMs: 2000,
    fn: async (input: unknown) => {
      const start = Date.now();
      try {
        const parsed = PlanComposeInputSchema.parse(input);
        const result = await planService.compose(parsed);
        return PlanComposeOutputSchema.parse(result);
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

// Story 3-DM-C1 Phase 5 — tree-shape planner tool. Same role as plan.compose
// but operates on the canonical 4-table tree
// (main_assignments + days[].slots[].variations) instead of the flat
// days[].items[] array. PLANNER_PROMPT_TREE in
// apps/api/src/agents/prompts/planner.prompt.ts is the matching prompt.
//
// Phase 9 deletes createPlanComposeSpec + the flat schemas, renames this
// tool back to 'plan.compose', and applies the migration in the same
// commit. Until then both tools live side-by-side; orchestrator registers
// both. The planner LLM only sees the one its prompt's toolsAllowed list
// exposes — flat vs tree never appear in the same allow-list.
export function createPlanComposeTreeSpec(planService: PlansService, redis: Redis): ToolSpec {
  return {
    name: 'plan.compose.tree',
    description:
      "Assemble the final weekly plan as the canonical tree (main_assignments + days[].slots[].variations). main_assignment_sequence is the symbolic 1..6 handle that variations on main slots reference; snack/extra slots carry recipe_id directly. Returns a validated tree ready for guardrail evaluation and atomic commit_plan() RPC submission.",
    inputSchema: PlanComposeTreeInputSchema,
    outputSchema: PlanComposeTreeOutputSchema,
    maxLatencyMs: 2000,
    fn: async (input: unknown) => {
      const start = Date.now();
      try {
        const parsed = PlanComposeTreeInputSchema.parse(input);
        const result = await planService.composeTree(parsed);
        return PlanComposeTreeOutputSchema.parse(result);
      } finally {
        try {
          await recordToolLatency(redis, 'plan.compose.tree', Date.now() - start);
        } catch {
          // latency recording is observability-only; do not mask the tool result
        }
      }
    },
  };
}
