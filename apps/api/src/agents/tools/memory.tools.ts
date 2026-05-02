import type { Redis } from 'ioredis';
import {
  MemoryNoteInputSchema,
  MemoryNoteOutputSchema,
  MemoryRecallInputSchema,
  MemoryRecallOutputSchema,
} from '@hivekitchen/contracts';
import { recordToolLatency } from '../../observability/tool-latency.histogram.js';
import type { ToolSpec } from '../tools.manifest.js';
import type { MemoryService } from '../../modules/memory/memory.service.js';

export const MANIFESTED_TOOL_NAMES = ['memory.note', 'memory.recall'] as const;

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

export function createMemoryRecallSpec(memoryService: MemoryService, redis: Redis): ToolSpec {
  return {
    name: 'memory.recall',
    description:
      'Read memory nodes for the household. Optionally filter by facet. Used by the planner to retrieve preferences, rhythms, and constraints.',
    inputSchema: MemoryRecallInputSchema,
    outputSchema: MemoryRecallOutputSchema,
    maxLatencyMs: 200,
    fn: async (input: unknown): Promise<unknown> => {
      const start = Date.now();
      try {
        const parsed = MemoryRecallInputSchema.parse(input);
        const result = await memoryService.recall(parsed);
        return MemoryRecallOutputSchema.parse(result);
      } finally {
        try {
          await recordToolLatency(redis, 'memory.recall', Date.now() - start);
        } catch {
          // latency recording is observability-only; do not mask the tool result
        }
      }
    },
  };
}
