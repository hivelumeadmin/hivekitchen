import type { ZodTypeAny } from 'zod';
import {
  AllergyCheckInputSchema,
  AllergyCheckOutputSchema,
  MemoryNoteInputSchema,
  MemoryNoteOutputSchema,
} from '@hivekitchen/contracts';

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: ZodTypeAny;
  outputSchema: ZodTypeAny;
  maxLatencyMs: number;
  fn: (input: unknown) => Promise<unknown>;
}

const allergyCheckStubSpec: ToolSpec = {
  name: 'allergy.check',
  description:
    'Advisory allergy check — Story 3.2 injects fn via createAllergyCheckSpec(allergyGuardrailService).',
  inputSchema: AllergyCheckInputSchema,
  outputSchema: AllergyCheckOutputSchema,
  maxLatencyMs: 150,
  fn: async (): Promise<unknown> => {
    throw new Error(
      'allergy.check not yet wired — Story 3.2 injects fn via createAllergyCheckSpec(allergyGuardrailService)',
    );
  },
};

const memoryNoteStubSpec: ToolSpec = {
  name: 'memory.note',
  description:
    'Write a new memory node from agent context. Story 3.2 injects the real fn via createMemoryNoteSpec(memoryService).',
  inputSchema: MemoryNoteInputSchema,
  outputSchema: MemoryNoteOutputSchema,
  maxLatencyMs: 200,
  fn: async (): Promise<unknown> => {
    throw new Error(
      'memory.note not yet wired — Story 3.2 injects fn via createMemoryNoteSpec(memoryService)',
    );
  },
};

export const TOOL_MANIFEST = new Map<string, ToolSpec>([
  ['allergy.check', allergyCheckStubSpec],
  ['memory.note', memoryNoteStubSpec],
]);
