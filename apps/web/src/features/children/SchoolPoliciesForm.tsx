import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SlotScope } from '@hivekitchen/types';
import { useSchoolPolicies } from '@/hooks/useSchoolPolicies.js';

interface SchoolPoliciesFormProps {
  childId: string;
  childName: string;
}

// Common school policy presets. Free-text policies remain captured by the
// existing children.school_policy_notes column — this form only manages the
// canonical, plan-affecting rules.
const COMMON_POLICY_TYPES = [
  { type: 'nut_free', label: 'Nut-free', helper: "School-wide rule, no nuts in the bag" },
  { type: 'no_heating', label: 'No heating', helper: "Cold-only, no microwaves available" },
  { type: 'no_pork', label: 'No pork', helper: "Avoid all pork-based items" },
  { type: 'no_shellfish', label: 'No shellfish', helper: "Avoid all shellfish" },
  { type: 'vegetarian_only', label: 'Vegetarian only', helper: "No meat or fish" },
] as const;

// Story 3.16 — School-policy toggle list.
// Activation triggers regeneration of cleared future plans (FR22); the parent
// sees a quiet confirmation rather than a refresh prompt.
export function SchoolPoliciesForm({ childId, childName }: SchoolPoliciesFormProps) {
  const headingId = useId();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const { policies, loading, pending, loadError, update } = useSchoolPolicies(childId);

  const activeByType = useMemo(() => {
    const map = new Map<string, SlotScope>();
    for (const p of policies) {
      if (p.is_active) map.set(p.policy_type, p.slot_scope);
    }
    return map;
  }, [policies]);

  async function togglePolicy(policyType: string, isActive: boolean) {
    setStatusMessage(null);
    const outcome = await update({
      policy_type: policyType,
      slot_scope: 'bag_wide',
      is_active: isActive,
    });
    if (!outcome.ok) {
      setStatusMessage(outcome.message);
      return;
    }
    if (outcome.regenerationTriggered) {
      setStatusMessage('Saved. Updating future plans now.');
    } else {
      setStatusMessage('Saved.');
    }
  }

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 max-w-md mx-auto p-6 rounded-2xl bg-white border border-stone-200 font-sans"
    >
      <h2 id={headingId} className="font-serif text-xl text-stone-800">
        School food policies for {childName}
      </h2>
      <p className="text-sm text-stone-600">
        Tell us what {childName}&apos;s school requires. We&apos;ll quietly redo
        any upcoming plans so they fit.
      </p>

      {loading && (
        <p className="text-sm text-stone-500" role="status">
          Loading policies…
        </p>
      )}

      {loadError !== null && (
        <p className="text-sm text-red-700" role="alert">
          {loadError}
        </p>
      )}

      {!loading && loadError === null && (
        <ul className="flex flex-col gap-3">
          {COMMON_POLICY_TYPES.map(({ type, label, helper }) => {
            const isActive = activeByType.has(type);
            return (
              <li
                key={type}
                className="flex items-center justify-between px-4 py-3 rounded-2xl bg-white border border-stone-200"
              >
                <label htmlFor={`policy-${type}`} className="flex flex-col cursor-pointer gap-0.5">
                  <span className="text-base text-stone-800">{label}</span>
                  <span className="text-xs text-stone-500">{helper}</span>
                </label>
                <input
                  id={`policy-${type}`}
                  type="checkbox"
                  checked={isActive}
                  disabled={pending}
                  onChange={(e) => void togglePolicy(type, e.target.checked)}
                  className="h-5 w-5 accent-amber-600 disabled:opacity-50"
                />
              </li>
            );
          })}
        </ul>
      )}

      {statusMessage !== null && (
        <p className="text-sm text-stone-600" role="status">
          {statusMessage}
        </p>
      )}

      <div className="pt-2 border-t border-stone-100">
        <Link
          to={`/app/children/${childId}/bag-composition`}
          className="text-sm text-stone-500 hover:text-stone-700 underline underline-offset-2"
        >
          Edit {childName}&apos;s bag composition
        </Link>
      </div>
    </section>
  );
}
