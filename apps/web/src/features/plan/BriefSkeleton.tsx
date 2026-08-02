// Story 14-s2 — the Brief's loading branch, extracted verbatim from BriefCanvas.
// Story 13-s4 — thread-less draft state. No Lumi thread is hydrated; this is the
// calm "finished answer, still being laid out" surface the valet shows before the
// brief lands. The dot pulse falls back to static under prefers-reduced-motion.
export function BriefSkeleton() {
  return (
    <main className="mx-auto w-full max-w-7xl flex-grow px-6 pt-12 pb-24">
      <p className="mb-8 flex items-center gap-2 text-sm text-fg-muted" role="status">
        <span className="h-2 w-2 rounded-full bg-lumi-terracotta animate-pulse motion-reduce:animate-none" />
        Lumi is drafting&hellip;
      </p>
      <div
        className="animate-pulse motion-reduce:animate-none flex flex-col gap-6"
        aria-busy="true"
        aria-label="Loading plan"
      >
        <div className="h-3 w-1/3 bg-surface rounded" />
        <div className="h-12 w-2/3 bg-surface rounded" />
        <div className="h-5 w-1/2 bg-[color-mix(in_srgb,var(--surface)_60%,transparent)] rounded" />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-32 bg-surface rounded-lg" />
          ))}
        </div>
      </div>
    </main>
  );
}
