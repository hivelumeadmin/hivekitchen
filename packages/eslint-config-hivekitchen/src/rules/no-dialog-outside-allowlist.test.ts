import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';

import { noDialogOutsideAllowlist } from './no-dialog-outside-allowlist.js';

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
  },
});

const options = [
  {
    allowlist: ['features/auth', 'features/safety', 'features/command-palette', 'features/memory'],
  },
];

tester.run('no-dialog-outside-allowlist', noDialogOutsideAllowlist, {
  valid: [
    {
      name: 'dialog import in features/auth passes',
      filename: '/project/apps/web/src/features/auth/re-entry.tsx',
      code: `import * as Dialog from '@radix-ui/react-dialog';`,
      options,
    },
    {
      name: 'non-dialog import elsewhere passes',
      filename: '/project/apps/web/src/features/plan/card.tsx',
      code: `import { cn } from '@hivekitchen/ui';`,
      options,
    },
  ],
  invalid: [
    {
      name: 'dialog import outside allowlist fails',
      filename: '/project/apps/web/src/features/plan/modal.tsx',
      code: `import * as Dialog from '@radix-ui/react-dialog';`,
      options,
      errors: [
        {
          message:
            'Dialog/modal primitives are restricted — only allowed in auth, safety, command-palette, and memory (Phase 2) features',
        },
      ],
    },
    {
      name: 'alert-dialog import outside allowlist fails',
      filename: '/project/apps/web/src/features/plan/alert.tsx',
      code: `import { AlertDialogContent } from '@radix-ui/react-alert-dialog';`,
      options,
      errors: [
        {
          message:
            'Dialog/modal primitives are restricted — only allowed in auth, safety, command-palette, and memory (Phase 2) features',
        },
      ],
    },
  ],
});
