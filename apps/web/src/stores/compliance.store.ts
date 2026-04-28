import { create } from 'zustand';

// Tracks the parental-notice acknowledgment state for the current user.
// The API is the source of truth (GET /v1/users/me); this store caches the
// state for the lifetime of the SPA session so the gating hook can render
// without an extra round-trip after login.
//
// `state === 'unknown'` means we have not yet fetched. The gating hook hydrates
// it lazily; the dialog flips it to 'acknowledged' on success.

export type ParentalNoticeGateState = 'unknown' | 'acknowledged' | 'required';

interface ComplianceState {
  parentalNoticeState: ParentalNoticeGateState;
  parentalNoticeAcknowledgedAt: string | null;
  parentalNoticeAcknowledgedVersion: string | null;
  setAcknowledgmentState: (
    acknowledgedAt: string | null,
    acknowledgedVersion: string | null,
  ) => void;
  reset: () => void;
}

export const useComplianceStore = create<ComplianceState>()((set) => ({
  parentalNoticeState: 'unknown',
  parentalNoticeAcknowledgedAt: null,
  parentalNoticeAcknowledgedVersion: null,
  setAcknowledgmentState: (acknowledgedAt, acknowledgedVersion) =>
    set({
      parentalNoticeState: acknowledgedAt === null ? 'required' : 'acknowledged',
      parentalNoticeAcknowledgedAt: acknowledgedAt,
      parentalNoticeAcknowledgedVersion: acknowledgedVersion,
    }),
  reset: () =>
    set({
      parentalNoticeState: 'unknown',
      parentalNoticeAcknowledgedAt: null,
      parentalNoticeAcknowledgedVersion: null,
    }),
}));
