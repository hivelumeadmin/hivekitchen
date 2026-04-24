import { describe, it, expect } from 'vitest';
import { webConfig, apiConfig, baseConfig } from './index.js';

type Block = { rules?: Record<string, unknown> };

function allRules(configs: readonly unknown[]): Set<string> {
  const names = new Set<string>();
  for (const block of configs) {
    const rules = (block as Block).rules;
    if (!rules) continue;
    for (const key of Object.keys(rules)) names.add(key);
  }
  return names;
}

describe('baseConfig', () => {
  it('enables hivekitchen logical-properties rule and type-import hygiene', () => {
    const rules = allRules(baseConfig());
    expect(rules.has('hivekitchen/logical-properties-only')).toBe(true);
    expect(rules.has('@typescript-eslint/consistent-type-imports')).toBe(true);
  });
});

describe('webConfig', () => {
  const cfg = webConfig({
    scopeAllowlist: {
      'app-scope': { forbiddenComponents: [] },
      'child-scope': { forbiddenComponents: ['Command'] },
      'grandparent-scope': { forbiddenComponents: [] },
      'ops-scope': { forbiddenComponents: [] },
    },
  });
  const rules = allRules(cfg);

  it('loads React recommended rules (guards against plugin config rename to flat/recommended)', () => {
    const hasReactRule = [...rules].some((r) => r.startsWith('react/'));
    expect(hasReactRule).toBe(true);
  });

  it('loads react-hooks rules', () => {
    expect(rules.has('react-hooks/rules-of-hooks')).toBe(true);
  });

  it('loads jsx-a11y strict rules', () => {
    const hasJsxA11y = [...rules].some((r) => r.startsWith('jsx-a11y/'));
    expect(hasJsxA11y).toBe(true);
  });

  it('registers the three hivekitchen scope rules', () => {
    expect(rules.has('hivekitchen/no-cross-scope-component')).toBe(true);
    expect(rules.has('hivekitchen/no-dialog-outside-allowlist')).toBe(true);
    expect(rules.has('hivekitchen/logical-properties-only')).toBe(true);
  });
});

describe('apiConfig', () => {
  const rules = allRules(apiConfig());

  it('registers boundaries element-types', () => {
    expect(rules.has('boundaries/element-types')).toBe(true);
  });

  it('registers no-restricted-imports for vendor SDKs', () => {
    expect(rules.has('no-restricted-imports')).toBe(true);
  });

  it('registers no-restricted-syntax (dynamic import + audit_log)', () => {
    expect(rules.has('no-restricted-syntax')).toBe(true);
  });
});
