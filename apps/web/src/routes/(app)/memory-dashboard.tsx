import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ParentalDashboardResponseSchema } from '@hivekitchen/contracts';
import type { MemorySourceCounts, ParentalDashboardResponse } from '@hivekitchen/types';
import { hkFetch, HkApiError } from '@/lib/fetch.js';
import { useLumiContext } from '@/hooks/useLumiContext.js';
import { useAuthStore } from '@/stores/auth.store.js';
import { RailCard } from '@hivekitchen/ui';

type LoadState = 'loading' | 'ready' | 'error';

// UX-DR39 — observational, calm copy. No CTA, no SaaS-dashboard chrome.
const EMPTY_COPY =
  'No children are set up yet. Once they are, this is where everything Lumi holds about each of them will appear.';
const ERROR_COPY = "Lumi couldn't load your data review right now. Try refreshing.";

// Friendly labels for each memory source bucket. Keys mirror the contract's
// SourceType enum; every key is always present in the counts object.
const SOURCE_LABELS: Record<keyof MemorySourceCounts, string> = {
  onboarding: 'onboarding',
  turn: 'conversations',
  tool: 'planning tools',
  user_edit: 'your edits',
  plan_outcome: 'plan outcomes',
  import: 'imports',
};

function nonZeroCounts(counts: MemorySourceCounts): Array<{ label: string; count: number }> {
  return (Object.keys(SOURCE_LABELS) as Array<keyof MemorySourceCounts>)
    .filter((k) => counts[k] > 0)
    .map((k) => ({ label: SOURCE_LABELS[k], count: counts[k] }));
}

function MemoryCounts({ counts }: { counts: MemorySourceCounts }) {
  const entries = nonZeroCounts(counts);
  if (entries.length === 0) {
    return <p className="font-sans text-sm text-fg-muted">Nothing remembered yet.</p>;
  }
  return (
    <ul className="space-y-1">
      {entries.map((e) => (
        <li key={e.label} className="font-sans text-sm text-fg-muted">
          {e.count} from {e.label}
        </li>
      ))}
    </ul>
  );
}

function Tags({ values }: { values: string[] }) {
  if (values.length === 0) {
    return <span className="font-sans text-sm text-fg-muted">None recorded</span>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {values.map((v) => (
        <span
          key={v}
          className="rounded-full border border-border/20 bg-bg/50 px-3 py-1 font-sans text-xs text-fg-muted"
        >
          {v}
        </span>
      ))}
    </div>
  );
}

export default function MemoryDashboardRoute() {
  useLumiContext({ surface: 'general' });

  const navigate = useNavigate();
  const accessToken = useAuthStore((s) => s.accessToken);
  const householdId = useAuthStore((s) => s.user?.current_household_id ?? null);
  const didLoad = useRef(false);

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [data, setData] = useState<ParentalDashboardResponse | null>(null);

  useEffect(() => {
    if (!accessToken) {
      navigate('/auth/login?next=/app/memory/dashboard', { replace: true });
      return;
    }
    if (householdId === null || didLoad.current) return;
    didLoad.current = true;
    const controller = new AbortController();
    void (async () => {
      try {
        const raw = await hkFetch<unknown>(`/v1/households/${householdId}/dashboard`, {
          method: 'GET',
          signal: controller.signal,
        });
        setData(ParentalDashboardResponseSchema.parse(raw));
        setLoadState('ready');
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        if (err instanceof HkApiError && err.status === 401) {
          navigate('/auth/login?next=/app/memory/dashboard', { replace: true });
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
      <h1 className="font-serif text-3xl text-fg">Data review</h1>
      <p className="mt-2 font-sans text-base text-fg-muted leading-relaxed">
        Everything HiveKitchen holds about your family, in one place.
      </p>

      {loadState === 'loading' ? (
        <div role="status" aria-label="Loading your data review" className="mt-8 space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-24 rounded-lg bg-surface animate-pulse motion-reduce:animate-none"
            />
          ))}
        </div>
      ) : loadState === 'error' || data === null ? (
        <p role="alert" className="mt-8 font-sans text-base text-fg-muted">
          {ERROR_COPY}
        </p>
      ) : (
        <div className="mt-8 space-y-6">
          <RailCard eyebrow="Household">
            <div className="space-y-5">
              <div>
                <h3 className="font-serif text-base text-fg">Cultural priors</h3>
                <div className="mt-2">
                  <Tags values={data.household.cultural_priors.map((p) => p.label)} />
                </div>
              </div>
              <div>
                <h3 className="font-serif text-base text-fg">Voice retention</h3>
                <p className="mt-2 font-sans text-sm text-fg-muted">
                  {data.household.voice_retention_days} days
                </p>
              </div>
              <div>
                <h3 className="font-serif text-base text-fg">Recent consent events</h3>
                {data.household.recent_vpc_events.length === 0 ? (
                  <p className="mt-2 font-sans text-sm text-fg-muted">None recorded</p>
                ) : (
                  <ul className="mt-2 space-y-1">
                    {data.household.recent_vpc_events.map((e) => (
                      <li
                        key={`${e.mechanism}-${e.signed_at}`}
                        className="font-sans text-sm text-fg-muted"
                      >
                        {e.mechanism} · {e.document_version} ·{' '}
                        {new Date(e.signed_at).toLocaleDateString()}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h3 className="font-serif text-base text-fg">Household memory</h3>
                <div className="mt-2">
                  <MemoryCounts counts={data.household.general_memory_node_counts} />
                </div>
              </div>
            </div>
          </RailCard>

          {data.children.length === 0 ? (
            <p className="font-sans text-base text-fg-muted leading-relaxed">{EMPTY_COPY}</p>
          ) : (
            data.children.map((child) => (
              <RailCard key={child.child_id} eyebrow={child.age_band}>
                <div className="space-y-5">
                  <h2 className="font-serif text-xl text-fg">{child.name}</h2>
                  <div>
                    <h3 className="font-serif text-base text-fg">Allergens</h3>
                    <div className="mt-2">
                      <Tags values={child.declared_allergens} />
                    </div>
                  </div>
                  <div>
                    <h3 className="font-serif text-base text-fg">Dietary preferences</h3>
                    <div className="mt-2">
                      <Tags values={child.dietary_preferences} />
                    </div>
                  </div>
                  <div>
                    <h3 className="font-serif text-base text-fg">Memory</h3>
                    <div className="mt-2">
                      <MemoryCounts counts={child.memory_node_counts} />
                    </div>
                  </div>
                  <Link
                    to="/app/memory"
                    className="inline-block font-sans text-sm text-fg underline-offset-4 hover:underline"
                  >
                    See everything Lumi remembers →
                  </Link>
                </div>
              </RailCard>
            ))
          )}
        </div>
      )}
    </main>
  );
}
