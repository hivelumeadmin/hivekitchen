import { describe, it, expect } from 'vitest';
import { scopeAllowlist as fromTs } from '../scope-allowlist.config.js';
// @ts-expect-error — plain-JS twin; no types by design.
import { scopeAllowlist as fromJs } from '../scope-allowlist.eslint.js';

describe('scope-allowlist sync', () => {
  it('TypeScript source of truth matches the plain-JS ESLint twin', () => {
    expect(fromJs).toEqual(fromTs);
  });
});
