import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConsentHistoryResponseSchema } from '@hivekitchen/contracts';
import type { ConsentHistoryEvent } from '@hivekitchen/types';
import { hkFetch, HkApiError } from '@/lib/fetch.js';
import { useLumiContext } from '@/hooks/useLumiContext.js';
import { useAuthStore } from '@/stores/auth.store.js';

type LoadState = 'loading' | 'ready' | 'error';

const EMPTY_COPY = 'No consent events have been recorded for this household yet.';
const ERROR_COPY = "Lumi couldn't load your consent history right now. Try refreshing.";

// Human-readable labels for the consent event types in audit_log.
// event_type uses z.string() in the contract for forward-compatibility —
// unknown event types fall back to the raw event_type string.
const EVENT_LABELS: Record<string, string> = {
  'vpc.consented': 'Consent recorded',
  'parental_notice.acknowledged': 'Parental notice acknowledged',
  'account.created': 'Account created',
  'account.updated': 'Account updated',
  'account.deleted': 'Account deletion initiated',
};

function eventLabel(event: ConsentHistoryEvent): string {
  const base = EVENT_LABELS[event.event_type] ?? event.event_type;
  const mechanism =
    typeof event.metadata['mechanism'] === 'string' ? event.metadata['mechanism'] : null;
  return mechanism ? `${base} (${mechanism})` : base;
}

export default function ConsentHistoryRoute() {
  useLumiContext({ surface: 'general' });

  const navigate = useNavigate();
  const accessToken = useAuthStore((s) => s.accessToken);
  const householdId = useAuthStore((s) => s.user?.current_household_id ?? null);
  const didLoad = useRef(false);

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [events, setEvents] = useState<ConsentHistoryEvent[]>([]);

  useEffect(() => {
    if (!accessToken) {
      navigate('/auth/login?next=/app/memory/consent-history', { replace: true });
      return;
    }
    if (householdId === null || didLoad.current) return;
    didLoad.current = true;
    const controller = new AbortController();
    void (async () => {
      try {
        const raw = await hkFetch<unknown>(`/v1/households/${householdId}/consent-history`, {
          method: 'GET',
          signal: controller.signal,
        });
        const parsed = ConsentHistoryResponseSchema.parse(raw);
        setEvents(parsed.events);
        setLoadState('ready');
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        if (err instanceof HkApiError && err.status === 401) {
          navigate('/auth/login?next=/app/memory/consent-history', { replace: true });
          return;
        }
        didLoad.current = false;
        setLoadState('error');
      }
    })();
    return () => controller.abort();
  }, [accessToken, householdId, navigate]);

  return (
    <main className="mx-auto w-full max-w-3xl flex-grow px-4 py-16 sm:px-6 md:py-24">
      <h1 className="font-serif text-3xl text-fg">Consent history</h1>
      <p className="mt-2 font-sans text-base text-fg-muted leading-relaxed">
        Every consent and account event recorded for your household.
      </p>

      {loadState === 'loading' ? (
        <div role="status" aria-label="Loading your consent history" className="mt-8 space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-10 rounded bg-surface animate-pulse motion-reduce:animate-none"
            />
          ))}
        </div>
      ) : loadState === 'error' ? (
        <p role="alert" className="mt-8 font-sans text-base text-fg-muted">
          {ERROR_COPY}
        </p>
      ) : events.length === 0 ? (
        <p className="mt-8 font-sans text-base text-fg-muted leading-relaxed">{EMPTY_COPY}</p>
      ) : (
        <ul className="mt-8 space-y-4">
          {events.map((event) => (
            <li key={event.id} className="border-b border-border/20 pb-4">
              <p className="font-sans text-sm text-fg">{eventLabel(event)}</p>
              <p className="mt-1 font-sans text-xs text-fg-muted">
                {new Date(event.created_at).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
