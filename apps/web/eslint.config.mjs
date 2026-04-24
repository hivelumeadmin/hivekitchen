import { webConfig } from '@hivekitchen/eslint-config';
import { scopeAllowlist } from '../../packages/ui/src/scope-allowlist.eslint.js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '.turbo/**'] },
  ...webConfig({ scopeAllowlist }),
);
