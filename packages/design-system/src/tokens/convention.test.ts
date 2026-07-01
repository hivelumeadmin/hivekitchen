import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseTokenMap(section: string): Record<string, string> {
  const map: Record<string, string> = {};
  const re = /--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(section)) !== null) {
    map[`--${m[1]}`] = m[2];
  }
  return map;
}

function linearize(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const r = linearize(parseInt(hex.slice(1, 3), 16) / 255);
  const g = linearize(parseInt(hex.slice(3, 5), 16) / 255);
  const b = linearize(parseInt(hex.slice(5, 7), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const css = readFileSync(
  resolve(__dirname, '../../tokens/colors.css'),
  'utf8',
);
const darkIdx = css.indexOf('[data-theme="dark"]');
const lightSection = darkIdx > -1 ? css.slice(0, darkIdx) : css;
const darkSection = darkIdx > -1 ? css.slice(darkIdx) : '';
const lightMap = parseTokenMap(lightSection);
const darkMap = { ...lightMap, ...parseTokenMap(darkSection) };

describe('warm-neutral convention (canonical: low = bg, high = fg)', () => {
  it('LIGHT: warm-neutral-50 is lighter than warm-neutral-900 (50 is bg-like)', () => {
    const fifty = lightMap['--warm-neutral-50'];
    const nine = lightMap['--warm-neutral-900'];
    expect(fifty, 'missing --warm-neutral-50 in light section').toBeDefined();
    expect(nine, 'missing --warm-neutral-900 in light section').toBeDefined();
    expect(relativeLuminance(fifty)).toBeGreaterThan(relativeLuminance(nine));
  });

  it('DARK: warm-neutral-50 is darker than warm-neutral-900 (50 is still bg-like, just inverted)', () => {
    const fifty = darkMap['--warm-neutral-50'];
    const nine = darkMap['--warm-neutral-900'];
    expect(fifty).toBeDefined();
    expect(nine).toBeDefined();
    expect(relativeLuminance(fifty)).toBeLessThan(relativeLuminance(nine));
  });

  it('intent is stable across themes: warm-neutral-50 always sits closer to its theme bg than -900 does', () => {
    // In both themes, -50 should be the surface-side anchor and -900 the foreground-side anchor.
    // Concretely: -50's distance to the page bg (--bg) is smaller than -900's.
    const lDist50 = Math.abs(
      relativeLuminance(lightMap['--warm-neutral-50']) -
        relativeLuminance(lightMap['--bg']),
    );
    const lDist900 = Math.abs(
      relativeLuminance(lightMap['--warm-neutral-900']) -
        relativeLuminance(lightMap['--bg']),
    );
    expect(lDist50).toBeLessThan(lDist900);

    const dDist50 = Math.abs(
      relativeLuminance(darkMap['--warm-neutral-50']) -
        relativeLuminance(darkMap['--bg']),
    );
    const dDist900 = Math.abs(
      relativeLuminance(darkMap['--warm-neutral-900']) -
        relativeLuminance(darkMap['--bg']),
    );
    expect(dDist50).toBeLessThan(dDist900);
  });
});

describe('v2.0 semantic aliases — repo-pinned hex per theme', () => {
  // Light-mode surface chain was refined 2026-05-24: original Stitch
  // v2.0 hexes had washed-out card hierarchy (tight L gaps, border ==
  // surface-2). Widened gaps, added surface-3 for elevated panels,
  // distinct border. Dark mode unchanged (it was the authored baseline).
  const v20 = {
    light: {
      '--bg': '#f7f2e9',
      '--surface': '#ebe2d0',
      '--surface-2': '#dccfb5',
      '--surface-3': '#c8b791',
      '--fg': '#141210',
      '--fg-muted': '#474339',
      '--border': '#b5a784',
      '--lumi-terracotta': '#a15838',
      '--lumi-terracotta-dim': '#753a24',
      '--sacred-plum': '#6b4a5a',
      '--sacred-plum-soft': '#533845',
      '--foliage': '#5f7a67',
      '--foliage-soft': '#46604f',
      '--safety-cleared-teal': '#3d6b5f',
      '--safety-red': '#a84236',
      '--amber': '#b97730',
      '--amber-soft': '#96601f',
      '--amber-warm': '#d98f3c',
      '--honey-accent': '#d98f3c',
    },
    dark: {
      '--bg': '#1c1a17',
      '--surface': '#262420',
      '--surface-2': '#2f2d27',
      '--surface-3': '#383530',
      '--fg': '#faf7f2',
      '--fg-muted': '#b0a99d',
      '--border': '#2f2d27',
      '--lumi-terracotta': '#b46a4e',
      '--lumi-terracotta-dim': '#8a4f3a',
      '--sacred-plum': '#8a5f72',
      '--sacred-plum-soft': '#6b4a5a',
      '--foliage': '#7a9681',
      '--foliage-soft': '#5f7a67',
      '--safety-cleared-teal': '#5a9c8b',
      '--safety-red': '#c65a4e',
      '--amber': '#d98f3c',
      '--amber-soft': '#b97730',
      '--amber-warm': '#e69a3d',
      '--honey-accent': '#d98f3c',
    },
  } as const;

  for (const [token, hex] of Object.entries(v20.light)) {
    it(`light: ${token} = ${hex}`, () => {
      expect(lightMap[token]).toBe(hex);
    });
  }
  for (const [token, hex] of Object.entries(v20.dark)) {
    it(`dark: ${token} = ${hex}`, () => {
      expect(darkMap[token]).toBe(hex);
    });
  }
});
