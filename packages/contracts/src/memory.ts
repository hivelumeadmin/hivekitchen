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
