import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AcknowledgeParentalNoticeResponseSchema,
  ParentalNoticeResponseSchema,
} from '@hivekitchen/contracts';
import type { ParentalNoticeResponse } from '@hivekitchen/types';
import { hkFetch } from '@/lib/fetch.js';
import { useScrollGate } from '@/hooks/useScrollGate.js';
import { Dialog } from '@/components/Dialog.js';
import { ParentalNoticeContent } from './ParentalNoticeContent.js';

interface ParentalNoticeDialogProps {
  open: boolean;
  onAcknowledged: (acknowledgedAt: string, documentVersion: string) => void;
  onClose: () => void;
}

export function ParentalNoticeDialog({
  open,
  onAcknowledged,
  onClose,
}: ParentalNoticeDialogProps) {
  const [notice, setNotice] = useState<ParentalNoticeResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [acking, setAcking] = useState(false);
  const [ackError, setAckError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      // Reset state on close so the next open re-fetches.
      setNotice(null);
      setLoadError(null);
      setAckError(null);
      setAcking(false);
      return;
    }
    const controller = new AbortController();
    setLoadError(null);
    setNotice(null);

    async function load() {
      try {
        const raw = await hkFetch<unknown>('/v1/compliance/parental-notice', {
          method: 'GET',
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setNotice(ParentalNoticeResponseSchema.parse(raw));
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setLoadError("Couldn't load the notice. Please try again.");
      }
    }

    void load();
    return () => controller.abort();
  }, [open, reloadKey]);

  const hasScrolled = useScrollGate(scrollContainerRef, sentinelRef, notice !== null);

  const handleAcknowledge = useCallback(async () => {
    if (notice === null || acking) return;
    setAckError(null);
    setAcking(true);
    try {
      const raw = await hkFetch<unknown>('/v1/compliance/parental-notice/acknowledge', {
        method: 'POST',
        body: { document_version: notice.document_version },
      });
      const parsed = AcknowledgeParentalNoticeResponseSchema.parse(raw);
      onAcknowledged(parsed.acknowledged_at, parsed.document_version);
    } catch {
      setAckError("Couldn't record your acknowledgment. Please try again.");
      setAcking(false);
    }
  }, [notice, acking, onAcknowledged]);

  const handleRetryLoad = useCallback(() => {
    setReloadKey((k) => k + 1);
  }, []);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      titleId="parental-notice-title"
      descriptionId="parental-notice-intro"
    >
      <h2
        id="parental-notice-title"
        className="font-serif text-xl text-stone-800 mb-2"
      >
        Before we collect data about your family
      </h2>
      <p
        id="parental-notice-intro"
        className="font-sans text-sm text-stone-600 mb-4 leading-relaxed"
      >
        Please read this notice once. You can revisit it any time from
        Account &rsaquo; Privacy &amp; Data.
      </p>

      {loadError !== null && (
        <div className="flex flex-col gap-3">
          <p className="font-sans text-sm text-red-700" role="alert">
            {loadError}
          </p>
          <button
            type="button"
            onClick={handleRetryLoad}
            className="self-start px-4 py-2 rounded-full bg-stone-800 text-white font-sans text-sm hover:bg-stone-900 transition-colors motion-reduce:transition-none"
          >
            Try again
          </button>
        </div>
      )}

      {loadError === null && notice === null && (
        <p className="font-sans text-stone-400 text-sm">Loading…</p>
      )}

      {notice !== null && (
        <>
          <div
            ref={scrollContainerRef}
            className="flex-1 overflow-y-auto px-4 py-3 rounded-2xl border border-stone-200 bg-stone-50 min-h-0"
          >
            <ParentalNoticeContent notice={notice} />
            <div ref={sentinelRef} aria-hidden="true" />
          </div>

          {ackError !== null && (
            <p className="font-sans text-sm text-red-700 mt-3" role="alert">
              {ackError}
            </p>
          )}

          <button
            type="button"
            onClick={handleAcknowledge}
            disabled={!hasScrolled || acking}
            className="mt-4 w-full px-6 py-3 rounded-full bg-amber-600 text-white font-sans text-base hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors motion-reduce:transition-none"
          >
            {acking ? 'Saving…' : "I've read this — start adding my child"}
          </button>

          {!hasScrolled && (
            <p className="font-sans text-xs text-stone-400 text-center mt-2">
              Scroll to the end to enable the button.
            </p>
          )}
        </>
      )}
    </Dialog>
  );
}
