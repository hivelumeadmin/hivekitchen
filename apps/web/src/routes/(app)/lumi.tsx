import { useScope } from '@hivekitchen/ui';
import { useLumiContext } from '@/hooks/useLumiContext.js';
import { LumiConversation } from '@/components/LumiConversation.js';

// Epic 13-s11 — the Lumi anchor. The one vision-sanctioned exception to
// "no persistent chat column" (vision §2c: "Lumi — the thread itself,
// full-screen"). Renders the SAME <LumiConversation> the summoned sheet uses,
// so there is no forked second implementation. Surface registration +
// hydration come from useLumiContext (mirrors the other anchor routes); the
// ambient presence dot is suppressed here by AppLayout so the page never shows
// a second Lumi affordance over itself.
export default function LumiPage() {
  useScope('app-scope');
  useLumiContext({ surface: 'general' });

  return (
    <main className="mx-auto flex min-h-[calc(100vh-8rem)] w-full max-w-2xl flex-1 flex-col px-4 py-10 sm:px-6">
      <h1 className="pb-4 font-serif text-2xl italic text-fg">Lumi</h1>
      <div className="flex flex-1 flex-col rounded-2xl border border-border bg-surface p-5 shadow-sm min-h-0">
        <LumiConversation active fullHeight />
      </div>
    </main>
  );
}
