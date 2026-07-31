import type { Config } from 'tailwindcss';
import { tokenPresets } from '@hivekitchen/design-system';

const config: Config = {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    // The locked primitives live in @hivekitchen/ui and are source-consumed;
    // without this glob every class they own vanishes from the bundle.
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: tokenPresets,
  plugins: [],
};

export default config;
