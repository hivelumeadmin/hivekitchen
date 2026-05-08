import { useCallback, useId, useState } from 'react';
import { useSetBagComposition } from '@/hooks/useSetBagComposition.js';

interface BagCompositionFormProps {
  childId: string;
  childName: string;
  initialSnack: boolean;
  initialExtra: boolean;
}

// Story 3.20 — settings-style edit form for per-child Lunch Bag composition.
// Distinct from BagCompositionCard (post-add-child onboarding card): this
// surface is reached after onboarding from the household-children settings
// area, pre-loads the current composition, and writes through the same
// PATCH /v1/children/:id/bag-composition endpoint introduced in Story 2.12.
// Changes are explicit-save: a confirmation message appears once the API
// acknowledges the write so the parent knows the next plan-generation cycle
// will pick up the new composition.
export function BagCompositionForm({
  childId,
  childName,
  initialSnack,
  initialExtra,
}: BagCompositionFormProps) {
  const headingId = useId();
  const snackId = useId();
  const extraId = useId();
  const [snack, setSnack] = useState(initialSnack);
  const [extra, setExtra] = useState(initialExtra);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { submit, pending } = useSetBagComposition();

  const handleSave = useCallback(async () => {
    setSubmitError(null);
    setSavedAt(null);
    const outcome = await submit(childId, { snack, extra });
    if (outcome.ok) {
      setSavedAt(new Date());
    } else {
      setSubmitError(outcome.message);
    }
  }, [submit, childId, snack, extra]);

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 max-w-md mx-auto p-6 rounded-2xl bg-white border border-stone-200 font-sans"
    >
      <h2 id={headingId} className="font-serif text-xl text-stone-800">
        {childName}&apos;s lunch bag
      </h2>
      <p className="text-sm text-stone-600">
        Choose which slots Lumi should plan for. Changes apply on the next
        weekly plan — your current week stays as it is.
      </p>

      <ul className="flex flex-col gap-3">
        <li className="flex items-center justify-between px-4 py-3 rounded-2xl bg-stone-50 border border-stone-200">
          <div className="flex flex-col">
            <span className="text-base text-stone-800">Main</span>
            <span className="text-xs text-stone-500">Always included</span>
          </div>
          <span className="px-3 py-1 rounded-full bg-stone-200 text-xs text-stone-600">
            Locked
          </span>
        </li>

        <li className="flex items-center justify-between px-4 py-3 rounded-2xl bg-white border border-stone-200">
          <label htmlFor={snackId} className="flex flex-col cursor-pointer">
            <span className="text-base text-stone-800">Snack</span>
            <span className="text-xs text-stone-500">A small mid-bag bite</span>
          </label>
          <input
            id={snackId}
            type="checkbox"
            checked={snack}
            disabled={pending}
            onChange={(e) => setSnack(e.target.checked)}
            className="h-5 w-5 accent-amber-600"
          />
        </li>

        <li className="flex items-center justify-between px-4 py-3 rounded-2xl bg-white border border-stone-200">
          <label htmlFor={extraId} className="flex flex-col cursor-pointer">
            <span className="text-base text-stone-800">Extra</span>
            <span className="text-xs text-stone-500">Treats, crackers, fruit on the side</span>
          </label>
          <input
            id={extraId}
            type="checkbox"
            checked={extra}
            disabled={pending}
            onChange={(e) => setExtra(e.target.checked)}
            className="h-5 w-5 accent-amber-600"
          />
        </li>
      </ul>

      {submitError !== null && (
        <p className="text-sm text-red-700" role="alert">
          {submitError}
        </p>
      )}

      {savedAt !== null && submitError === null && (
        <p className="text-sm text-stone-600" role="status">
          Saved. Lumi will use this composition for the next plan.
        </p>
      )}

      <div className="flex flex-row items-center justify-end mt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="px-6 py-2 rounded-full bg-amber-600 text-white hover:bg-amber-700 transition-colors motion-reduce:transition-none disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </section>
  );
}
