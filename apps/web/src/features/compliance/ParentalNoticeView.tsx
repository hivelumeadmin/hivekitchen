import { useCallback, useEffect, useState } from 'react';
import { ParentalNoticeResponseSchema } from '@hivekitchen/contracts';
import type { ParentalNoticeResponse } from '@hivekitchen/types';
import { hkFetch } from '@/lib/fetch.js';
import { ParentalNoticeContent } from './ParentalNoticeContent.js';

// Inline view of the parental notice — used from Account &rsaquo; Privacy &amp; Data
// and from any future child-scope footer link. No scrim, no scroll-gate, no
// acknowledge button — pure reference reading.
export function ParentalNoticeView() {
  const [notice, setNotice] = useState<ParentalNoticeResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
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
  }, [reloadKey]);

  const handleRetry = useCallback(() => {
    setReloadKey((k) => k + 1);
  }, []);

  if (loadError !== null) {
    return (
      <div className="flex flex-col gap-3">
        <p className="font-sans text-sm text-red-700" role="alert">
          {loadError}
        </p>
        <button
          type="button"
          onClick={handleRetry}
          className="self-start px-4 py-2 rounded-full bg-stone-800 text-white font-sans text-sm hover:bg-stone-900 transition-colors motion-reduce:transition-none"
        >
          Try again
        </button>
      </div>
    );
  }

  if (notice === null) {
    return <p className="font-sans text-stone-400 text-sm">Loading…</p>;
  }

  return (
    <div className="flex flex-col gap-2 font-sans text-sm text-stone-700 leading-relaxed">
      <ParentalNoticeContent notice={notice} />
    </div>
  );
}
