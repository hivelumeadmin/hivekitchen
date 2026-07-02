import { useState } from 'react';
import { hkFetch } from '@/lib/fetch.js';
import { useAuthStore } from '@/stores/auth.store.js';

type ActionState = 'idle' | 'running' | 'done' | 'error';

function useAction(fn: () => Promise<void>): [ActionState, () => void] {
  const [state, setState] = useState<ActionState>('idle');
  function trigger() {
    if (state === 'running') return;
    setState('running');
    fn()
      .then(() => setState('done'))
      .catch(() => {
        setState('error');
        setTimeout(() => setState('idle'), 2000);
      });
  }
  return [state, trigger];
}

function label(state: ActionState, idle: string): string {
  if (state === 'running') return '⏳ Working…';
  if (state === 'done') return '✓ Done';
  if (state === 'error') return '✗ Error';
  return idle;
}

export function DevTools() {
  const [open, setOpen] = useState(false);
  const clearSession = useAuthStore((s) => s.clearSession);

  const [resetAllState, triggerResetAll] = useAction(async () => {
    await hkFetch(`/v1/dev/reset-all`, { method: 'DELETE' });
    clearSession();
    window.location.replace('/auth/login');
  });

  const [resetPlansState, triggerResetPlans] = useAction(async () => {
    await hkFetch(`/v1/dev/reset-plans`, { method: 'DELETE' });
    window.location.reload();
  });

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      {open && (
        <div className="w-56 rounded-lg border border-amber-warm/40 bg-surface shadow-lg text-xs font-mono">
          <div className="border-b border-amber-warm/20 px-3 py-2 text-amber-warm font-semibold tracking-wide uppercase">
            Dev Tools
          </div>
          <div className="p-2 space-y-1">
            <button
              type="button"
              onClick={triggerResetAll}
              disabled={resetAllState === 'running' || resetAllState === 'done'}
              className="w-full rounded px-3 py-1.5 text-left text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50 transition-colors"
            >
              {label(resetAllState, '🔥 Reset all + onboarding')}
            </button>
            <button
              type="button"
              onClick={triggerResetPlans}
              disabled={resetPlansState === 'running' || resetPlansState === 'done'}
              className="w-full rounded px-3 py-1.5 text-left text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50 transition-colors"
            >
              {label(resetPlansState, '🗑 Reset weekly plans')}
            </button>
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-amber-warm/40 bg-surface text-xs font-bold text-amber-warm shadow-md hover:bg-surface-2 transition-colors"
        title="Dev tools"
      >
        {open ? '×' : '⚙'}
      </button>
    </div>
  );
}
