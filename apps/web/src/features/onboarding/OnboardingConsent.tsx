import { useCallback, useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import {
  ConsentDeclarationResponseSchema,
  VpcConsentResponseSchema,
} from '@hivekitchen/contracts';
import type { ConsentDeclarationResponse } from '@hivekitchen/types';
import { hkFetch } from '@/lib/fetch.js';
import { useScrollGate } from '@/hooks/useScrollGate.js';

interface OnboardingConsentProps {
  onConsented: () => void;
}

export function OnboardingConsent({ onConsented }: OnboardingConsentProps) {
  const [declaration, setDeclaration] = useState<ConsentDeclarationResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Fetch the consent declaration on mount; cancel on unmount.
  useEffect(() => {
    const controller = new AbortController();
    setLoadError(null);
    setDeclaration(null);

    async function load() {
      try {
        const raw = await hkFetch<unknown>('/v1/compliance/consent-declaration', {
          method: 'GET',
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        const parsed = ConsentDeclarationResponseSchema.parse(raw);
        setDeclaration(parsed);
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setLoadError("Couldn't load the consent declaration. Please try again.");
      }
    }

    void load();
    return () => controller.abort();
  }, [reloadKey]);

  const hasScrolled = useScrollGate(scrollContainerRef, sentinelRef, declaration !== null);

  const handleSign = useCallback(async () => {
    if (declaration === null || signing) return;
    setSignError(null);
    setSigning(true);
    try {
      const raw = await hkFetch<unknown>('/v1/compliance/vpc-consent', {
        method: 'POST',
        body: { document_version: declaration.document_version },
      });
      VpcConsentResponseSchema.parse(raw);
      onConsented();
    } catch {
      setSignError("Couldn't record your consent. Please try again.");
      setSigning(false);
    }
  }, [declaration, signing, onConsented]);

  const handleRetryLoad = useCallback(() => {
    setReloadKey((k) => k + 1);
  }, []);

  if (loadError !== null) {
    return (
      <div className="flex flex-col gap-4">
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
    );
  }

  if (declaration === null) {
    return <p className="font-sans text-stone-400 text-sm">Loading…</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="font-serif text-base text-stone-700 leading-relaxed">
        Before I save your family&apos;s preferences, Lumi needs your formal agreement to our data practices.
      </p>

      <div
        ref={scrollContainerRef}
        className="max-h-[60vh] overflow-y-auto px-4 py-3 rounded-2xl border border-stone-200 bg-stone-50"
        aria-label="Consent declaration"
      >
        <div className="font-sans text-sm text-stone-700 leading-relaxed">
          <Markdown
            components={{
              h1: (props) => (
                <h1 className="font-serif text-xl text-stone-800 mt-2 mb-3" {...props} />
              ),
              h2: (props) => (
                <h2 className="font-serif text-base text-stone-800 mt-4 mb-2" {...props} />
              ),
              p: (props) => <p className="my-2" {...props} />,
              ul: (props) => <ul className="list-disc pl-5 my-2 space-y-1" {...props} />,
              li: (props) => <li className="my-1" {...props} />,
              strong: (props) => <strong className="font-medium text-stone-800" {...props} />,
              a: (props) => (
                <a
                  className="underline text-stone-800 hover:text-stone-900"
                  rel="noopener noreferrer"
                  {...props}
                />
              ),
            }}
          >
            {declaration.content}
          </Markdown>
        </div>
        <div ref={sentinelRef} aria-hidden="true" />
      </div>

      {signError !== null && (
        <p className="font-sans text-sm text-red-700" role="alert">
          {signError}
        </p>
      )}

      <button
        type="button"
        onClick={handleSign}
        disabled={!hasScrolled || signing}
        className="w-full px-6 py-3 rounded-full bg-amber-600 text-white font-sans text-base hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors motion-reduce:transition-none"
      >
        {signing ? 'Signing…' : 'I agree and sign'}
      </button>

      {!hasScrolled && (
        <p className="font-sans text-xs text-stone-400 text-center">
          Scroll to the end to enable the sign button.
        </p>
      )}
    </div>
  );
}
