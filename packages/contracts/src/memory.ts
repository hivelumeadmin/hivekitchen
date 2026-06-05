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
  completed_at: z.string().datetime({ offset: true }),
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
  soft_forget_at: z.string().datetime({ offset: true }).nullable(),
  forget_reason: z.string().nullable(),
  hard_forgotten: z.boolean(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

// Story 7-S1/7-S4 — read response for the Visible Memory page. Returns all
// non-hard-forgotten nodes (active AND soft-forgotten). Soft-forgotten nodes
// render as tombstones on the client; the route filters hard_forgotten=false only.
export const GetMemoryResponseSchema = z.object({
  nodes: z.array(MemoryNodeSchema),
});
export type GetMemoryResponse = z.infer<typeof GetMemoryResponseSchema>;

export const MemoryProvenanceSchema = z.object({
  id: z.string().uuid(),
  memory_node_id: z.string().uuid(),
  source_type: SourceTypeSchema,
  source_ref: z.record(z.string(), z.unknown()),
  captured_at: z.string().datetime({ offset: true }),
  captured_by: z.string().uuid().nullable(),
  confidence: z.number().min(0).max(1),
  superseded_by: z.string().uuid().nullable(),
});

// Story 7-S2 — provenance read response for a single memory node.
export const GetProvenanceResponseSchema = z.object({
  provenance: z.array(MemoryProvenanceSchema),
});
export type GetProvenanceResponse = z.infer<typeof GetProvenanceResponseSchema>;

// Story 7-S3 — edit a memory sentence. `reason` is a literal today; widen
// the union when additional edit reasons appear.
export const EditMemoryRequestSchema = z.object({
  prose_text: z.string().min(1).max(2000),
  reason: z.literal('parent_edit'),
});
export type EditMemoryRequest = z.infer<typeof EditMemoryRequestSchema>;

export const EditMemoryResponseSchema = z.object({
  node: MemoryNodeSchema,
});
export type EditMemoryResponse = z.infer<typeof EditMemoryResponseSchema>;

// Story 7-S4 — soft-forget a memory sentence. Body carries an optional
// reason; nodeId comes from the URL parameter. Mode is always 'soft' here —
// hard promotion is handled by the nightly job (7-S5).
export const ForgetMemoryRequestSchema = z.object({
  reason: z.string().max(500).optional(),
});
export type ForgetMemoryRequest = z.infer<typeof ForgetMemoryRequestSchema>;

export const ForgetMemoryResponseSchema = z.object({
  node: MemoryNodeSchema,
});
export type ForgetMemoryResponse = z.infer<typeof ForgetMemoryResponseSchema>;

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
  created_at: z.string().datetime({ offset: true }),
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
