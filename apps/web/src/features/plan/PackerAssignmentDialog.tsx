import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { HouseholdMembersResponseSchema } from '@hivekitchen/contracts';
import type { HouseholdMember } from '@hivekitchen/types';
import { hkFetch } from '@/lib/fetch.js';
import { QueryKeys } from '@/lib/realtime';

interface PackerAssignmentDialogProps {
  readonly day: string;
  readonly date: string;
  readonly householdId: string;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly initialPackerUserId: string | null;
}

/**
 * Slice 5-S3 — the picker behind a PackerChip. Lists household members (Primary
 * Parent + Secondary Caregiver) plus a "Nobody" option, then PATCHes the chosen
 * packer for the day and invalidates the shared packers query.
 */
export function PackerAssignmentDialog({
  day,
  date,
  householdId,
  open,
  onClose,
  initialPackerUserId,
}: PackerAssignmentDialogProps) {
  const queryClient = useQueryClient();
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(initialPackerUserId);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const raw = await hkFetch<unknown>(`/v1/households/${householdId}/members`, {
          method: 'GET',
          signal: controller.signal,
        });
        setMembers(HouseholdMembersResponseSchema.parse(raw).members);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError("Couldn't load household members.");
      }
    })();
    return () => controller.abort();
  }, [householdId]);

  async function handleAssign() {
    setError(null);
    setSubmitting(true);
    try {
      await hkFetch(`/v1/households/${householdId}/days/${date}/packer`, {
        method: 'PATCH',
        // hkFetch JSON-stringifies the body — pass the raw object (project trap).
        body: { packer_user_id: selectedUserId },
      });
      void queryClient.invalidateQueries({ queryKey: QueryKeys.packers(householdId) });
      onClose();
    } catch {
      setError('Could not save. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--fg)_20%,transparent)] px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Who's packing ${day}?`}
        className="w-full max-w-sm rounded-lg border border-border bg-bg p-6 shadow-lg"
      >
        <h2 className="font-serif text-xl text-fg">Who&apos;s packing {day}?</h2>

        <fieldset className="mt-4 space-y-2">
          {members.map((member) => (
            <label key={member.user_id} className="flex items-center gap-3 font-sans text-sm text-fg">
              <input
                type="radio"
                name="packer"
                value={member.user_id}
                checked={selectedUserId === member.user_id}
                onChange={() => setSelectedUserId(member.user_id)}
              />
              {member.display_name ?? 'Unknown'}
            </label>
          ))}
          <label className="flex items-center gap-3 font-sans text-sm text-fg-muted">
            <input
              type="radio"
              name="packer"
              value=""
              checked={selectedUserId === null}
              onChange={() => setSelectedUserId(null)}
            />
            Nobody
          </label>
        </fieldset>

        {error !== null && (
          <p role="alert" className="mt-3 font-sans text-sm text-safety-red">
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-border px-4 py-2 font-sans text-sm text-fg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleAssign()}
            disabled={submitting}
            aria-busy={submitting}
            className="rounded bg-amber-warm px-4 py-2 font-sans text-sm font-medium text-bg transition-colors hover:bg-amber motion-reduce:transition-none disabled:opacity-50"
          >
            {submitting ? 'Saving…' : 'Assign'}
          </button>
        </div>
      </div>
    </div>
  );
}
