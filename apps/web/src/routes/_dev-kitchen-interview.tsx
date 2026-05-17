import { AppFooter } from '../components/AppFooter.js';
import { AppHeader } from '../components/AppHeader.js';
import { ChatThread } from '../features/kitchen-interview/components/ChatThread.js';
import { HoldToTalkButton } from '../features/kitchen-interview/components/HoldToTalkButton.js';
import { InterviewHeader } from '../features/kitchen-interview/components/InterviewHeader.js';
import { kitchenInterviewMock } from '../features/kitchen-interview/data/mockData.js';

export function DevKitchenInterviewPage() {
  const m = kitchenInterviewMock;
  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-7xl flex-grow flex-col px-4 pb-40 pt-12 md:px-12">
        <div className="relative mx-auto flex w-full max-w-2xl flex-col">
          <InterviewHeader title={m.title} subtitle={m.subtitle} />
          <ChatThread
            turns={m.turns}
            userAvatarSrc={m.userAvatarSrc}
            userAvatarAlt={m.userAvatarAlt}
          />
        </div>
        <HoldToTalkButton label={m.holdToTalkLabel} />
      </main>
      <AppFooter />
    </div>
  );
}
