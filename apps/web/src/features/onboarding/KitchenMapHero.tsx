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

// The hero binds to the authoritative KitchenMap projection (13-s5 Scope
// Decision 2) — no transcript heuristics. Cards and safety pills land as slots
// fill; a thin placeholder covers the gap between a turn and the refetch (Q2).
export function KitchenMapHero({
  kitchenMap,
  momentKey,
  mapPending,
  householdDisplayName,
}: KitchenMapHeroProps) {
  const reached = (key: string): boolean =>
    MOMENT_ORDER.indexOf(momentKey ?? 'pre_start') >= MOMENT_ORDER.indexOf(key);

  const children = kitchenMap?.children ?? [];
  const kitchenName = kitchenMap?.household.display_name ?? householdDisplayName;

  // Allergens: household-wide rows + per-child rows, deduped by (child, allergen).
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

  // Tastes: liked food-preferences + household dietary / cultural identity.
  const likedPrefs = (kitchenMap?.food_preferences ?? [])
    .filter((p) => p.valence === 'loves' || p.valence === 'likes')
    .map((p) => p.item);
  const tasteTags = [
    ...new Set([
      ...(kitchenMap?.household.dietary_preferences ?? []),
      ...(kitchenMap?.household.cultural_identifiers ?? []),
      ...likedPrefs,
    ]),
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 px-7 pb-5 pt-8">
        <h2 className="font-serif text-[22px] font-normal leading-tight text-fg">
          Your Kitchen Profile
        </h2>
        <p
          className="mt-2 flex items-center gap-1.5 font-sans text-[11px] text-amber"
          role="status"
          aria-live="polite"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-amber motion-safe:animate-pulse motion-reduce:animate-none" />
          Building as we talk…
        </p>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 pb-4">
        {/* Kitchen name */}
        {kitchenName !== null && kitchenName !== undefined ? (
          <Card key="kitchen">
            <h3 className="mb-1 font-serif text-base text-fg">Your kitchen</h3>
            <p className="font-sans text-base italic text-fg">{kitchenName}</p>
          </Card>
        ) : (
          <Ghost label="Your kitchen…" pending={mapPending} />
        )}

        {/* Family */}
        {children.length > 0 ? (
          <Card key="family">
            <h3 className="mb-3 font-serif text-base text-fg">Family</h3>
            <div className="flex flex-wrap gap-2">
              {children.map((child) => (
                <span
                  key={child.id}
                  className="animate-[hk-land_0.55s_ease-out] rounded-full bg-surface px-3 py-1.5 font-sans text-xs font-medium text-fg motion-reduce:animate-none"
                >
                  {child.name}
                  {AGE_BAND_LABEL[child.age_band] !== undefined
                    ? ` · ${AGE_BAND_LABEL[child.age_band]}`
                    : ''}
                </span>
              ))}
            </div>
          </Card>
        ) : reached('m1_table') ? (
          <Ghost label="Who's at the table…" pending={mapPending} />
        ) : null}

        {/* Keeping safe */}
        {reached('m2_safe') && (
          <Card key="safety" testId="m2-safety-card">
            <h3 className="mb-3 font-serif text-base text-fg">Keeping safe</h3>
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
                      <div key={(childName ?? '') + allergen} className="flex items-center gap-1.5">
                        {childName !== null && (
                          <span className="font-sans text-[10px] font-semibold text-fg-muted/60">
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
              <span className="inline-flex animate-[hk-land_0.55s_ease-out] items-center gap-1.5 rounded-md border border-safety-cleared-200 bg-safety-cleared-100 px-2.5 py-1 font-sans text-xs text-safety-cleared-800 motion-reduce:animate-none">
                ✓ All clear — no known allergens
              </span>
            ) : (
              <p className="font-sans text-xs italic text-fg-muted">Noting what to keep safe…</p>
            )}
          </Card>
        )}

        {/* How your kitchen tastes */}
        {tasteTags.length > 0 && (
          <Card key="taste" testId="taste-card">
            <h3 className="mb-3 font-serif text-base text-fg">How your kitchen tastes</h3>
            <div className="flex flex-wrap gap-1.5">
              {tasteTags.map((tag) => (
                <span
                  key={tag}
                  className="animate-[hk-land_0.55s_ease-out] rounded-md bg-surface px-2.5 py-1 font-sans text-xs text-fg motion-reduce:animate-none"
                >
                  {tag}
                </span>
              ))}
            </div>
          </Card>
        )}

        {/* Lunches to start from — the M5 starting-line the parent declared */}
        {(kitchenMap?.favorite_lunches ?? []).length > 0 && (
          <Card key="lunches" testId="starting-lineup-card">
            <h3 className="mb-3 font-serif text-base text-fg">Lunches to start from</h3>
            <div className="flex flex-wrap gap-1.5">
              {(kitchenMap?.favorite_lunches ?? []).map((lunch) => (
                <span
                  key={`${lunch.position}-${lunch.item}`}
                  className="animate-[hk-land_0.55s_ease-out] rounded-md bg-surface px-2.5 py-1 font-sans text-xs text-fg motion-reduce:animate-none"
                >
                  {lunch.item}
                </span>
              ))}
            </div>
          </Card>
        )}

        {/* Deferred — Lumi learns the rest during the first week (no interview wall) */}
        <div className="rounded-xl border border-dashed border-border/50 px-5 py-4">
          <h3 className="mb-1 font-serif text-base text-fg-muted">The bag &amp; your week</h3>
          <p className="font-sans text-xs italic text-fg-muted/70">
            Lumi learns these as you cook the first week — no interview wall.
          </p>
        </div>
      </div>
    </div>
  );
}

function Card({
  children,
  testId,
}: {
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className="animate-[hk-land_0.55s_ease-out] rounded-xl bg-surface-2 p-5 motion-reduce:animate-none"
    >
      {children}
    </div>
  );
}

function Ghost({ label, pending }: { label: string; pending: boolean }) {
  return (
    <div className="flex items-center gap-3.5 rounded-xl bg-surface p-4">
      <span
        className={[
          'h-8 w-8 shrink-0 rounded-full bg-amber/10',
          pending ? 'motion-safe:animate-pulse motion-reduce:animate-none' : '',
        ].join(' ')}
      />
      <div>
        <p className="font-sans text-sm font-medium text-fg/55">{label}</p>
        <p className="mt-0.5 font-sans text-[11px] text-fg-muted/40">Still listening…</p>
      </div>
    </div>
  );
}

function SafetyPill({ label }: { label: string }) {
  // Matches the AA-proven AllergyClearedBadge pairing (text-800 on fill-100).
  return (
    <span className="inline-flex animate-[hk-land_0.55s_ease-out] items-center gap-1 rounded-md border border-safety-cleared-200 bg-safety-cleared-100 px-2.5 py-1 font-sans text-xs font-medium text-safety-cleared-800 motion-reduce:animate-none">
      {label}
    </span>
  );
}
