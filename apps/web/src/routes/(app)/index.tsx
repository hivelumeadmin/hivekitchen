import { useScope } from '@hivekitchen/ui';
import { useRequireParentalNoticeAcknowledgment } from '@/hooks/useRequireParentalNoticeAcknowledgment.js';

export default function AppHomePage() {
  useScope('app-scope');
  const gate = useRequireParentalNoticeAcknowledgment();

  // Stub "Add your first child" affordance — Story 2.10 ships the real form.
  // The gating hook ensures the parental-notice dialog opens before the
  // intent fires when acknowledgment is missing.
  const handleAddChild = () => {
    gate.requireAcknowledgment(() => {
      // Placeholder — Story 2.10 will navigate to the add-child route here.
      // Until then, log the intent so the gate flow is observable in dev.
      // eslint-disable-next-line no-console
      console.info('add-child intent fired (Story 2.10 stub)');
    });
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md flex flex-col items-center gap-6 text-center">
        <p className="font-serif text-lg text-stone-800">Brief stub</p>
        <button
          type="button"
          onClick={handleAddChild}
          className="px-6 py-3 rounded-full bg-amber-600 text-white font-sans text-base hover:bg-amber-700 transition-colors motion-reduce:transition-none"
        >
          Add your first child
        </button>
      </div>
      {gate.dialog}
    </main>
  );
}
