import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['line']] : [['list']],
  use: {
    baseURL: (process.env.PRODUCTION_SMOKE_BASE_URL || 'https://comms-dashboard-navy.vercel.app').replace(/\/$/, ''),
    browserName: 'chromium',
    headless: true,
    ignoreHTTPSErrors: false,
  },
});
