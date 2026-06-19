import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useScope } from '@hivekitchen/ui';
import type {
  KitchenMap,
  KitchenMapAllergen,
  KitchenMapChild,
  KitchenMapCultural,
  KitchenMapFavoriteLunch,
  KitchenMapFoodPreference,
} from '@hivekitchen/types';
import { hkFetch, HkApiError } from '@/lib/fetch.js';
import { useLumiContext } from '@/hooks/useLumiContext.js';
import { useAuthStore } from '@/stores/auth.store.js';
import { CalendarSummary } from '@/features/kitchen-profile/components/CalendarSummary.js';
import { ChildProfileCard } from '@/features/kitchen-profile/components/ChildProfileCard.js';
import { KitchenIdentityCard } from '@/features/kitchen-profile/components/KitchenIdentityCard.js';
import { ProfileHeader } from '@/features/kitchen-profile/components/ProfileHeader.js';
import { SchoolsList } from '@/features/kitchen-profile/components/SchoolsList.js';
import { SectionEyebrow } from '@/features/kitchen-profile/components/SectionEyebrow.js';
import { StartingLineCard } from '@/features/kitchen-profile/components/StartingLineCard.js';

type LoadState = 'loading' | 'ready' | 'error';

function noop() {
  /* read-only stub in s11 */
}

function logComposite(section: string, composite: string) {
  // eslint-disable-next-line no-console
  console.log(`[Kitchen Profile · ${section}] composite (read-only stub):\n` + composite);
}

export default function KitchenProfileRoute() {
  useScope('app-scope');
  useLumiContext({ surface: 'general' });

  const navigate = useNavigate();
  const accessToken = useAuthStore((s) => s.accessToken);
  const householdId = useAuthStore((s) => s.user?.current_household_id ?? null);
  const didLoad = useRef(false);

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [kitchenMap, setKitchenMap] = useState<KitchenMap | null>(null);

  useEffect(() => {
    if (!accessToken) {
      navigate('/auth/login?next=/app/kitchen-profile', { replace: true });
      return;
    }
    if (householdId === null || didLoad.current) return;
    didLoad.current = true;
    const controller = new AbortController();
    void (async () => {
      try {
        const map = await hkFetch<KitchenMap>(
          `/v1/households/${householdId}/kitchen-map`,
          { method: 'GET', signal: controller.signal },
        );
        setKitchenMap(map);
        setLoadState('ready');
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        if (err instanceof HkApiError && err.status === 401) {
          navigate('/auth/login?next=/app/kitchen-profile', { replace: true });
          return;
        }
        didLoad.current = false;
        setLoadState('error');
      }
    })();
    return () => {
      controller.abort();
      didLoad.current = false;
    };
  }, [accessToken, householdId, navigate]);

  if (loadState === 'loading') {
    return (
      <main className="mx-auto flex w-full max-w-7xl flex-grow items-center justify-center px-6 py-24">
        <p className="font-serif text-lg text-fg-muted">Loading your kitchen…</p>
      </main>
    );
  }

  if (loadState === 'error' || kitchenMap === null) {
    return (
      <main className="mx-auto flex w-full max-w-7xl flex-grow items-center justify-center px-6 py-24">
        <p role="alert" className="font-serif text-lg text-fg-muted">
          We couldn&apos;t load your kitchen profile. Please try again later.
        </p>
      </main>
    );
  }

  const culturalChips = mapCulturalToChips(kitchenMap.cultural);
  const identityQuote = synthesizeQuote(
    kitchenMap.cultural,
    kitchenMap.household.display_name,
  );
  const sharedTastes = synthesizeSharedTastes(kitchenMap.food_preferences);
  const startingLine = mapStartingLine(kitchenMap.favorite_lunches);

  return (
    <main className="mx-auto w-full max-w-4xl flex-grow px-4 py-16 sm:px-6 md:py-24">
        <ProfileHeader
          eyebrow="Visible Memory"
          headline="What Lumi knows about your kitchen."
          description="Lumi only suggests things that fit. If anything here is wrong, change it — Lumi listens."
        />

        <section className="mb-16 scroll-mt-24">
          <SectionEyebrow>Collective Kitchen Identity</SectionEyebrow>
          <KitchenIdentityCard
            quote={identityQuote}
            cultural={culturalChips}
            sharedTastes={sharedTastes}
            refineLabel="Refine collective identity"
            suggestedAdditions={[]}
            isEditing={false}
            onRefine={noop}
            onSendComposite={(c) => logComposite('Identity', c)}
            onDone={noop}
          />
        </section>

        <section className="mb-16 scroll-mt-24">
          <SectionEyebrow>Children</SectionEyebrow>
          <div className="space-y-8">
            {kitchenMap.children.map((child) => (
              <ChildProfileCard
                key={child.id}
                child={mapChild(child, kitchenMap.allergens, kitchenMap.food_preferences)}
                suggestedAllergens={[]}
                isEditing={false}
                onEdit={noop}
                onSendComposite={(c) => logComposite(`Child[${child.id}]`, c)}
                onDone={noop}
              />
            ))}
          </div>
        </section>

        <section className="mb-16 scroll-mt-24">
          <SectionEyebrow>Lumi&apos;s starting line</SectionEyebrow>
          <StartingLineCard
            description="The lunches you said you'd happily pack tomorrow. Lumi mixes it up from here."
            line={startingLine}
            suggestedAdditions={[]}
            isEditing={false}
            onEdit={noop}
            onSendComposite={(c) => logComposite('Starting line', c)}
            onDone={noop}
          />
        </section>

        <section className="mb-16 scroll-mt-24">
          <SectionEyebrow>Schools</SectionEyebrow>
          <SchoolsList
            schools={[]}
            addLabel="Add a school"
            isEditing={false}
            onEdit={noop}
            onSendComposite={(c) => logComposite('Schools', c)}
            onDone={noop}
          />
        </section>

        <section className="mb-16 scroll-mt-24">
          <SectionEyebrow>Calendar</SectionEyebrow>
          <CalendarSummary
            currentTerm={{ label: 'Current Term', value: '' }}
            upcomingTrip={{ label: 'Upcoming Trip', value: '' }}
            syncLabel="Sync Google Calendar"
            isEditing={false}
            onEdit={noop}
            onSendComposite={(c) => logComposite('Calendar', c)}
            onDone={noop}
          />
        </section>
    </main>
  );
}

// ─── Adapters: KitchenMap → component prop shapes ──────────────────────────

type UiEnforcement = 'always' | 'prefer' | 'context';

function apiEnforcementToUi(enforcement: string): UiEnforcement {
  if (enforcement === 'non_negotiable' || enforcement === 'strong') return 'always';
  if (enforcement === 'default') return 'prefer';
  return 'context';
}

function mapCulturalToChips(
  cultural: KitchenMapCultural,
): Array<{ key: string; label: string; enforcement: UiEnforcement }> {
  const seen = new Set<string>();
  return [...cultural.active, ...cultural.suggested]
    .filter((p) => {
      if (seen.has(p.key)) return false;
      seen.add(p.key);
      return true;
    })
    .map((p) => ({
      key: p.key,
      label: p.label,
      enforcement: apiEnforcementToUi(p.enforcement),
    }));
}

function synthesizeQuote(
  cultural: KitchenMapCultural,
  displayName: string | null,
): string {
  const hard = cultural.active.filter(
    (p) => p.enforcement === 'non_negotiable' || p.enforcement === 'strong',
  );
  const soft = cultural.active.filter(
    (p) => p.enforcement === 'default' || p.enforcement === 'soft',
  );
  if (hard.length === 0 && soft.length === 0) {
    return displayName !== null ? `${displayName}'s kitchen` : '';
  }
  const hardStr = hard.map((p) => p.label).join(', ');
  const softStr = soft.map((p) => p.label).join(', ');
  if (hardStr.length > 0 && softStr.length > 0) {
    return `"A ${hardStr} household with ${softStr} cooking."`;
  }
  return `"A ${hardStr.length > 0 ? hardStr : softStr} household."`;
}

function synthesizeSharedTastes(foodPrefs: readonly KitchenMapFoodPreference[]): string {
  const householdLoves = foodPrefs
    .filter((p) => p.child_id === null && (p.valence === 'loves' || p.valence === 'likes'))
    .map((p) => p.item);
  const householdAvoids = foodPrefs
    .filter((p) => p.child_id === null && (p.valence === 'dislikes' || p.valence === 'refuses'))
    .map((p) => p.item);
  if (householdLoves.length === 0 && householdAvoids.length === 0) return '';
  const parts: string[] = [];
  if (householdLoves.length > 0) parts.push(`Loves: ${householdLoves.join(', ')}`);
  if (householdAvoids.length > 0) parts.push(`Avoids: ${householdAvoids.join(', ')}`);
  return parts.join(' · ');
}

const BAG_COMPOSITION_LABELS: Record<string, string> = {
  main_only: 'Main only',
  main_plus_snack: 'Main + snack',
  main_plus_extra: 'Main + extra',
  main_plus_snack_plus_extra: 'Main + snack + extra',
};

function mapBagComposition(pattern: string | null): string | null {
  if (pattern === null) return null;
  return BAG_COMPOSITION_LABELS[pattern] ?? pattern;
}

function allergensByChild(
  allergens: readonly KitchenMapAllergen[],
  childId: string,
): Array<{ name: string; medical: boolean }> {
  return allergens
    .filter((a) => a.child_id === childId)
    .map((a) => ({ name: a.allergen, medical: true }));
}

function foodPrefsByChild(
  prefs: readonly KitchenMapFoodPreference[],
  childId: string,
): { loves: string; avoids: string } {
  const childPrefs = prefs.filter((p) => p.child_id === childId);
  const loves = childPrefs
    .filter((p) => p.valence === 'loves' || p.valence === 'likes')
    .map((p) => p.item)
    .join(', ');
  const avoids = childPrefs
    .filter((p) => p.valence === 'dislikes' || p.valence === 'refuses')
    .map((p) => p.item)
    .join(', ');
  return { loves, avoids };
}

const AGE_BAND_MIDPOINT: Record<string, number> = {
  toddler: 3,
  child: 7,
  preteen: 11,
  teen: 14,
};

function mapChild(
  child: KitchenMapChild,
  allergens: readonly KitchenMapAllergen[],
  prefs: readonly KitchenMapFoodPreference[],
): {
  initial: string;
  name: string;
  age: number;
  ageBand: string;
  schoolBadge: string;
  meta: readonly string[];
  allergens: ReadonlyArray<{ name: string; medical: boolean }>;
  bagComposition: string | null;
  loves: string;
  avoids: string;
  lumiQuote?: string;
} {
  const { loves, avoids } = foodPrefsByChild(prefs, child.id);
  return {
    initial: child.name[0]?.toUpperCase() ?? '?',
    name: child.name,
    age: AGE_BAND_MIDPOINT[child.age_band] ?? 0,
    ageBand: child.age_band,
    schoolBadge:
      child.school_policies.length > 0 ? child.school_policies.join(' · ') : '',
    meta: [],
    allergens: allergensByChild(allergens, child.id),
    bagComposition: mapBagComposition(child.bag_composition_pattern),
    loves: loves.length > 0 ? loves : 'Not yet captured',
    avoids: avoids.length > 0 ? avoids : 'Not yet captured',
  };
}

function mapStartingLine(
  lunches: readonly KitchenMapFavoriteLunch[],
): { count: number; target: number; items: string[] } {
  return {
    count: lunches.length,
    target: 10,
    items: lunches.map((l) => l.item),
  };
}

// Exported only for unit tests. The page itself uses them as locals.
export const __test__ = {
  apiEnforcementToUi,
  mapCulturalToChips,
  synthesizeQuote,
  synthesizeSharedTastes,
  mapBagComposition,
  allergensByChild,
  foodPrefsByChild,
  mapChild,
  mapStartingLine,
};
