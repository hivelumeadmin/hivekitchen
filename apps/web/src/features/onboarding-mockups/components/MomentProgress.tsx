interface MomentProgressProps {
  current: number;
  total: number;
}

export function MomentProgress({ current, total }: MomentProgressProps) {
  return (
    <div
      role="status"
      aria-label={`Moment ${current} of ${total}`}
      className="font-sans text-xs uppercase tracking-[0.18em] text-memory-provenance-500"
    >
      Moment {current} of {total}
    </div>
  );
}
