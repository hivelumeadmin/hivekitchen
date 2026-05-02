import type { Redis } from 'ioredis';
import { PantryReadInputSchema, PantryReadOutputSchema } from '@hivekitchen/contracts';
import { recordToolLatency } from '../../observability/tool-latency.histogram.js';
import type { ToolSpec } from '../tools.manifest.js';
import type { PantryService } from '../../modules/pantry/pantry.service.js';

export const MANIFESTED_TOOL_NAMES = ['pantry.read'] as const;

export function createPantryReadSpec(pantryService: PantryService, redis: Redis): ToolSpec {
  return {
    name: 'pantry.read',
    description:
      'Read current pantry inventory for the household. Used by the planner to prefer ingredients already on hand.',
    inputSchema: PantryReadInputSchema,
    outputSchema: PantryReadOutputSchema,
    maxLatencyMs: 80,
    fn: async (input: unknown) => {
      const start = Date.now();
      try {
        const parsed = PantryReadInputSchema.parse(input);
        const result = await pantryService.read(parsed);
        return PantryReadOutputSchema.parse(result);
      } finally {
        try {
          await recordToolLatency(redis, 'pantry.read', Date.now() - start);
        } catch {
          // latency recording is observability-only; do not mask the tool result
        }
      }
    },
  };
}
