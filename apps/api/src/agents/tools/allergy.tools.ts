import { AllergyCheckInputSchema, AllergyCheckOutputSchema } from '@hivekitchen/contracts';
import type { ToolSpec } from '../tools.manifest.js';
import type { AllergyGuardrailService } from '../../modules/allergy-guardrail/allergy-guardrail.service.js';

export const MANIFESTED_TOOL_NAMES = ['allergy.check'] as const;

export function createAllergyCheckSpec(
  allergyGuardrailService: AllergyGuardrailService,
): ToolSpec {
  return {
    name: 'allergy.check',
    description:
      'Advisory allergy check — runs same engine as authoritative guardrail. Tool-cleared is not guardrail-cleared.',
    inputSchema: AllergyCheckInputSchema,
    outputSchema: AllergyCheckOutputSchema,
    maxLatencyMs: 150,
    fn: async (input: unknown) => {
      const parsed = AllergyCheckInputSchema.parse(input);
      return allergyGuardrailService.evaluate(parsed.plan_items, parsed.household_id);
    },
  };
}
