import { MemoryNoteInputSchema, MemoryNoteOutputSchema } from '@hivekitchen/contracts';
import type { ToolSpec } from '../tools.manifest.js';
import type { MemoryService } from '../../modules/memory/memory.service.js';

export function createMemoryNoteSpec(memoryService: MemoryService): ToolSpec {
  return {
    name: 'memory.note',
    description:
      'Write a new memory node sourced from agent context (preference, rhythm, allergy, etc.).',
    inputSchema: MemoryNoteInputSchema,
    outputSchema: MemoryNoteOutputSchema,
    maxLatencyMs: 200,
    fn: async (input: unknown): Promise<unknown> => {
      const parsed = MemoryNoteInputSchema.parse(input);
      const result = await memoryService.noteFromAgent({
        householdId: parsed.household_id,
        nodeType: parsed.node_type,
        facet: parsed.facet,
        proseText: parsed.prose_text,
        subjectChildId: parsed.subject_child_id,
        confidence: parsed.confidence,
      });
      return MemoryNoteOutputSchema.parse(result);
    },
  };
}
