import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';

import { logicalPropertiesOnly } from './logical-properties-only.js';

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

tester.run('logical-properties-only', logicalPropertiesOnly, {
  valid: [
    {
      name: 'logical CSS props in style pass',
      code: `export const C = () => <div style={{ marginInlineStart: 8 }} />;`,
    },
    {
      name: 'logical Tailwind classes in className pass',
      code: `export const C = () => <div className="ms-4 pe-2" />;`,
    },
  ],
  invalid: [
    {
      name: 'physical CSS marginLeft reports',
      code: `export const C = () => <div style={{ marginLeft: 8 }} />;`,
      errors: [
        {
          message: "Use 'marginInlineStart' instead of 'marginLeft' for RTL/LTR support",
        },
      ],
    },
    {
      name: 'physical Tailwind ml-/pr- each report',
      code: `export const C = () => <div className="ml-4 pr-2" />;`,
      errors: [
        {
          message: "Use Tailwind logical class 'ms-4' instead of 'ml-4'",
        },
        {
          message: "Use Tailwind logical class 'pe-2' instead of 'pr-2'",
        },
      ],
    },
  ],
});
