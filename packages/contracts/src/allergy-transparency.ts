import { z } from 'zod';

// Slice 4-S17 — Allergy Transparency Log Export (FR80). Surfaces the
// allergy.* rows already accumulating in audit_log (Stories 1.8 + 3.1) to the
// authenticated parent as a human-readable, downloadable timeline. The label /
// detail fields are produced by a deterministic server-side mapping — no LLM.

export const AllergyTransparencyExportBodySchema = z.object({
  format: z.enum(['json', 'pdf']),
});

export const AllergyEventEntrySchema = z.object({
  id: z.string().uuid(),
  timestamp: z.string().datetime(),
  event_type: z.enum([
    'allergy.guardrail_rejection',
    'allergy.uncertainty',
    'allergy.check_overridden',
  ]),
  label: z.string(),
  detail: z.string().nullable(),
});

export const AllergyTransparencyLogSchema = z.object({
  household_id: z.string().uuid(),
  exported_at: z.string().datetime(),
  event_count: z.number().int().nonnegative(),
  events: z.array(AllergyEventEntrySchema),
});

export type AllergyTransparencyExportBody = z.infer<typeof AllergyTransparencyExportBodySchema>;
export type AllergyEventEntry = z.infer<typeof AllergyEventEntrySchema>;
export type AllergyTransparencyLog = z.infer<typeof AllergyTransparencyLogSchema>;
