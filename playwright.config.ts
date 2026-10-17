import { defineConfig, devices } from '@playwright/test';
import { assertSectionRecordUiConfigAdmission } from './scripts/case-section-record-ui-admission.mjs';
import {
  createManagedTestRuntime,
  planManagedTestRuntime,
} from './scripts/managed-test-runtime.mjs';

// Global setup/webServer runs before spec loading, so spec guards are too late.
assertSectionRecordUiConfigAdmission(__dirname, process.argv.slice(2));
const runtime = createManagedTestRuntime(__dirname, 'ui');
planManagedTestRuntime(runtime);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: runtime.baseURL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: runtime.webServer,
});
