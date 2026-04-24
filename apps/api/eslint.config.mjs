import { apiConfig } from '@hivekitchen/eslint-config';
import tseslint from 'typescript-eslint';

// apiConfig() uses 'apps/api/src/**/*.ts' patterns written for repo-root invocation.
// Remap them to 'src/**/*.ts' since this config is resolved from apps/api/.
function remapPaths(configs) {
  return configs.map((c) => ({
    ...c,
    ...(c.files
      ? {
          files: c.files.map((f) =>
            typeof f === 'string' ? f.replace('apps/api/src/', 'src/') : f,
          ),
        }
      : {}),
    ...(c.ignores
      ? {
          ignores: c.ignores.map((f) =>
            typeof f === 'string' ? f.replace('apps/api/src/', 'src/') : f,
          ),
        }
      : {}),
  }));
}

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '.turbo/**'] },
  ...remapPaths(apiConfig()),
);
