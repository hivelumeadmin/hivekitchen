import { useQuery } from '@tanstack/react-query';
import { FamilyLanguageTermsResponseSchema } from '@hivekitchen/contracts';
import type { FamilyLanguageTerm } from '@hivekitchen/types';
import { hkFetch } from '@/lib/fetch.js';
import { QueryKeys } from '@/lib/realtime/query-keys.js';

// Slice 5-S10 (review patch) — read the household's family-language terms so the
// Lumi panel can suppress a persisted family_language_prompt card whose term has
// already been resolved (state !== 'candidate') on re-hydration / a second tab.
// `enabled` is gated by the caller so we only fetch when a prompt card is present.
export function useFamilyLanguageTerms(
  householdId: string,
  enabled: boolean,
): FamilyLanguageTerm[] {
  const { data } = useQuery({
    queryKey: QueryKeys.familyLanguage(householdId),
    queryFn: async () => {
      const raw = await hkFetch<unknown>(
        `/v1/households/${householdId}/family-language`,
        { method: 'GET' },
      );
      return FamilyLanguageTermsResponseSchema.parse(raw);
    },
    enabled: enabled && Boolean(householdId),
    staleTime: 30_000,
  });

  return data?.terms ?? [];
}
