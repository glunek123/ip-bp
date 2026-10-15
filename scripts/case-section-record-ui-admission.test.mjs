import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { test, vi } from 'vitest';
import {
  assertSectionRecordUiAdmission,
  assertSectionRecordUiConfigAdmission,
} from './case-section-record-ui-admission.mjs';

const root = process.cwd();
const ui = 'tests/e2e/case-section-record-ui.spec.ts';
const hearing = 'tests/e2e/hearing-correction-chain.spec.ts';
const pending = (error) => {
  assert.equal(error.code, 'NORMAL_SOURCE_PERMISSION_PENDING');
  assert.equal(error.finding, 'I-SECTION-UI-GRANT01');
  return true;
};

test.each([
  [],
  [ui],
  [`${ui}:695`],
  [`${ui}:695:5`],
  ['tests/e2e'],
  ['case-.*-ui'],
  [hearing, ui],
  ['--', ui],
  ['--', ui, '--list'],
  ['--grep=--list', ui],
  ['--grep', '--list', ui],
  ['--grep-invert=--list', ui],
  ['--project=chromium'],
  ['--last-failed'],
  ['--unknown', hearing],
  ['--unknown', '--list', ui],
  ['--list', '--ui', ui],
  ['--list', '--ui-host=127.0.0.1', ui],
  ['--list', '--ui-port=0', ui],
  ['['],
  ['--grep'],
])('rejects pending or unrecognized selection %j', (...args) => {
  assert.throws(() => assertSectionRecordUiAdmission(root, args), pending);
});

test.each([
  [hearing],
  [`${hearing}:20`],
  ['tests/e2e/auth.spec.ts'],
  [hearing, '--', ui],
])('preserves an unrelated explicit file selection %j', (...args) => {
  assert.doesNotThrow(() => assertSectionRecordUiAdmission(root, args));
});

test.each([['--list', ui], [ui, '--list'], ['--list']])(
  'permits actual discovery %j without granting later execution',
  (...args) => {
    assert.doesNotThrow(() => assertSectionRecordUiAdmission(root, args));
    assert.throws(() => assertSectionRecordUiAdmission(root, [ui]), pending);
  },
);

test('root configuration rejects direct normal CLI before registering global setup', () => {
  assert.throws(
    () => assertSectionRecordUiConfigAdmission(root, ['test', ui]),
    pending,
  );
  assert.throws(
    () => assertSectionRecordUiConfigAdmission(root, ['test']),
    pending,
  );
  assert.throws(() => assertSectionRecordUiConfigAdmission(root, []), pending);
  assert.throws(
    () =>
      assertSectionRecordUiConfigAdmission(root, ['unrecognized', '--list']),
    pending,
  );
  assert.doesNotThrow(() =>
    assertSectionRecordUiConfigAdmission(root, ['test', '--list', ui]),
  );
  assert.doesNotThrow(() =>
    assertSectionRecordUiConfigAdmission(root, ['test', hearing]),
  );
});

test.each(['worker/workerProcessEntry.js', 'loader/loaderProcessEntry.js'])(
  'permits only installed framework IPC config replay in %s',
  (entry) => {
    const require = createRequire(import.meta.url);
    const playwrightRequire = createRequire(
      require.resolve('@playwright/test/package.json'),
    );
    const packageRoot = dirname(
      playwrightRequire.resolve('playwright/package.json'),
    );
    try {
      vi.stubGlobal('process', {
        ...process,
        argv: [process.execPath, resolve(packageRoot, 'lib', entry)],
        connected: true,
        send() {},
      });
      assert.doesNotThrow(() => assertSectionRecordUiConfigAdmission(root, []));
      process.connected = false;
      assert.throws(
        () => assertSectionRecordUiConfigAdmission(root, []),
        pending,
      );
      process.connected = true;
      process.argv[1] = resolve(root, 'unrecognized.js');
      assert.throws(
        () => assertSectionRecordUiConfigAdmission(root, []),
        pending,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  },
);

test('environment flags cannot unlock direct normal UI selection', () => {
  vi.stubEnv('TEST_WORKER_INDEX', '0');
  vi.stubEnv('DEV_COR_SECTION_UI_ALLOW', '1');
  try {
    assert.throws(
      () => assertSectionRecordUiConfigAdmission(root, ['test', ui]),
      pending,
    );
  } finally {
    vi.unstubAllEnvs();
  }
});

test('watch mode with --list is not discovery-only admission', () => {
  vi.stubEnv('PWTEST_WATCH', '1');
  try {
    assert.throws(
      () => assertSectionRecordUiAdmission(root, ['--list', ui]),
      pending,
    );
  } finally {
    vi.unstubAllEnvs();
  }
});
