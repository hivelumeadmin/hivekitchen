import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';

import { noCrossScopeComponent } from './no-cross-scope-component.js';

// ESLint's RuleTester uses Mocha's describe/it. Bridge it to Vitest.
const globalWithHooks = globalThis as unknown as {
  describe: typeof describe;
  it: typeof it;
};
globalWithHooks.describe = describe;
globalWithHooks.it = it;

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const childScope = {
  scopeAllowlist: {
    'child-scope': { forbiddenComponents: ['Command', 'AlertDialog'] },
    'app-scope': { forbiddenComponents: [] },
  },
};

tester.run('no-cross-scope-component', noCrossScopeComponent, {
  valid: [
    {
      name: 'allowed component imported into child-scope passes',
      filename: '/project/apps/web/src/routes/(child)/lunch-link.tsx',
      code: `import { HeartNote } from '@hivekitchen/ui';`,
      options: [childScope],
    },
    {
      name: 'forbidden name outside any scoped route is ignored',
      filename: '/project/apps/web/src/app.tsx',
      code: `import { Command } from '@hivekitchen/ui';`,
      options: [childScope],
    },
  ],
  invalid: [
    {
      name: 'forbidden component imported into child-scope fails',
      filename: '/project/apps/web/src/routes/(child)/lunch-link.tsx',
      code: `import { Command } from '@hivekitchen/ui';`,
      options: [childScope],
      errors: [
        {
          message: "'Command' is forbidden in .child-scope — see SCOPE_CHARTER.md",
        },
      ],
    },
    {
      name: 'multiple forbidden components each report',
      filename: '/project/apps/web/src/routes/(child)/lunch-link.tsx',
      code: `import { Command, AlertDialog } from '@hivekitchen/ui';`,
      options: [childScope],
      errors: [
        {
          message: "'Command' is forbidden in .child-scope — see SCOPE_CHARTER.md",
        },
        {
          message: "'AlertDialog' is forbidden in .child-scope — see SCOPE_CHARTER.md",
        },
      ],
    },
  ],
});
