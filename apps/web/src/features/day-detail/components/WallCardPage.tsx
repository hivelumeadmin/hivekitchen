import { useState } from 'react';
import { PauseCircleIcon } from '@hivekitchen/ui';
import type {
  ChildPerson,
  CookingMode,
  DayPlan,
} from '../day-view-model.js';
import { formatAttribution } from '../day-view-model.js';
import { MainGroupBadge } from './MainGroupBadge.js';
import { OptionalExtraBlock } from './OptionalExtraBlock.js';
import { VariationChip } from './VariationChip.js';

interface Readonly_WallCardPageProps {
  readonly day: DayPlan;
  readonly kids: readonly ChildPerson[];
  readonly mode: CookingMode;
}

export type WallCardPageProps = Readonly<Readonly_WallCardPageProps>;

function dayNameLabel(name: DayPlan['dayName']): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function WallCardPage({ day, kids, mode }: WallCardPageProps) {
  const [methodExpanded, setMethodExpanded] = useState<boolean>(
    !day.main.familiarityKnown,
  );

  const childById = new Map(kids.map((c) => [c.id, c]));
  const attribution = formatAttribution(kids);
  const minutes = mode === 'prep' ? day.main.prepMinutes : day.main.finishMinutes;
  const verb = mode === 'prep' ? 'to prep' : 'to pack';
  const timeFragment =
    minutes > 0
      ? `~${String(minutes)} min ${verb}`
      : `Nothing in ${mode === 'prep' ? 'Prep' : 'Finish'}`;
  const filteredMethod = day.main.method.filter((s) => s.mode === mode);
  // Undefined means no familiarity signal exists — say nothing rather than
  // claim "New recipe" about a dish the household may well cook every month.
  const familiarityFragment =
    day.main.familiarityKnown === undefined
      ? null
      : day.main.familiarityKnown
        ? 'Familiar recipe'
        : 'New recipe';

  return (
    <article
      aria-label={dayNameLabel(day.dayName)}
      className="flex w-full shrink-0 snap-start flex-col gap-8 px-6 py-10 md:gap-10 md:px-12 md:py-14 lg:px-20 lg:py-16"
    >
      <header className="space-y-2">
        <p className="text-[11px] uppercase tracking-[0.25em] text-fg-muted">
          {dayNameLabel(day.dayName)} · {day.dateLabel}
        </p>
        {day.mainGroupId !== '' ? (
          <MainGroupBadge
            groupId={day.mainGroupId}
            {...(day.mainGroupNote !== undefined
              ? { note: day.mainGroupNote }
              : {})}
          />
        ) : null}
        {/* Story 14-s4 — a paused day still shows its card (the parent may want
            to see what they parked), marked plainly rather than hidden. */}
        {/* Visible text only: an aria-label on a <p> is prohibited ARIA (role
            `paragraph` cannot be named) — and the data carries no pause reason
            to announce, so the marker claims none. */}
        {day.paused ? (
          <p className="inline-flex items-center gap-2 text-xs italic text-fg-muted">
            <PauseCircleIcon className="h-4 w-4 shrink-0" aria-hidden />
            Paused
          </p>
        ) : null}
      </header>

      <section className="space-y-3">
        <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-fg-muted">
          Main meal
        </p>
        <h3 className="font-serif text-3xl italic leading-tight text-fg md:text-4xl lg:text-5xl">
          {day.main.title}
        </h3>
        {/* Roster still loading or failed → no attribution line at all, never
            a dangling " · × 0" fragment. */}
        {kids.length > 0 ? (
          <p className="text-sm text-fg-muted md:text-base">
            {attribution} · × {String(kids.length)}
          </p>
        ) : null}
        <p className="text-xs text-fg-muted md:text-sm">
          {familiarityFragment !== null ? `${timeFragment} · ${familiarityFragment}` : timeFragment}
        </p>
      </section>

      {day.variations.length > 0 ? (
        <section className="space-y-3">
          <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-fg-muted">
            Per-child variations
          </p>
          <div className="flex flex-wrap gap-3 pb-1">
            {day.variations.map((v) => {
              const kid = childById.get(v.childId);
              if (kid === undefined) return null;
              return (
                <VariationChip key={v.childId} kid={kid} variation={v} />
              );
            })}
          </div>
        </section>
      ) : null}

      <div className="grid grid-cols-1 gap-10 md:grid-cols-12 md:gap-12">
        <section className="space-y-4 md:col-span-5">
          <h4 className="text-[10px] font-medium uppercase tracking-[0.25em] text-fg-muted">
            You&apos;ll need
          </h4>
          <ul className="space-y-2.5">
            {/* Index keys: legacy rows can repeat an ingredient line, and a
                duplicated string key breaks React reconciliation. */}
            {day.main.ingredients.map((ing, idx) => (
              <li key={idx} className="flex items-start gap-3 text-fg">
                <span
                  className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-warm"
                  aria-hidden
                />
                <span>{ing}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-3 md:col-span-7">
          <button
            type="button"
            onClick={() => {
              setMethodExpanded((v) => !v);
            }}
            className="flex w-full items-center justify-between gap-3 text-left transition-colors hover:text-lumi-terracotta-warmed"
          >
            <span className="text-[10px] font-medium uppercase tracking-[0.25em] text-fg-muted">
              How to make it
            </span>
            <span className="text-[11px] font-medium text-fg-muted">
              {methodExpanded ? 'Hide steps ▴' : 'Show steps ▾'}
            </span>
          </button>

          {methodExpanded ? (
            filteredMethod.length === 0 ? (
              <p className="rounded-md border border-dashed border-border p-4 text-sm italic text-fg-muted">
                {mode === 'prep'
                  ? 'Nothing to prep tonight — this one comes together at packing.'
                  : 'Already finished — nothing else to do at packing.'}
              </p>
            ) : (
              <ol className="space-y-4">
                {filteredMethod.map((step, i) => (
                  <li
                    key={`${String(i)}-${step.text.slice(0, 24)}`}
                    className="flex items-start gap-4"
                  >
                    {/* The honey scale is theme-flipped, so this pairing reads
                        in both modes. `bg-amber-warm/20` did not: an alpha
                        modifier on a hex-valued var token compiles to nothing. */}
                    <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-honey-amber-100 text-xs font-semibold text-honey-amber-800 md:h-7 md:w-7 md:text-sm">
                      {i + 1}
                    </span>
                    <span className="leading-relaxed text-fg">{step.text}</span>
                  </li>
                ))}
              </ol>
            )
          ) : null}
        </section>
      </div>

      <section className="space-y-3 border-t border-border pt-6 md:grid md:grid-cols-12 md:gap-12 md:space-y-0">
        <div className="md:col-span-5">
          <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-fg-muted">
            Snack
          </p>
          <p className="mt-2 font-serif text-lg italic text-fg md:text-xl">
            {day.snack.title}
          </p>
        </div>
        <div className="md:col-span-7">
          <ul className="space-y-1.5 text-sm text-fg-muted">
            {day.snack.ingredients.map((ing, idx) => (
              <li key={idx}>· {ing}</li>
            ))}
          </ul>
          {day.snack.perChildVariation !== undefined &&
          Object.keys(day.snack.perChildVariation).length > 0 ? (
            <ul className="space-y-1 pt-2 text-xs text-fg-muted">
              {Object.entries(day.snack.perChildVariation).map(
                ([cid, note]) => {
                  const kid = childById.get(cid);
                  if (kid === undefined) return null;
                  return (
                    <li key={cid}>
                      {kid.name}: {note}
                    </li>
                  );
                },
              )}
            </ul>
          ) : null}
        </div>
      </section>

      {day.optionalExtra !== undefined ? (
        <OptionalExtraBlock extra={day.optionalExtra} kids={kids} />
      ) : null}
    </article>
  );
}
