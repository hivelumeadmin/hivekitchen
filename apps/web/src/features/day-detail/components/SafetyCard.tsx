import { CheckCircleIcon } from '../../../components/icons.js';
import { RailCard } from '../../../components/RailCard.js';
import type { SafetySection } from '../data/mockData.js';

interface Readonly_SafetyCardProps {
  readonly safety: SafetySection;
}

export type SafetyCardProps = Readonly<Readonly_SafetyCardProps>;

export function SafetyCard({ safety }: SafetyCardProps) {
  return (
    <RailCard accent="sacred" eyebrow={safety.schoolLabel}>
      <ul className="space-y-3">
        {safety.policies.map((policy) => (
          <li key={policy} className="flex items-center justify-between text-fg-muted">
            <span>{policy}</span>
            <CheckCircleIcon className="h-5 w-5 text-sacred" />
          </li>
        ))}
      </ul>
    </RailCard>
  );
}
