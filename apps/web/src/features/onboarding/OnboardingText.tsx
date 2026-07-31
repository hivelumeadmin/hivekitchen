import { useEffect, useState } from 'react';
import { ConversationColumn } from './ConversationColumn.js';
import { KitchenMapHero } from './KitchenMapHero.js';
import { useOnboardingConversation, type OnboardingTextProps } from './onboarding-conversation.js';

/**
 * The onboarding conversation surface (13-s5): one calm conversation column
 * beside a wider Kitchen-Map hero that builds itself from the authoritative 2.7
 * projection. Onboarding is the deliberate conversational exception to the valet
 * doctrine (memory onboarding-ux-is-chat-not-form) — no ambient Lumi presence
 * mounts here; the flat onboarding route sits outside the (app) presence mount.
 */
export function OnboardingText(props: OnboardingTextProps = {}) {
  const c = useOnboardingConversation(props);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setProfileOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const hero = (
    <KitchenMapHero
      kitchenMap={c.kitchenMap}
      momentKey={c.currentMomentKey}
      mapPending={c.mapPending}
      householdDisplayName={c.householdDisplayName}
    />
  );

  return (
    <>
      <div className="flex h-full w-full overflow-hidden">
        <ConversationColumn
          turns={c.turns}
          pending={c.pending}
          isComplete={c.isComplete}
          currentMomentKey={c.currentMomentKey}
          chipConfig={c.chipConfig}
          chipSelections={c.chipSelections}
          draft={c.draft}
          error={c.error}
          finalizing={c.finalizing}
          requiredSetComplete={c.requiredSetComplete}
          missingRequiredSet={c.missingRequiredSet}
          kitchenMap={c.kitchenMap}
          coldStartMode={c.coldStartMode}
          coldStartDishCount={c.coldStartDishCount}
          isResume={c.isResume}
          onDraftChange={c.setDraft}
          onSubmit={c.handleSubmit}
          onToggleChip={c.toggleChip}
          onSkip={() => void c.submitTurn(['skip'], '')}
          onOverrideFewer={() => void c.submitTurn(['override_fewer'], '')}
          onFinalize={() => void c.handleFinalize()}
          onJumpToMoment={c.setCurrentMomentKey}
          onOpenProfile={() => setProfileOpen(true)}
        />

        {/* RIGHT: Kitchen Map hero — the showpiece, wider than the conversation */}
        <section
          className="relative hidden flex-col overflow-hidden bg-bg md:flex md:w-[55%]"
          aria-label="Your Kitchen Profile"
        >
          <div className="relative z-10 flex flex-1 flex-col overflow-hidden">{hero}</div>
        </section>
      </div>

      {/* Mobile: the hero as a slide-up drawer */}
      <div
        className={[
          'fixed inset-0 z-40 transition-opacity duration-300 md:hidden',
          profileOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        ].join(' ')}
      >
        <div
          className="absolute inset-0 bg-black/60"
          onClick={() => setProfileOpen(false)}
          aria-hidden="true"
        />
        <div
          role="dialog"
          aria-label="Your Kitchen Profile"
          aria-hidden={!profileOpen}
          inert={!profileOpen}
          className={[
            'absolute bottom-0 left-0 right-0 flex max-h-[85vh] flex-col overflow-hidden rounded-t-2xl bg-bg transition-transform duration-300 ease-out motion-reduce:transition-none',
            profileOpen ? 'translate-y-0' : 'translate-y-full',
          ].join(' ')}
        >
          <div className="flex shrink-0 justify-center pb-1 pt-3">
            <div className="h-1 w-10 rounded-full bg-border" />
          </div>
          <div className="flex shrink-0 justify-end px-5 pb-1">
            <button
              type="button"
              onClick={() => setProfileOpen(false)}
              aria-label="Close profile panel"
              className="font-sans text-xs text-fg-muted transition-colors hover:text-fg"
            >
              Close
            </button>
          </div>
          <div className="flex flex-1 flex-col overflow-hidden">{hero}</div>
        </div>
      </div>
    </>
  );
}
