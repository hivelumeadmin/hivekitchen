import type { Redis } from 'ioredis';
import { PlanComposeInputSchema, PlanComposeOutputSchema } from '@hivekitchen/contracts';
import { recordToolLatency } from '../../observability/tool-latency.histogram.js';
import type { ToolSpec } from '../tools.manifest.js';
import type { PlansService } from '../../modules/plans/plans.service.js';

export const MANIFESTED_TOOL_NAMES = ['plan.compose'] as const;

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
