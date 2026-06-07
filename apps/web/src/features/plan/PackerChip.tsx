import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DayAssignmentsResponseSchema } from '@hivekitchen/contracts';
import { hkFetch } from '@/lib/fetch.js';
import { QueryKeys } from '@/lib/realtime';
import { PackerAssignmentDialog } from './PackerAssignmentDialog.js';

interface PackerChipProps {
  readonly day: string;
  readonly date: string;
  readonly householdId: string;
}

/**
 * Slice 5-S3 — one chip per Brief tile-day showing who packs that day. A single
 * household-level query (QueryKeys.packers) feeds every chip on the canvas; each
 * chip derives its own day from the shared response. Tapping opens the
 * assignment picker.
 */
export function PackerChip({ day, date, householdId }: PackerChipProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const { data } = useQuery({
    queryKey: QueryKeys.packers(householdId),
    queryFn: async ({ signal }) => {
      const raw = await hkFetch<unknown>(`/v1/households/${householdId}/packers`, {
        method: 'GET',
        signal,
      });
      return DayAssignmentsResponseSchema.parse(raw);
    },
    enabled: householdId !== '',
    staleTime: 30_000,
  });

  const assignment = data?.assignments.find((a) => a.date === date) ?? null;
  const packerName = assignment?.packer_display_name ?? null;

  return (
    <>
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        className={`self-start font-sans text-[13px] rounded-full border border-border bg-surface-2 px-3 py-1 transition-colors hover:border-amber-warm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-warm ${
          packerName !== null ? 'text-fg' : 'text-fg-muted'
        }`}
      >
        {packerName !== null ? `${packerName} packs ${day}` : `Nobody's claimed ${day}`}
      </button>

      {pickerOpen && (
        <PackerAssignmentDialog
          day={day}
          date={date}
          householdId={householdId}
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          initialPackerUserId={assignment?.packer_user_id ?? null}
        />
      )}
    </>
  );
}
