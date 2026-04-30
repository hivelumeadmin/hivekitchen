import { useCallback, useId, useState } from 'react';
import type { ChildResponse } from '@hivekitchen/types';
import { useSetBagComposition } from '@/hooks/useSetBagComposition.js';

interface BagCompositionCardProps {
  childId: string;
  childName: string;
  onSaved: (child: ChildResponse) => void;
  onSkip: () => void;
}

export function BagCompositionCard({
  childId,
  childName,
  onSaved,
  onSkip,
}: BagCompositionCardProps) {
  const headingId = useId();
  const snackId = useId();
  const extraId = useId();
  const [snack, setSnack] = useState(true);
  const [extra, setExtra] = useState(true);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { submit, pending } = useSetBagComposition();

  const handleSave = useCallback(async () => {
    setSubmitError(null);
    const outcome = await submit(childId, { snack, extra });
    if (outcome.ok) {
      onSaved(outcome.child);
    } else {
      setSubmitError(outcome.message);
    }
  }, [submit, childId, snack, extra, onSaved]);

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 max-w-md mx-auto p-6 rounded-2xl bg-white border border-stone-200 font-sans"
    >
      <h2 id={headingId} className="font-serif text-xl text-stone-800">
        How does {childName}&apos;s lunch bag look?
      </h2>
      <p className="text-sm text-stone-600">
        We&apos;ll plan around the slots you keep on. You can change this later.
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

      <div className="flex flex-row items-center justify-between mt-2">
        <button
          type="button"
          onClick={onSkip}
          disabled={pending}
          className="text-sm text-stone-600 hover:text-stone-800 underline-offset-2 hover:underline disabled:opacity-50"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="px-6 py-2 rounded-full bg-amber-600 text-white hover:bg-amber-700 transition-colors motion-reduce:transition-none disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </section>
  );
}
