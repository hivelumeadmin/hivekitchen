import { z } from 'zod';

// Story 7-S11 — POST /v1/households/:householdId/delete. COPPA right-to-delete
// (FR69, NFR-PRIV-2). The route soft-deletes the household (sets
// deletion_requested_at), bans the caller, and revokes all sessions; the
// nightly account-deletion job hard-deletes at day 30. The 200 body confirms
// the schedule and surfaces the projected hard-delete date.
export const DeleteHouseholdRequestSchema = z.object({
  confirmation_name: z.string().min(1),
});
export type DeleteHouseholdRequest = z.infer<typeof DeleteHouseholdRequestSchema>;

export const DeleteHouseholdResponseSchema = z.object({
  status: z.enum(['scheduled', 'already_scheduled']),
  scheduled_hard_delete_at: z.string().datetime(),
  message: z.string(),
});
export type DeleteHouseholdResponse = z.infer<typeof DeleteHouseholdResponseSchema>;
