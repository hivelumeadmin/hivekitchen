import type { ReactNode } from 'react';
import type { KitchenMap } from '@hivekitchen/types';

interface KitchenMapHeroProps {
  kitchenMap: KitchenMap | null;
  momentKey: string | null;
  mapPending: boolean;
  householdDisplayName: string | null;
}

const MOMENT_ORDER = [
  'pre_start',
  'm1_table',
  'm2_safe',
  'm3_taste',
  'm4_bag',
  'm5_starting_line',
  'summary',
  'finalized',
];

const AGE_BAND_LABEL: Record<string, string> = {
  toddler: 'Toddler',
  child: 'Child',
  preteen: 'Pre-teen',
  teen: 'Teen',
};

// Deterministic per-child accent so a child keeps the same avatar colour across
// re-renders and refetches. Index-based, not hash-based: the projection returns
// children in a stable order and an index is legible when debugging.
//
// The accent is the BORDER, not the fill. No single text colour clears AA on all
// four fills in both themes (honey-amber-300 needs dark text at 8.14:1 while
// lumi-terracotta's best dark option is 3.84:1 in dark theme). Ringing a neutral
// surface keeps the per-child hue and puts the initial on fg/surface-3, which
// measures 9.47:1 light and 11.42:1 dark.
const AVATAR_ACCENTS = [
  'border-foliage',
  'border-lumi-terracotta',
  'border-honey-amber-300',
  'border-amber',
];

// Keyed on the child's id, not their position: onboarding adds children
// incrementally, and an index would re-colour every sibling on any insert that
// is not an append.
function avatarAccent(childId: string): string {
  let hash = 0;
  for (const ch of childId) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return AVATAR_ACCENTS[hash % AVATAR_ACCENTS.length]!;
}

// charAt(0) indexes UTF-16 code UNITS, so a name starting outside the BMP
// (emoji, CJK Ext-B, Deseret…) yields a lone surrogate and renders U+FFFD.
// Iterating the string yields whole code points. Empty after trim → no initial.
function avatarInitial(name: string): string {
  return [...name.trim()][0]?.toUpperCase() ?? '';
}

// The hero binds to the authoritative KitchenMap projection (13-s5 Scope
// Decision 2) — no transcript heuristics. Rows and pills land as slots fill; a
// thin placeholder covers the gap between a turn and the refetch (Q2).
export function KitchenMapHero({
  kitchenMap,
  momentKey,
  mapPending,
  householdDisplayName,
}: KitchenMapHeroProps) {
  // `moment_key` is a free string on the wire, not an enum, so a server-side
  // rename would make indexOf return -1 and silently collapse EVERY gated
  // section. Treat an unrecognised key as fully advanced: showing a section
  // early is recoverable, showing an empty panel is not.
  const currentIndex = MOMENT_ORDER.indexOf(momentKey ?? 'pre_start');
  const reached = (key: string): boolean =>
    currentIndex === -1 || currentIndex >= MOMENT_ORDER.indexOf(key);

  const children = kitchenMap?.children ?? [];
  const kitchenName = kitchenMap?.household.display_name ?? householdDisplayName;

  // Allergens: household-wide rows + per-child rows, deduped by (child, allergen).
  // `household.declared_allergens` is a RESOLVED projection array (household_allergens
  // where child_id IS NULL) — not the dropped households column. See kitchen-map.repository.
  const householdAllergens = kitchenMap?.household.declared_allergens ?? [];
  const childNameById = new Map(children.map((c) => [c.id, c.name]));
  const seenAllergen = new Set<string>();
  const childAllergens: Array<{ childName: string | null; allergen: string }> = [];
  for (const a of kitchenMap?.allergens ?? []) {
    // Never surface a raw child_id — if the child isn't in the projection yet,
    // show the allergen without a name rather than a UUID. Never hide it.
    const childName = childNameById.get(a.child_id) ?? null;
    const dedupeKey = `${childName?.toLowerCase() ?? a.child_id}::${a.allergen.toLowerCase()}`;
    if (!seenAllergen.has(dedupeKey)) {
      seenAllergen.add(dedupeKey);
      childAllergens.push({ childName, allergen: a.allergen });
    }
  }
  for (const c of children) {
    for (const allergen of c.declared_allergens) {
      const dedupeKey = `${c.name.toLowerCase()}::${allergen.toLowerCase()}`;
      if (!seenAllergen.has(dedupeKey)) {
        seenAllergen.add(dedupeKey);
        childAllergens.push({ childName: c.name, allergen });
      }
    }
  }
  const hasAllergenData = householdAllergens.length > 0 || childAllergens.length > 0;

  // Tastes: liked food-preferences (attributed to the child who holds them) +
  // household dietary / cultural identity. child_id is on the wire and was
  // previously discarded — attribution is what makes the map feel personal.
  // Both sides build the SAME key shape (`scope::item`) — an earlier version
  // keyed household tags on the bare tag and prefs on `name::item`, so a
  // household tag and an unattributed pref with identical text both survived.
  // Scope is the child_id, not the name: two children may share a name (no
  // UNIQUE constraint), and keying on the name silently drops one's chip —
  // the allergen loop above already falls back to child_id for this reason.
  const likedPrefs = (kitchenMap?.food_preferences ?? [])
    .filter((p) => p.valence === 'loves' || p.valence === 'likes')
    .map((p) => {
      const childName = p.child_id !== null ? (childNameById.get(p.child_id) ?? null) : null;
      return { key: `${p.child_id ?? ''}::${p.item}`, childName, item: p.item };
    });
  const householdTasteTags = [
    ...(kitchenMap?.household.dietary_preferences ?? []),
    ...(kitchenMap?.household.cultural_identifiers ?? []),
  ].map((tag) => ({ key: `::${tag}`, childName: null, item: tag }));
  const seenTaste = new Set<string>();
  const tasteTags = [...householdTasteTags, ...likedPrefs].filter((t) => {
    const k = t.key.toLowerCase();
    if (seenTaste.has(k)) return false;
    seenTaste.add(k);
    return true;
  });

  // The map is the payoff: once the summary lands it breathes rather than sits.
  const recognised = reached('summary');

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 px-7 pb-4 pt-8">
        {/* AC3 removes the visible "Your kitchen" label, but the section's h3s
            still need an h2 above them or the document jumps h1 -> h3. Visually
            hidden keeps the mockup's look and the heading order both. */}
        <h2 className="sr-only">Your Kitchen Profile</h2>
        <p
          className="flex items-center gap-2 font-sans text-[11px] font-bold uppercase tracking-[0.04em] text-amber"
          role="status"
          aria-live="polite"
        >
          <span className="h-[7px] w-[7px] rounded-full bg-amber motion-safe:animate-[hk-breathe_2s_ease-in-out_infinite] motion-reduce:animate-none" />
          Building as we talk…
        </p>
      </div>

      <div className="flex flex-1 flex-col overflow-y-auto px-5 pb-6">
        <div
          data-testid="kitchen-map-panel"
          className={[
            'flex flex-col rounded-xl border border-border bg-surface p-[22px]',
            // Delayed past RecognitionEnding's 1.4s one-shot bloom so the two
            // amber glows hand off instead of firing together: the card
            // announces, then the map takes over and keeps breathing.
            recognised
              ? 'motion-safe:animate-[hk-map-glow_2.4s_ease-in-out_1.4s_infinite] motion-reduce:animate-none'
              : '',
          ].join(' ')}
        >
          {/* Kitchen name — the mockup leads with the name itself, no label */}
          {kitchenName !== null && kitchenName !== undefined ? (
            <p
              key="kitchen"
              className="animate-[hk-land_0.55s_ease-out] font-serif text-[26px] leading-tight text-fg motion-reduce:animate-none"
            >
              {kitchenName}
            </p>
          ) : (
            <Ghost label="Your kitchen…" pending={mapPending} />
          )}

          {/* Family */}
          {children.length > 0 ? (
            <Section key="family" title="Family">
              <div className="flex flex-col gap-2">
                {children.map((child) => (
                  <div
                    key={child.id}
                    className="flex animate-[hk-land_0.55s_ease-out] items-center gap-3 rounded-md bg-surface-2 px-[13px] py-[11px] motion-reduce:animate-none"
                  >
                    <span
                      aria-hidden="true"
                      className={[
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 bg-surface-3 font-sans text-sm font-semibold text-fg',
                        avatarAccent(child.id),
                      ].join(' ')}
                    >
                      {avatarInitial(child.name)}
                    </span>
                    <span className="min-w-0">
                      <span dir="auto" className="block truncate font-sans text-sm font-semibold text-fg">
                        {child.name}
                      </span>
                      {AGE_BAND_LABEL[child.age_band] !== undefined && (
                        <span className="block font-sans text-xs text-fg-muted">
                          {AGE_BAND_LABEL[child.age_band]}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          ) : reached('m1_table') ? (
            <Ghost label="Who's at the table…" pending={mapPending} />
          ) : null}

          {/* Keeping safe */}
          {reached('m2_safe') && (
            <Section
              key="safety"
              title="Keeping safe"
              testId="m2-safety-card"
              suffix={
                hasAllergenData ? (
                  <span className="font-sans text-[11px] font-semibold normal-case tracking-normal text-safety-cleared-800">
                    ✓ cleared on every plan
                  </span>
                ) : undefined
              }
            >
              {hasAllergenData ? (
                <div className="flex flex-col gap-2">
                  {householdAllergens.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {householdAllergens.map((a) => (
                        <SafetyPill key={a} label={a} />
                      ))}
                    </div>
                  )}
                  {childAllergens.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      {childAllergens.map(({ childName, allergen }) => (
                        <div
                          key={(childName ?? '') + allergen}
                          className="flex items-center gap-1.5"
                        >
                          {childName !== null && (
                            <span className="font-sans text-[10px] font-semibold text-fg-muted">
                              {childName}
                            </span>
                          )}
                          <SafetyPill label={allergen} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : reached('m3_taste') && !mapPending && kitchenMap !== null ? (
                // "All clear" is only safe to assert from a loaded projection — never
                // when the map never loaded (null household-id early in onboarding).
                <span className="inline-flex animate-[hk-land_0.55s_ease-out] items-center gap-1 rounded-full border border-safety-cleared-200 bg-safety-cleared-100 px-3 py-1 font-sans text-[13px] font-semibold text-safety-cleared-800 motion-reduce:animate-none">
                  ✓ All clear — no known allergens
                </span>
              ) : (
                <p className="font-sans text-xs italic text-fg-muted">Noting what to keep safe…</p>
              )}
            </Section>
          )}

          {/* How your kitchen tastes */}
          {tasteTags.length > 0 && (
            <Section key="taste" title="How your kitchen tastes" testId="taste-card">
              <div className="flex flex-wrap gap-1.5">
                {tasteTags.map(({ key, childName, item }) => (
                  <span
                    key={key}
                    dir="auto"
                    className="animate-[hk-land_0.55s_ease-out] rounded-full border border-border bg-surface-2 px-3 py-1 font-sans text-[13px] font-semibold text-fg motion-reduce:animate-none"
                  >
                    {childName !== null ? `${childName} · ${item}` : item}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {/* Lunches to start from — the M5 starting-line the parent declared */}
          {(kitchenMap?.favorite_lunches ?? []).length > 0 && (
            <Section key="lunches" title="Lunches to start from" testId="starting-lineup-card">
              <div className="flex flex-wrap gap-1.5">
                {(kitchenMap?.favorite_lunches ?? []).map((lunch) => (
                  <span
                    key={`${lunch.position}-${lunch.item}`}
                    className="animate-[hk-land_0.55s_ease-out] rounded-full border border-border bg-surface-2 px-3 py-1 font-sans text-[13px] font-semibold text-fg motion-reduce:animate-none"
                  >
                    {lunch.item}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {/* Deferred — Lumi learns the rest during the first week (no interview
              wall). The mockup reveals this only once the bag moment is reached. */}
          {reached('m3_taste') && (
            <Section key="bag" title="The bag &amp; your week">
              <p className="font-sans text-xs italic text-fg-muted">
                Lumi learns these as you cook the first week — no interview wall.
              </p>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

// A flat section on the panel: uppercase label, then content. Deliberately NOT a
// card — only child rows are cards, so the panel reads as one surface.
function Section({
  title,
  children,
  testId,
  suffix,
}: {
  title: string;
  children: ReactNode;
  testId?: string;
  suffix?: ReactNode;
}) {
  return (
    <div data-testid={testId} className="mt-[18px] animate-[hk-land_0.55s_ease-out] motion-reduce:animate-none">
      {/* The suffix is a sibling, not a child, of the heading: nesting it made
          the accessible name "Keeping safe ✓ cleared on every plan" and put
          that string in the screen-reader heading list. */}
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
        <h3 className="font-sans text-xs font-bold uppercase tracking-[0.08em] text-fg-muted">
          {title}
        </h3>
        {suffix}
      </div>
      {children}
    </div>
  );
}

function Ghost({ label, pending }: { label: string; pending: boolean }) {
  return (
    <div className="flex items-center gap-3.5">
      <span
        className={[
          'h-8 w-8 shrink-0 rounded-full bg-honey-amber-100',
          pending ? 'motion-safe:animate-pulse motion-reduce:animate-none' : '',
        ].join(' ')}
      />
      <div>
        <p className="font-sans text-sm font-medium text-fg">{label}</p>
        <p className="mt-0.5 font-sans text-[11px] text-fg-muted">Still listening…</p>
      </div>
    </div>
  );
}

function SafetyPill({ label }: { label: string }) {
  // Matches the AA-proven AllergyClearedBadge pairing (text-800 on fill-100).
  // Negated phrasing per the mockup: the pill states what is kept OUT. The
  // label keeps its canonical vocabulary casing — lower-casing it here would
  // mangle entries the allergen vocab capitalises deliberately.
  return (
    <span className="inline-flex animate-[hk-land_0.55s_ease-out] items-center gap-1 rounded-full border border-safety-cleared-200 bg-safety-cleared-100 px-3 py-1 font-sans text-[13px] font-semibold text-safety-cleared-800 motion-reduce:animate-none">
      ✓ No {label}
    </span>
  );
}
