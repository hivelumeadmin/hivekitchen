import { z } from 'zod';
import type { ZodTypeAny } from 'zod';

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: ZodTypeAny;
  outputSchema: ZodTypeAny;
  maxLatencyMs: number;
  fn: (input: unknown) => Promise<unknown>;
}

const PlaceholderInputSchema = z.object({ echo: z.string() });
const PlaceholderOutputSchema = z.object({ echo: z.string() });

const placeholderSpec: ToolSpec = {
  name: '_placeholder',
  description: 'Manifest health-check placeholder — remove before Epic 3 tools land',
  inputSchema: PlaceholderInputSchema,
  outputSchema: PlaceholderOutputSchema,
  maxLatencyMs: 50,
  fn: async (input) => {
    const parsed = PlaceholderInputSchema.parse(input);
    return { echo: parsed.echo };
  },
};

export const TOOL_MANIFEST = new Map<string, ToolSpec>([['_placeholder', placeholderSpec]]);
