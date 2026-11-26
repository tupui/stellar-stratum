import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against Stellar testnet only (see tests/testnet-flows.spec.ts).
 * @see https://playwright.dev/docs/test-configuration
 */
const PORT = 5190;

export default defineConfig({
  testDir: './tests',
  // Every test funds its own throwaway accounts, so the tests run side by side.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: 'list',
  // A testnet submission lands in about 5 s; a test that waits longer than this is stuck.
  timeout: 90_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
