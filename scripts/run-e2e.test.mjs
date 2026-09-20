import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireE2eResourceLock, runE2e } from './run-e2e.mjs';

const environment = {
  fingerprint: 'a'.repeat(64),
  metadata: {
    node: 'v24.21.0',
    pnpm: '11.27.0',
    platform: 'win32',
    architecture: 'x64',
  },
  childEnvironment: {
    NODE_ENV: 'test',
    DATABASE_URL: 'secret-database-url',
  },
};

test('uses one environment snapshot and one shared-resource lock', () => {
  let captures = 0;
  let released = 0;
  let spawned;
  const status = runE2e('C:/repo', ['tests/e2e/auth.spec.ts'], {
    pnpmVersion: '11.27.0',
    captureEnvironment: () => {
      captures += 1;
      return environment;
    },
    acquireLock: () => ({ release: () => (released += 1) }),
    spawn: (command, args, options) => {
      spawned = { command, args, options };
      return { status: 0 };
    },
  });

  assert.equal(status, 0);
  assert.equal(captures, 1);
  assert.equal(released, 1);
  assert.equal(spawned.command, process.execPath);
  assert.deepEqual(spawned.args.slice(-2), ['test', 'tests/e2e/auth.spec.ts']);
  assert.equal(spawned.options.env, environment.childEnvironment);
});

test('starts no child when environment or lock preconditions fail', () => {
  let spawnCalls = 0;
  assert.throws(
    () =>
      runE2e('C:/repo', [], {
        pnpmVersion: '11.27.0',
        captureEnvironment: () => {
          throw new Error('environment rejected');
        },
        spawn: () => {
          spawnCalls += 1;
        },
      }),
    /environment rejected/,
  );
  assert.throws(
    () =>
      runE2e('C:/repo', [], {
        pnpmVersion: '11.27.0',
        captureEnvironment: () => environment,
        acquireLock: () => {
          throw new Error('resource locked');
        },
        spawn: () => {
          spawnCalls += 1;
        },
      }),
    /resource locked/,
  );
  assert.equal(spawnCalls, 0);
});

test('serializes the actual shared database and fixed ports across clones', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dev-cor-e2e-resource-test-'));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const first = acquireE2eResourceLock({ lockRoot: root, ownerPid: 101 });
  assert.throws(
    () => acquireE2eResourceLock({ lockRoot: root, ownerPid: 202 }),
    /already locked/i,
  );
  first.release();
  const second = acquireE2eResourceLock({ lockRoot: root, ownerPid: 202 });
  second.release();
});
