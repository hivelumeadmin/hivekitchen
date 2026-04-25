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

const css = readFileSync(resolve(__dirname, 'tokens/colors.css'), 'utf8');
const darkIdx = css.indexOf('[data-theme="dark"]');
const lightMap = parseTokenMap(darkIdx > -1 ? css.slice(0, darkIdx) : css);
const darkMap = { ...lightMap, ...parseTokenMap(darkIdx > -1 ? css.slice(darkIdx) : '') };
const maps = { light: lightMap, dark: darkMap } as const;

function tok(map: Record<string, string>, name: string): string {
  const v = map[name];
  if (!v) throw new Error(`Token not found: ${name}`);
  return v;
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

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

interface Pair {
  label: string;
  fg: string;
  bg: string;
  required: number;
  mode: 'light' | 'dark';
}

const PAIRS: Pair[] = [
  { label: 'body/surface-0', fg: '--warm-neutral-900', bg: '--warm-neutral-50', required: 7, mode: 'light' },
  { label: 'body/surface-1', fg: '--warm-neutral-900', bg: '--warm-neutral-100', required: 7, mode: 'light' },
  { label: 'body/surface-0', fg: '--warm-neutral-900', bg: '--warm-neutral-50', required: 7, mode: 'dark' },
  { label: 'body/surface-1', fg: '--warm-neutral-900', bg: '--warm-neutral-100', required: 7, mode: 'dark' },
  { label: 'focus/surface-0', fg: '--foliage-500', bg: '--warm-neutral-50', required: 3, mode: 'light' },
  { label: 'focus/surface-0', fg: '--foliage-500', bg: '--warm-neutral-50', required: 3, mode: 'dark' },
  { label: 'safety-chip', fg: '--safety-cleared-teal-700', bg: '--safety-cleared-teal-50', required: 4.5, mode: 'light' },
  { label: 'safety-chip', fg: '--safety-cleared-teal-900', bg: '--safety-cleared-teal-100', required: 4.5, mode: 'dark' },
];

describe('WCAG contrast audit — token pairs', () => {
  it.each(PAIRS)('$label ($mode): ≥ $required:1', ({ label, fg, bg, required, mode }) => {
    const map = maps[mode];
    const fgHex = tok(map, fg);
    const bgHex = tok(map, bg);
    const ratio = contrastRatio(fgHex, bgHex);
    expect(
      ratio,
      `[${mode}] ${label}: ${fg}(${fgHex}) on ${bg}(${bgHex}) → ${ratio.toFixed(2)}:1 (required ${required}:1)`,
    ).toBeGreaterThanOrEqual(required);
  });
});
