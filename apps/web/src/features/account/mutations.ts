import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  CulturalLanguagePreference,
  NotificationPrefs,
  UpdateProfileRequest,
  UserProfile,
  VoiceRetentionMode,
} from '@hivekitchen/types';
import { hkFetch, hkFetchBlob } from '@/lib/fetch.js';
import { QueryKeys } from '@/lib/realtime/query-keys.js';
import { useAuthStore } from '@/stores/auth.store.js';
import { useLumiStore } from '@/stores/lumi.store.js';
import type { VoiceTranscriptsResponse } from './queries.js';

// None of these carry an Idempotency-Key: the account endpoints are plain
// idempotent PATCHes and the header is not part of their wire contract.

type MeKey = readonly unknown[];
type ProfileSnapshot = { key: MeKey; previous: UserProfile | undefined };

function useMeKey(): MeKey {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  return userId !== null ? QueryKeys.me(userId) : ['me', null];
}

// PATCH /v1/users/me — display name / preferred language / email.
export function useUpdateProfileMutation() {
  const queryClient = useQueryClient();
  const key = useMeKey();
  return useMutation<UserProfile, Error, UpdateProfileRequest>({
    mutationFn: (body) => hkFetch<UserProfile>('/v1/users/me', { method: 'PATCH', body }),
    onSuccess: (updated) => {
      queryClient.setQueryData(key, updated);
      useAuthStore.getState().updateUser({
        display_name: updated.display_name,
        email: updated.email,
      });
    },
  });
}

// POST /v1/auth/password-reset.
export function usePasswordResetMutation() {
  return useMutation<void, Error, { email: string }>({
    mutationFn: (body) => hkFetch<void>('/v1/auth/password-reset', { method: 'POST', body }),
  });
}

// PATCH /v1/users/me/notifications — optimistic single-field toggle.
export function useNotificationPrefsMutation() {
  const queryClient = useQueryClient();
  const key = useMeKey();
  return useMutation<
    UserProfile,
    Error,
    { field: keyof NotificationPrefs; checked: boolean },
    ProfileSnapshot
  >({
    mutationFn: ({ field, checked }) =>
      hkFetch<UserProfile>('/v1/users/me/notifications', {
        method: 'PATCH',
        body: { [field]: checked },
      }),
    onMutate: async ({ field, checked }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<UserProfile>(key);
      if (previous !== undefined) {
        queryClient.setQueryData<UserProfile>(key, {
          ...previous,
          notification_prefs: { ...previous.notification_prefs, [field]: checked },
        });
      }
      return { key, previous };
    },
    onError: (_err, _vars, context) => {
      if (context !== undefined) queryClient.setQueryData(context.key, context.previous);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(key, updated);
      useLumiStore.getState().setProactiveNudges(updated.notification_prefs.proactive_lumi_nudges);
    },
  });
}

// PATCH /v1/users/me/preferences — the one-way family-language ratchet (409 on
// an attempt to return to `default`).
export function useCulturalLanguageMutation() {
  const queryClient = useQueryClient();
  const key = useMeKey();
  return useMutation<UserProfile, Error, CulturalLanguagePreference, ProfileSnapshot>({
    mutationFn: (cultural_language) =>
      hkFetch<UserProfile>('/v1/users/me/preferences', {
        method: 'PATCH',
        body: { cultural_language },
      }),
    onMutate: async (cultural_language) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<UserProfile>(key);
      if (previous !== undefined) {
        queryClient.setQueryData<UserProfile>(key, { ...previous, cultural_language });
      }
      return { key, previous };
    },
    onError: (_err, _vars, context) => {
      if (context !== undefined) queryClient.setQueryData(context.key, context.previous);
    },
    onSuccess: (updated) => queryClient.setQueryData(key, updated),
  });
}

// PATCH /v1/users/me/accessibility — Slice 5-S13. The lumi store is dual-written
// alongside the cache because the voice hook reads the flag from there.
export function useAccessibilityMutation() {
  const queryClient = useQueryClient();
  const key = useMeKey();
  return useMutation<UserProfile, Error, boolean, ProfileSnapshot>({
    mutationFn: (caption_only_mode) =>
      hkFetch<UserProfile>('/v1/users/me/accessibility', {
        method: 'PATCH',
        body: { caption_only_mode },
      }),
    onMutate: async (caption_only_mode) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<UserProfile>(key);
      if (previous !== undefined) {
        queryClient.setQueryData<UserProfile>(key, { ...previous, caption_only_mode });
      }
      useLumiStore.getState().setCaptionOnlyMode(caption_only_mode);
      return { key, previous };
    },
    onError: (_err, _vars, context) => {
      if (context !== undefined) {
        queryClient.setQueryData(context.key, context.previous);
        if (context.previous !== undefined) {
          useLumiStore.getState().setCaptionOnlyMode(context.previous.caption_only_mode);
        }
      }
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(key, updated);
      useLumiStore.getState().setCaptionOnlyMode(updated.caption_only_mode);
    },
  });
}

// PATCH /v1/users/me/voice-retention — Slice 5-S15. Optimistically flips the
// mode and, on immediate-delete, empties the transcript list; both revert
// together on failure (AC10).
export function useVoiceRetentionMutation() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const key: MeKey =
    userId !== null ? QueryKeys.voiceTranscripts(userId) : ['voice-transcripts', null];
  return useMutation<
    void,
    Error,
    VoiceRetentionMode,
    { key: MeKey; previous: VoiceTranscriptsResponse | undefined }
  >({
    mutationFn: (voice_retention_mode) =>
      hkFetch('/v1/users/me/voice-retention', {
        method: 'PATCH',
        body: { voice_retention_mode },
      }),
    onMutate: async (voice_retention_mode) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<VoiceTranscriptsResponse>(key);
      queryClient.setQueryData<VoiceTranscriptsResponse>(key, {
        voice_retention_mode,
        transcripts:
          voice_retention_mode === 'immediate_delete' ? [] : (previous?.transcripts ?? []),
      });
      return { key, previous };
    },
    onError: (_err, _vars, context) => {
      if (context !== undefined) queryClient.setQueryData(context.key, context.previous);
    },
  });
}

// POST /v1/heart-notes/transparency-log — Slice 4-S17. Returns a binary body,
// so it uses hkFetchBlob. The synthetic-anchor click is the only reliable
// cross-browser way to save a same-origin response instead of navigating to it.
export function useAllergyLogDownloadMutation() {
  return useMutation<void, Error, 'json' | 'pdf'>({
    mutationFn: async (format) => {
      const blob = await hkFetchBlob('/v1/heart-notes/transparency-log', {
        method: 'POST',
        body: { format },
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `allergy-log-${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
  });
}

// POST /v1/households/:id/export — Slice 7-S10. 202: the snapshot is composed
// asynchronously and emailed as a signed link. No polling, no redirect.
export function useExportMutation(householdId: string | null) {
  return useMutation<unknown, Error, void>({
    mutationFn: () =>
      hkFetch<unknown>(`/v1/households/${householdId ?? ''}/export`, { method: 'POST' }),
  });
}

// POST /v1/households/:id/delete — Slice 7-S11.
export function useDeleteAccountMutation(householdId: string | null) {
  return useMutation<unknown, Error, { confirmation_name: string }>({
    mutationFn: (body) =>
      hkFetch<unknown>(`/v1/households/${householdId ?? ''}/delete`, { method: 'POST', body }),
  });
}
