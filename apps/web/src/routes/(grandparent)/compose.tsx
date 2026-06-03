import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GuestAuthorCapResponseSchema } from '@hivekitchen/contracts';
import type { GuestAuthorCapResponse } from '@hivekitchen/types';
import { hkFetch, HkApiError } from '@/lib/fetch.js';
import { HeartNoteComposer } from '@/features/grandparent/HeartNoteComposer.js';

export default function GrandparentComposePage() {
  const navigate = useNavigate();
  const [cap, setCap] = useState<GuestAuthorCapResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const raw = await hkFetch<unknown>('/v1/guest-author/cap', { method: 'GET' });
        if (cancelled) return;
        setCap(GuestAuthorCapResponseSchema.parse(raw));
      } catch (err) {
        if (cancelled) return;
        if (err instanceof HkApiError && err.status === 401) {
          navigate('/auth/login?next=/guest-author/compose', { replace: true });
          return;
        }
        setError('Could not load your composer. Please try again.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg px-6 text-fg">
        <p role="alert" className="font-serif text-lg text-fg-muted">
          {error}
        </p>
      </main>
    );
  }

  if (!cap) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg px-6 text-fg">
        <p className="font-serif text-lg text-fg-muted">Loading…</p>
      </main>
    );
  }

  // `.grandparent-scope` is always single-column (SCOPE_CHARTER.md): no sidebar,
  // no aside, max-width 640px.
  return (
    <main className="flex min-h-screen flex-col items-center bg-bg px-6 py-12 text-fg">
      <div className="w-full max-w-[640px]">
        <HeartNoteComposer
          childId={cap.child_id}
          childName={cap.child_name}
          grandparentName={cap.grandparent_name}
          grandparentTerm={cap.grandparent_term}
          notesUsed={cap.notes_used}
          cap={cap.cap}
          nextMonthOpens={cap.next_month_opens}
        />
      </div>
    </main>
  );
}
