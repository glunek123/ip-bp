import { defineConfig, devices } from '@playwright/test';
import { assertSectionRecordUiConfigAdmission } from './scripts/case-section-record-ui-admission.mjs';

// Global setup/webServer runs before spec loading, so spec guards are too late.
assertSectionRecordUiConfigAdmission(__dirname, process.argv.slice(2));

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:5174', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node backend/dist/main.js',
      url: 'http://127.0.0.1:3101/api/v1/health',
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command:
        'node frontend/node_modules/vite/bin/vite.js frontend --host 127.0.0.1 --port 5174 --strictPort',
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});
