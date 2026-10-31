import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { lstatSync, realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { acquireLocalLock } from './local-lock.mjs';
import { captureTestEnvironment } from './test-environment.mjs';
import { assertSectionRecordUiAdmission } from './case-section-record-ui-admission.mjs';
import { assertBatch2LeadImportAdmission } from './batch2-lead-import-admission.mjs';
import { admitManagedE2e } from './managed-e2e-admission.mjs';
import {
  clearManagedWorkerContext,
  createManagedWorkerEnvironment,
} from './managed-e2e-worker-admission.mjs';

// Keep this legacy lock key stable across checkouts, even when the database port
// changes: old and new candidates still share the application ports below.
// The database connection comes from captureTestEnvironment, not this key.
const e2eResourceIdentity = [
  'postgresql://127.0.0.1:55433/dev_cor_test',
  'http://127.0.0.1:3101',
  'http://127.0.0.1:5174',
].join('|');

function currentPnpmVersion() {
  const match = (process.env.npm_config_user_agent ?? '').match(
    /\bpnpm\/([^\s]+)/,
  );
  if (!match) throw new Error('Run E2E through pnpm');
  return match[1];
}

export function e2eResourceLockRoot() {
  // On the managed Windows host this is the original user Temp directory.
  // Runner-local TMP/TEMP overrides must not create a second resource lock.
  const temporaryRoot =
    process.platform === 'win32'
      ? join(
          process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'),
          'Temp',
        )
      : tmpdir();
  return join(temporaryRoot, 'dev-cor-shared-e2e-locks');
}

export function acquireE2eResourceLock(options = {}) {
  const lockRoot = options.lockRoot ?? e2eResourceLockRoot();
  const resourceHash = createHash('sha256')
    .update(e2eResourceIdentity)
    .digest('hex')
    .slice(0, 24);
  return acquireLocalLock(lockRoot, `resource-${resourceHash}`, {
    ownerPid: options.ownerPid,
  });
}

function managedSelection(root, args) {
  if (!args.some((arg) => arg.startsWith('--managed-e2e-'))) return null;
  const flags = new Map();
  const files = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const equals = arg.indexOf('=');
    const name = equals < 0 ? arg : arg.slice(0, equals);
    if (
      name === '--managed-e2e-manifest' ||
      name === '--managed-e2e-manifest-sha256'
    ) {
      if (flags.has(name)) throw new Error('Duplicate managed E2E option');
      const value = equals < 0 ? args[++index] : arg.slice(equals + 1);
      if (!value || value.startsWith('--'))
        throw new Error('Missing managed E2E option value');
      flags.set(name, value);
    } else {
      if (!/^tests\/e2e\/[a-z0-9-]+\.spec\.ts$/u.test(arg))
        throw new Error('Managed E2E requires exact spec files only');
      if (
        arg === 'tests/e2e/case-section-record-ui.spec.ts' ||
        arg === 'tests/e2e/batch2-lead-import.spec.ts'
      )
        throw new Error('Managed H/import runtime is not wired');
      const path = resolve(root, arg);
      const stat = lstatSync(path);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        realpathSync.native(path) !== path
      )
        throw new Error('Managed E2E requires existing regular spec files');
      if (files.includes(arg)) throw new Error('Duplicate managed E2E spec');
      files.push(arg);
    }
  }
  const manifestPath = flags.get('--managed-e2e-manifest');
  const manifestSha256 = flags.get('--managed-e2e-manifest-sha256');
  if (
    !manifestPath ||
    !isAbsolute(manifestPath) ||
    !/^[a-f0-9]{64}$/u.test(manifestSha256 ?? '') ||
    files.length === 0
  )
    throw new Error('Managed E2E requires manifest path, raw SHA and specs');
  // Playwright treats file operands as regular expressions. Escape literal dots
  // and anchor the suffix so a supposedly exact file cannot select a sibling.
  return {
    manifestPath,
    manifestSha256,
    files,
    args: files.map((file) => `${file.replaceAll('.', '\\.')}$`),
  };
}

function startPlaywright(root, args, environment, spawn) {
  const result = spawn(
    process.execPath,
    [resolve(root, 'node_modules/@playwright/test/cli.js'), 'test', ...args],
    { cwd: root, stdio: 'inherit', env: environment.childEnvironment },
  );
  if (result.error) throw result.error;
  return result.status ?? 1;
}

async function runManagedE2e(root, selection, dependencies) {
  const pnpmVersion = dependencies.pnpmVersion ?? currentPnpmVersion();
  const captureEnvironment =
    dependencies.captureEnvironment ?? captureTestEnvironment;
  const acquireLock = dependencies.acquireLock ?? acquireE2eResourceLock;
  const spawn = dependencies.spawn ?? spawnSync;
  const lock = acquireLock();
  try {
    const environment = captureEnvironment(root, { pnpmVersion });
    const admission = await admitManagedE2e({
      root,
      manifestPath: selection.manifestPath,
      manifestSha256: selection.manifestSha256,
      databaseUrl: environment.childEnvironment.DATABASE_URL,
    });
    if (
      admission?.kind !== 'controlled-managed-e2e-readonly-admission' ||
      admission.manifestSha256 !== selection.manifestSha256
    )
      throw new Error('Managed E2E admission did not return its bound receipt');
    const childEnvironment = createManagedWorkerEnvironment({
      root,
      environment: environment.childEnvironment,
      selection,
      admission,
    });
    return startPlaywright(root, selection.args, { childEnvironment }, spawn);
  } finally {
    lock.release();
  }
}

export function runE2e(root, args, dependencies = {}) {
  const managed = managedSelection(root, args);
  const selectedArgs = managed?.args ?? args;
  assertSectionRecordUiAdmission(root, selectedArgs);
  assertBatch2LeadImportAdmission(root, selectedArgs);
  if (managed) return runManagedE2e(root, managed, dependencies);
  const pnpmVersion = dependencies.pnpmVersion ?? currentPnpmVersion();
  const captureEnvironment =
    dependencies.captureEnvironment ?? captureTestEnvironment;
  const acquireLock = dependencies.acquireLock ?? acquireE2eResourceLock;
  const spawn = dependencies.spawn ?? spawnSync;
  const environment = captureEnvironment(root, { pnpmVersion });
  const lock = acquireLock();
  try {
    return startPlaywright(
      root,
      args,
      {
        childEnvironment: clearManagedWorkerContext(
          environment.childEnvironment,
        ),
      },
      spawn,
    );
  } finally {
    lock.release();
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    const root = fileURLToPath(new URL('..', import.meta.url));
    // Keep the module synchronously importable by existing Playwright helpers.
    // Only the explicit managed branch returns a promise.
    Promise.resolve(runE2e(root, process.argv.slice(2))).then(
      (status) => {
        process.exitCode = status;
      },
      (error) => {
        console.error(error instanceof Error ? error.message : 'E2E failed');
        process.exitCode = 1;
      },
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'E2E failed');
    process.exitCode = 1;
  }
}
