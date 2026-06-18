import { z } from 'zod';

// Story 3-S35 — weekly auto-compose enrollment. The toggle is on/off only; the
// schedule (Friday evening) is fixed. has_plan lets the web surface the toggle
// only after the household has composed its first plan (AC6).
export const AutoComposeStateSchema = z.object({
  auto_compose_enabled: z.boolean(),
  has_plan: z.boolean(),
});

export const UpdateAutoComposeRequestSchema = z.object({
  auto_compose_enabled: z.boolean(),
});

export type AutoComposeState = z.infer<typeof AutoComposeStateSchema>;
export type UpdateAutoComposeRequest = z.infer<typeof UpdateAutoComposeRequestSchema>;
