import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { hkFetch } from '@/lib/fetch.js';
import type { LunchLinkDevResponse } from '@hivekitchen/contracts';
import { FeedbackBlock } from '@/features/lunch-link/components/FeedbackBlock.js';
import { HeartNoteCard } from '@/features/lunch-link/components/HeartNoteCard.js';
import { LunchSummary } from '@/features/lunch-link/components/LunchSummary.js';
import { MumNoteSalutation } from '@/features/lunch-link/components/MumNoteSalutation.js';
import type { RatingOption } from '@/features/lunch-link/data/mockData.js';

type LoadState = 'loading' | 'invalid-link' | 'error' | 'loaded';

// Stub link format for slice 4-S2: `test-{UUID:36}-{YYYY-MM-DD:10}` = 52 chars.
// Real HMAC-signed tokens ship in 4-S3 and will replace this parser.
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

// Child-scope surface. AppLayout suppresses the LumiOrb/LumiPanel for /lunch/*
// routes (via useMatch); chrome (AppHeader/AppFooter) is intentionally kept so
// a parent peeking at the link recognizes the family of surfaces.
export default function LunchLinkRoute() {
  const { linkId } = useParams<{ linkId: string }>();
  const parsed = linkId ? parseStubLinkId(linkId) : null;

  const [loadState, setLoadState] = useState<LoadState>(parsed ? 'loading' : 'invalid-link');
  const [data, setData] = useState<LunchLinkDevResponse | null>(null);

  useEffect(() => {
    if (!parsed) return;
    let isMounted = true;
    setLoadState('loading');
    hkFetch<LunchLinkDevResponse>(
      `/v1/lunch-link-dev/${parsed.childId}/${parsed.date}`,
      { method: 'GET' },
    )
      .then((res) => {
        if (isMounted) {
          setData(res);
          setLoadState('loaded');
        }
      })
      .catch(() => {
        if (isMounted) setLoadState('error');
      });
    return () => {
      isMounted = false;
    };
  }, [parsed?.childId, parsed?.date]);

  if (loadState === 'invalid-link') {
    return <LunchLinkErrorState message="This link doesn't look right." />;
  }
  if (loadState === 'loading') {
    return <LunchLinkLoadingState />;
  }
  if (loadState === 'error' || data === null) {
    return <LunchLinkErrorState message="Couldn't load this lunch link. Please try again." />;
  }

  const { childName, date, heartNote, bag } = data;
  const dateLabel = formatDateLabel(date);

  return (
    <main className="flex w-full flex-grow items-center justify-center px-4 py-8 sm:py-12">
      <div className="w-full max-w-md space-y-8">
        <MumNoteSalutation title="A note from Parent" date={dateLabel} />
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
