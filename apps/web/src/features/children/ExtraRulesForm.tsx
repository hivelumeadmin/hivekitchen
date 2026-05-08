import { useId, useState } from 'react';
import type { ExtraRules } from '@hivekitchen/types';
import { useExtraRules } from '@/hooks/useExtraRules.js';

interface ExtraRulesFormProps {
  childId: string;
  childName: string;
  householdId: string;
  initialRules?: ExtraRules;
}

// Component types are plain-text labels the planner agent interprets when
// composing the Extra slot. Keep this list short and recognisable; parents
// can extend with custom library entries below.
const COMMON_COMPONENT_TYPES = [
  'fruit',
  'veggie',
  'grain',
  'protein',
  'dairy',
  'sweet treat',
] as const;

// Story 3.21 — Extra-slot pin/ban form + custom Extra library.
// Pins ensure a component type always appears, bans guarantee it never does;
// both are forward-only — they affect future plans, not the current week.
export function ExtraRulesForm({
  childId,
  childName,
  householdId,
  initialRules,
}: ExtraRulesFormProps) {
  const headingId = useId();
  const newItemNameId = useId();
  const newItemTypeId = useId();
  const newItemAllergenFreeId = useId();
  const [saveStatusMessage, setSaveStatusMessage] = useState<string | null>(null);
  const [addStatusMessage, setAddStatusMessage] = useState<string | null>(null);
  const [newItemName, setNewItemName] = useState('');
  const [newItemType, setNewItemType] = useState<string>(COMMON_COMPONENT_TYPES[0]);
  const [newItemAllergenFree, setNewItemAllergenFree] = useState(false);

  const {
    rules,
    setRules,
    libraryItems,
    loading,
    savePending,
    addPending,
    loadError,
    saveRules,
    addLibraryItem,
  } = useExtraRules({ childId, householdId, initialRules });

  function togglePin(componentType: string, on: boolean) {
    const next = on
      ? { ...rules, pins: rules.pins.includes(componentType) ? rules.pins : [...rules.pins, componentType] }
      : { ...rules, pins: rules.pins.filter((p) => p !== componentType) };
    setRules(next);
  }

  function toggleBan(componentType: string, on: boolean) {
    const next = on
      ? { ...rules, bans: rules.bans.includes(componentType) ? rules.bans : [...rules.bans, componentType] }
      : { ...rules, bans: rules.bans.filter((b) => b !== componentType) };
    setRules(next);
  }

  async function handleSave() {
    setSaveStatusMessage(null);
    const outcome = await saveRules(rules);
    setSaveStatusMessage(outcome.ok ? 'Saved. Lumi will use these for next week.' : outcome.message);
  }

  async function handleAddLibraryItem() {
    setAddStatusMessage(null);
    const trimmed = newItemName.trim();
    if (trimmed.length === 0) return;
    const outcome = await addLibraryItem({
      name: trimmed,
      component_type: newItemType,
      is_allergen_free: newItemAllergenFree,
    });
    if (outcome.ok) {
      setNewItemName('');
      setNewItemAllergenFree(false);
      setAddStatusMessage('Added to your Extra library.');
    } else {
      setAddStatusMessage(outcome.message);
    }
  }

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-6 max-w-md mx-auto p-6 rounded-2xl bg-white border border-stone-200 font-sans"
    >
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="font-serif text-xl text-stone-800">
          {childName}&apos;s Extra slot
        </h2>
        <p className="text-sm text-stone-600">
          Pin component types you&apos;d like Lumi to always include, ban the
          ones you never want, and save your own go-to Extras for reuse.
        </p>
      </div>

      {loadError !== null && (
        <p className="text-sm text-red-700" role="alert">
          {loadError}
        </p>
      )}

      <fieldset className="flex flex-col gap-3" disabled={savePending || addPending}>
        <legend className="text-sm font-medium text-stone-700">Pins — always include</legend>
        <ul className="flex flex-col gap-2">
          {COMMON_COMPONENT_TYPES.map((type) => {
            const isPinned = rules.pins.includes(type);
            return (
              <li
                key={`pin-${type}`}
                className="flex items-center justify-between px-4 py-2 rounded-2xl border border-stone-200"
              >
                <label htmlFor={`pin-${type}`} className="text-base text-stone-800 capitalize cursor-pointer">
                  {type}
                </label>
                <input
                  id={`pin-${type}`}
                  type="checkbox"
                  checked={isPinned}
                  onChange={(e) => togglePin(type, e.target.checked)}
                  className="h-5 w-5 accent-amber-600"
                />
              </li>
            );
          })}
        </ul>
      </fieldset>

      <fieldset className="flex flex-col gap-3" disabled={savePending || addPending}>
        <legend className="text-sm font-medium text-stone-700">Bans — never propose</legend>
        <ul className="flex flex-col gap-2">
          {COMMON_COMPONENT_TYPES.map((type) => {
            const isBanned = rules.bans.includes(type);
            return (
              <li
                key={`ban-${type}`}
                className="flex items-center justify-between px-4 py-2 rounded-2xl border border-stone-200"
              >
                <label htmlFor={`ban-${type}`} className="text-base text-stone-800 capitalize cursor-pointer">
                  {type}
                </label>
                <input
                  id={`ban-${type}`}
                  type="checkbox"
                  checked={isBanned}
                  onChange={(e) => toggleBan(type, e.target.checked)}
                  className="h-5 w-5 accent-amber-600"
                />
              </li>
            );
          })}
        </ul>
      </fieldset>

      <div className="flex flex-row items-center justify-end">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={savePending}
          className="px-6 py-2 rounded-full bg-amber-600 text-white hover:bg-amber-700 transition-colors motion-reduce:transition-none disabled:opacity-50"
        >
          {savePending ? 'Saving…' : 'Save rules'}
        </button>
      </div>

      {saveStatusMessage !== null && (
        <p className="text-sm text-stone-600" role="status">
          {saveStatusMessage}
        </p>
      )}

      <div className="flex flex-col gap-3 pt-4 border-t border-stone-100">
        <h3 className="font-serif text-base text-stone-800">Your Extra library</h3>
        {loading ? (
          <p className="text-sm text-stone-500" role="status">
            Loading library…
          </p>
        ) : libraryItems.length === 0 ? (
          <p className="text-sm text-stone-500">No saved items yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {libraryItems.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between px-4 py-2 rounded-2xl border border-stone-200"
              >
                <span className="text-base text-stone-800">{item.name}</span>
                <span className="text-xs text-stone-500 capitalize">{item.component_type}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-2 mt-2">
          <label htmlFor={newItemNameId} className="text-sm text-stone-700">
            Add a custom Extra
          </label>
          <input
            id={newItemNameId}
            type="text"
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            placeholder="e.g. homemade oat bar"
            disabled={addPending}
            className="px-4 py-2 rounded-full border border-stone-200 text-base disabled:opacity-50"
          />
          <label htmlFor={newItemTypeId} className="text-sm text-stone-700">
            Component type
          </label>
          <select
            id={newItemTypeId}
            value={newItemType}
            onChange={(e) => setNewItemType(e.target.value)}
            disabled={addPending}
            className="px-4 py-2 rounded-full border border-stone-200 text-base disabled:opacity-50"
          >
            {COMMON_COMPONENT_TYPES.map((type) => (
              <option key={type} value={type} className="capitalize">
                {type}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2 mt-1">
            <input
              id={newItemAllergenFreeId}
              type="checkbox"
              checked={newItemAllergenFree}
              onChange={(e) => setNewItemAllergenFree(e.target.checked)}
              disabled={addPending}
              className="h-4 w-4 accent-amber-600"
            />
            <label htmlFor={newItemAllergenFreeId} className="text-sm text-stone-700 cursor-pointer">
              Allergen-free
            </label>
          </div>
          <div className="flex flex-row items-center justify-end mt-1">
            <button
              type="button"
              onClick={() => void handleAddLibraryItem()}
              disabled={addPending || newItemName.trim().length === 0}
              className="px-5 py-2 rounded-full border border-amber-600 text-amber-700 hover:bg-amber-50 transition-colors motion-reduce:transition-none disabled:opacity-50"
            >
              Add to library
            </button>
          </div>
          {addStatusMessage !== null && (
            <p className="text-sm text-stone-600" role="status">
              {addStatusMessage}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
