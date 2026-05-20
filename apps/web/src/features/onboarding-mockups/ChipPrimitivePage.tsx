import { useState } from 'react';
import { TextOnboardingTurnResponseSchema } from '@hivekitchen/contracts';
import { PrimaryButton } from '../../components/PrimaryButton.js';
import { SendIcon } from '../../components/icons.js';
import { StickyBottomBar } from '../../components/StickyBottomBar.js';
import { hkFetch, HkApiError } from '@/lib/fetch.js';
import { ChoiceChip } from '@/features/onboarding/components/ChoiceChip.js';
import { ChoiceChipGroup, type ChipOption } from '@/features/onboarding/components/ChoiceChipGroup.js';
import { FreetypeInput } from '@/features/onboarding/components/FreetypeInput.js';
import { MomentProgress } from '@/features/onboarding/components/MomentProgress.js';
import { SkipChip } from '@/features/onboarding/components/SkipChip.js';

const ageBandOptions: ChipOption[] = [
  { key: '0-3', label: '0–3' },
  { key: '4-6', label: '4–6' },
  { key: '7-9', label: '7–9' },
  { key: '10-12', label: '10–12' },
  { key: '13+', label: '13+' },
];

const identityOptions: ChipOption[] = [
  { key: 'halal', label: 'Halal' },
  { key: 'kosher', label: 'Kosher' },
  { key: 'hindu-vegetarian', label: 'Hindu vegetarian' },
  { key: 'jain', label: 'Jain' },
  { key: 'punjabi', label: 'Punjabi' },
  { key: 'gujarati', label: 'Gujarati' },
  { key: 'south-indian', label: 'South Indian' },
  { key: 'italian', label: 'Italian heritage' },
  { key: 'mexican', label: 'Mexican heritage' },
  { key: 'east-african', label: 'East African' },
  { key: 'caribbean', label: 'Caribbean' },
  { key: 'mediterranean', label: 'Mediterranean' },
];

const allergenOptions: ChipOption[] = [
  { key: 'none', label: 'No known allergens' },
  { key: 'peanut', label: 'Peanut' },
  { key: 'tree-nuts', label: 'Tree nuts' },
  { key: 'dairy', label: 'Dairy' },
  { key: 'eggs', label: 'Eggs' },
  { key: 'soy', label: 'Soy' },
  { key: 'wheat', label: 'Wheat' },
  { key: 'fish', label: 'Fish' },
  { key: 'shellfish', label: 'Shellfish' },
  { key: 'sesame', label: 'Sesame' },
];

export function ChipPrimitivePage() {
  const [ageBand, setAgeBand] = useState<string[]>(['7-9']);
  const [identity, setIdentity] = useState<string[]>(['punjabi', 'gujarati']);
  const [allergens, setAllergens] = useState<string[]>([]);
  const [freetext, setFreetext] = useState('');
  const [skipped, setSkipped] = useState(false);

  // Slice 2.5-s3 — Section E demo is the only place a real API call lives
  // inside a mockup. Proves the chip-turn body round-trips end-to-end.
  const [demoPending, setDemoPending] = useState(false);
  const [demoResponse, setDemoResponse] = useState<string | null>(null);
  const [demoError, setDemoError] = useState<string | null>(null);

  const moment2HasResponse = allergens.length > 0 || freetext.trim().length > 0;

  async function handleDemoSend() {
    if (demoPending || !moment2HasResponse) return;
    setDemoPending(true);
    setDemoError(null);
    setDemoResponse(null);
    try {
      const trimmed = freetext.trim();
      // When no allergens are selected (only freetext), fall back to a plain
      // text turn so we don't send chip_selections: [] which fails .min(1).
      const body: { chip_selections: string[]; text?: string } | { message: string } =
        allergens.length > 0
          ? trimmed.length > 0
            ? { chip_selections: allergens, text: trimmed }
            : { chip_selections: allergens }
          : { message: trimmed };
      const raw = await hkFetch<unknown>('/v1/onboarding/text/turn', {
        method: 'POST',
        body,
      });
      const parsed = TextOnboardingTurnResponseSchema.parse(raw);
      setDemoResponse(parsed.lumi_response);
    } catch (err) {
      setDemoError(
        err instanceof HkApiError
          ? `API error ${err.status}: ${err.message}`
          : 'Request failed.',
      );
    } finally {
      setDemoPending(false);
    }
  }

  return (
    <>
      <main className="mx-auto w-full max-w-4xl flex-grow px-6 py-16 pb-40">
        <header className="mb-16 border-b border-border/30 pb-10">
          <p className="font-sans text-xs uppercase tracking-[0.18em] text-memory-provenance-500">
            Epic 2.5 — Design Mockup · v2 retrofit
          </p>
          <h1 className="mt-3 font-serif text-4xl italic text-amber-warm">
            Choice-chip primitive
          </h1>
          <p className="mt-4 max-w-2xl font-sans text-base text-fg-muted">
            The visual language for chip-driven onboarding turns. Every chaptered moment inherits
            these states. Scroll through the state matrix and live groups, then see the assembly
            in <code className="rounded bg-warm-neutral-100 px-1.5 py-0.5 text-xs">StickyBottomBar</code> at
            the bottom — the canonical action-surface pattern from{' '}
            <code className="rounded bg-warm-neutral-100 px-1.5 py-0.5 text-xs">docs/DESIGN.md</code>{' '}
            §7.
          </p>
          <DoctrineNote />
        </header>

        {/* Section A — State matrix */}
        <Section eyebrow="Section A" title="ChoiceChip — state matrix">
          <p className="font-sans text-sm text-fg-muted">
            Five states × two modes. Selected uses the <strong>foliage channel</strong>{' '}
            (confirmation) — calmer than amber, on-doctrine with the Honey rule (honey-amber is
            never used for routine interactive state).
          </p>

          <div className="mt-8 space-y-8">
            <StateRow label="Default (unselected)">
              <ChoiceChip label="Halal" mode="multi" selected={false} onClick={() => {}} />
              <ChoiceChip label="Punjabi" mode="single" selected={false} onClick={() => {}} />
            </StateRow>

            <StateRow label="Selected">
              <ChoiceChip label="Halal" mode="multi" selected onClick={() => {}} />
              <ChoiceChip label="Punjabi" mode="single" selected onClick={() => {}} />
            </StateRow>

            <StateRow label="Disabled (unselected)">
              <ChoiceChip
                label="Halal"
                mode="multi"
                selected={false}
                disabled
                onClick={() => {}}
              />
              <ChoiceChip
                label="Punjabi"
                mode="single"
                selected={false}
                disabled
                onClick={() => {}}
              />
            </StateRow>

            <StateRow label="Disabled (selected)">
              <ChoiceChip label="Halal" mode="multi" selected disabled onClick={() => {}} />
              <ChoiceChip label="Punjabi" mode="single" selected disabled onClick={() => {}} />
            </StateRow>

            <StateRow label="Skip variant">
              <SkipChip label="Skip this moment" onClick={() => {}} />
            </StateRow>
          </div>
        </Section>

        {/* Section B — Live groups */}
        <Section eyebrow="Section B" title="ChoiceChipGroup — single & multi-select">
          <p className="font-sans text-sm text-fg-muted">
            Click the chips. State updates immediately. The bundled payload shown below is what
            the agent receives on Send (Section D assembly).
          </p>

          <div className="mt-8 space-y-10">
            <Field label="Single-select — age band">
              <ChoiceChipGroup
                options={ageBandOptions}
                selected={ageBand}
                onChange={setAgeBand}
                mode="single"
                ariaLabel="Age band"
              />
              <SelectionEcho selected={ageBand} />
            </Field>

            <Field label="Multi-select — cultural & religious identity">
              <ChoiceChipGroup
                options={identityOptions}
                selected={identity}
                onChange={setIdentity}
                mode="multi"
                ariaLabel="Cultural and religious identity"
              />
              <SelectionEcho selected={identity} />
            </Field>
          </div>
        </Section>

        {/* Section C — Skip chip in context */}
        <Section eyebrow="Section C" title="SkipChip — first-class opt-out">
          <p className="font-sans text-sm text-fg-muted">
            On good-to-have moments only. Dashed warm-neutral outline — distinct from selected
            ChoiceChips (filled foliage) so it never reads as a content choice. Sits below the
            chip group with whitespace separation.
          </p>

          <div className="mt-8 space-y-6">
            <ChoiceChipGroup
              options={identityOptions.slice(0, 6)}
              selected={identity}
              onChange={setIdentity}
              mode="multi"
              ariaLabel="Cultural identity example"
            />
            <div className="pt-4">
              <SkipChip
                onClick={() => setSkipped((s) => !s)}
                label={skipped ? 'Skipped — tap to undo' : 'Skip this moment'}
              />
              {skipped && (
                <p className="mt-2 font-sans text-xs italic text-fg-muted">
                  Skipped state simulated for the demo. In production, tap-Skip advances the
                  agent to the next moment and writes a placeholder for Kitchen Profile.
                </p>
              )}
            </div>
          </div>
        </Section>

        {/* Section D — Moment progress */}
        <Section eyebrow="Section D" title="MomentProgress — minimal text mark">
          <p className="font-sans text-sm text-fg-muted">
            Recedes by design. Uses{' '}
            <code className="rounded bg-warm-neutral-100 px-1.5 py-0.5 text-xs">
              memory-provenance-500
            </code>{' '}
            color and tight tracking. No progress bar — that reads SaaS-onboarding-y. Just words.
          </p>

          <div className="mt-8 flex flex-col gap-3">
            <MomentProgress current={1} total={5} />
            <MomentProgress current={2} total={5} />
            <MomentProgress current={3} total={5} />
            <MomentProgress current={4} total={5} />
            <MomentProgress current={5} total={5} />
          </div>
        </Section>

        {/* Section E — Full assembly */}
        <Section
          eyebrow="Section E — Assembly preview"
          title="Moment 2 — What I need to keep safe"
          emphasis
        >
          <p className="font-sans text-sm text-fg-muted">
            Required moment (no Skip chip). All primitives composed together with the canonical
            action surface: <code className="rounded bg-warm-neutral-100 px-1.5 py-0.5 text-xs">
              {'<StickyBottomBar>'}
            </code>{' '}
            at viewport bottom holding{' '}
            <code className="rounded bg-warm-neutral-100 px-1.5 py-0.5 text-xs">
              {'<PrimaryButton>'}
            </code>{' '}
            with a leading icon. Try selecting an allergen — Send activates. Leave blank — Send
            disabled, hint surfaces below the chips.
          </p>

          <div className="mt-8 rounded-lg bg-surface p-10">
            <MomentProgress current={2} total={5} />

            <h2 className="mt-6 font-serif text-3xl italic leading-tight text-fg">
              What I need to keep safe.
            </h2>
            <p className="mt-4 max-w-xl font-sans text-base leading-relaxed text-fg-muted">
              Any food allergies or sensitivities I should know about? Tap any that apply, or
              type your own — and let me know if there&rsquo;s nothing.
            </p>

            <div className="mt-8 space-y-6">
              <ChoiceChipGroup
                options={allergenOptions}
                selected={allergens}
                onChange={setAllergens}
                mode="multi"
                ariaLabel="Allergens"
              />

              <FreetypeInput
                value={freetext}
                onChange={setFreetext}
                placeholder="Or type your own — e.g., poppy seed, kiwi…"
              />

              {!moment2HasResponse && (
                <p className="font-sans text-xs italic text-fg-muted">
                  Tap one to continue, type your own, or pick &ldquo;No known allergens&rdquo;.
                </p>
              )}
            </div>

            {/* Slice 2.5-s3 — live response from /v1/onboarding/text/turn. */}
            {demoResponse !== null && (
              <div className="mt-8 rounded-md border border-foliage/40 bg-foliage-soft/40 p-4">
                <p className="font-sans text-[10px] uppercase tracking-[0.18em] text-memory-provenance-500">
                  Lumi replied
                </p>
                <p className="mt-2 font-serif text-base leading-relaxed text-fg">
                  {demoResponse}
                </p>
              </div>
            )}
            {demoError !== null && (
              <p className="mt-6 font-sans text-xs text-red-400" role="alert">
                {demoError}
              </p>
            )}
          </div>

          <aside className="mt-6 border-l-2 border-foliage/60 pl-5">
            <p className="font-sans text-xs text-fg-muted">
              <strong className="font-medium text-fg">Anti-narration discipline:</strong> the
              words &ldquo;Moment 2 of 5&rdquo; surface here for orientation, but the agent
              never narrates moments inside its prose. Chapters are scaffolding for the agent,
              not visible structure spoken by Lumi.
            </p>
          </aside>
        </Section>

        <footer className="mt-24 border-t border-border/30 pt-8">
          <p className="font-sans text-xs text-fg-muted">
            Mockup authored by Sally (UX) — 2026-05-19 (v2 retrofit). Per Epic 2.5 Sprint Change
            Proposal at{' '}
            <code className="rounded bg-warm-neutral-100 px-1.5 py-0.5">
              _bmad-output/planning-artifacts/sprint-change-proposal-2026-05-19.md
            </code>
            . Honors{' '}
            <code className="rounded bg-warm-neutral-100 px-1.5 py-0.5">docs/DESIGN.md</code>{' '}
            §1 Honey rule, §4 button taxonomy, §7 StickyBottomBar pattern.
          </p>
        </footer>
      </main>

      {/* Canonical action surface — wired to the Moment 2 assembly above */}
      <StickyBottomBar>
        <div className="flex w-full items-center justify-end">
          <PrimaryButton
            icon={<SendIcon />}
            disabled={!moment2HasResponse || demoPending}
            onClick={() => void handleDemoSend()}
            ariaLabel="Send turn"
          >
            {demoPending ? 'Sending…' : 'Send'}
          </PrimaryButton>
        </div>
      </StickyBottomBar>
    </>
  );
}

function DoctrineNote() {
  return (
    <aside className="mt-8 border-l-2 border-foliage/60 pl-5">
      <p className="font-sans text-xs uppercase tracking-wide text-foliage">
        v2 retrofit notes
      </p>
      <ul className="mt-3 list-inside list-disc space-y-1 font-sans text-xs text-fg-muted">
        <li>
          Selected chip uses <strong className="text-foliage">foliage</strong> (confirmation)
          channel — dropped honey-amber per DESIGN.md §1 Honey rule.
        </li>
        <li>
          Send action lives in <strong className="text-fg">StickyBottomBar</strong> at viewport
          bottom — matches Weekly Plan, Day Detail, Heart Note. Not in-flow.
        </li>
        <li>
          Send uses canonical <strong className="text-fg">PrimaryButton</strong> + SendIcon —
          no custom wrapper. Disabled hint moved inline near the chips where the parent&rsquo;s
          attention is.
        </li>
        <li>
          Skip chip uses dashed <strong className="text-fg">warm-neutral</strong> outline — so
          it never visually competes with foliage-selected chips.
        </li>
      </ul>
    </aside>
  );
}

function Section({
  eyebrow,
  title,
  children,
  emphasis,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <section className={`mb-20 ${emphasis ? 'rounded-xl bg-surface-2/30 p-8' : ''}`}>
      <p className="font-sans text-xs uppercase tracking-[0.18em] text-memory-provenance-500">
        {eyebrow}
      </p>
      <h2 className="mt-2 font-serif text-2xl italic text-fg">{title}</h2>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function StateRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[200px_1fr] md:items-center">
      <span className="font-sans text-xs uppercase tracking-wide text-fg-muted">{label}</span>
      <div className="flex flex-wrap gap-3">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-3 font-sans text-xs uppercase tracking-wide text-fg-muted">{label}</p>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function SelectionEcho({ selected }: { selected: string[] }) {
  return (
    <p className="font-sans text-xs italic text-memory-provenance-500">
      Selected payload:{' '}
      <code className="not-italic">
        {selected.length === 0 ? '[]' : `[${selected.map((s) => `"${s}"`).join(', ')}]`}
      </code>
    </p>
  );
}
