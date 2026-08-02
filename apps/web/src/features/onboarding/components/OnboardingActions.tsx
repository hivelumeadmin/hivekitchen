import { ArrowRightIcon, PrimaryButton } from '@hivekitchen/ui';
import { onboardingMock } from '../data/mockData.js';

interface Readonly_OnboardingActionsProps {
  readonly onBegin?: () => void;
  readonly onLookAround?: () => void;
  /** Override the primary CTA label. Default: mock copy "Begin the kitchen interview". */
  readonly primaryLabel?: string;
  /** Override the secondary link label. Default: mock copy "I'd like to look
   *  around first". Pass `null` to hide the secondary link entirely. */
  readonly secondaryLabel?: string | null;
  /** Override the privacy reassurance line. Default: mock copy. */
  readonly privacyLine?: string;
  /** Override the step indicator (dots + label). Pass `null` to hide entirely. */
  readonly stepIndicator?:
    | {
        readonly dots: readonly ('active' | 'inactive')[];
        readonly label: string;
      }
    | null;
}

export type OnboardingActionsProps = Readonly<Readonly_OnboardingActionsProps>;

export function OnboardingActions({
  onBegin,
  onLookAround,
  primaryLabel,
  secondaryLabel,
  privacyLine,
  stepIndicator,
}: OnboardingActionsProps) {
  const m = onboardingMock;
  const step = stepIndicator === undefined ? m.stepIndicator : stepIndicator;
  return (
    <section className="space-y-12 px-8 pb-16 text-center">
      <p className="font-serif text-lg italic text-fg-muted">
        {privacyLine ?? m.privacyReassurance}
      </p>
      <div className="flex flex-col items-center gap-8">
        {step ? <StepIndicator dots={step.dots} label={step.label} /> : null}
        <div className="flex flex-col items-center gap-6">
          <PrimaryButton size="lg" icon={<ArrowRightIcon />} onClick={onBegin}>
            {primaryLabel ?? m.primaryCta}
          </PrimaryButton>
          {secondaryLabel !== null && (
            <button
              type="button"
              onClick={onLookAround}
              className="text-sm text-fg-muted underline decoration-border underline-offset-8 transition-colors hover:text-amber-warm hover:decoration-amber-warm"
            >
              {secondaryLabel ?? m.secondaryCta}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function StepIndicator({
  dots,
  label,
}: Readonly<{
  readonly dots: readonly ('active' | 'inactive')[];
  readonly label: string;
}>) {
  return (
    <div className="flex items-center gap-4 text-xs uppercase tracking-widest text-fg-muted">
      {dots.map((state, i) => (
        <span key={i} className={state === 'active' ? 'text-amber-warm' : ''}>
          {state === 'active' ? '●' : '○'}
        </span>
      ))}
      <span className="ms-2">{label}</span>
    </div>
  );
}
