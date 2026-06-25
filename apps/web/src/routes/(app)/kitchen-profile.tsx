import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useScope } from '@hivekitchen/ui';
import { ALLERGEN_LABELS } from '@hivekitchen/contracts';
import type {
  AllergenKey,
  ChildAllergenMutationResponse,
  EnforcementLevel,
  KitchenMap,
  KitchenMapAllergen,
  KitchenMapChild,
  KitchenMapCultural,
  KitchenMapFavoriteLunch,
  KitchenMapFoodPreference,
  LumiTurnResponse,
  SetFavoriteLunchesResponse,
  UpdateExtraRulesResponse,
} from '@hivekitchen/types';
import { hkFetch, HkApiError } from '@/lib/fetch.js';
import { useLumiContext } from '@/hooks/useLumiContext.js';
import { useAuthStore } from '@/stores/auth.store.js';
import { CalendarSummary } from '@/features/kitchen-profile/components/CalendarSummary.js';
import { ChildProfileCard } from '@/features/kitchen-profile/components/ChildProfileCard.js';
import { KitchenIdentityCard } from '@/features/kitchen-profile/components/KitchenIdentityCard.js';
import type { IdentityEditValue } from '@/features/kitchen-profile/components/IdentityEditConversation.js';
import { ProfileHeader } from '@/features/kitchen-profile/components/ProfileHeader.js';
import { SchoolsList } from '@/features/kitchen-profile/components/SchoolsList.js';
import { SectionEyebrow } from '@/features/kitchen-profile/components/SectionEyebrow.js';
import { StartingLineCard } from '@/features/kitchen-profile/components/StartingLineCard.js';
import type { StartingLine } from '@/features/kitchen-profile/data/mockData.js';

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
  const role = useAuthStore((s) => s.user?.role ?? null);
  const didLoad = useRef(false);

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [kitchenMap, setKitchenMap] = useState<KitchenMap | null>(null);
  // Story 7-S14 — deterministic safety-edit mutation state.
  const [allergenBusyChild, setAllergenBusyChild] = useState<string | null>(null);
  const [allergenErrors, setAllergenErrors] = useState<Record<string, string | null>>({});
  const [enforcementBusy, setEnforcementBusy] = useState(false);
  const [enforcementError, setEnforcementError] = useState<string | null>(null);
  // Story 3-S42 — per-child Snack & Extra preference (pins/bans) mutation state.
  const [extraRulesBusyChild, setExtraRulesBusyChild] = useState<string | null>(null);
  const [extraRulesErrors, setExtraRulesErrors] = useState<Record<string, string | null>>({});
  // Story 7-S15 — soft-edit conversation state. Only one section edits at a time.
  const [editingSection, setEditingSection] = useState<'identity' | 'starting-line' | null>(null);
  const [identityLumiResponse, setIdentityLumiResponse] = useState<string | null>(null);
  const [identityEditError, setIdentityEditError] = useState<string | null>(null);

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

  async function handleAddAllergen(childId: string, key: AllergenKey): Promise<void> {
    if (householdId === null) return;
    const prevMap = kitchenMap;
    setAllergenErrors((e) => ({ ...e, [childId]: null }));
    setAllergenBusyChild(childId);
    // Optimistic: add the human label before the POST completes.
    const label = ALLERGEN_LABELS[key];
    setKitchenMap((m) => {
      if (m === null) return m;
      const current = m.allergens.filter((a) => a.child_id === childId).map((a) => a.allergen);
      return reconcileChildAllergens(m, childId, [...current, label]);
    });
    try {
      const res = await hkFetch<ChildAllergenMutationResponse>(
        `/v1/children/${childId}/allergens`,
        { method: 'POST', body: { allergen: key } },
      );
      setKitchenMap((m) => (m === null ? m : reconcileChildAllergens(m, childId, res.allergens)));
    } catch {
      setKitchenMap(prevMap);
      setAllergenErrors((e) => ({ ...e, [childId]: 'Could not add that allergen. Please try again.' }));
    } finally {
      setAllergenBusyChild(null);
    }
  }

  async function handleRemoveAllergen(childId: string, allergenName: string): Promise<void> {
    if (householdId === null) return;
    const prevMap = kitchenMap;
    setAllergenErrors((e) => ({ ...e, [childId]: null }));
    setAllergenBusyChild(childId);
    // Optimistic: remove the item before the DELETE completes.
    setKitchenMap((m) => {
      if (m === null) return m;
      const current = m.allergens
        .filter((a) => a.child_id === childId && a.allergen !== allergenName)
        .map((a) => a.allergen);
      return reconcileChildAllergens(m, childId, current);
    });
    try {
      const res = await hkFetch<ChildAllergenMutationResponse>(
        `/v1/children/${childId}/allergens/${encodeURIComponent(allergenName)}`,
        { method: 'DELETE' },
      );
      setKitchenMap((m) => (m === null ? m : reconcileChildAllergens(m, childId, res.allergens)));
    } catch {
      setKitchenMap(prevMap);
      setAllergenErrors((e) => ({ ...e, [childId]: 'Could not remove that allergen. Please try again.' }));
    } finally {
      setAllergenBusyChild(null);
    }
  }

  // Story 3-S42 — deterministic per-child pins/bans. Optimistic local mutation,
  // server reconcile from the parsed response, revert on catch (mirrors
  // handleAddAllergen). Forward-only: affects next compose, not the current week.
  async function handleSetExtraRules(
    childId: string,
    next: { pins: string[]; bans: string[] },
  ): Promise<void> {
    if (householdId === null) return;
    const prevMap = kitchenMap;
    setExtraRulesErrors((e) => ({ ...e, [childId]: null }));
    setExtraRulesBusyChild(childId);
    setKitchenMap((m) => (m === null ? m : reconcileChildExtraRules(m, childId, next)));
    try {
      const res = await hkFetch<UpdateExtraRulesResponse>(
        `/v1/children/${childId}/extra-rules`,
        { method: 'PATCH', body: { pins: next.pins, bans: next.bans } },
      );
      setKitchenMap((m) =>
        m === null ? m : reconcileChildExtraRules(m, childId, res.extra_rules),
      );
    } catch {
      setKitchenMap(prevMap);
      setExtraRulesErrors((e) => ({
        ...e,
        [childId]: 'Could not save those preferences. Please try again.',
      }));
    } finally {
      setExtraRulesBusyChild(null);
    }
  }

  async function handleSetEnforcement(key: string, tier: UiEnforcement): Promise<void> {
    if (householdId === null) return;
    const prevMap = kitchenMap;
    const enforcement = UI_TIER_TO_ENFORCEMENT[tier];
    setEnforcementError(null);
    setEnforcementBusy(true);
    setKitchenMap((m) => (m === null ? m : applyCulturalEnforcement(m, key, enforcement)));
    try {
      await hkFetch(`/v1/households/${householdId}/cultural-priors/enforcement`, {
        method: 'PATCH',
        body: { key, enforcement },
      });
    } catch {
      setKitchenMap(prevMap);
      setEnforcementError('Could not update that rule. Please try again.');
    } finally {
      setEnforcementBusy(false);
    }
  }

  // Story 7-S15 (Arc A) — replace-semantics favorites edit. Optimistic update,
  // server reconcile, revert on failure (mirrors handleAddAllergen).
  async function handleFavoritesComposite(
    _composite: string,
    nextValue: StartingLine,
  ): Promise<void> {
    if (householdId === null) return;
    const prevMap = kitchenMap;
    setKitchenMap((m) =>
      m === null
        ? m
        : {
            ...m,
            favorite_lunches: nextValue.items.map((item, i) => ({
              item,
              provenance: 'parent_added' as const,
              position: i,
            })),
          },
    );
    try {
      const res = await hkFetch<SetFavoriteLunchesResponse>(
        `/v1/households/${householdId}/favorite-lunches`,
        { method: 'PUT', body: { items: nextValue.items } },
      );
      setKitchenMap((m) =>
        m === null
          ? m
          : {
              ...m,
              favorite_lunches: res.items.map((item, i) => ({
                item,
                provenance: 'parent_added' as const,
                position: i,
              })),
            },
      );
    } catch {
      setKitchenMap(prevMap);
    }
  }

  // Story 7-S15 (Arc B + Arc C) — identity composite. Cultural chip-state deltas
  // are deterministic opt_in/forget PATCHes; the shared-tastes [Message] prose,
  // when present, posts a Lumi turn that may call food_preference.declare. A
  // kitchen-map re-fetch at the end reconciles both.
  async function handleIdentityComposite(
    composite: string,
    nextValue: IdentityEditValue,
  ): Promise<void> {
    if (householdId === null) return;
    setIdentityEditError(null);

    const currentKeys = new Set(kitchenMap?.cultural.active.map((p) => p.key) ?? []);
    const nextKeys = new Set(nextValue.cultural.map((c) => c.key));
    const toAdd = [...nextKeys].filter((k) => !currentKeys.has(k));
    const toRemove = [...currentKeys].filter((k) => !nextKeys.has(k));

    const calls: Array<Promise<unknown>> = [
      ...toAdd.map((key) =>
        hkFetch(`/v1/households/${householdId}/cultural-priors/state`, {
          method: 'PATCH',
          body: { key, action: 'opt_in' },
        }),
      ),
      ...toRemove.map((key) =>
        hkFetch(`/v1/households/${householdId}/cultural-priors/state`, {
          method: 'PATCH',
          body: { key, action: 'forget' },
        }),
      ),
    ];
    if (calls.length > 0) {
      // Surface partial failures — the trailing kitchen-map re-fetch reconciles
      // the chips to true server state, but a silent revert would otherwise hide
      // that a change didn't take (spec OQ-3 / Review-note).
      const results = await Promise.allSettled(calls);
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) setIdentityEditError('Some identity changes could not be saved.');
    }

    // Shared-tastes prose → Lumi. Only when the composite carries a [Message]
    // section; chip-only edits skip the LLM round-trip entirely.
    if (composite.includes('\n[Message]\n')) {
      try {
        const lumiRes = await hkFetch<LumiTurnResponse>('/v1/lumi/turns', {
          method: 'POST',
          body: { message: composite, context_signal: { surface: 'kitchen-profile' } },
        });
        const body = lumiRes.lumi_turn.body;
        setIdentityLumiResponse(body.type === 'message' ? body.content : null);
      } catch {
        // Chip writes already applied — a Lumi failure is non-fatal here.
      }
    }

    // Reconcile: catches both the cultural state changes and any food_preferences
    // the Lumi tool wrote.
    try {
      const fresh = await hkFetch<KitchenMap>(`/v1/households/${householdId}/kitchen-map`, {
        method: 'GET',
      });
      setKitchenMap(fresh);
    } catch {
      // Keep optimistic/current local state on a refresh failure.
    }
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
            isEditing={editingSection === 'identity'}
            onRefine={() => {
              setIdentityLumiResponse(null);
              setIdentityEditError(null);
              setEditingSection('identity');
            }}
            onSendComposite={(c, next) => void handleIdentityComposite(c, next)}
            onDone={() => setEditingSection(null)}
            lumiResponse={identityLumiResponse}
            editError={identityEditError}
            onSetEnforcement={(key, tier) => void handleSetEnforcement(key, tier)}
            enforcementBusy={enforcementBusy}
            enforcementError={enforcementError}
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
                onAddAllergen={(key) => void handleAddAllergen(child.id, key)}
                onRemoveAllergen={(name) => void handleRemoveAllergen(child.id, name)}
                allergenBusy={allergenBusyChild === child.id}
                allergenError={allergenErrors[child.id] ?? null}
                extraRules={child.extra_rules}
                onSetExtraRules={
                  role === 'primary_parent'
                    ? (next) => void handleSetExtraRules(child.id, next)
                    : undefined
                }
                extraRulesBusy={extraRulesBusyChild === child.id}
                extraRulesError={extraRulesErrors[child.id] ?? null}
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
            isEditing={editingSection === 'starting-line'}
            onEdit={() => setEditingSection('starting-line')}
            onSendComposite={(c, next) => void handleFavoritesComposite(c, next)}
            onDone={() => setEditingSection(null)}
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

// Story 7-S14 — inverse of apiEnforcementToUi for the deterministic edit path.
// Locked mapping (OQ-2): always→strong, prefer→default, context→just_for_context.
// `non_negotiable` is never written from the 3-way UI selector.
const UI_TIER_TO_ENFORCEMENT: Record<UiEnforcement, EnforcementLevel> = {
  always: 'strong',
  prefer: 'default',
  context: 'just_for_context',
};

// Replace a single child's allergen rows with the authoritative list returned
// by the API, preserving every other child's rows. Used to reconcile after an
// optimistic add/remove.
function reconcileChildAllergens(
  map: KitchenMap,
  childId: string,
  allergens: readonly string[],
): KitchenMap {
  const others = map.allergens.filter((a) => a.child_id !== childId);
  const next: KitchenMapAllergen[] = allergens.map((allergen) => ({
    child_id: childId,
    allergen,
    source: 'parent_edited',
  }));
  return { ...map, allergens: [...others, ...next] };
}

// Story 3-S42 — replace one child's extra_rules projection ({ pinned, banned }),
// preserving every other child. Maps the PATCH-body shape ({ pins, bans }) onto
// the kitchen-map projection vocabulary.
function reconcileChildExtraRules(
  map: KitchenMap,
  childId: string,
  rules: { readonly pins: readonly string[]; readonly bans: readonly string[] },
): KitchenMap {
  return {
    ...map,
    children: map.children.map((c) =>
      c.id === childId
        ? { ...c, extra_rules: { pinned: [...rules.pins], banned: [...rules.bans] } }
        : c,
    ),
  };
}

// Optimistically set a cultural prior's enforcement (matched by key) across
// both the active and suggested arrays.
function applyCulturalEnforcement(
  map: KitchenMap,
  key: string,
  enforcement: EnforcementLevel,
): KitchenMap {
  const patch = <T extends { key: string; enforcement: EnforcementLevel }>(arr: readonly T[]) =>
    arr.map((p) => (p.key === key ? { ...p, enforcement } : p));
  return {
    ...map,
    cultural: {
      active: patch(map.cultural.active),
      suggested: patch(map.cultural.suggested),
    },
  };
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
      locked: p.enforcement === 'non_negotiable',
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
