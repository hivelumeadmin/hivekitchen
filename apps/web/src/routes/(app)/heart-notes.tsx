import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  HeartNotesListPayloadSchema,
  type HeartNoteResponse,
} from '@hivekitchen/contracts';
import { hkFetch } from '@/lib/fetch.js';
import { PageHeader } from '@/components/PageHeader.js';
import { StatusPill } from '@/features/heart-note/components/StatusPill.js';

export default function HeartNotesRoute() {
  const [notes, setNotes] = useState<HeartNoteResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await hkFetch<unknown>('/v1/heart-notes/history', { method: 'GET' });
        if (cancelled) return;
        const { notes: fetched } = HeartNotesListPayloadSchema.parse(raw);
        setNotes(fetched);
      } catch {
        if (!cancelled) setError('Could not load notes.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="flex flex-grow justify-center px-6 pb-32 pt-16">
      <div className="w-full max-w-[720px]">
        <PageHeader eyebrow="Heart Notes" headlineSize="sm" className="mb-8">
          All notes
        </PageHeader>
        <div className="mb-6 flex justify-end">
          <Link
            to="/app/heart-note"
            className="rounded-lg bg-honey px-4 py-2 text-sm font-medium text-white hover:bg-honey-dark"
          >
            Write a note
          </Link>
        </div>
        {loading ? (
          <p className="text-sm text-fg-muted">Loading…</p>
        ) : error !== null ? (
          <p role="alert" className="text-sm text-safety-red">
            {error}
          </p>
        ) : notes.length === 0 ? (
          <p className="text-sm text-fg-muted">
            No notes yet. Write one for a child’s lunch!
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {notes.map((note) => {
              const isNavigable = note.status === 'draft' || note.status === 'scheduled';
              const rowInner = (
                <>
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium text-fg">
                      Note for child {note.child_id.slice(0, 8)}…
                    </span>
                    <span className="text-xs text-fg-muted">
                      {note.scheduled_for ?? note.created_at.slice(0, 10)}
                    </span>
                  </div>
                  <StatusPill
                    status={note.status}
                    scheduledFor={note.scheduled_for}
                    deliveredAt={note.delivered_at}
                  />
                </>
              );
              return (
                <li
                  key={note.id}
                  className="rounded-xl border border-[color-mix(in_srgb,var(--border)_20%,transparent)] bg-surface px-5 py-4"
                >
                  {isNavigable ? (
                    <Link
                      to="/app/heart-note"
                      className="flex w-full items-center justify-between"
                    >
                      {rowInner}
                    </Link>
                  ) : (
                    <div className="flex items-center justify-between">{rowInner}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
