import { z } from 'zod';

export const HouseholdGeolocationConsentSchema = z.object({
  geolocation_enabled: z.boolean(),
  geolocation_consented_at: z.string().datetime().nullable(),
  geolocation_purpose: z.enum(['cultural_supplier_routing']).nullable(),
});

// Requires geolocation_purpose when enabling.
export const UpdateGeolocationConsentRequestSchema = z
  .object({
    geolocation_enabled: z.boolean(),
    geolocation_purpose: z.enum(['cultural_supplier_routing']).optional(),
  })
  .refine((d) => !(d.geolocation_enabled && !d.geolocation_purpose), {
    message: 'geolocation_purpose is required when geolocation_enabled is true',
  });

export type HouseholdGeolocationConsent = z.infer<typeof HouseholdGeolocationConsentSchema>;
export type UpdateGeolocationConsentRequest = z.infer<typeof UpdateGeolocationConsentRequestSchema>;
