import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createElement } from 'react';
import { UserProfileSchema } from '@hivekitchen/contracts';
import type { UserProfile } from '@hivekitchen/types';
import { hkFetch } from '@/lib/fetch.js';
import { useAuthStore } from '@/stores/auth.store.js';
import {
  useComplianceStore,
  type ParentalNoticeGateState,
} from '@/stores/compliance.store.js';
import { ParentalNoticeDialog } from '@/features/compliance/ParentalNoticeDialog.js';

interface Gate {
  state: ParentalNoticeGateState;
  requireAcknowledgment: (intent: () => void) => void;
  dialog: ReactNode;
}

// Lazy-hydrate the parental-notice gate state from GET /v1/users/me on first
// mount. After that, the dialog itself updates the store on success.
//
// Usage: call requireAcknowledgment(intent). If the user has acknowledged,
// the intent fires immediately. Otherwise the dialog opens; on success, the
// stored intent fires automatically.
export function useRequireParentalNoticeAcknowledgment(): Gate {
  const accessToken = useAuthStore((s) => s.accessToken);
  const state = useComplianceStore((s) => s.parentalNoticeState);
  const setAcknowledgmentState = useComplianceStore((s) => s.setAcknowledgmentState);
  const [dialogOpen, setDialogOpen] = useState(false);
  const pendingIntent = useRef<(() => void) | null>(null);

  // Hydrate from /v1/users/me when we have a token but state is still unknown.
  useEffect(() => {
    if (accessToken === null) return;
    if (state !== 'unknown') return;
    const controller = new AbortController();

    async function hydrate() {
      try {
        const raw = await hkFetch<unknown>('/v1/users/me', {
          method: 'GET',
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        const profile: UserProfile = UserProfileSchema.parse(raw);
        setAcknowledgmentState(
          profile.parental_notice_acknowledged_at,
          profile.parental_notice_acknowledged_version,
        );
      } catch {
        // Hydration failure leaves state === 'unknown'; the gate stays
        // closed-and-blocking (requireAcknowledgment treats unknown as
        // required-with-retry-on-fetch). Avoid crashing the page tree.
      }
    }
    void hydrate();
    return () => controller.abort();
  }, [accessToken, state, setAcknowledgmentState]);

  const requireAcknowledgment = useCallback(
    (intent: () => void) => {
      if (state === 'acknowledged') {
        intent();
        return;
      }
      pendingIntent.current = intent;
      setDialogOpen(true);
    },
    [state],
  );

  const handleAcknowledged = useCallback(
    (acknowledgedAt: string, acknowledgedVersion: string) => {
      setAcknowledgmentState(acknowledgedAt, acknowledgedVersion);
      setDialogOpen(false);
      const intent = pendingIntent.current;
      pendingIntent.current = null;
      if (intent !== null) intent();
    },
    [setAcknowledgmentState],
  );

  const handleClose = useCallback(() => {
    setDialogOpen(false);
    pendingIntent.current = null;
  }, []);

  const dialog = createElement(ParentalNoticeDialog, {
    open: dialogOpen,
    onAcknowledged: handleAcknowledged,
    onClose: handleClose,
  });

  return { state, requireAcknowledgment, dialog };
}
