import type { Config } from 'tailwindcss';
import { tokenPresets } from '@hivekitchen/design-system';

const config: Config = {
  content: [],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: tokenPresets,
  plugins: [],
};

export default config;
