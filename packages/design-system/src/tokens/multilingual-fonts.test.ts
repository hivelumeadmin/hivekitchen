import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

// CSS-source guardrail (4-S16 AC9). Asserts the structure of typography.css as
// text — no font binaries required, so this runs in CI. It guards against a
// future edit silently dropping unicode-range (blows the bundle budget) or
// font-display: swap (re-introduces FOIT).

const __dirname = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(__dirname, '../../tokens/typography.css'), 'utf8');

const SERIF_FAMILIES = [
  'Noto Serif Devanagari',
  'Noto Serif Bengali',
  'Noto Serif Hebrew',
  'Noto Serif Tamil',
  'Noto Naskh Arabic',
];

const SANS_FAMILIES = [
  'Noto Sans Devanagari',
  'Noto Sans Bengali',
  'Noto Sans Hebrew',
  'Noto Sans Tamil',
];

const NOTO_FAMILIES = [...SERIF_FAMILIES, ...SANS_FAMILIES];

function fontFaceBlocks(source: string): Array<{ family: string; body: string }> {
  const blocks: Array<{ family: string; body: string }> = [];
  const re = /@font-face\s*\{([\s\S]*?)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const body = m[1] ?? '';
    const family = /font-family:\s*'([^']+)'/.exec(body)?.[1];
    if (family) blocks.push({ family, body });
  }
  return blocks;
}

function cssVarValue(name: string): string {
  const value = new RegExp(`${name}:\\s*([^;]+);`).exec(css)?.[1];
  expect(value, `missing CSS var ${name}`).toBeTruthy();
  return value ?? '';
}

describe('typography.css — multilingual @font-face blocks', () => {
  const blocks = fontFaceBlocks(css);

  it.each(NOTO_FAMILIES)('declares an @font-face for %s', (family) => {
    expect(blocks.some((b) => b.family === family)).toBe(true);
  });

  it.each(NOTO_FAMILIES)('%s block has unicode-range (lazy per-script load)', (family) => {
    const block = blocks.find((b) => b.family === family);
    expect(block?.body).toContain('unicode-range');
  });

  it.each(NOTO_FAMILIES)('%s block has font-display: swap (FOUT over FOIT)', (family) => {
    const block = blocks.find((b) => b.family === family);
    expect(block?.body).toContain('font-display: swap');
  });
});

describe('typography.css — fallback chains', () => {
  it('--font-serif lists the five Heart-Note families after Instrument Serif and before Georgia', () => {
    const serif = cssVarValue('--font-serif');
    const instrumentIdx = serif.indexOf('Instrument Serif');
    const georgiaIdx = serif.indexOf('Georgia');
    expect(instrumentIdx, '--font-serif missing Instrument Serif').toBeGreaterThan(-1);
    expect(georgiaIdx, '--font-serif missing Georgia').toBeGreaterThan(-1);
    for (const family of SERIF_FAMILIES) {
      const notoIdx = serif.indexOf(family);
      expect(notoIdx, `--font-serif missing ${family}`).toBeGreaterThan(-1);
      expect(notoIdx, `${family} must follow Instrument Serif`).toBeGreaterThan(instrumentIdx);
      expect(notoIdx, `${family} must precede Georgia`).toBeLessThan(georgiaIdx);
    }
  });

  it('--font-sans lists the four Noto Sans families + Noto Naskh Arabic after Public Sans and before system fallbacks', () => {
    const sans = cssVarValue('--font-sans');
    const publicSansIdx = sans.indexOf('Public Sans');
    const systemIdx = sans.indexOf('-apple-system');
    expect(publicSansIdx, '--font-sans missing Public Sans').toBeGreaterThan(-1);
    expect(systemIdx, '--font-sans missing -apple-system').toBeGreaterThan(-1);
    for (const family of [...SANS_FAMILIES, 'Noto Naskh Arabic']) {
      const notoIdx = sans.indexOf(family);
      expect(notoIdx, `--font-sans missing ${family}`).toBeGreaterThan(-1);
      expect(notoIdx, `${family} must follow Public Sans`).toBeGreaterThan(publicSansIdx);
      expect(notoIdx, `${family} must precede -apple-system`).toBeLessThan(systemIdx);
    }
  });
});
