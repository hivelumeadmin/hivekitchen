import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GetMemoryResponseSchema } from '@hivekitchen/contracts';
import type { MemoryNode } from '@hivekitchen/types';
import { hkFetch, HkApiError } from '@/lib/fetch.js';
import { useLumiContext } from '@/hooks/useLumiContext.js';
import { useAuthStore } from '@/stores/auth.store.js';
import { VisibleMemorySentence } from '@/components/VisibleMemorySentence.js';

type LoadState = 'loading' | 'ready' | 'error';

// UX-DR39 — observational, not imperative. No CTA, no illustration.
const EMPTY_COPY =
  'Lumi is still learning about your family. Memory will show up here as patterns appear.';
const ERROR_COPY = "Lumi couldn't load your memory right now. Try refreshing.";

export default function MemoryRoute() {
  useLumiContext({ surface: 'general' });

  const navigate = useNavigate();
  const accessToken = useAuthStore((s) => s.accessToken);
  const householdId = useAuthStore((s) => s.user?.current_household_id ?? null);
  const didLoad = useRef(false);
  // 7-S6 — read once at construction; stable for the component's lifetime.
  // try/catch guards against SecurityError in private-browsing or restricted storage environments.
  const showHelper = useRef(
    (() => {
      try {
        return !localStorage.getItem('memory_helper_seen_at');
      } catch {
        return false;
      }
    })()
  ).current;

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [nodes, setNodes] = useState<MemoryNode[]>([]);

  useEffect(() => {
    if (!accessToken) {
      navigate('/auth/login?next=/app/memory', { replace: true });
      return;
    }
    if (householdId === null || didLoad.current) return;
    didLoad.current = true;
    const controller = new AbortController();
    void (async () => {
      try {
        const raw = await hkFetch<unknown>(`/v1/households/${householdId}/memory`, {
          method: 'GET',
          signal: controller.signal,
        });
        const parsed = GetMemoryResponseSchema.parse(raw);
        setNodes(parsed.nodes);
        setLoadState('ready');
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        if (err instanceof HkApiError && err.status === 401) {
          navigate('/auth/login?next=/app/memory', { replace: true });
          return;
        }
        didLoad.current = false;
        setLoadState('error');
      }
    })();
    return () => {
      controller.abort();
      didLoad.current = false;
    };
  }, [accessToken, householdId, navigate]);

  return (
    <main className="mx-auto w-full max-w-3xl flex-grow px-4 py-16 sm:px-6 md:py-24">
      <h1 className="font-serif text-3xl text-fg">Memory</h1>

      {loadState === 'loading' ? (
        <div role="status" aria-label="Loading your memory" className="mt-8 space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-5 rounded bg-surface animate-pulse motion-reduce:animate-none"
            />
          ))}
        </div>
      ) : loadState === 'error' ? (
        <p role="alert" className="mt-8 font-sans text-base text-fg-muted">
          {ERROR_COPY}
        </p>
      ) : nodes.length === 0 ? (
        <p className="mt-8 font-sans text-base text-fg-muted leading-relaxed">{EMPTY_COPY}</p>
      ) : (
        <div className="mt-8">
          {nodes.map((node, index) => (
            <VisibleMemorySentence
              key={node.id}
              node={node}
              showHelper={index === 0 && showHelper}
              onNodeUpdated={(u) => setNodes((prev) => prev.map((n) => (n.id === u.id ? u : n)))}
            />
          ))}
        </div>
      )}
    </main>
  );
}
