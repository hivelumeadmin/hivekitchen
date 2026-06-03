import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../../../..');

const expectedFonts = [
  'InstrumentSerif-Regular.woff2',
  'InstrumentSerif-Italic.woff2',
  'PublicSans-Latin.woff2',
  'PublicSans-LatinExt.woff2',
];

// Multilingual Heart Note subsets (4-S16). Web-only — apps/marketing renders no
// Heart Notes, so these are deliberately NOT added to expectedFonts (which is
// asserted against both apps).
const multilingualFonts = [
  'NotoSerifDevanagari.woff2',
  'NotoSerifBengali.woff2',
  'NotoSerifHebrew.woff2',
  'NotoSerifTamil.woff2',
  'NotoNaskhArabic.woff2',
  'NotoSansDevanagari.woff2',
  'NotoSansBengali.woff2',
  'NotoSansHebrew.woff2',
  'NotoSansTamil.woff2',
];

describe('self-hosted font files', () => {
  it.skipIf(!!process.env.CI)(
    'exist in apps/web/public/fonts/',
    () => {
      for (const font of expectedFonts) {
        const path = resolve(root, 'apps/web/public/fonts', font);
        expect(existsSync(path), `missing: apps/web/public/fonts/${font}`).toBe(true);
      }
    },
  );

  it.skipIf(!!process.env.CI)(
    'exist in apps/marketing/public/fonts/',
    () => {
      for (const font of expectedFonts) {
        const path = resolve(root, 'apps/marketing/public/fonts', font);
        expect(existsSync(path), `missing: apps/marketing/public/fonts/${font}`).toBe(true);
      }
    },
  );
});

describe('multilingual Heart Note font subsets (4-S16)', () => {
  // Web-only: apps/marketing renders no Heart Notes and must not carry these.
  it.skipIf(!!process.env.CI)(
    'exist in apps/web/public/fonts/ only',
    () => {
      for (const font of multilingualFonts) {
        const path = resolve(root, 'apps/web/public/fonts', font);
        expect(existsSync(path), `missing: apps/web/public/fonts/${font}`).toBe(true);
      }
    },
  );
});
