import { z } from 'zod';

// Slice 4-S15 — Child Request-a-Lunch + Parent Approval (FR42, Boundary 1).

// Child-submitted request body (public Lunch Link endpoint).
export const ChildRequestCreateSchema = z.object({
  request_text: z.string().trim().min(1).max(200),
});

// One pending/resolved request as surfaced to the parent. `child_name` is joined
// from children.name at query time — it is not a stored column on the request.
export const ChildRequestSchema = z.object({
  id: z.string().uuid(),
  child_id: z.string().uuid(),
  child_name: z.string(),
  request_text: z.string(),
  status: z.enum(['pending', 'approved', 'declined']),
  created_at: z.string(), // ISO 8601
});

export const PendingChildRequestsResponseSchema = z.object({
  requests: z.array(ChildRequestSchema),
});

export type ChildRequestCreate = z.infer<typeof ChildRequestCreateSchema>;
export type ChildRequest = z.infer<typeof ChildRequestSchema>;
export type PendingChildRequestsResponse = z.infer<typeof PendingChildRequestsResponseSchema>;
