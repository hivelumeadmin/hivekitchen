import type { Config } from 'tailwindcss';
// TODO(story-1.4): replace relative path with final packages/design-system
// resolution once Story 1.4 decides whether design-system is a workspace package
// or folded into packages/ui/src/tokens. Epic vs architecture conflict — see
// Story 1.1 Dev Notes §Cross-story resolution.
import { tokenPresets } from '../design-system/tokens/index.js';

const config: Config = {
  content: [],
  theme: {
    extend: tokenPresets,
  },
  plugins: [],
};

export default config;
