import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PendingChildRequestsResponseSchema } from '@hivekitchen/contracts';
import type { PendingChildRequestsResponse } from '@hivekitchen/types';
import { hkFetch } from '@/lib/fetch.js';
import { QueryKeys } from '@/lib/realtime';
import { PrimaryButton, CheckCircleIcon } from '@hivekitchen/ui';

interface PendingChildRequestsProps {
  readonly householdId: string;
}

// "2 hours ago" within the day, else "Mon 14 Apr".
function formatCreatedAt(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  if (Number.isNaN(diff)) return '';
  if (diff >= 0 && diff < 86_400_000) {
    const hours = Math.floor(diff / 3_600_000);
    if (hours < 1) {
      const mins = Math.floor(diff / 60_000);
      return mins <= 1 ? 'just now' : `${mins} minutes ago`;
    }
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  }
  const d = new Date(iso);
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  return `${weekday} ${d.getDate()} ${month}`;
}

/**
 * Slice 4-S15 — surfaces a child's "request a lunch" suggestion on the parent's
 * planning page with [Approve] / [Decline]. Approved requests become a soft
 * planner signal server-side. Renders nothing when there are no pending
 * requests. `.app-scope` — no child/grandparent guard needed.
 */
export function PendingChildRequests({ householdId }: PendingChildRequestsProps) {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: QueryKeys.childRequests(householdId),
    queryFn: async ({ signal }) => {
      const raw = await hkFetch<unknown>('/v1/child-requests?status=pending', {
        method: 'GET',
        signal,
      });
      return PendingChildRequestsResponseSchema.parse(raw);
    },
    staleTime: 30_000,
  });

  const requests = data?.requests ?? [];

  async function resolve(id: string, action: 'approve' | 'decline'): Promise<void> {
    // Optimistic removal — the card disappears immediately; the invalidation
    // below reconciles with the server (restores it if the POST failed).
    queryClient.setQueryData<PendingChildRequestsResponse>(
      QueryKeys.childRequests(householdId),
      (old) => (old ? { requests: old.requests.filter((r) => r.id !== id) } : old),
    );
    try {
      await hkFetch(`/v1/child-requests/${id}/${action}`, { method: 'POST' });
    } catch {
      // Swallow — the invalidation refetch restores the true state.
    } finally {
      void queryClient.invalidateQueries({ queryKey: QueryKeys.childRequests(householdId) });
    }
  }

  if (requests.length === 0) return null;

  return (
    <section className="mb-12">
      <p className="mb-4 text-sm font-medium uppercase tracking-wide text-fg-muted">
        From your kids
      </p>
      <div className="space-y-4">
        {requests.map((req) => (
          <article
            key={req.id}
            aria-label={`${req.child_name}'s request`}
            className="rounded-lg bg-surface p-5"
          >
            <p className="font-serif text-fg">{req.child_name}</p>
            <p className="mt-1 text-base text-fg">{req.request_text}</p>
            <p className="mt-1 text-sm text-fg-muted">{formatCreatedAt(req.created_at)}</p>
            <div className="mt-4 flex items-center gap-4">
              <PrimaryButton
                icon={<CheckCircleIcon />}
                onClick={() => void resolve(req.id, 'approve')}
                ariaLabel={`Approve ${req.child_name}'s request`}
              >
                Approve
              </PrimaryButton>
              <button
                type="button"
                onClick={() => void resolve(req.id, 'decline')}
                aria-label={`Decline ${req.child_name}'s request`}
                className="text-sm text-fg-muted underline"
              >
                Decline
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
