import type { Config } from 'tailwindcss';
import { tokenPresets } from '@hivekitchen/design-system';

const config: Config = {
  content: {
    // relative: true resolves these globs against this config file, not
    // process.cwd() — a root-cwd build would otherwise silently drop every
    // class these globs own.
    relative: true,
    files: [
      './index.html',
      './src/**/*.{ts,tsx}',
      // The locked primitives live in @hivekitchen/ui and are source-consumed;
      // without this glob every class they own vanishes from the bundle.
      '../../packages/ui/src/**/*.{ts,tsx}',
    ],
  },
  darkMode: ['class', '[data-theme="dark"]'],
  theme: tokenPresets,
  plugins: [],
};

export default config;
