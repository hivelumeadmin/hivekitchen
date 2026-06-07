import { z } from 'zod';

// Slice 5-S3 — PackerOfTheDay. A day_assignments row, with the packer's
// display_name resolved from the users table at read time. packer_user_id and
// packer_display_name are both nullable: an unassigned ("Nobody") day clears
// the user but keeps the row.
export const DayAssignmentSchema = z.object({
  date: z.string().date(),
  packer_user_id: z.string().uuid().nullable(),
  packer_display_name: z.string().nullable(),
});

export const DayAssignmentsResponseSchema = z.object({
  assignments: z.array(DayAssignmentSchema),
});

export const AssignPackerRequestSchema = z.object({
  packer_user_id: z.string().uuid().nullable(),
});

export const AssignPackerResponseSchema = DayAssignmentSchema;

export type DayAssignment = z.infer<typeof DayAssignmentSchema>;
export type DayAssignmentsResponse = z.infer<typeof DayAssignmentsResponseSchema>;
export type AssignPackerRequest = z.infer<typeof AssignPackerRequestSchema>;
export type AssignPackerResponse = z.infer<typeof AssignPackerResponseSchema>;
