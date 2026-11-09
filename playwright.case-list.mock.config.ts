import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

const port = 5175;
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/browser',
  testMatch: ['case-list-preferences-browser.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: resolve(
    __dirname,
    '.local/case-workflow-acceptance/mock-list/test-results',
  ),
  use: {
    baseURL: origin,
    testIdAttribute: 'data-test',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command:
        'node frontend/node_modules/vite/bin/vite.js frontend --host 127.0.0.1 --port 5175 --strictPort',
      cwd: resolve(__dirname),
      url: origin,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
