import { defineConfig, devices } from '@playwright/test';
import { assertSectionRecordUiConfigAdmission } from '../../scripts/case-section-record-ui-admission.mjs';
import { assertBatch2ImportOwnedRuntime } from './batch2-lead-import-fixture.mjs';

// Use only for the I suite. The standard run-e2e capture and resource lock
// remain in force; this config never starts the normal backend image worker.
assertSectionRecordUiConfigAdmission(process.cwd(), process.argv.slice(2));
assertBatch2ImportOwnedRuntime();

export default defineConfig({
  testDir: '../e2e',
  testMatch: '**/batch2-lead-import.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:5174', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node tests/support/batch2-lead-import-app.mjs',
      cwd: process.cwd(),
      url: 'http://127.0.0.1:3101/api/v1/health',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command:
        'node frontend/node_modules/vite/bin/vite.js frontend --host 127.0.0.1 --port 5174 --strictPort',
      cwd: process.cwd(),
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
