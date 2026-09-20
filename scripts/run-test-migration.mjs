import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { acquireE2eResourceLock } from './run-e2e.mjs';
import { captureTestEnvironment } from './test-environment.mjs';

function currentPnpmVersion() {
  const match = (process.env.npm_config_user_agent ?? '').match(
    /\bpnpm\/([^\s]+)/,
  );
  if (!match) throw new Error('Run the test migration through pnpm');
  return match[1];
}

export function runTestMigration(root, dependencies = {}) {
  const pnpmVersion = dependencies.pnpmVersion ?? currentPnpmVersion();
  const captureEnvironment =
    dependencies.captureEnvironment ?? captureTestEnvironment;
  const acquireLock = dependencies.acquireLock ?? acquireE2eResourceLock;
  const spawn = dependencies.spawn ?? spawnSync;
  const environment = captureEnvironment(root, { pnpmVersion });
  const lock = acquireLock();
  try {
    const backend = resolve(root, 'backend');
    const result = spawn(
      process.execPath,
      [
        resolve(backend, 'node_modules/prisma/build/index.js'),
        'migrate',
        'deploy',
      ],
      {
        cwd: backend,
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
    process.exitCode = runTestMigration(root);
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Test migration failed',
    );
    process.exitCode = 1;
  }
}
