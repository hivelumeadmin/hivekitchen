import { z } from 'zod';

// Slice 5-S10 — household-scoped family-language ratchet (UX-DR47). A term is a
// non-English kinship word the parent used in conversation; maps_to is its English
// equivalent. State is forward-only at the service layer once 'active'.
export const FamilyLanguageStateSchema = z.enum(['candidate', 'active', 'forgotten']);

export const FamilyLanguageTermSchema = z.object({
  term: z.string().min(1).max(40),
  maps_to: z.string().min(1).max(40),
  usage_count: z.number().int().min(0),
  state: FamilyLanguageStateSchema,
  first_seen_at: z.string(),
  ratified_at: z.string().nullable(),
});

export const FamilyLanguageRatifyActionSchema = z.enum([
  'opt_in',
  'forget',
  'tell_lumi_more',
]);

export const FamilyLanguageRatifyBodySchema = z.object({
  term: z.string().min(1).max(40),
  action: FamilyLanguageRatifyActionSchema,
});

export const FamilyLanguageRatifyResponseSchema = z.object({
  term: FamilyLanguageTermSchema,
  lumi_response: z.string().optional(),
});

// Slice 5-S10 (review patch) — GET /v1/households/:id/family-language. The web
// reads the household's terms so a persisted family_language_prompt turn whose
// term has already been resolved (state !== 'candidate') is suppressed on
// re-hydration instead of replaying the card.
export const FamilyLanguageTermsResponseSchema = z.object({
  terms: z.array(FamilyLanguageTermSchema),
});
