import type { FlavorPassportStamp } from '@hivekitchen/types';

// Noon local time dodges the DST/UTC-offset edge where midnight rolls the date
// back a day. Matches the convention in routes/(app)/lunch-link.tsx.
function formatStampDate(isoDate: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${isoDate}T12:00:00`));
}

interface FlavorPassportStampProps {
  stamp: FlavorPassportStamp;
  scope: 'app' | 'child';
}

// One stamp card. The loved emoji is absolutely positioned and rendered LAST in
// the DOM so the read-aloud order stays dish name → date → method caption (AC11)
// with nothing decorative interspersed; it still carries an aria-label so the
// "loved" state is not conveyed by the glyph alone.
export function FlavorPassportStampCard({ stamp, scope }: FlavorPassportStampProps) {
  const dateLabel = formatStampDate(stamp.signal_date);
  const headingId = `stamp-${stamp.recipe_id}`;
  // Child scope demands AAA (7:1). `--fg-muted` only reaches ~6:1 on these
  // surfaces, so secondary text uses full-strength `--fg` there; the parent
  // (app) scope keeps the muted hierarchy at AA.
  const secondaryText = scope === 'child' ? 'text-fg' : 'text-fg-muted';

  const inner = (
    <>
      <h3
        id={scope === 'child' ? headingId : undefined}
        className="pr-8 font-serif text-lg text-fg"
      >
        {stamp.recipe_name}
      </h3>
      <p className={`mt-1 text-sm ${secondaryText}`}>{dateLabel}</p>
      {stamp.method_caption !== null && (
        <p className={`mt-2 text-sm italic ${secondaryText}`}>{stamp.method_caption}</p>
      )}
      {stamp.cuisine_tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {stamp.cuisine_tags.map((tag) => (
            <span
              key={tag}
              className={`rounded-sm bg-surface-2 px-2 py-0.5 text-xs ${secondaryText}`}
            >
              {tag}
            </span>
          ))}
        </div>
      )}
      {stamp.signal_type === 'loved' && (
        <span
          className="absolute right-4 top-4 text-[20px] leading-none"
          role="img"
          aria-label="loved it"
        >
          😋
        </span>
      )}
    </>
  );

  if (scope === 'child') {
    return (
      <li>
        <article aria-labelledby={headingId} className="relative rounded-lg bg-surface p-5">
          {inner}
        </article>
      </li>
    );
  }

  return <article className="relative rounded-lg bg-surface p-5">{inner}</article>;
}
