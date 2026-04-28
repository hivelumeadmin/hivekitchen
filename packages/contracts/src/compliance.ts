import { z } from 'zod';

// ---- Story 2.8: COPPA soft-VPC signed declaration -------------------------

export const KNOWN_CONSENT_VERSIONS = ['v1'] as const;

export const ConsentDeclarationResponseSchema = z.object({
  document_version: z.string(),
  content: z.string(),
});

export const VpcConsentRequestSchema = z.object({
  document_version: z.enum(KNOWN_CONSENT_VERSIONS),
});

export const VpcConsentResponseSchema = z.object({
  household_id: z.string().uuid(),
  signed_at: z.string().datetime(),
  mechanism: z.literal('soft_signed_declaration'),
  document_version: z.string(),
});

export type ConsentDeclarationResponse = z.infer<typeof ConsentDeclarationResponseSchema>;
export type VpcConsentRequest = z.infer<typeof VpcConsentRequestSchema>;
export type VpcConsentResponse = z.infer<typeof VpcConsentResponseSchema>;

// ---- Story 2.9: AADC parental notice (informational) ----------------------

export const KNOWN_PARENTAL_NOTICE_VERSIONS = ['v1'] as const;

export const PARENTAL_NOTICE_PROCESSOR_NAMES = [
  'supabase',
  'elevenlabs',
  'sendgrid',
  'twilio',
  'stripe',
  'openai',
] as const;

export const ProcessorEntrySchema = z.object({
  name: z.enum(PARENTAL_NOTICE_PROCESSOR_NAMES),
  display_name: z.string().min(1),
  purpose: z.string().min(1),
  data_categories: z.array(z.string().min(1)).min(1),
  retention_label: z.string().min(1),
});

export const RetentionEntrySchema = z.object({
  category: z.string().min(1),
  horizon_days: z.number().int().nonnegative().nullable(),
  label: z.string().min(1),
});

export const ParentalNoticeResponseSchema = z.object({
  document_version: z.string().min(1),
  content: z.string().min(1),
  processors: z
    .array(ProcessorEntrySchema)
    .length(6)
    .refine(
      (arr) => new Set(arr.map((p) => p.name)).size === arr.length,
      { message: 'Processor names must be unique' },
    ),
  data_categories: z.array(z.string().min(1)).min(1),
  retention: z.array(RetentionEntrySchema).min(1),
});

export const AcknowledgeParentalNoticeRequestSchema = z.object({
  document_version: z.enum(KNOWN_PARENTAL_NOTICE_VERSIONS),
});

export const AcknowledgeParentalNoticeResponseSchema = z.object({
  acknowledged_at: z.string().datetime(),
  document_version: z.string().min(1),
});

export type ProcessorEntry = z.infer<typeof ProcessorEntrySchema>;
export type RetentionEntry = z.infer<typeof RetentionEntrySchema>;
export type ParentalNoticeResponse = z.infer<typeof ParentalNoticeResponseSchema>;
export type AcknowledgeParentalNoticeRequest = z.infer<
  typeof AcknowledgeParentalNoticeRequestSchema
>;
export type AcknowledgeParentalNoticeResponse = z.infer<
  typeof AcknowledgeParentalNoticeResponseSchema
>;
