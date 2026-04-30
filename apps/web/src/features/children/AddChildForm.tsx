import { useCallback, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { AddChildBodySchema } from '@hivekitchen/contracts';
import type { AgeBand, ChildResponse } from '@hivekitchen/types';
import { useAddChild } from '@/hooks/useAddChild.js';

interface AddChildFormProps {
  householdId: string;
  onSuccess: (child: ChildResponse) => void;
  onCancel: () => void;
  onParentalNoticeRequired: () => void;
}

const AGE_BANDS: ReadonlyArray<{ value: AgeBand; label: string }> = [
  { value: 'toddler', label: 'Toddler' },
  { value: 'child', label: 'Child' },
  { value: 'preteen', label: 'Pre-teen' },
  { value: 'teen', label: 'Teen' },
];

export function AddChildForm({
  householdId,
  onSuccess,
  onCancel,
  onParentalNoticeRequired,
}: AddChildFormProps) {
  const nameId = useId();
  const ageBandId = useId();
  const notesId = useId();
  const allergensId = useId();
  const culturalId = useId();
  const dietaryId = useId();

  const [name, setName] = useState('');
  const [ageBand, setAgeBand] = useState<AgeBand | ''>('');
  const [notes, setNotes] = useState('');
  const [declaredAllergens, setDeclaredAllergens] = useState<string[]>([]);
  const [culturalIdentifiers, setCulturalIdentifiers] = useState<string[]>([]);
  const [dietaryPreferences, setDietaryPreferences] = useState<string[]>([]);
  // Draft strings lifted to form level so handleSubmit can flush them synchronously
  // before schema validation, covering keyboard/AT submit paths where onBlur may not fire.
  const [allergenDraft, setAllergenDraft] = useState('');
  const [culturalDraft, setCulturalDraft] = useState('');
  const [dietaryDraft, setDietaryDraft] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { submit, pending } = useAddChild();

  const flushDraft = useCallback((draft: string, values: string[]): string[] => {
    const next = draft.trim();
    if (next.length === 0 || values.some((v) => v.toLowerCase() === next.toLowerCase())) return values;
    return [...values, next];
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSubmitError(null);
      setValidationError(null);
      // Flush pending draft text synchronously before schema validation —
      // covers keyboard/AT submit paths where onBlur may not fire.
      const finalAllergens = flushDraft(allergenDraft, declaredAllergens);
      const finalCultural = flushDraft(culturalDraft, culturalIdentifiers);
      const finalDietary = flushDraft(dietaryDraft, dietaryPreferences);
      const candidate = {
        name,
        age_band: ageBand,
        school_policy_notes: notes.trim().length === 0 ? undefined : notes,
        declared_allergens: finalAllergens,
        cultural_identifiers: finalCultural,
        dietary_preferences: finalDietary,
      };
      const result = AddChildBodySchema.safeParse(candidate);
      if (!result.success) {
        const first = result.error.issues[0];
        setValidationError(first?.message ?? 'Please check the form');
        return;
      }
      const outcome = await submit(householdId, result.data);
      if (outcome.status === 'ok') {
        onSuccess(outcome.child);
      } else if (outcome.status === 'parental_notice_required') {
        onParentalNoticeRequired();
      } else {
        setSubmitError(outcome.message);
      }
    },
    [
      name,
      ageBand,
      notes,
      allergenDraft,
      culturalDraft,
      dietaryDraft,
      declaredAllergens,
      culturalIdentifiers,
      dietaryPreferences,
      flushDraft,
      submit,
      householdId,
      onSuccess,
      onParentalNoticeRequired,
    ],
  );

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 max-w-xl mx-auto font-sans"
      aria-labelledby="add-child-heading"
    >
      <h2
        id="add-child-heading"
        className="font-serif text-xl text-stone-800"
      >
        Tell us about your child
      </h2>

      <label htmlFor={nameId} className="flex flex-col gap-1 text-sm text-stone-700">
        Name
        <input
          id={nameId}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          required
          className="px-4 py-2 rounded-2xl border border-stone-300 bg-white text-base"
        />
      </label>

      <label htmlFor={ageBandId} className="flex flex-col gap-1 text-sm text-stone-700">
        Age band
        <select
          id={ageBandId}
          value={ageBand}
          onChange={(e) => setAgeBand(e.target.value as AgeBand | '')}
          required
          className="px-4 py-2 rounded-2xl border border-stone-300 bg-white text-base"
        >
          <option value="" disabled>
            Choose an age band
          </option>
          {AGE_BANDS.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </select>
      </label>

      <TagChipInput
        id={allergensId}
        label="Declared allergens"
        helper="Press Enter or comma after each. These travel encrypted."
        values={declaredAllergens}
        onChange={setDeclaredAllergens}
        draft={allergenDraft}
        onDraftChange={setAllergenDraft}
        max={50}
      />

      <TagChipInput
        id={culturalId}
        label="Cultural identifiers"
        helper="What food traditions matter for this child?"
        values={culturalIdentifiers}
        onChange={setCulturalIdentifiers}
        draft={culturalDraft}
        onDraftChange={setCulturalDraft}
        max={20}
      />

      <TagChipInput
        id={dietaryId}
        label="Dietary preferences"
        helper="Vegetarian, halal, no pork — anything that should always apply."
        values={dietaryPreferences}
        onChange={setDietaryPreferences}
        draft={dietaryDraft}
        onDraftChange={setDietaryDraft}
        max={30}
      />

      <label htmlFor={notesId} className="flex flex-col gap-1 text-sm text-stone-700">
        School food-policy notes (optional)
        <textarea
          id={notesId}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={500}
          rows={3}
          className="px-4 py-2 rounded-2xl border border-stone-300 bg-white text-base"
        />
      </label>

      {validationError !== null && (
        <p className="text-sm text-red-700" role="alert">
          {validationError}
        </p>
      )}
      {submitError !== null && (
        <p className="text-sm text-red-700" role="alert">
          {submitError}
        </p>
      )}

      <div className="flex flex-row gap-3 justify-end mt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="px-5 py-2 rounded-full border border-stone-300 text-stone-700 hover:bg-stone-100 transition-colors motion-reduce:transition-none disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="px-6 py-2 rounded-full bg-amber-600 text-white hover:bg-amber-700 transition-colors motion-reduce:transition-none disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save child'}
        </button>
      </div>
    </form>
  );
}

interface TagChipInputProps {
  id: string;
  label: string;
  helper: string;
  values: string[];
  onChange: (next: string[]) => void;
  draft: string;
  onDraftChange: (draft: string) => void;
  max?: number;
}

function TagChipInput({ id, label, helper, values, onChange, draft, onDraftChange, max }: TagChipInputProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  const commitDraft = useCallback(() => {
    const next = draft.trim();
    if (next.length === 0) return;
    if (values.some((v) => v.toLowerCase() === next.toLowerCase())) {
      onDraftChange('');
      return;
    }
    if (max !== undefined && values.length >= max) return;
    onChange([...values, next]);
    onDraftChange('');
  }, [draft, values, onChange, onDraftChange, max]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        commitDraft();
        return;
      }
      if (e.key === 'Backspace' && draft.length === 0 && values.length > 0) {
        e.preventDefault();
        onChange(values.slice(0, -1));
      }
    },
    [commitDraft, draft, values, onChange],
  );

  const handleBlur = useCallback(
    (e: FocusEvent<HTMLInputElement>) => {
      if (wrapperRef.current?.contains(e.relatedTarget as Node | null)) return;
      commitDraft();
    },
    [commitDraft],
  );

  const handleRemove = useCallback(
    (target: string) => {
      onChange(values.filter((v) => v !== target));
    },
    [values, onChange],
  );

  return (
    <div className="flex flex-col gap-1 text-sm text-stone-700">
      <label htmlFor={id}>{label}</label>
      <div
        ref={wrapperRef}
        className="flex flex-wrap gap-2 px-2 py-2 rounded-2xl border border-stone-300 bg-white min-h-[44px]"
      >
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-stone-100 text-stone-700 text-sm"
          >
            {v}
            <button
              type="button"
              onClick={() => handleRemove(v)}
              aria-label={`Remove ${v}`}
              className="text-stone-500 hover:text-stone-800 motion-reduce:transition-none"
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          type="text"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          className="flex-1 min-w-[120px] bg-transparent outline-none text-base"
        />
      </div>
      <p className="text-xs text-stone-500">{helper}</p>
    </div>
  );
}
