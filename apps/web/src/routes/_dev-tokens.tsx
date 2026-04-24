const colorGroups = [
  'sacred-plum',
  'lumi-terracotta',
  'safety-cleared-teal',
  'memory-provenance',
  'honey-amber',
  'foliage',
  'warm-neutral',
] as const;

const stops = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

export function DevTokensPage() {
  return (
    <main style={{ padding: '2rem', fontFamily: 'var(--font-sans)' }}>
      <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '2rem' }}>
        Design System v2.0 — Token Reference
      </h1>
      <p style={{ color: 'var(--warm-neutral-700)' }}>
        Development-only smoke test. Every token group renders below.
      </p>
      {colorGroups.map((group) => (
        <section key={group} style={{ marginTop: '2rem' }}>
          <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.25rem' }}>{group}</h2>
          <div
            style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: '0.5rem' }}
          >
            {stops.map((stop) => (
              <div
                key={stop}
                style={{
                  background: `var(--${group}-${stop})`,
                  padding: '1rem 0.5rem',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  color: stop >= 500 ? 'var(--warm-neutral-50)' : 'var(--warm-neutral-900)',
                  textAlign: 'center',
                }}
              >
                {stop}
              </div>
            ))}
          </div>
        </section>
      ))}
      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.25rem' }}>Typography</h2>
        <p style={{ fontFamily: 'var(--font-serif)', fontSize: '1.5rem' }}>
          Instrument Serif — the sacred, editorial, letter-ink voice.
        </p>
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: '1rem' }}>
          Inter — all UI, body, buttons, labels.
        </p>
      </section>
      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.25rem' }}>Motion</h2>
        <button
          type="button"
          style={{
            padding: '0.75rem 1.5rem',
            background: 'var(--sacred-plum-500)',
            color: 'var(--warm-neutral-50)',
            border: 'none',
            borderRadius: '8px',
            transition: 'transform var(--motion-medium) var(--sacred-ease)',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.05)')}
          onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
        >
          Hover me — sacred-ease, motion-medium
        </button>
      </section>
      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.25rem' }}>Focus indicator</h2>
        <button
          type="button"
          style={{
            padding: '0.75rem 1.5rem',
            background: 'var(--warm-neutral-100)',
            color: 'var(--warm-neutral-900)',
            border: '1px solid var(--warm-neutral-300)',
            borderRadius: '8px',
            outline: 'var(--focus-indicator-width) solid var(--focus-indicator-color)',
            outlineOffset: 'var(--focus-indicator-offset)',
          }}
        >
          Focus indicator preview
        </button>
      </section>
    </main>
  );
}
