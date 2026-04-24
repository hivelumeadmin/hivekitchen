import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../../../..');

const expectedFonts = [
  'InstrumentSerif-Regular.woff2',
  'InstrumentSerif-Italic.woff2',
  'Inter-Regular.woff2',
  'Inter-Medium.woff2',
  'Inter-SemiBold.woff2',
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
