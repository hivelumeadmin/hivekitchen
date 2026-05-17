import { CheckinHeader } from '@/features/evening-checkin/components/CheckinHeader.js';
import { ConversationThread } from '@/features/evening-checkin/components/ConversationThread.js';
import { MessageComposer } from '@/features/evening-checkin/components/MessageComposer.js';
import { eveningCheckinMock } from '@/features/evening-checkin/data/mockData.js';

export default function EveningCheckinRoute() {
  const m = eveningCheckinMock;
  return (
    <>
      <main className="mx-auto w-full max-w-3xl flex-grow px-6 pb-48 pt-24">
        <CheckinHeader title={m.title} subtitle={m.subtitle} />
        <ConversationThread turns={m.turns} />
      </main>
      <MessageComposer
        placeholder={m.composer.placeholder}
        charCap={m.composer.charCap}
      />
    </>
  );
}
