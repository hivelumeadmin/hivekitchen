import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { hkFetch, publicGet, publicPost } from '@/lib/fetch.js';
import type {
  LunchLinkDevResponse,
  LunchLinkPayload,
  LunchLinkExpiredPayload,
} from '@hivekitchen/contracts';
import { FeedbackBlock } from '@/features/lunch-link/components/FeedbackBlock.js';
import { HeartNoteCard } from '@/features/lunch-link/components/HeartNoteCard.js';
import { LunchSummary } from '@/features/lunch-link/components/LunchSummary.js';
import { MumNoteSalutation } from '@/features/lunch-link/components/MumNoteSalutation.js';
import type { RatingOption } from '@/features/lunch-link/data/mockData.js';

type LoadState = 'loading' | 'invalid-link' | 'error' | 'loaded' | 'expired';

// Stub link format for slice 4-S2: `test-{UUID:36}-{YYYY-MM-DD:10}` = 52 chars.
function parseStubLinkId(linkId: string): { childId: string; date: string } | null {
  if (!linkId.startsWith('test-') || linkId.length !== 52) return null;
  // Char at index 41 separates the UUID and the date — without this guard a
  // garbage 52-char string slips client-side validation and dead-ends in the
  // generic server-side 400 error.
  if (linkId[41] !== '-') return null;
  const childId = linkId.slice(5, 41);
  const date = linkId.slice(42);
  if (
    childId[8] !== '-' ||
    childId[13] !== '-' ||
    childId[18] !== '-' ||
    childId[23] !== '-'
  ) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return { childId, date };
}

// Slice 4-S3 — real HMAC token: `{base64url(payload)}.{64 hex chars}`.
// base64url alphabet contains no `.` so the last dot unambiguously splits
// the encoded payload from the 64-char hex signature.
function isHmacToken(linkId: string): boolean {
  const dotIdx = linkId.lastIndexOf('.');
  if (dotIdx === -1) return false;
  const encodedPart = linkId.slice(0, dotIdx);
  const sigPart = linkId.slice(dotIdx + 1);
  return (
    encodedPart.length > 0 &&
    /^[A-Za-z0-9_-]+$/.test(encodedPart) &&
    /^[0-9a-f]{64}$/.test(sigPart)
  );
}

// Use noon local time to dodge the DST edge case where midnight in a negative
// UTC offset rolls the date back a day.
function formatDateLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`);
  const day = d.toLocaleDateString('en-US', { weekday: 'long' });
  const num = d.getDate();
  const month = d.toLocaleDateString('en-US', { month: 'long' });
  return `${day} · ${num} ${month}`;
}

const RATING_OPTIONS = [
  { id: 'loved', emoji: '😋', label: 'Loved it' },
  { id: 'ok', emoji: '🙂', label: 'It was OK' },
  { id: 'not-really', emoji: '😕', label: 'Not really' },
] as const satisfies readonly RatingOption[];

const RATING_EMOJIS: Record<string, string> = {
  loved: '😋',
  ok: '🙂',
  'not-really': '😕',
};

type LoadedPayload = {
  childName: string;
  date: string;
  heartNote: { body: string; authorDisplayName: string } | null;
  bag: { name: string; sub: string; safetyNote: string };
  rating?: 'loved' | 'ok' | 'not-really' | null;
};

// Child-scope surface. AppLayout suppresses the LumiOrb/LumiPanel for /lunch/*
// routes (via useMatch); chrome (AppHeader/AppFooter) is intentionally kept so
// a parent peeking at the link recognizes the family of surfaces.
export default function LunchLinkRoute() {
  const { linkId } = useParams<{ linkId: string }>();
  const stubParsed = linkId ? parseStubLinkId(linkId) : null;
  const isStub = stubParsed !== null;
  const isHmac = linkId !== undefined && !isStub && isHmacToken(linkId);

  const [loadState, setLoadState] = useState<LoadState>(
    isStub || isHmac ? 'loading' : 'invalid-link',
  );
  const [data, setData] = useState<LoadedPayload | null>(null);
  const [expiredSnapshot, setExpiredSnapshot] = useState<
    LunchLinkExpiredPayload['last_state_snapshot'] | null
  >(null);
  // Offline support (4-S10): when the SW serves a cached SPA shell but the
  // cross-origin API is unreachable, fall back to a localStorage snapshot.
  // `lastSyncedAt` is non-null only when the render is served from cache.
  // The badge is only visible when both conditions hold: cached data AND offline.
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  // Slice 4-S15 — child "request a lunch" affordance.
  const [requestText, setRequestText] = useState('');
  const [requestState, setRequestState] = useState<'idle' | 'submitting' | 'submitted'>('idle');

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      if (!linkId) return;
      const pendingKey = `lunch-link-pending-rating.${linkId}`;
      const raw = localStorage.getItem(pendingKey);
      if (raw === null) return;
      try {
        const { rating } = JSON.parse(raw) as {
          rating: 'loved' | 'ok' | 'not-really';
        };
        void publicPost(`/v1/lunch-link/${linkId}/rate`, { rating }).then(() => {
          localStorage.removeItem(pendingKey);
        });
      } catch {
        localStorage.removeItem(pendingKey);
      }
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [linkId]);

  useEffect(() => {
    if (!linkId) return;
    let isMounted = true;

    if (isStub && stubParsed) {
      setLoadState('loading');
      hkFetch<LunchLinkDevResponse>(
        `/v1/lunch-link-dev/${stubParsed.childId}/${stubParsed.date}`,
        { method: 'GET' },
      )
        .then((res) => {
          if (!isMounted) return;
          setData(res);
          setLoadState('loaded');
        })
        .catch(() => {
          if (isMounted) setLoadState('error');
        });
    } else if (isHmac) {
      setLoadState('loading');
      publicGet(`/v1/lunch-link/${linkId}`)
        .then(({ status, body }) => {
          if (!isMounted) return;
          if (status === 200) {
            const payload = body as LoadedPayload;
            setData(payload);
            setLoadState('loaded');
            const cacheEntry = JSON.stringify({
              payload,
              at: new Date().toISOString(),
            });
            try {
              localStorage.setItem(`lunch-link-cache.${linkId}`, cacheEntry);
              // Freshly loaded from network — suppress the "last synced" badge.
              setLastSyncedAt(null);
            } catch {
              // localStorage write failure (quota) is non-fatal.
            }
          } else if (status === 410) {
            const snapshot = (body as LunchLinkExpiredPayload).last_state_snapshot;
            if (snapshot !== undefined && snapshot !== null) {
              setExpiredSnapshot(snapshot);
              setLoadState('expired');
            } else {
              setLoadState('error');
            }
          } else if (status === 404) {
            setLoadState('invalid-link');
          } else {
            setLoadState('error');
          }
        })
        .catch(() => {
          if (!isMounted) return;
          if (!navigator.onLine) {
            const raw = localStorage.getItem(`lunch-link-cache.${linkId}`);
            if (raw !== null) {
              try {
                const { payload, at } = JSON.parse(raw) as {
                  payload: LoadedPayload;
                  at: string;
                };
                setData(payload);
                setLastSyncedAt(at);
                setLoadState('loaded');
                return;
              } catch {
                // Corrupt cache — fall through to error state.
              }
            }
          }
          setLoadState('error');
        });
    }

    return () => {
      isMounted = false;
    };
  }, [linkId, isStub, isHmac, stubParsed?.childId, stubParsed?.date]);

  if (loadState === 'invalid-link') {
    return <LunchLinkErrorState message="This link doesn't look right." />;
  }
  if (loadState === 'loading') {
    return <LunchLinkLoadingState />;
  }
  if (loadState === 'expired' && expiredSnapshot !== null) {
    return <LunchLinkExpiredState snapshot={expiredSnapshot} />;
  }
  if (loadState === 'error' || data === null) {
    return <LunchLinkErrorState message="Couldn't load this lunch link. Please try again." />;
  }

  const { childName, date, heartNote, bag } = data;
  const dateLabel = formatDateLabel(date);
  // The public payload carries no parent name; the heart-note author label is
  // the closest available, with a generic fallback (no extra API call — 4-S15).
  const parentName = heartNote?.authorDisplayName ?? 'your parent';

  // Slice 4-S15 — submit the child's request. publicPost never throws; route on
  // status. 201 → confirmation; 409 (already submitted) → confirmation; any
  // other status → re-show the form (silent retry).
  const handleSubmitRequest = async () => {
    if (!linkId || requestText.trim().length === 0) return;
    setRequestState('submitting');
    const { status } = await publicPost(`/v1/lunch-link/${linkId}/child-request`, {
      request_text: requestText,
    });
    setRequestState(status === 201 || status === 409 ? 'submitted' : 'idle');
  };

  // Slice 4-S4: fire-and-forget rating submission. The FeedbackBlock locks
  // immediately on tap regardless of API outcome.
  // Slice 4-S10: on offline failure, queue the rating in localStorage so the
  // `online` listener can replay the POST when connectivity restores.
  const handleRate = (rating: 'loved' | 'ok' | 'not-really') => {
    if (!linkId || !isHmac) return;
    void publicPost(`/v1/lunch-link/${linkId}/rate`, { rating }).catch(() => {
      if (!navigator.onLine) {
        try {
          localStorage.setItem(
            `lunch-link-pending-rating.${linkId}`,
            JSON.stringify({ rating, linkId }),
          );
        } catch {
          // Best-effort retry — quota failures are non-fatal.
        }
      }
    });
  };

  return (
    <main className="flex w-full flex-grow items-center justify-center px-4 py-8 sm:py-12">
      <div className="w-full max-w-md space-y-8">
        <MumNoteSalutation title="A note from Parent" date={dateLabel} />
        {lastSyncedAt !== null && !isOnline && (
          <p className="text-center text-xs text-fg-muted/50">
            offline · last synced{' '}
            {new Date(lastSyncedAt).toLocaleTimeString(undefined, {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        )}
        <HeartNoteCard
          body={(heartNote?.body?.trim() ? heartNote.body : null) ?? 'No note today — check back soon'}
          from={heartNote ? `— ${heartNote.authorDisplayName}` : ''}
        />
        <LunchSummary
          lunch={{
            eyebrow: "Today's Lunch",
            name: bag.name,
            sub: bag.sub,
            safetyBadge: bag.safetyNote,
          }}
        />
        <FeedbackBlock
          question={`How was lunch, ${childName}?`}
          options={RATING_OPTIONS}
          hint="Tap one. That's all."
          onRate={isHmac ? handleRate : undefined}
          lockedRating={
            isHmac ? ((data as LunchLinkPayload).rating ?? undefined) : undefined
          }
        />
        {/* Slice 4-S12: understated link to the cumulative FlavorPassport. The
            passport page handles its own empty state, so this shows
            unconditionally for real (HMAC) links — no extra API call here. The
            child name rides along via router state since the public passport
            response carries no name. */}
        {isHmac && linkId && (
          <p className="text-center">
            <Link
              to={`/lunch/${linkId}/passport`}
              state={{ childName }}
              className="text-sm text-fg-muted underline"
            >
              See {childName}&apos;s flavor passport →
            </Link>
          </p>
        )}
        {/* Slice 4-S15 — child "request a lunch" affordance. Real (HMAC) links
            only; hidden once submitted. */}
        {isHmac && linkId && (
          requestState === 'submitted' ? (
            <p role="status" className="text-center text-[22px] text-fg-muted">
              Got it! Your note is on its way.
            </p>
          ) : (
            <div className="space-y-3">
              <label
                htmlFor="child-request-input"
                className="block font-serif text-[22px] text-fg"
              >
                Tell {parentName} back
              </label>
              <textarea
                id="child-request-input"
                value={requestText}
                onChange={(e) => setRequestText(e.target.value.slice(0, 200))}
                maxLength={200}
                rows={3}
                dir="auto"
                placeholder="I'd love…"
                className="min-h-[48px] w-full resize-none rounded-lg border border-fg-muted/20 bg-surface p-3 font-serif text-[22px] leading-relaxed text-fg placeholder:text-fg-muted/40 focus:outline-none"
              />
              {requestText.length > 0 && (
                <p aria-live="polite" className="text-right text-sm text-fg-muted">
                  {requestText.length} / 200
                </p>
              )}
              <button
                type="button"
                onClick={() => void handleSubmitRequest()}
                disabled={requestState === 'submitting' || requestText.trim().length === 0}
                aria-busy={requestState === 'submitting'}
                className="inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-lg bg-amber-warm px-8 font-medium uppercase tracking-widest text-bg transition-all duration-200 hover:bg-amber active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Send to {parentName}
              </button>
            </div>
          )
        )}
      </div>
    </main>
  );
}

function LunchLinkExpiredState({
  snapshot,
}: {
  readonly snapshot: LunchLinkExpiredPayload['last_state_snapshot'];
}) {
  return (
    <main className="flex w-full flex-grow items-center justify-center px-4 py-8 sm:py-12">
      <div className="w-full max-w-md space-y-8">
        <p className="text-center text-sm text-fg-muted">This link closed at 8pm</p>
        <HeartNoteCard
          body={
            (snapshot.heartNote?.body?.trim() ? snapshot.heartNote.body : null) ??
            'No note for this day'
          }
          from={snapshot.heartNote ? `— ${snapshot.heartNote.authorDisplayName}` : ''}
        />
        {snapshot.rating != null && (
          <p
            className="text-center text-4xl"
            aria-label={`Child rated: ${snapshot.rating}`}
          >
            {RATING_EMOJIS[snapshot.rating]}
          </p>
        )}
        <LunchSummary
          lunch={{
            eyebrow: "Today's Lunch",
            name: snapshot.bag.name,
            sub: snapshot.bag.sub,
            safetyBadge: snapshot.bag.safetyNote,
          }}
        />
      </div>
    </main>
  );
}

function LunchLinkLoadingState() {
  return (
    <main className="flex w-full flex-grow items-center justify-center px-4 py-8">
      <div className="w-full max-w-md space-y-8">
        <div className="mx-auto h-8 w-48 animate-pulse rounded bg-surface-2" />
        <div className="h-[200px] animate-pulse rounded-lg bg-surface-2" />
        <div className="h-20 animate-pulse rounded-lg bg-surface-2" />
      </div>
    </main>
  );
}

function LunchLinkErrorState({ message }: { readonly message: string }) {
  return (
    <main className="flex w-full flex-grow items-center justify-center px-4 py-8">
      <p className="text-center text-sm text-fg-muted">{message}</p>
    </main>
  );
}
