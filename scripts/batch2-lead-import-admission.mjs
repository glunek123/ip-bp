import { captureTestEnvironment } from './test-environment.mjs';
import {
  isBatch2Current269,
  assertBatch2Current269Target,
} from '../tests/support/batch2-current-managed-target.mjs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const playwrightRequire = createRequire(
  require.resolve('@playwright/test/package.json'),
);
const { program } = playwrightRequire('playwright/lib/program');
const { suiteUtils } = playwrightRequire('playwright/lib/common');

function controlledConfigRequired() {
  return new Error(
    'Batch-2 lead import requires --config tests/support/batch2-lead-import.config.ts before Playwright starts',
  );
}

// Parse Playwright's own test options and file filters before environment
// capture. A filename substring cannot safely identify regex or all-file runs.
export function assertBatch2LeadImportAdmission(root, args) {
  let selection;
  try {
    const original = program.commands.find(
      (command) => command.name() === 'test',
    );
    const command = original
      .createCommand()
      .exitOverride()
      .configureOutput({ writeErr() {}, writeOut() {} });
    for (const option of original.options) command.addOption(option);
    const parsed = command.parseOptions(args);
    if (parsed.unknown.length !== 0) throw new Error('Unknown test selection');
    const options = command.opts();
    if (
      options.ui ||
      options.uiHost ||
      options.uiPort ||
      process.env.PWTEST_WATCH
    )
      throw new Error('Interactive selection is not fixed');
    const separator = args.indexOf('--');
    const postDashCount = separator < 0 ? 0 : args.length - separator - 1;
    const filters = parsed.operands.slice(
      0,
      parsed.operands.length - postDashCount,
    );
    selection = {
      list: options.list === true,
      includesImport:
        filters.length === 0 ||
        suiteUtils
          .createFiltersFromArguments(filters)
          .fileFilter(resolve(root, 'tests/e2e/batch2-lead-import.spec.ts')),
      config: options.config,
      filters,
    };
  } catch {
    throw controlledConfigRequired();
  }
  if (selection.list || !selection.includesImport) return false;
  if (isBatch2Current269()) {
    const exact = new Set(
      [
        'tests/e2e/batch2-lead-import.spec.ts',
        'tests/e2e/batch2-lead-import-migration.spec.ts',
        'tests/e2e/batch2-lead-import-upgrade.spec.ts',
      ].map((path) => path.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&') + '$'),
    );
    if (
      selection.config !== undefined ||
      selection.filters.length === 0 ||
      !selection.filters.every((filter) => exact.has(filter)) ||
      new Set(selection.filters).size !== selection.filters.length
    )
      throw controlledConfigRequired();
    const captured = captureTestEnvironment(root, { pnpmVersion: '11.27.0' });
    assertBatch2Current269Target(captured.childEnvironment, root);
    return true;
  }
  const expected = resolve(root, 'tests/support/batch2-lead-import.config.ts');
  if (
    typeof selection.config !== 'string' ||
    resolve(root, selection.config) !== expected
  )
    throw controlledConfigRequired();
}
