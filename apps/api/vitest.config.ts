import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      'test/**/*.test.ts',
      'test/**/*.int.test.ts',
      // Slice 2.6-s8 — one-shot backfill script tests.
      'scripts/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
    },
  },
});
