import { uiConfig } from '@hivekitchen/eslint-config';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '.turbo/**'] },
  ...uiConfig(),
);
