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
      sacred: colorScale('sacred-plum'),
      'lumi-terracotta': {
        ...colorScale('lumi-terracotta'),
        warmed: 'var(--lumi-terracotta-warmed)',
      },
      'safety-cleared': colorScale('safety-cleared-teal'),
      'memory-provenance': colorScale('memory-provenance'),
      'honey-amber': colorScale('honey-amber'),
      foliage: colorScale('foliage'),
      'warm-neutral': colorScale('warm-neutral'),
    },
    fontFamily: {
      serif: 'var(--font-serif)',
      sans: 'var(--font-sans)',
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
