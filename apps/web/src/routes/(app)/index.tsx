import { useCallback, useRef, useState } from 'react';
import { useScope } from '@hivekitchen/ui';
import type { ChildResponse } from '@hivekitchen/types';
import { useRequireParentalNoticeAcknowledgment } from '@/hooks/useRequireParentalNoticeAcknowledgment.js';
import { useAuthStore } from '@/stores/auth.store.js';
import { useComplianceStore } from '@/stores/compliance.store.js';
import { AddChildForm } from '@/features/children/AddChildForm.js';
import { BagCompositionCard } from '@/features/children/BagCompositionCard.js';

export default function AppHomePage() {
  useScope('app-scope');
  const gate = useRequireParentalNoticeAcknowledgment();
  const householdId = useAuthStore((s) => s.user?.current_household_id ?? null);
  const [formOpen, setFormOpen] = useState(false);
  const [savedChildren, setSavedChildren] = useState<ChildResponse[]>([]);
  const [pendingBagChild, setPendingBagChild] = useState<ChildResponse | null>(null);
  const pendingBagChildRef = useRef<ChildResponse | null>(null);
  pendingBagChildRef.current = pendingBagChild;

  const handleAddChild = useCallback(() => {
    gate.requireAcknowledgment(() => setFormOpen(true));
  }, [gate]);

  const handleSuccess = useCallback((child: ChildResponse) => {
    setPendingBagChild(child);
    setFormOpen(false);
  }, []);

  const handleCancel = useCallback(() => setFormOpen(false), []);

  // Defensive re-trigger: if the API rejects a write because the user's
  // server-side acknowledgment is missing (stale client state), invalidate
  // the cached compliance state so the gate forces the dialog open instead
  // of trusting a stale 'acknowledged' value and silently looping.
  const handleParentalNoticeRequired = useCallback(() => {
    setFormOpen(false);
    useComplianceStore.getState().setAcknowledgmentState(null, null);
    gate.requireAcknowledgment(() => setFormOpen(true));
  }, [gate]);

  const handleBagSaved = useCallback((updatedChild: ChildResponse) => {
    setSavedChildren((prev) => [...prev, updatedChild]);
    setPendingBagChild(null);
  }, []);

  // Skip → keep the original child (with the DB default bag_composition) in
  // the saved list. Read via ref so the callback never captures a stale value.
  const handleBagSkip = useCallback(() => {
    const child = pendingBagChildRef.current;
    setSavedChildren((prev) => (child ? [...prev, child] : prev));
    setPendingBagChild(null);
  }, []);

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md flex flex-col items-center gap-6 text-center">
        <p className="font-serif text-lg text-stone-800">Brief stub</p>

        {savedChildren.length > 0 && (
          <ul className="w-full flex flex-col gap-2 text-left">
            {savedChildren.map((c) => (
              <li
                key={c.id}
                className="px-4 py-3 rounded-2xl bg-white border border-stone-200 font-sans text-base text-stone-800"
              >
                {c.name} · <span className="text-stone-500">{c.age_band}</span>
              </li>
            ))}
          </ul>
        )}

        {pendingBagChild !== null && (
          <BagCompositionCard
            childId={pendingBagChild.id}
            childName={pendingBagChild.name}
            onSaved={handleBagSaved}
            onSkip={handleBagSkip}
          />
        )}

        {!formOpen && pendingBagChild === null && householdId !== null && (
          <button
            type="button"
            onClick={handleAddChild}
            className="px-6 py-3 rounded-full bg-amber-600 text-white font-sans text-base hover:bg-amber-700 transition-colors motion-reduce:transition-none"
          >
            {savedChildren.length === 0 ? 'Add your first child' : 'Add another child'}
          </button>
        )}

        {formOpen && householdId !== null && (
          <AddChildForm
            householdId={householdId}
            onSuccess={handleSuccess}
            onCancel={handleCancel}
            onParentalNoticeRequired={handleParentalNoticeRequired}
          />
        )}
      </div>
      {gate.dialog}
    </main>
  );
}
