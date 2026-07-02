import { EditIcon, GlobeIcon, UtensilsIcon } from '../../../components/icons.js';
import type { EnforcedChip, Enforcement } from '../data/mockData.js';
import {
  IdentityEditConversation,
  type IdentityEditValue,
} from './IdentityEditConversation.js';

interface Readonly_KitchenIdentityCardProps {
  readonly quote: string;
  readonly cultural: readonly EnforcedChip[];
  readonly sharedTastes: string;
  readonly refineLabel: string;
  /** Suggested additions surfaced in edit mode. */
  readonly suggestedAdditions?: readonly EnforcedChip[];
  /** Read mode vs edit mode. Read mode shows the refine CTA; edit mode swaps
   * the body for the inline IdentityEditConversation. */
  readonly isEditing?: boolean;
  readonly onRefine?: () => void;
  /**
   * Fired on each Send during the edit conversation. The parent applies
   * `nextValue` to its identity state and persists the composite (in
   * production, by posting to the Lumi conversation thread API).
   */
  readonly onSendComposite?: (composite: string, nextValue: IdentityEditValue) => void;
  /** Close the edit panel (user clicked "I'm done with my edit"). */
  readonly onDone?: () => void;
  /**
   * Story 7-S14 — deterministic enforcement editing. When provided, each
   * cultural rule chip gains an inline tier selector (parent is editor of
   * record, no LLM). Omitting it keeps the chips read-only (dev mock route).
   */
  readonly onSetEnforcement?: (key: string, tier: Enforcement) => void;
  readonly enforcementBusy?: boolean;
  readonly enforcementError?: string | null;
  /**
   * Story 7-S15 — Lumi's confirmation reply after a shared-tastes edit. Shown
   * inside the edit panel (while refining) and below the pillars (read mode).
   * Cleared by the parent when the panel re-opens.
   */
  readonly lumiResponse?: string | null;
  /**
   * Story 7-S15 — inline error when one or more cultural chip-state writes
   * failed (partial failure must not be swallowed). Shown in the edit panel.
   */
  readonly editError?: string | null;
}

export type KitchenIdentityCardProps = Readonly<Readonly_KitchenIdentityCardProps>;

export function KitchenIdentityCard({
  quote,
  cultural,
  sharedTastes,
  refineLabel,
  suggestedAdditions = [],
  isEditing = false,
  onRefine,
  onSendComposite,
  onDone,
  onSetEnforcement,
  enforcementBusy = false,
  enforcementError = null,
  lumiResponse = null,
  editError = null,
}: KitchenIdentityCardProps) {
  if (isEditing) {
    return (
      <IdentityEditConversation
        initial={{ cultural, sharedTastes }}
        suggestedAdditions={suggestedAdditions}
        onSendComposite={(composite, next) =>
          onSendComposite?.(composite, next)
        }
        onDone={() => onDone?.()}
        lumiResponse={lumiResponse}
        editError={editError}
      />
    );
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-border/20 bg-surface p-8 md:p-12">
      <blockquote className="mb-10 font-serif text-2xl italic leading-relaxed text-sacred md:text-3xl">
        {quote}
      </blockquote>
      <div className="mb-8 grid grid-cols-1 gap-8 md:grid-cols-2">
        <CulturalPillar
          items={cultural}
          onSetEnforcement={onSetEnforcement}
          enforcementBusy={enforcementBusy}
          enforcementError={enforcementError}
        />
        <SharedTastesPillar body={sharedTastes} />
      </div>
      {lumiResponse !== null && lumiResponse.length > 0 && (
        <p className="mb-6 font-serif text-sm italic leading-relaxed text-amber-warm">
          {lumiResponse}
        </p>
      )}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onRefine}
          className="flex items-center gap-1 text-sm font-medium text-amber-warm hover:underline"
        >
          {refineLabel}
          <EditIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function CulturalPillar({
  items,
  onSetEnforcement,
  enforcementBusy = false,
  enforcementError = null,
}: Readonly<{
  readonly items: readonly EnforcedChip[];
  readonly onSetEnforcement?: (key: string, tier: Enforcement) => void;
  readonly enforcementBusy?: boolean;
  readonly enforcementError?: string | null;
}>) {
  const editable = onSetEnforcement !== undefined;
  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-amber-warm">
        <GlobeIcon className="h-5 w-5" />
        <h3 className="text-sm font-bold uppercase tracking-wider">
          Cultural &amp; religious
        </h3>
      </div>
      {items.length === 0 ? (
        <p className="text-sm italic text-fg-muted/70">Nothing locked in yet.</p>
      ) : editable ? (
        <div className="space-y-3">
          {items.map((c) => (
            <div key={c.key} className="flex flex-wrap items-center gap-2">
              <EnforcementChip chip={c} />
              {!c.locked && (
                <EnforcementSelector
                  value={c.enforcement}
                  disabled={enforcementBusy}
                  onChange={(tier) => onSetEnforcement!(c.key, tier)}
                />
              )}
            </div>
          ))}
          {enforcementError !== null && (
            <p role="alert" className="text-[12px] text-safety-red">
              {enforcementError}
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((c) => (
            <EnforcementChip key={c.key} chip={c} />
          ))}
        </div>
      )}
    </div>
  );
}

const ENFORCEMENT_TIERS: ReadonlyArray<{ tier: Enforcement; label: string }> = [
  { tier: 'always', label: 'Always' },
  { tier: 'prefer', label: 'Prefer' },
  { tier: 'context', label: 'Context' },
];

function EnforcementSelector({
  value,
  onChange,
  disabled = false,
}: Readonly<{
  readonly value: Enforcement;
  readonly onChange: (tier: Enforcement) => void;
  readonly disabled?: boolean;
}>) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-border/30">
      {ENFORCEMENT_TIERS.map(({ tier, label }) => (
        <button
          key={tier}
          type="button"
          disabled={disabled}
          aria-pressed={value === tier}
          onClick={() => onChange(tier)}
          className={[
            'px-2 py-0.5 font-sans text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            value === tier
              ? 'bg-amber text-bg'
              : 'bg-surface text-fg-muted hover:text-fg',
          ].join(' ')}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function SharedTastesPillar({ body }: Readonly<{ readonly body: string }>) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-amber-warm">
        <UtensilsIcon className="h-5 w-5" />
        <h3 className="text-sm font-bold uppercase tracking-wider">Shared tastes</h3>
      </div>
      <p className="text-sm leading-relaxed text-fg-muted">{body}</p>
    </div>
  );
}

/**
 * Mirrors the chip treatment used in Moment 6's Kitchen Profile panel.
 *
 *  always  → foliage-bordered, "· rule" tail. Hard rule the planner respects.
 *  prefer  → soft foliage fill. Lumi leans this way but isn't bound.
 *  context → muted italic. Background flavor / occasional cuisine.
 */
function EnforcementChip({ chip }: Readonly<{ readonly chip: EnforcedChip }>) {
  if (chip.enforcement === 'always') {
    return (
      <span className="flex items-center gap-1.5 rounded-md border-2 border-foliage bg-foliage-soft px-2.5 py-1 font-sans text-xs font-medium text-fg">
        {chip.label}
        <span className="text-[10px] uppercase tracking-wide text-foliage">· rule</span>
      </span>
    );
  }
  if (chip.enforcement === 'prefer') {
    return (
      <span className="rounded-md border border-foliage/60 bg-foliage-soft/50 px-2.5 py-1 font-sans text-xs text-fg">
        {chip.label}
      </span>
    );
  }
  return (
    <span className="rounded-md bg-warm-neutral-100/60 px-2.5 py-1 font-sans text-xs italic text-fg-muted">
      {chip.label}
    </span>
  );
}
