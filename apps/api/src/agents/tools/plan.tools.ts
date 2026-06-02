import type { Redis } from 'ioredis';
import {
  PlanComposeTreeInputSchema,
  PlanComposeTreeOutputSchema,
} from '@hivekitchen/contracts';
import { recordToolLatency } from '../../observability/tool-latency.histogram.js';
import type { ToolSpec } from '../tools.manifest.js';
import type { PlansService } from '../../modules/plans/plans.service.js';

export const MANIFESTED_TOOL_NAMES = ['plan.compose'] as const;

// Tree-shape planner tool. Operates on the canonical 4-table tree
// (main_assignments + days[].slots[].variations). The PLANNER_PROMPT in
// apps/api/src/agents/prompts/planner.prompt.ts is the matching prompt.
export function createPlanComposeSpec(planService: PlansService, redis: Redis): ToolSpec {
  return {
    name: 'plan.compose',
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
          await recordToolLatency(redis, 'plan.compose', Date.now() - start);
        } catch {
          // latency recording is observability-only; do not mask the tool result
        }
      }
    },
  };
}
