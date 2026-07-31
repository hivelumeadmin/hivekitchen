import { useQuery } from '@tanstack/react-query';
import type {
  KitchenMap,
  UserProfile,
  VoiceRetentionMode,
  VoiceTranscriptItem,
} from '@hivekitchen/types';
import { hkFetch } from '@/lib/fetch.js';
import { QueryKeys } from '@/lib/realtime/query-keys.js';
import { useComplianceStore } from '@/stores/compliance.store.js';
import { useLumiStore } from '@/stores/lumi.store.js';

export interface VoiceTranscriptsResponse {
  transcripts: VoiceTranscriptItem[];
  voice_retention_mode: VoiceRetentionMode;
}

/**
 * The profile fetch is the only place the canonical values behind three global
 * stores arrive, so hydration lives in the queryFn rather than a render effect:
 * it fires exactly when server truth lands (matching the previous
 * `didLoad`-guarded fetch) instead of on every cache read.
 */
function hydrateStores(profile: UserProfile): void {
  // Story 12-S12 / 5-S13 — the Lumi panel toggle and the voice hook read these
  // from the lumi store, not from this page.
  useLumiStore.getState().setProactiveNudges(profile.notification_prefs.proactive_lumi_nudges);
  useLumiStore.getState().setCaptionOnlyMode(profile.caption_only_mode);
  useComplianceStore
    .getState()
    .setAcknowledgmentState(
      profile.parental_notice_acknowledged_at,
      profile.parental_notice_acknowledged_version,
    );
}

// Reproduces the previous `didLoad`-guarded semantics exactly: fetch once per
// mount, then never again on its own. `refetchOnMount: 'always'` gives the
// per-mount fetch; `staleTime: Infinity` stops window-focus refetches from
// clobbering an optimistic toggle with a stale server snapshot. The user-id key
// keeps a re-login from reading the prior account's profile.
export function useMeQuery(userId: string | null) {
  return useQuery({
    queryKey: userId !== null ? QueryKeys.me(userId) : ['me', null],
    queryFn: async ({ signal }) => {
      const profile = await hkFetch<UserProfile>('/v1/users/me', { method: 'GET', signal });
      hydrateStores(profile);
      return profile;
    },
    staleTime: Infinity,
    refetchOnMount: 'always',
    enabled: userId !== null,
  });
}

// Slice 5-S15 — fail-open by design: on failure `data` stays undefined and the
// Voice Data panel falls back to the profile's mode with an empty list, which
// is what the previous swallowed-catch did. No retry, no surfaced error.
export function useVoiceTranscriptsQuery(userId: string | null) {
  return useQuery({
    queryKey: userId !== null ? QueryKeys.voiceTranscripts(userId) : ['voice-transcripts', null],
    queryFn: ({ signal }) =>
      hkFetch<VoiceTranscriptsResponse>('/v1/users/me/voice-transcripts', {
        method: 'GET',
        signal,
      }),
    staleTime: Infinity,
    refetchOnMount: 'always',
    retry: false,
    enabled: userId !== null,
  });
}

// Slice 7-S11 — the delete dialog needs the household label (the profile
// carries the caregiver's name). Fetched lazily: `enabled` flips when the
// dialog opens.
export function useHouseholdNameQuery(householdId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: householdId !== null ? QueryKeys.kitchenMap(householdId) : ['kitchen-map', null],
    queryFn: ({ signal }) =>
      hkFetch<KitchenMap>(`/v1/households/${householdId ?? ''}/kitchen-map`, {
        method: 'GET',
        signal,
      }),
    select: (map: KitchenMap) => map.household.display_name ?? null,
    retry: false,
    enabled: householdId !== null && enabled,
  });
}
