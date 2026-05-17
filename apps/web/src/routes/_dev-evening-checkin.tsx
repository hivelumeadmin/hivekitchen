import { AppFooter } from '../components/AppFooter.js';
import { AppHeader } from '../components/AppHeader.js';
import { CheckinHeader } from '../features/evening-checkin/components/CheckinHeader.js';
import { ConversationThread } from '../features/evening-checkin/components/ConversationThread.js';
import { MessageComposer } from '../features/evening-checkin/components/MessageComposer.js';
import { eveningCheckinMock } from '../features/evening-checkin/data/mockData.js';

export function DevEveningCheckinPage() {
  const m = eveningCheckinMock;
  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl flex-grow px-6 pb-48 pt-24">
        <CheckinHeader title={m.title} subtitle={m.subtitle} />
        <ConversationThread turns={m.turns} />
      </main>
      <MessageComposer
        placeholder={m.composer.placeholder}
        charCap={m.composer.charCap}
      />
      <AppFooter />
    </div>
  );
}
