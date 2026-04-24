import type { Config } from 'tailwindcss';
import { tokenPresets } from '@hivekitchen/design-system';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: tokenPresets,
  plugins: [],
};

export default config;
