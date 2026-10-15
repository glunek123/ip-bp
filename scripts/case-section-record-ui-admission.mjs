import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { assertSectionRecordUiSourceReady } from '../tests/support/case-section-record-ui-database.mjs';

// Playwright transforms config imports to CJS in this CommonJS project; its
// transformed module has __filename. The native ESM runner runs from project root.
/* global __filename */
const require = createRequire(
  typeof __filename === 'string'
    ? __filename
    : resolve(process.cwd(), 'scripts/case-section-record-ui-admission.mjs'),
);
const playwrightRequire = createRequire(
  require.resolve('@playwright/test/package.json'),
);
const { program } = playwrightRequire('playwright/lib/program');
const { suiteUtils } = playwrightRequire('playwright/lib/common');
const playwrightRoot = dirname(
  playwrightRequire.resolve('playwright/package.json'),
);

// Use the locked Playwright option definitions and file/line matching. Parsing
// options here never invokes a CLI action, loads tests, or starts global setup.
export function assertSectionRecordUiAdmission(root, args) {
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
    // UI/watch modes can execute later selections even when --list is present.
    if (
      options.ui ||
      options.uiHost ||
      options.uiPort ||
      process.env.PWTEST_WATCH
    ) {
      throw new Error('Interactive selection is not fixed');
    }
    // Playwright's test action removes arguments after `--` from file filters.
    const separator = args.indexOf('--');
    const postDashCount = separator < 0 ? 0 : args.length - separator - 1;
    const filters = parsed.operands.slice(
      0,
      parsed.operands.length - postDashCount,
    );
    selection = {
      list: options.list === true,
      includesPendingUi:
        filters.length === 0 ||
        suiteUtils
          .createFiltersFromArguments(filters)
          .fileFilter(
            resolve(root, 'tests/e2e/case-section-record-ui.spec.ts'),
          ),
    };
  } catch {
    // An unrecognized selector must not reach capture or webServer setup.
    assertSectionRecordUiSourceReady();
  }
  if (!selection.list && selection.includesPendingUi) {
    assertSectionRecordUiSourceReady();
  }
}

export function assertSectionRecordUiConfigAdmission(root, argv) {
  // Framework workers/loaders deserialize the already admitted configuration.
  // They have no global setup/webServer lifecycle. Only the installed framework
  // entry with its live IPC channel qualifies; no environment switch grants this.
  const entry = process.argv[1] && resolve(process.argv[1]);
  if (
    process.connected === true &&
    typeof process.send === 'function' &&
    [
      resolve(playwrightRoot, 'lib/worker/workerProcessEntry.js'),
      resolve(playwrightRoot, 'lib/loader/loaderProcessEntry.js'),
    ].includes(entry)
  )
    return;
  // Direct CLI and the protected runner both use `test ...`. API/config imports
  // without that selection cannot prove the pending suite is excluded.
  if (argv[0] !== 'test') assertSectionRecordUiSourceReady();
  assertSectionRecordUiAdmission(root, argv.slice(1));
}
