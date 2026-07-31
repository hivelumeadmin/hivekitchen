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

// None of these send an Idempotency-Key: the PATCH endpoints are idempotent by
// shape, and the four POSTs (password-reset, transparency-log, export, delete)
// have never carried the header — it is not part of their wire contract. The
// export and delete POSTs are the ones where a duplicate submit would matter;
// both are guarded in the UI instead (a pending mutation disables the trigger,
// and delete additionally requires a typed confirmation).
//
// OPTIMISTIC TOGGLES: `onMutate` writes the cache without awaiting
// cancelQueries, so the write itself is synchronous with the click. Getting
// that write onto the SCREEN synchronously additionally requires the
// notifyManager scheduler override in providers/query-provider.tsx — see the
// comment there.
//
// The four profile mutations share a mutation `scope`, which makes React Query
// run them one at a time. Without it they interleave, and because each one
// snapshots and restores the WHOLE profile, a slow failing toggle would roll
// back a fast successful one — including un-setting the one-way family-language
// ratchet.
const ACCOUNT_PROFILE_SCOPE = { id: 'account-profile' } as const;

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
    scope: ACCOUNT_PROFILE_SCOPE,
    mutationFn: (body) => hkFetch<UserProfile>('/v1/users/me', { method: 'PATCH', body }),
    onSuccess: (updated) => {
      // Merge, don't replace: this response carries the server's pre-toggle
      // notification_prefs / caption_only_mode / cultural_language, and writing
      // it wholesale would revert a toggle that is still settling.
      queryClient.setQueryData<UserProfile>(key, (current) =>
        current === undefined
          ? updated
          : {
              ...updated,
              notification_prefs: current.notification_prefs,
              caption_only_mode: current.caption_only_mode,
              cultural_language: current.cultural_language,
            },
      );
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
    scope: ACCOUNT_PROFILE_SCOPE,
    mutationFn: ({ field, checked }) =>
      hkFetch<UserProfile>('/v1/users/me/notifications', {
        method: 'PATCH',
        body: { [field]: checked },
      }),
    onMutate: ({ field, checked }) => {
      void queryClient.cancelQueries({ queryKey: key });
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
    scope: ACCOUNT_PROFILE_SCOPE,
    mutationFn: (cultural_language) =>
      hkFetch<UserProfile>('/v1/users/me/preferences', {
        method: 'PATCH',
        body: { cultural_language },
      }),
    onMutate: (cultural_language) => {
      void queryClient.cancelQueries({ queryKey: key });
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
  return useMutation<
    UserProfile,
    Error,
    boolean,
    ProfileSnapshot & { previousStoreValue: boolean }
  >({
    scope: ACCOUNT_PROFILE_SCOPE,
    mutationFn: (caption_only_mode) =>
      hkFetch<UserProfile>('/v1/users/me/accessibility', {
        method: 'PATCH',
        body: { caption_only_mode },
      }),
    onMutate: (caption_only_mode) => {
      void queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<UserProfile>(key);
      // Captured from the store, not from `previous` — the store is written
      // unconditionally below, so the revert must be unconditional too or a
      // failed PATCH with no cached profile leaves TTS suppressed while the UI
      // says audio is on.
      const previousStoreValue = useLumiStore.getState().captionOnlyMode;
      if (previous !== undefined) {
        queryClient.setQueryData<UserProfile>(key, { ...previous, caption_only_mode });
      }
      useLumiStore.getState().setCaptionOnlyMode(caption_only_mode);
      return { key, previous, previousStoreValue };
    },
    onError: (_err, _vars, context) => {
      if (context !== undefined) {
        queryClient.setQueryData(context.key, context.previous);
        useLumiStore.getState().setCaptionOnlyMode(context.previousStoreValue);
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
    onMutate: (voice_retention_mode) => {
      void queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<VoiceTranscriptsResponse>(key);
      queryClient.setQueryData<VoiceTranscriptsResponse>(key, {
        voice_retention_mode,
        transcripts:
          voice_retention_mode === 'immediate_delete' ? [] : (previous?.transcripts ?? []),
      });
      return { key, previous };
    },
    onError: (_err, _vars, context) => {
      if (context === undefined) return;
      // setQueryData bails on undefined, so restoring "no data" has to remove
      // the entry — otherwise a failed PATCH leaves this privacy control
      // showing immediate_delete while the server is still standard.
      if (context.previous === undefined) {
        queryClient.removeQueries({ queryKey: context.key });
      } else {
        queryClient.setQueryData(context.key, context.previous);
      }
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
//
// Callbacks are accepted here rather than at the mutate() call site: React
// Query drops mutate-scoped callbacks once the observer has no listeners, so a
// panel that unmounts mid-flight would silently skip its 401 redirect.
export function useExportMutation(
  householdId: string | null,
  callbacks?: { onError?: (err: Error) => void },
) {
  return useMutation<unknown, Error, void>({
    mutationFn: () =>
      hkFetch<unknown>(`/v1/households/${householdId ?? ''}/export`, { method: 'POST' }),
    onError: callbacks?.onError,
  });
}

// POST /v1/households/:id/delete — Slice 7-S11. Same rule as the export above,
// and it matters far more here: the success path logs the user out, and losing
// it would leave a live session against a deleted household.
export function useDeleteAccountMutation(
  householdId: string | null,
  callbacks?: { onSuccess?: () => Promise<void> | void; onError?: (err: Error) => void },
) {
  return useMutation<unknown, Error, { confirmation_name: string }>({
    mutationFn: (body) =>
      hkFetch<unknown>(`/v1/households/${householdId ?? ''}/delete`, { method: 'POST', body }),
    onSuccess: callbacks?.onSuccess,
    onError: callbacks?.onError,
  });
}
