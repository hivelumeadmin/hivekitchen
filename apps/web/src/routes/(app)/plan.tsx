import { useEffect } from 'react';
import { useRequireParentalNoticeAcknowledgment } from '@/hooks/useRequireParentalNoticeAcknowledgment.js';
import { PlanPage as PlanFeaturePage } from '@/features/plan/PlanPage.js';

// Story 3.14 — /app/plan host. Mirrors the parental-notice gate from /app
// so the upcoming-week tab is never reachable for households that haven't
// acknowledged the AADC notice (Story 2.9).
export default function PlanRoute() {
  const gate = useRequireParentalNoticeAcknowledgment();

  useEffect(() => {
    if (gate.state === 'required') {
      gate.requireAcknowledgment(() => {});
    }
  }, [gate.state, gate.requireAcknowledgment]);

  if (gate.state !== 'acknowledged') {
    return <>{gate.dialog}</>;
  }

  return (
    <>
      <PlanFeaturePage />
      {gate.dialog}
    </>
  );
}
