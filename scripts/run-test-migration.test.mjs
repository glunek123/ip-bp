import { test } from 'vitest';
import assert from 'node:assert/strict';
import { runTestMigration } from './run-test-migration.mjs';

const environment = {
  childEnvironment: {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://fixed-test-database',
  },
};

test('passes the fixed test environment while holding the shared resource lock', () => {
  let released = 0;
  let spawned;
  const status = runTestMigration('C:/repo', {
    pnpmVersion: '11.27.0',
    captureEnvironment: () => environment,
    acquireLock: () => ({ release: () => (released += 1) }),
    spawn: (command, args, options) => {
      spawned = { command, args, options };
      return { status: 0 };
    },
  });

  assert.equal(status, 0);
  assert.equal(released, 1);
  assert.equal(spawned.command, process.execPath);
  assert.deepEqual(spawned.args.slice(-2), ['migrate', 'deploy']);
  assert.equal(spawned.options.cwd, 'C:\\repo\\backend');
  assert.equal(spawned.options.env, environment.childEnvironment);
});

test('a conflicting environment or occupied resource starts no migration child', () => {
  let spawnCalls = 0;
  assert.throws(
    () =>
      runTestMigration('C:/repo', {
        pnpmVersion: '11.27.0',
        captureEnvironment: () => {
          throw new Error(
            'DATABASE_URL conflicts with the fixed E2E environment',
          );
        },
        spawn: () => {
          spawnCalls += 1;
        },
      }),
    /DATABASE_URL conflicts/,
  );
  assert.throws(
    () =>
      runTestMigration('C:/repo', {
        pnpmVersion: '11.27.0',
        captureEnvironment: () => environment,
        acquireLock: () => {
          throw new Error('resource already locked');
        },
        spawn: () => {
          spawnCalls += 1;
        },
      }),
    /already locked/,
  );
  assert.equal(spawnCalls, 0);
});
