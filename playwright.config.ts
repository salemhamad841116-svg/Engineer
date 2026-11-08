import { defineConfig, devices } from '@playwright/test';

// Unset proxy environment variables inside Playwright runner process
delete process.env.http_proxy;
delete process.env.https_proxy;
delete process.env.HTTP_PROXY;
delete process.env.HTTPS_PROXY;
delete process.env.all_proxy;
delete process.env.ALL_PROXY;
process.env.no_proxy = '*';
process.env.NO_PROXY = '*';

export default defineConfig({
  testDir: './e2e',
  timeout: 90000,
  expect: {
    timeout: 15000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],
  use: {
    baseURL: 'http://127.0.0.1:3015',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        headless: true,
      },
    },
  ],
  webServer: {
    command: 'PORT=3015 NODE_ENV=production npx tsx server.ts',
    port: 3015,
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      http_proxy: '',
      https_proxy: '',
      HTTP_PROXY: '',
      HTTPS_PROXY: '',
      no_proxy: '*',
      NO_PROXY: '*',
    },
  },
});
