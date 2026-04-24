import type { Linter } from 'eslint';
// Third-party plugins ship incomplete types; cast through unknown at consumer boundary.
import jsxA11yRaw from 'eslint-plugin-jsx-a11y';
import reactPluginRaw from 'eslint-plugin-react';
import reactHooksRaw from 'eslint-plugin-react-hooks';
import boundariesPluginRaw from 'eslint-plugin-boundaries';
import tseslint from 'typescript-eslint';

const jsxA11y = jsxA11yRaw as {
  configs?: Record<string, { rules?: Record<string, unknown> }>;
  flatConfigs?: Record<string, { rules?: Record<string, unknown> }>;
};
const reactPlugin = reactPluginRaw as {
  configs?: Record<string, { rules?: Record<string, unknown> }>;
};
const reactHooks = reactHooksRaw as {
  configs?: Record<string, { rules?: Record<string, unknown> }>;
};
const boundariesPlugin = boundariesPluginRaw;

import { noCrossScopeComponent } from './rules/no-cross-scope-component.js';
import { noDialogOutsideAllowlist } from './rules/no-dialog-outside-allowlist.js';
import { logicalPropertiesOnly } from './rules/logical-properties-only.js';

export type { ScopeClass, ScopeRestrictions } from './rules/no-cross-scope-component.js';
export { noCrossScopeComponent, noDialogOutsideAllowlist, logicalPropertiesOnly };

export interface ScopeAllowlistOptions {
  [scope: string]: { forbiddenComponents: string[] };
}

export interface WebConfigOptions {
  scopeAllowlist: ScopeAllowlistOptions;
  dialogAllowlist?: string[];
}

const DEFAULT_DIALOG_ALLOWLIST = [
  'features/auth',
  'features/safety',
  'features/command-palette',
  'features/memory',
];

const hivekitchenPlugin = {
  rules: {
    'no-cross-scope-component': noCrossScopeComponent,
    'no-dialog-outside-allowlist': noDialogOutsideAllowlist,
    'logical-properties-only': logicalPropertiesOnly,
  },
};

export function baseConfig(): Linter.Config[] {
  return tseslint.config(
    {
      plugins: {
        hivekitchen: hivekitchenPlugin as unknown as NonNullable<Linter.Config['plugins']>[string],
      },
    },
    ...(tseslint.configs.recommended as Linter.Config[]),
    {
      files: ['**/*.{ts,tsx,js,jsx,mjs,cjs}'],
      rules: {
        'hivekitchen/logical-properties-only': 'error',
        '@typescript-eslint/consistent-type-imports': 'error',
        '@typescript-eslint/no-explicit-any': 'error',
        eqeqeq: ['error', 'always'],
      },
    },
  ) as Linter.Config[];
}

export function webConfig(opts: WebConfigOptions): Linter.Config[] {
  const scopeAllowlist = opts.scopeAllowlist;
  const dialogAllowlist = opts.dialogAllowlist ?? DEFAULT_DIALOG_ALLOWLIST;

  return [
    ...baseConfig(),
    {
      files: ['**/*.{jsx,tsx}'],
      plugins: {
        react: reactPlugin as unknown as NonNullable<Linter.Config['plugins']>[string],
        'react-hooks': reactHooks as unknown as NonNullable<Linter.Config['plugins']>[string],
        'jsx-a11y': jsxA11y as unknown as NonNullable<Linter.Config['plugins']>[string],
        hivekitchen: hivekitchenPlugin as unknown as NonNullable<Linter.Config['plugins']>[string],
      },
      languageOptions: {
        parserOptions: {
          ecmaFeatures: { jsx: true },
        },
      },
      settings: {
        react: { version: 'detect' },
      },
      rules: {
        ...(reactPlugin.configs?.recommended?.rules ?? {}),
        ...(reactHooks.configs?.recommended?.rules ?? {}),
        ...(jsxA11y.flatConfigs?.strict?.rules ?? jsxA11y.configs?.strict?.rules ?? {}),
        'react/react-in-jsx-scope': 'off',
        'react/prop-types': 'off',
        'hivekitchen/no-cross-scope-component': ['error', { scopeAllowlist }],
        'hivekitchen/no-dialog-outside-allowlist': ['error', { allowlist: dialogAllowlist }],
      },
    },
  ];
}

const API_ELEMENTS = [
  { type: 'api-agents', pattern: 'apps/api/src/agents/**/*' },
  {
    type: 'api-routes',
    pattern: ['apps/api/src/**/*.routes.ts', 'apps/api/src/routes/**/*'],
  },
  { type: 'api-plugins', pattern: 'apps/api/src/plugins/**/*' },
  { type: 'api-modules', pattern: 'apps/api/src/modules/**/*' },
  { type: 'api-audit', pattern: 'apps/api/src/audit/**/*' },
  { type: 'api-repository', pattern: 'apps/api/src/**/*.repository.ts' },
];

const VENDOR_SDK_PATTERNS = [
  'openai',
  '@openai/*',
  '@elevenlabs/*',
  'stripe',
  '@sendgrid/*',
  'twilio',
  'ioredis',
  'bullmq',
];

export function apiConfig(): Linter.Config[] {
  return [
    ...baseConfig(),
    {
      files: ['apps/api/src/**/*.ts'],
      plugins: {
        boundaries: boundariesPlugin as unknown as NonNullable<Linter.Config['plugins']>[string],
      },
      settings: {
        'boundaries/elements': API_ELEMENTS,
      },
      rules: {
        'boundaries/element-types': [
          'error',
          {
            default: 'allow',
            rules: [
              {
                from: 'api-agents',
                disallow: ['api-routes'],
                message: 'Agent modules cannot import route handlers',
              },
            ],
          },
        ],
      },
    },
    {
      files: ['apps/api/src/**/*.ts'],
      ignores: ['apps/api/src/plugins/**/*', 'apps/api/src/**/*.repository.ts'],
      rules: {
        'no-console': 'error',
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['@supabase/**'],
                message: 'Supabase must be imported only in plugins/ or *.repository.ts files',
                allowTypeImports: true,
              },
              {
                group: VENDOR_SDK_PATTERNS,
                message: 'SDK clients must only be imported inside apps/api/src/plugins/',
                allowTypeImports: true,
              },
            ],
          },
        ],
      },
    },
    {
      files: ['apps/api/src/**/*.ts'],
      ignores: ['apps/api/src/plugins/**/*', 'apps/api/src/audit/**/*'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector:
              "ImportExpression[source.value=/^(@supabase\\/|openai$|@openai\\/|@elevenlabs\\/|stripe$|@sendgrid\\/|twilio$|ioredis$|bullmq$)/]",
            message:
              'Dynamic import() of vendor SDKs is restricted — only allowed inside apps/api/src/plugins/ or *.repository.ts',
          },
          {
            selector:
              "CallExpression[callee.name='require'][arguments.0.value=/^(@supabase\\/|openai$|@openai\\/|@elevenlabs\\/|stripe$|@sendgrid\\/|twilio$|ioredis$|bullmq$)/]",
            message:
              'require() of vendor SDKs is restricted — only allowed inside apps/api/src/plugins/ or *.repository.ts',
          },
          {
            selector:
              "CallExpression[callee.property.name='insert'][callee.object.type='CallExpression'][callee.object.callee.property.name='from'][callee.object.arguments.0.value='audit_log']",
            message: 'audit_log writes must live in apps/api/src/audit/',
          },
        ],
      },
    },
  ];
}
