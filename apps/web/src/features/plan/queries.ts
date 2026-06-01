import { useQuery } from '@tanstack/react-query';
import type { GetPlansResponse, PlanHistoryResponse } from '@hivekitchen/types';
import { hkFetch } from '@/lib/fetch.js';
import { QueryKeys } from '@/lib/realtime/query-keys.js';

// Story 3.14 — Following-week draft view (FR21).
// Returns the cleared plan + items for the requested week. Pre-clearance/
// pre-generation drafts surface as { plan: null, is_draft: true }; the page
// renders the "Lumi is drafting next week" loading state in that case.
//
// staleTime 30s keeps the tab snappy when the user toggles back and forth
// without dogpiling the API. SSE-driven invalidation lands in Story 5.2.
export function usePlanQuery(week: 'current' | 'next', options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: QueryKeys.planByWeek(week),
    queryFn: ({ signal }) =>
      hkFetch<GetPlansResponse>(`/v1/plans?week=${week}`, {
        method: 'GET',
        signal,
      }),
    staleTime: 30_000,
    enabled: options?.enabled ?? true,
  });
}

// Story 3.15 — historical plan + outcomes view (FR25).
// Past plans are immutable, so the cache stays warm for 5 minutes — no SSE
// subscription needed (history pages don't react to plan.updated events).
const HISTORY_DISABLED_KEY = '__disabled__';

export function usePlanHistoryQuery(weekId: string | undefined) {
  const enabled = weekId !== undefined && weekId !== '';
  return useQuery({
    queryKey: QueryKeys.planHistory(enabled ? weekId : HISTORY_DISABLED_KEY),
    queryFn: ({ signal }) =>
      hkFetch<PlanHistoryResponse>(
        `/v1/plans/${encodeURIComponent(weekId!)}/history`,
        {
          method: 'GET',
          signal,
        },
      ),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}
