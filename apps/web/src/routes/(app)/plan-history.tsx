import { useEffect } from 'react';
import { useRequireParentalNoticeAcknowledgment } from '@/hooks/useRequireParentalNoticeAcknowledgment.js';
import { PlanHistoryPage } from '@/features/plan/PlanHistoryPage.js';

// Story 3.15 — /app/plan/:weekId host. Mirrors the /app/plan parental-notice
// gate so historical plan views are never reachable for households that have
// not acknowledged the AADC notice (Story 2.9).
export default function PlanHistoryRoute() {
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
      <PlanHistoryPage />
      {gate.dialog}
    </>
  );
}
