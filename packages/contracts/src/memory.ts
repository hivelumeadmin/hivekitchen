import { z } from 'zod';

export const ForgetRequest = z.object({
  node_id: z.string().uuid(),
  mode: z.literal('soft'),
  reason: z.string().optional(),
});

export const ForgetCompletedEvent = z.object({
  type: z.literal('memory.forget.completed'),
  node_id: z.string().uuid(),
  mode: z.literal('soft'),
  completed_at: z.string().datetime(),
});

export const NodeTypeSchema = z.enum([
  'preference',
  'rhythm',
  'cultural_rhythm',
  'allergy',
  'child_obsession',
  'school_policy',
  'other',
]);

export const SourceTypeSchema = z.enum([
  'onboarding',
  'turn',
  'tool',
  'user_edit',
  'plan_outcome',
  'import',
]);

export const MemoryNodeSchema = z.object({
  id: z.string().uuid(),
  household_id: z.string().uuid(),
  node_type: NodeTypeSchema,
  facet: z.string().min(1).max(200),
  subject_child_id: z.string().uuid().nullable(),
  prose_text: z.string().min(1),
  soft_forget_at: z.string().datetime().nullable(),
  hard_forgotten: z.boolean(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const MemoryProvenanceSchema = z.object({
  id: z.string().uuid(),
  memory_node_id: z.string().uuid(),
  source_type: SourceTypeSchema,
  source_ref: z.record(z.string(), z.unknown()),
  captured_at: z.string().datetime(),
  captured_by: z.string().uuid().nullable(),
  confidence: z.number().min(0).max(1),
  superseded_by: z.string().uuid().nullable(),
});

export const MemoryNoteInputSchema = z.object({
  household_id: z.string().uuid(),
  node_type: NodeTypeSchema,
  facet: z.string().min(1).max(200),
  prose_text: z.string().min(1).max(2000),
  subject_child_id: z.string().uuid().nullable(),
  confidence: z.number().min(0).max(1).default(0.75),
});

export const MemoryNoteOutputSchema = z.object({
  node_id: z.string().uuid(),
  created_at: z.string().datetime(),
});

// Story 3.4 — memory.recall (read) tool I/O. Distinct from memory.note (write):
// the planner reads memory but does not write it, so memory.recall is in
// PLANNER_PROMPT.toolsAllowed while memory.note is not.
export const MemoryRecallInputSchema = z.object({
  household_id: z.string().uuid(),
  facets: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

export const MemoryRecallNodeSchema = z.object({
  node_id: z.string().uuid(),
  node_type: NodeTypeSchema,
  facet: z.string(),
  prose_text: z.string(),
  subject_child_id: z.string().uuid().nullable(),
  confidence: z.number().min(0).max(1),
});

export const MemoryRecallOutputSchema = z.object({
  nodes: z.array(MemoryRecallNodeSchema),
});
