const colorScale = (prefix: string) => ({
  50: `var(--${prefix}-50)`,
  100: `var(--${prefix}-100)`,
  200: `var(--${prefix}-200)`,
  300: `var(--${prefix}-300)`,
  400: `var(--${prefix}-400)`,
  500: `var(--${prefix}-500)`,
  600: `var(--${prefix}-600)`,
  700: `var(--${prefix}-700)`,
  800: `var(--${prefix}-800)`,
  900: `var(--${prefix}-900)`,
});

export const tokenPresets = {
  extend: {
    colors: {
      sacred: {
        ...colorScale('sacred-plum'),
        DEFAULT: 'var(--sacred-plum)',
        soft: 'var(--sacred-plum-soft)',
      },
      'lumi-terracotta': {
        ...colorScale('lumi-terracotta'),
        DEFAULT: 'var(--lumi-terracotta)',
        warmed: 'var(--lumi-terracotta-warmed)',
        dim: 'var(--lumi-terracotta-dim)',
      },
      'safety-cleared': {
        ...colorScale('safety-cleared-teal'),
        DEFAULT: 'var(--safety-cleared-teal)',
        fill: 'var(--safety-cleared-fill)',
      },
      'safety-red': {
        DEFAULT: 'var(--safety-red)',
        fill: 'var(--safety-red-fill)',
      },
      'memory-provenance': colorScale('memory-provenance'),
      'honey-amber': colorScale('honey-amber'),
      foliage: {
        ...colorScale('foliage'),
        DEFAULT: 'var(--foliage)',
        soft: 'var(--foliage-soft)',
      },
      'warm-neutral': colorScale('warm-neutral'),

      // v2.0 semantic aliases — prefer these in generated components
      bg: 'var(--bg)',
      surface: {
        DEFAULT: 'var(--surface)',
        2: 'var(--surface-2)',
      },
      fg: {
        DEFAULT: 'var(--fg)',
        muted: 'var(--fg-muted)',
      },
      border: 'var(--border)',
      amber: {
        DEFAULT: 'var(--amber)',
        soft: 'var(--amber-soft)',
        warm: 'var(--amber-warm)',
      },
      'honey-accent': 'var(--honey-accent)',
    },
    fontFamily: {
      serif: 'var(--font-serif)',
      sans: 'var(--font-sans)',
    },
    borderRadius: {
      sm: 'var(--r-sm)',
      md: 'var(--r-md)',
      lg: 'var(--r-lg)',
      xl: 'var(--r-xl)',
    },
    transitionTimingFunction: {
      'sacred-ease': 'var(--sacred-ease)',
    },
    transitionDuration: {
      fast: 'var(--motion-fast)',
      medium: 'var(--motion-medium)',
      slow: 'var(--motion-slow)',
    },
    outlineColor: {
      'focus-indicator': 'var(--focus-indicator-color)',
    },
    outlineWidth: {
      'focus-indicator': 'var(--focus-indicator-width)',
    },
    outlineOffset: {
      'focus-indicator': 'var(--focus-indicator-offset)',
    },
  },
};
