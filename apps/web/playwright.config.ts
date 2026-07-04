import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test',
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    // The Workbox service worker (vite-plugin-pwa) intercepts fetches at the SW
    // layer, BYPASSING page.route() mocks — in full-suite runs this produced
    // ~99 reproducible failures (see epic-13 retro, 2026-07-03). Blocking SW
    // registration keeps every spec's route mocks authoritative.
    serviceWorkers: 'block',
  },
  webServer: {
    command: 'pnpm preview --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
