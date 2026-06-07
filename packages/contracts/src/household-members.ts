import { z } from 'zod';

// ---- GET /v1/households/:id/members ---------------------------------------
// Slice 5-S2 — household member roster (name + role). guest_author members are
// filtered out server-side; only co-caregivers appear here.
export const HouseholdMemberSchema = z.object({
  user_id: z.string().uuid(),
  display_name: z.string().nullable(),
  role: z.enum(['primary_parent', 'secondary_caregiver']),
});

export const HouseholdMembersResponseSchema = z.object({
  household_display_name: z.string().nullable(),
  members: z.array(HouseholdMemberSchema),
});
