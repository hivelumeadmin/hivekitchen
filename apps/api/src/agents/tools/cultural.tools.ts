import type { Redis } from 'ioredis';
import { CulturalLookupInputSchema, CulturalLookupOutputSchema } from '@hivekitchen/contracts';
import { recordToolLatency } from '../../observability/tool-latency.histogram.js';
import type { ToolSpec } from '../tools.manifest.js';
import type { CulturalPriorService } from '../../modules/cultural-priors/cultural-prior.service.js';

export const MANIFESTED_TOOL_NAMES = ['cultural.lookup'] as const;

export function createCulturalLookupSpec(
  culturalPriorService: CulturalPriorService,
  redis: Redis,
): ToolSpec {
  return {
    name: 'cultural.lookup',
    description:
      'Look up confirmed and active cultural templates for the household. Used by the planner to honour cultural constraints when composing meals.',
    inputSchema: CulturalLookupInputSchema,
    outputSchema: CulturalLookupOutputSchema,
    maxLatencyMs: 80,
    fn: async (input: unknown) => {
      const start = Date.now();
      try {
        const parsed = CulturalLookupInputSchema.parse(input);
        const priors = await culturalPriorService.listByHousehold(parsed.household_id);
        const result = {
          priors: priors
            .filter((p) => p.state === 'opt_in_confirmed' || p.state === 'active')
            .map((p) => ({
              id: p.id,
              key: p.key,
              label: p.label,
              state: p.state,
              tier: p.tier,
            })),
        };
        return CulturalLookupOutputSchema.parse(result);
      } finally {
        try {
          await recordToolLatency(redis, 'cultural.lookup', Date.now() - start);
        } catch {
          // latency recording is observability-only; do not mask the tool result
        }
      }
    },
  };
}
