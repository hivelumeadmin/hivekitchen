import type { BriefStateRow } from '@hivekitchen/types';
import { StarIcon, ShieldCheckIcon, LeafIcon } from '@/components/icons.js';

interface BriefWhyPanelProps {
  brief: BriefStateRow | null | undefined;
}

interface WhyReason {
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly text: string;
}

function buildReasons(brief: BriefStateRow): readonly WhyReason[] {
  const reasons: WhyReason[] = [];

  // Memory / personalisation reason
  if (brief.memory_prose !== '') {
    reasons.push({
      icon: <StarIcon className="h-5 w-5 text-amber-warm" />,
      label: 'Personalised',
      text: brief.memory_prose,
    });
  }

  // Safety / allergen clearance reason
  // Story 3-DM-D1 — cleared_allergies now lives under brief.payload.
  const clearedAllergies = brief.payload?.cleared_allergies ?? [];
  if (clearedAllergies.length > 0) {
    const uniqueAllergens = [...new Set(clearedAllergies.map((e) => e.allergen))];
    const allergenList = uniqueAllergens.slice(0, 3).join(', ');
    const overflow = uniqueAllergens.length > 3 ? ` +${uniqueAllergens.length - 3} more` : '';
    reasons.push({
      icon: <ShieldCheckIcon className="h-5 w-5 text-safety-cleared" />,
      label: 'Safety verified',
      text: `Checked and cleared: ${allergenList}${overflow}.`,
    });
  }

  // Balanced / nutrition reason — always shown as a default third pillar
  reasons.push({
    icon: <LeafIcon className="h-5 w-5 text-sacred" />,
    label: 'Balanced',
    text: 'Lumi has balanced variety, nutrition, and family preferences across the week.',
  });

  return reasons.slice(0, 3);
}

export function BriefWhyPanel({ brief }: BriefWhyPanelProps) {
  if (brief == null) return null;

  const reasons = buildReasons(brief);

  return (
    <section
      aria-label="Why this week"
      className="bg-surface-2 border border-border rounded-xl p-10 mb-8"
    >
      <p className="font-sans text-xs uppercase tracking-[0.2em] text-fg-muted mb-8">
        Why This Week
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
        {reasons.map((reason) => (
          <div key={reason.label} className="flex items-start gap-4">
            <span className="shrink-0 mt-0.5">{reason.icon}</span>
            <p className="font-sans text-sm leading-relaxed text-fg">
              {reason.text}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
