import { useQuery } from '@tanstack/react-query';
import type { BriefResponse } from '@hivekitchen/types';
import { hkFetch } from '@/lib/fetch.js';
import { QueryKeys } from '@/lib/realtime/query-keys.js';

// staleTime 5min gives the staleWhileRevalidate pattern (AC #2): cached data
// renders instantly; background refetch fires when stale. SSE-driven
// invalidation lands in Story 5.2; refetchOnWindowFocus (default true) is
// sufficient at MVP scale until then.
const BRIEF_STALE_TIME_MS = 5 * 60_000;

export function useBriefStateQuery(householdId: string | null) {
  return useQuery({
    queryKey: householdId !== null ? QueryKeys.brief(householdId) : ['brief', null],
    queryFn: ({ signal }) => {
      if (householdId === null) throw new Error('householdId is required');
      return hkFetch<BriefResponse>(`/v1/households/${householdId}/brief`, {
        method: 'GET',
        signal,
      });
    },
    staleTime: BRIEF_STALE_TIME_MS,
    enabled: householdId !== null,
  });
}
