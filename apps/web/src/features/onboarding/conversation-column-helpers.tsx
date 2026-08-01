import type { ChipConfig } from '@hivekitchen/contracts';

const MOMENT_CONFIG: Record<string, { number: number; name: string }> = {
  pre_start: { number: 0, name: '' },
  m1_table: { number: 1, name: "Who's at the table" },
  m2_safe: { number: 2, name: 'What I need to keep safe' },
  m3_taste: { number: 3, name: 'How your kitchen tastes' },
  m4_bag: { number: 4, name: 'What goes in the bag' },
  m5_starting_line: { number: 5, name: 'A starting line for Lumi' },
  summary: { number: 6, name: 'Summary' },
  finalized: { number: 0, name: '' },
};

export function momentSubtitle(
  momentKey: string | null,
  isResume: boolean,
  userTurnCount: number,
): string {
  if (momentKey === 'summary') return 'Summary · Lock in your kitchen';
  if (momentKey === 'finalized') return 'Kitchen locked in · Welcome';
  const meta = momentKey !== null ? MOMENT_CONFIG[momentKey] : undefined;
  if (meta !== undefined && meta.number > 0) {
    return `Moment ${Math.min(meta.number, 5)} of 5 · ${meta.name}`;
  }
  if (isResume) return '';
  return `Step ${Math.min(userTurnCount + 1, 8)} of ~8`;
}

export function inputPlaceholder(
  momentKey: string | null,
  coldStartMode: boolean,
  chipConfig: ChipConfig | null,
): string {
  if (momentKey === 'm5_starting_line' && coldStartMode) {
    return 'Type a dish your family eats most weeks…';
  }
  if (momentKey === 'm2_safe') {
    return 'Add details — which child, severity, anything special I should know…';
  }
  return chipConfig !== null ? 'Add a note…' : 'Type your answer...';
}

function selectionCountLabel(count: number): string {
  return count === 1
    ? '1 selection will be sent with your message'
    : `${count} selections will be sent with your message`;
}

export function StatusLine({
  currentMomentKey,
  coldStartMode,
  coldStartDishCount,
  chipSelections,
  draft,
  onOverrideFewer,
}: {
  currentMomentKey: string | null;
  coldStartMode: boolean;
  coldStartDishCount: number;
  chipSelections: string[];
  draft: string;
  onOverrideFewer: () => void;
}) {
  if (currentMomentKey === 'm5_starting_line' && coldStartMode) {
    if (coldStartDishCount === 0) {
      return (
        <p data-testid="cold-start-gate-line" className="mt-2 text-center font-sans text-xs italic text-fg-muted">
          Tell Lumi three dishes your family eats most weeks.
        </p>
      );
    }
    if (coldStartDishCount < 3) {
      const remaining =
        coldStartDishCount === 1
          ? '2 more dishes for a solid starting point.'
          : '1 more and Lumi has a place to start.';
      return (
        <p data-testid="cold-start-gate-line" className="mt-2 text-center font-sans text-xs italic text-fg-muted">
          {remaining}{' '}
          <button type="button" onClick={onOverrideFewer} className="text-amber underline hover:text-amber-warm">
            Or start with what you&rsquo;ve shared
          </button>
        </p>
      );
    }
    return (
      <p data-testid="cold-start-gate-line" className="mt-2 text-center font-sans text-xs italic text-foliage">
        Three dishes captured — Lumi has a starting point.
      </p>
    );
  }

  if (currentMomentKey === 'm2_safe') {
    const hasResponse = chipSelections.length > 0 || draft.trim().length > 0;
    if (!hasResponse) {
      return (
        <p data-testid="m2-status-line" className="mt-2 text-center font-sans text-xs italic text-amber">
          Required — tap an allergen, describe in your own words, or pick &ldquo;No known allergens&rdquo;.
        </p>
      );
    }
    if (chipSelections.includes('none')) {
      return (
        <p data-testid="m2-status-line" className="mt-2 text-center font-sans text-xs italic text-foliage">
          No known allergens — confirmed
        </p>
      );
    }
    if (chipSelections.length > 0) {
      return (
        <p data-testid="m2-status-line" className="mt-2 text-center font-sans text-xs italic text-foliage">
          {selectionCountLabel(chipSelections.length)}
        </p>
      );
    }
    return null;
  }

  if (chipSelections.length > 0) {
    return (
      <p className="mt-2 text-center font-sans text-xs italic text-foliage">
        {selectionCountLabel(chipSelections.length)}
      </p>
    );
  }
  return null;
}

export function WaveformGlyph() {
  return (
    <svg
      className="h-6 w-6 animate-pulse text-amber motion-reduce:animate-none"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 8.25v7.5m3-10.5v13.5M9 6.75v10.5m3-13.5v16.5m3-13.5v10.5m3-7.5v4.5"
      />
    </svg>
  );
}

export function SendGlyph() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
    </svg>
  );
}
