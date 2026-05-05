import { useEffect } from 'react';
import { useScope } from '@hivekitchen/ui';
import { useLumiContext } from '@/hooks/useLumiContext.js';
import { useRequireParentalNoticeAcknowledgment } from '@/hooks/useRequireParentalNoticeAcknowledgment.js';
import { BriefCanvas } from '@/features/plan/BriefCanvas.js';

export default function AppHomePage() {
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
      {gate.dialog}
    </>
  );
}
