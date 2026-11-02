import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'vitest';
import { assertBatch2LeadImportAdmission } from './batch2-lead-import-admission.mjs';
import { runE2e } from './run-e2e.mjs';

const root = process.cwd();
test.each([
  ['scripts/managed-e2e-admission.mjs', 'const project ='],
  ['tests/support/case-execution-record-edit-database.mjs', 'const root ='],
])(
  'actual module location survives ESM and CJS: %s',
  async (sourcePath, endMarker) => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { fileURLToPath } = await import('node:url');
    const { getCallSites } = await import('node:util');
    const vm = await import('node:vm');
    const { spawnSync } = await import('node:child_process');
    const { default: ts } = await import('typescript');
    const source = fs.readFileSync(resolve(root, sourcePath), 'utf8');
    const start = source.indexOf('const moduleScriptName =');
    const end = source.indexOf(endMarker, start);
    assert.ok(start >= 0 && end > start);
    const locator = source.slice(start, end);
    const directory = fs.mkdtempSync(
      resolve(tmpdir(), 'dev-cor-module-location-'),
    );
    const filename = resolve(directory, 'location.mjs');
    try {
      fs.writeFileSync(
        filename,
        "import assert from 'node:assert/strict';import { getCallSites } from 'node:util';import { isAbsolute } from 'node:path';import { fileURLToPath } from 'node:url';\n" +
          locator +
          '\nconsole.log(modulePath);\n',
      );
      const native = spawnSync(process.execPath, [filename], {
        encoding: 'utf8',
      });
      assert.equal(native.status, 0, native.stderr);
      assert.equal(native.stdout.trim(), filename);
      const code = ts.transpileModule(
        locator + '\nexports.modulePath = modulePath;',
        {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2023,
          },
        },
      ).outputText;
      const run = (calls) => {
        const exports = {};
        vm.runInNewContext(
          code,
          {
            exports,
            assert,
            getCallSites: calls,
            isAbsolute: path.isAbsolute,
            fileURLToPath,
          },
          { filename },
        );
        return exports.modulePath;
      };
      assert.equal(run(getCallSites), filename);
      for (const scriptName of [
        undefined,
        '',
        'evalmachine.<anonymous>',
        'https://example.com/module.mjs',
        'node:internal',
      ])
        assert.throws(() => run(() => [{ scriptName }]));
      assert.throws(() => run(() => []));
    } finally {
      fs.unlinkSync(filename);
      fs.rmdirSync(directory);
    }
  },
);
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

test('admission survives the root config CommonJS transformation and keeps selection guards', async () => {
  const { readFileSync } = await import('node:fs');
  const vm = await import('node:vm');
  const { createRequire } = await import('node:module');
  const { default: ts } = await import('typescript');
  const nativeRequire = createRequire(resolve(root, 'package.json'));
  const output = ts.transpileModule(
    readFileSync(
      resolve(root, 'scripts/batch2-lead-import-admission.mjs'),
      'utf8',
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2023,
        allowJs: true,
      },
    },
  ).outputText;
  const exports = {};
  const unexpected = () => {
    throw Error(
      'Discovery must not capture an environment or validate a database target',
    );
  };
  vm.runInNewContext(output, {
    exports,
    process,
    require(name) {
      if (name === './test-environment.mjs')
        return { captureTestEnvironment: unexpected };
      if (name === '../tests/support/batch2-current-managed-target.mjs')
        return {
          isBatch2Current269: () => false,
          assertBatch2Current269Target: unexpected,
        };
      return nativeRequire(name);
    },
  });
  assert.equal(
    exports.assertBatch2LeadImportAdmission(root, ['--list']),
    false,
  );
  assert.equal(
    exports.assertBatch2LeadImportAdmission(root, ['tests/e2e/auth.spec.ts']),
    false,
  );
  assert.throws(
    () => exports.assertBatch2LeadImportAdmission(root, [importFile]),
    /Batch-2 lead import requires --config/u,
  );
  assert.doesNotThrow(() =>
    exports.assertBatch2LeadImportAdmission(root, [
      '--config',
      config,
      importFile,
    ]),
  );
});
