import { useEffect, type ReactNode } from 'react';
import { useScope } from '@hivekitchen/ui';
import { useLumiContext } from '@/hooks/useLumiContext.js';
import { useRequireParentalNoticeAcknowledgment } from '@/hooks/useRequireParentalNoticeAcknowledgment.js';
import { BriefCanvas } from '@/features/plan/BriefCanvas.js';

// Epic 13-s11 — the Brief anchor. `artifact` hosts a summoned artifact sheet
// (day-detail, grocery, evening check-in, plan history) rendered OVER the Brief
// at its own kept URL. It renders only AFTER the parental-notice gate passes, so
// the AADC gate covers the artifacts too (they never show for an unacknowledged
// household). At /app it is undefined and the Brief renders alone.
export default function AppHomePage({ artifact }: { artifact?: ReactNode }) {
  useScope('app-scope');
  useLumiContext({ surface: 'brief' });
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
      <BriefCanvas />
      {artifact}
      {gate.dialog}
    </>
  );
}
