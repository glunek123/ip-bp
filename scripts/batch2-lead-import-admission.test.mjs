import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'vitest';
import { assertBatch2LeadImportAdmission } from './batch2-lead-import-admission.mjs';
import { runE2e } from './run-e2e.mjs';

const root = process.cwd();
const importFile = 'tests/e2e/batch2-lead-import.spec.ts';
const config = 'tests/support/batch2-lead-import.config.ts';
const rejects = (args) =>
  assert.throws(
    () => assertBatch2LeadImportAdmission(root, args),
    /Batch-2 lead import requires --config/u,
  );

test.each([
  [importFile],
  [`${importFile}:29`],
  ['batch2-lead-import'],
  ['batch2-lead-.*[.]spec[.]ts'],
  ['tests/e2e'],
  ['tests/e2e/auth.spec.ts', importFile],
  [],
  ['--', importFile],
  ['--config=playwright.config.ts', importFile],
  ['--grep=--list', importFile],
])('rejects I selection without its controlled config %j', (...args) => {
  rejects(args);
});

test.each([
  ['--config', config, importFile],
  [`--config=${config}`, importFile],
  ['--config', resolve(root, config), 'batch2-lead-import'],
  ['--config', config],
])('accepts exact I config with Playwright option syntax %j', (...args) => {
  assert.doesNotThrow(() => assertBatch2LeadImportAdmission(root, args));
});

test.each([
  ['tests/e2e/auth.spec.ts'],
  ['tests/e2e/auth.spec.ts', '--', importFile],
  ['--list', importFile],
  ['--list'],
])('does not block an unrelated file or discovery %j', (...args) => {
  assert.doesNotThrow(() => assertBatch2LeadImportAdmission(root, args));
});

test('runner rejects I before runtime, capture, lock, or Playwright child', () => {
  const calls = [];
  assert.throws(
    () =>
      runE2e(root, [importFile], {
        get pnpmVersion() {
          calls.push('runtime');
          return '11.27.0';
        },
        captureEnvironment() {
          calls.push('capture');
        },
        acquireLock() {
          calls.push('lock');
        },
        spawn() {
          calls.push('spawn');
        },
      }),
    /Batch-2 lead import requires --config/u,
  );
  assert.deepEqual(calls, []);
});
