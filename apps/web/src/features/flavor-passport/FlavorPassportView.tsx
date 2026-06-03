import { useState } from 'react';
import type { FlavorPassportStamp } from '@hivekitchen/types';
import { FlavorPassportStampCard } from './FlavorPassportStamp.js';

type SlotKind = 'main' | 'snack' | 'extra';

const SLOT_LABELS: Record<SlotKind, string> = {
  main: 'Mains',
  snack: 'Snacks',
  extra: 'Extras',
};

interface FlavorPassportViewProps {
  // Optional: the public child endpoint carries no name; the child route passes
  // it via router state, falling back to second-person copy when absent.
  childName?: string;
  state: 'empty' | 'developing' | 'established';
  stamps: FlavorPassportStamp[];
  availableFilters?: { cuisines: string[]; slot_kinds: SlotKind[] };
  scope: 'app' | 'child';
}

export function FlavorPassportView({
  childName,
  state,
  stamps,
  availableFilters,
  scope,
}: FlavorPassportViewProps) {
  const [activeCuisines, setActiveCuisines] = useState<string[]>([]);
  const [activeSlots, setActiveSlots] = useState<SlotKind[]>([]);

  const possessive = childName ? `${childName}'s` : 'Your';

  // Empty state renders ONLY the prose header — no grid, no placeholder cards,
  // no progress mechanic (UX-DR27 sparse-page doctrine).
  if (state === 'empty') {
    return (
      <main className="mx-auto w-full max-w-2xl flex-grow px-4 py-16 sm:px-6">
        <h1 className="font-serif text-2xl text-fg">Flavor passport</h1>
        <p className="mt-3 text-fg-muted">
          {possessive} taste is still forming. Lumi will notice and add it here.
        </p>
      </main>
    );
  }

  // Filter bar only in the established + app scope. Filtering is local UI state.
  const showFilters =
    scope === 'app' && state === 'established' && availableFilters !== undefined;

  const visibleStamps = stamps.filter(
    (s) =>
      (activeCuisines.length === 0 || s.cuisine_tags.some((c) => activeCuisines.includes(c))) &&
      (activeSlots.length === 0 || activeSlots.includes(s.slot_kind)),
  );
  const hasActiveFilters = activeCuisines.length > 0 || activeSlots.length > 0;

  const toggleCuisine = (cuisine: string) =>
    setActiveCuisines((prev) =>
      prev.includes(cuisine) ? prev.filter((c) => c !== cuisine) : [...prev, cuisine],
    );
  const toggleSlot = (slot: SlotKind) =>
    setActiveSlots((prev) =>
      prev.includes(slot) ? prev.filter((s) => s !== slot) : [...prev, slot],
    );
  const clearFilters = () => {
    setActiveCuisines([]);
    setActiveSlots([]);
  };

  return (
    <main className="mx-auto w-full max-w-2xl flex-grow px-4 py-16 sm:px-6">
      <header className="mb-8">
        <h1 className="font-serif text-2xl text-fg">{possessive} flavor passport</h1>
        <p className="mt-2 text-fg-muted">The dishes worth remembering, gathered over time.</p>
      </header>

      {showFilters && (
        <div className="mb-8 space-y-3">
          {availableFilters.cuisines.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {availableFilters.cuisines.map((cuisine) => {
                const active = activeCuisines.includes(cuisine);
                return (
                  <button
                    key={cuisine}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleCuisine(cuisine)}
                    className={`rounded-sm px-3 py-1 text-sm ${
                      active ? 'bg-amber text-fg' : 'bg-surface-2 text-fg-muted'
                    }`}
                  >
                    {cuisine}
                  </button>
                );
              })}
            </div>
          )}
          {availableFilters.slot_kinds.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {availableFilters.slot_kinds.map((slot) => {
                const active = activeSlots.includes(slot);
                return (
                  <button
                    key={slot}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleSlot(slot)}
                    className={`rounded-sm px-3 py-1 text-sm ${
                      active ? 'bg-amber text-fg' : 'bg-surface-2 text-fg-muted'
                    }`}
                  >
                    {SLOT_LABELS[slot]}
                  </button>
                );
              })}
            </div>
          )}
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-sm text-fg-muted underline"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {visibleStamps.length === 0 && hasActiveFilters ? (
        <p className="text-fg-muted">No dishes match these filters.</p>
      ) : scope === 'child' ? (
        <ol aria-label={`${possessive} flavor journey`} className="space-y-4">
          {visibleStamps.map((stamp) => (
            <FlavorPassportStampCard key={stamp.recipe_id} stamp={stamp} scope="child" />
          ))}
        </ol>
      ) : (
        <div className="space-y-4">
          {visibleStamps.map((stamp) => (
            <FlavorPassportStampCard key={stamp.recipe_id} stamp={stamp} scope="app" />
          ))}
        </div>
      )}
    </main>
  );
}
