import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PresenceResponseSchema } from '@hivekitchen/contracts';
import type { PresencePartner, SurfaceKind } from '@hivekitchen/types';
import { hkFetch } from '@/lib/fetch.js';
import { useAuthStore } from '@/stores/auth.store.js';
import { QueryKeys } from '@/lib/realtime/query-keys.js';

// Story 5-S1 — multi-tab presence. Sends a heartbeat to keep this user's Redis
// presence key alive (30s cadence, well under the 60s TTL), clears it on
// unmount, and reads the household's active partners. SSE `presence.partner-active`
// events invalidate the query (see lib/realtime/sse.ts), so partner changes
// refresh without polling.
export function usePresence(surface: SurfaceKind): { partners: PresencePartner[] } {
  const user = useAuthStore((s) => s.user);
  const householdId = user?.current_household_id ?? '';

  const { data } = useQuery({
    queryKey: QueryKeys.presence(householdId),
    queryFn: async () => {
      const raw = await hkFetch<unknown>('/v1/presence', { method: 'GET' });
      return PresenceResponseSchema.parse(raw);
    },
    enabled: Boolean(householdId),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!householdId) return;

    const sendHeartbeat = () =>
      hkFetch<unknown>('/v1/presence/heartbeat', {
        method: 'POST',
        body: { surface },
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      }).catch(() => {}); // best-effort; SSE invalidation handles UI refresh

    void sendHeartbeat(); // immediate on mount
    const interval = setInterval(() => void sendHeartbeat(), 30_000);

    return () => {
      clearInterval(interval);
      // Best-effort clear on unmount (navigate away from Brief).
      void hkFetch<unknown>('/v1/presence', {
        method: 'DELETE',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      }).catch(() => {});
    };
  }, [householdId, surface]);

  return { partners: data?.partners ?? [] };
}
