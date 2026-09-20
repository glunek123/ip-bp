import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { acquireLocalLock } from './local-lock.mjs';
import { captureTestEnvironment } from './test-environment.mjs';

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

export function acquireE2eResourceLock(options = {}) {
  const lockRoot =
    options.lockRoot ?? join(tmpdir(), 'dev-cor-shared-e2e-locks');
  const resourceHash = createHash('sha256')
    .update(e2eResourceIdentity)
    .digest('hex')
    .slice(0, 24);
  return acquireLocalLock(lockRoot, `resource-${resourceHash}`, {
    ownerPid: options.ownerPid,
  });
}

export function runE2e(root, args, dependencies = {}) {
  const pnpmVersion = dependencies.pnpmVersion ?? currentPnpmVersion();
  const captureEnvironment =
    dependencies.captureEnvironment ?? captureTestEnvironment;
  const acquireLock = dependencies.acquireLock ?? acquireE2eResourceLock;
  const spawn = dependencies.spawn ?? spawnSync;
  const environment = captureEnvironment(root, { pnpmVersion });
  const lock = acquireLock();
  try {
    const result = spawn(
      process.execPath,
      [resolve(root, 'node_modules/@playwright/test/cli.js'), 'test', ...args],
      {
        cwd: root,
        stdio: 'inherit',
        env: environment.childEnvironment,
      },
    );
    if (result.error) throw result.error;
    return result.status ?? 1;
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
    process.exitCode = runE2e(root, process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'E2E failed');
    process.exitCode = 1;
  }
}
