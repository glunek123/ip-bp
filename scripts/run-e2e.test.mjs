import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { acquireE2eResourceLock, runE2e } from './run-e2e.mjs';
import * as resourceRunner from './run-e2e.mjs';

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

test('keeps the Windows legacy lock directory when runner TMP and TEMP change', async () => {
  const legacyRoot = join(
    homedir(),
    'AppData',
    'Local',
    'Temp',
    'dev-cor-shared-e2e-locks',
  );
  const localLock = await import('./local-lock.mjs');
  const acquire = vi
    .spyOn(localLock, 'acquireLocalLock')
    .mockReturnValue({ release() {} });
  try {
    vi.stubGlobal('process', {
      ...process,
      platform: 'win32',
      env: {
        ...process.env,
        TMP: 'C:/runner-temp-a',
        TEMP: 'C:/runner-temp-b',
      },
    });
    assert.equal(resourceRunner.e2eResourceLockRoot(), legacyRoot);
    resourceRunner.acquireE2eResourceLock();
    process.env.TMP = 'C:/another-runner-temp';
    process.env.TEMP = 'C:/another-runner-temp';
    assert.equal(resourceRunner.e2eResourceLockRoot(), legacyRoot);
    resourceRunner.acquireE2eResourceLock();
    assert.equal(acquire.mock.calls.length, 2);
    assert.equal(acquire.mock.calls[0][0], legacyRoot);
    assert.equal(acquire.mock.calls[1][0], legacyRoot);
    assert.equal(acquire.mock.calls[0][1], acquire.mock.calls[1][1]);
  } finally {
    acquire.mockRestore();
    vi.unstubAllGlobals();
  }
});

test.each(['environment', 'connect', 'query', 'end', 'locked'])(
  'NT006 releases its resource lock for %s failure without a real database',
  async (phase) => {
    vi.resetModules();
    const events = [];
    const localLock = await import('./local-lock.mjs');
    const testEnvironment = await import('./test-environment.mjs');
    const requireFromBackend = createRequire(
      join(process.cwd(), 'backend/package.json'),
    );
    const pg = requireFromBackend('pg');
    const client = {
      connect: vi.fn(async () => {
        events.push('connect');
        if (phase === 'connect') throw new Error('offline connect failure');
      }),
      query: vi.fn(async () => {
        events.push('query');
        throw new Error('offline query failure');
      }),
      end: vi.fn(async () => {
        events.push('end');
        if (phase === 'end') throw new Error('offline end failure');
      }),
    };
    vi.spyOn(pg, 'Client').mockImplementation(function () {
      return client;
    });
    vi.spyOn(testEnvironment, 'captureTestEnvironment').mockImplementation(
      () => {
        if (phase === 'environment')
          throw new Error('offline environment failure');
        return environment;
      },
    );
    vi.spyOn(localLock, 'acquireLocalLock').mockImplementation(() => {
      events.push('lock');
      if (phase === 'locked') throw new Error('offline resource locked');
      return { release: () => events.push('release') };
    });
    try {
      await assert.rejects(
        import('../backend/src/modules/leads/core-nt-006-migration-probe.mjs'),
        /offline (environment|connect|query|end|resource locked)/,
      );
      if (phase === 'environment') {
        assert.deepEqual(events, []);
      } else if (phase === 'locked') {
        assert.deepEqual(events, ['lock']);
      } else {
        assert.equal(events[0], 'lock');
        assert.deepEqual(events.slice(-2), ['end', 'release']);
        assert.equal(client.connect.mock.calls.length, 1);
        if (phase === 'connect')
          assert.equal(client.query.mock.calls.length, 0);
      }
    } finally {
      vi.restoreAllMocks();
    }
  },
);
