import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { acquireE2eResourceLock, runE2e } from './run-e2e.mjs';
import * as resourceRunner from './run-e2e.mjs';
import * as managedAdmission from './managed-e2e-admission.mjs';
import { MANAGED_WORKER_CONTEXT_ENV } from './managed-e2e-worker-admission.mjs';

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

const managedManifest = join(tmpdir(), 'managed-e2e-explicit-manifest.json');
const managedSha = 'b'.repeat(64);
const managedOptions = [
  '--managed-e2e-manifest',
  managedManifest,
  '--managed-e2e-manifest-sha256',
  managedSha,
];
const managedReceipt = {
  kind: 'controlled-managed-e2e-readonly-admission',
  manifestSha256: managedSha,
  runId: '11111111-1111-4111-8111-111111111111',
  parentRunId: '22222222-2222-4222-8222-222222222222',
  containerId: 'c'.repeat(64),
  candidateSha256: 'd'.repeat(64),
  migrationCount: 266,
  actorIds: ['33333333-3333-4333-8333-333333333333'],
};

test('awaits the real admission module before starting exact managed selections', async () => {
  const events = [];
  let finishAdmission;
  const admission = vi
    .spyOn(managedAdmission, 'admitManagedE2e')
    .mockImplementation((input) => {
      events.push('admit');
      assert.deepEqual(input, {
        root: process.cwd(),
        manifestPath: managedManifest,
        manifestSha256: managedSha,
        databaseUrl: environment.childEnvironment.DATABASE_URL,
      });
      return new Promise((resolve) => (finishAdmission = resolve));
    });
  try {
    const pending = runE2e(
      process.cwd(),
      [...managedOptions, 'tests/e2e/auth.spec.ts', 'tests/e2e/cases.spec.ts'],
      {
        pnpmVersion: '11.27.0',
        acquireLock: () => {
          events.push('lock');
          return { release: () => events.push('release') };
        },
        captureEnvironment: () => {
          events.push('capture');
          return environment;
        },
        spawn(command, args, options) {
          events.push('spawn');
          assert.equal(command, process.execPath);
          assert.deepEqual(args.slice(1), [
            'test',
            'tests/e2e/auth\\.spec\\.ts$',
            'tests/e2e/cases\\.spec\\.ts$',
          ]);
          const require = createRequire(
            join(process.cwd(), 'scripts/run-e2e.test.mjs'),
          );
          const playwrightRequire = createRequire(
            require.resolve('@playwright/test/package.json'),
          );
          const { suiteUtils } = playwrightRequire('playwright/lib/common');
          const selection = suiteUtils.createFiltersFromArguments(
            args.slice(2),
          );
          assert.deepEqual(
            readdirSync('tests/e2e')
              .filter((file) =>
                selection.fileFilter(resolve('tests/e2e', file)),
              )
              .sort(),
            ['auth.spec.ts', 'cases.spec.ts'],
          );
          assert.notEqual(options.env, environment.childEnvironment);
          assert.equal(
            options.env.DATABASE_URL,
            environment.childEnvironment.DATABASE_URL,
          );
          const worker = JSON.parse(options.env[MANAGED_WORKER_CONTEXT_ENV]);
          assert.equal(worker.manifestPath, managedManifest);
          assert.equal(worker.manifestSha256, managedSha);
          assert.equal(worker.runId, managedReceipt.runId);
          assert.deepEqual(worker.suites, [
            'tests/e2e/auth.spec.ts',
            'tests/e2e/cases.spec.ts',
          ]);
          return { status: 7 };
        },
      },
    );
    assert.deepEqual(events, ['lock', 'capture', 'admit']);
    finishAdmission(managedReceipt);
    assert.equal(await pending, 7);
    assert.deepEqual(events, ['lock', 'capture', 'admit', 'spawn', 'release']);
    assert.equal(admission.mock.calls.length, 1);
  } finally {
    admission.mockRestore();
  }
});

test.each([
  [],
  ['tests/e2e'],
  ['tests/e2e/.*'],
  ['tests/e2e/nonexistent.spec.ts'],
  ['tests/e2e/auth.spec.ts', 'tests/e2e/auth.spec.ts'],
  ['tests/e2e/case-section-record-ui.spec.ts'],
  ['tests/e2e/batch2-lead-import.spec.ts'],
  ['tests/e2e/auth.spec.ts', '--list'],
  ['tests/e2e/auth.spec.ts', '--config', 'playwright.config.ts'],
  ['tests/e2e/auth.spec.ts', '--grep', 'one test'],
  ['tests/e2e/auth.spec.ts', '--shard=1/2'],
  ['tests/e2e/auth.spec.ts', '--', 'tests/e2e/auth.spec.ts'],
])(
  'rejects unsafe managed selection %j before capture/admission/lock/child',
  (...files) => {
    const admission = vi.spyOn(managedAdmission, 'admitManagedE2e');
    const calls = [];
    try {
      assert.throws(() =>
        runE2e(process.cwd(), [...managedOptions, ...files], {
          get pnpmVersion() {
            calls.push('runtime');
            return '11.27.0';
          },
          captureEnvironment: () => calls.push('capture'),
          acquireLock: () => calls.push('lock'),
          spawn: () => calls.push('spawn'),
        }),
      );
      assert.deepEqual(calls, []);
      assert.equal(admission.mock.calls.length, 0);
    } finally {
      admission.mockRestore();
    }
  },
);

test.each([
  ['--managed-e2e-manifest', managedManifest],
  ['--managed-e2e-manifest-sha256', managedSha],
  [
    '--managed-e2e-manifest=relative.json',
    `--managed-e2e-manifest-sha256=${managedSha}`,
  ],
  [
    '--managed-e2e-manifest',
    managedManifest,
    '--managed-e2e-manifest-sha256',
    'BAD',
  ],
  [...managedOptions, '--managed-e2e-manifest', managedManifest],
  ['--managed-e2e-manifest'],
])(
  'rejects incomplete or ambiguous explicit manifest options %j',
  (...options) => {
    assert.throws(() =>
      runE2e(process.cwd(), [...options, 'tests/e2e/auth.spec.ts'], {
        captureEnvironment: () => {
          assert.fail('capture must not run');
        },
      }),
    );
  },
);

test.each(['capture', 'admit', 'receipt', 'receipt-sha', 'spawn'])(
  'releases managed lock and starts no premature child on %s failure',
  async (phase) => {
    const events = [];
    const admission = vi
      .spyOn(managedAdmission, 'admitManagedE2e')
      .mockImplementation(async () => {
        events.push('admit');
        if (phase === 'admit') throw new Error('offline admission rejected');
        if (phase === 'receipt') return undefined;
        return {
          ...managedReceipt,
          manifestSha256: phase === 'receipt-sha' ? 'c'.repeat(64) : managedSha,
        };
      });
    try {
      await assert.rejects(
        runE2e(process.cwd(), [...managedOptions, 'tests/e2e/auth.spec.ts'], {
          pnpmVersion: '11.27.0',
          acquireLock: () => ({ release: () => events.push('release') }),
          captureEnvironment: () => {
            events.push('capture');
            if (phase === 'capture')
              throw new Error('offline capture rejected');
            return environment;
          },
          spawn: () => {
            events.push('spawn');
            return { error: new Error('offline child failed') };
          },
        }),
      );
      assert.equal(events.at(-1), 'release');
      assert.equal(events.includes('spawn'), phase === 'spawn');
      assert.equal(admission.mock.calls.length, phase === 'capture' ? 0 : 1);
    } finally {
      admission.mockRestore();
    }
  },
);

test('a managed lock failure performs no capture, admission or child startup', async () => {
  const admission = vi.spyOn(managedAdmission, 'admitManagedE2e');
  const events = [];
  try {
    await assert.rejects(
      runE2e(process.cwd(), [...managedOptions, 'tests/e2e/auth.spec.ts'], {
        pnpmVersion: '11.27.0',
        acquireLock: () => {
          events.push('lock');
          throw new Error('managed resources locked');
        },
        captureEnvironment: () => events.push('capture'),
        spawn: () => events.push('spawn'),
      }),
      /managed resources locked/,
    );
    assert.deepEqual(events, ['lock']);
    assert.equal(admission.mock.calls.length, 0);
  } finally {
    admission.mockRestore();
  }
});

test('legacy children cannot inherit a managed worker context and input env stays unchanged', () => {
  const inherited = {
    ...environment.childEnvironment,
    [MANAGED_WORKER_CONTEXT_ENV]: 'untrusted caller value',
  };
  let child;
  runE2e(process.cwd(), ['tests/e2e/auth.spec.ts'], {
    pnpmVersion: '11.27.0',
    captureEnvironment: () => ({ ...environment, childEnvironment: inherited }),
    acquireLock: () => ({ release() {} }),
    spawn(command, args, options) {
      child = options.env;
      return { status: 0 };
    },
  });
  assert.equal(Object.hasOwn(child, MANAGED_WORKER_CONTEXT_ENV), false);
  assert.equal(inherited[MANAGED_WORKER_CONTEXT_ENV], 'untrusted caller value');
});

test('an environment flag never replaces explicit managed admission or opens H/import', () => {
  vi.stubEnv('DEV_COR_MANAGED_E2E', 'true');
  vi.stubEnv('DEV_COR_MANAGED_E2E_MANIFEST', managedManifest);
  try {
    for (const suite of [
      'tests/e2e/case-section-record-ui.spec.ts',
      'tests/e2e/batch2-lead-import.spec.ts',
    ])
      assert.throws(() =>
        runE2e(process.cwd(), [suite], {
          captureEnvironment: () => assert.fail('capture must not run'),
        }),
      );
  } finally {
    vi.unstubAllEnvs();
  }
});

test.each([
  [],
  ['tests/e2e/case-section-record-ui.spec.ts'],
  ['--grep=--list', 'tests/e2e/case-section-record-ui.spec.ts'],
  ['--unknown', '--list'],
])(
  'rejects pending UI %j before runtime, capture, lock or child',
  (...args) => {
    const calls = { runtime: 0, capture: 0, lock: 0, spawn: 0 };
    const dependencies = {
      get pnpmVersion() {
        calls.runtime += 1;
        return '11.27.0';
      },
      captureEnvironment() {
        calls.capture += 1;
        return environment;
      },
      acquireLock() {
        calls.lock += 1;
        return { release() {} };
      },
      spawn() {
        calls.spawn += 1;
        return { status: 0 };
      },
    };
    assert.throws(
      () => runE2e(process.cwd(), args, dependencies),
      (error) => error.code === 'NORMAL_SOURCE_PERMISSION_PENDING',
    );
    assert.deepEqual(calls, { runtime: 0, capture: 0, lock: 0, spawn: 0 });
  },
);

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

test.each([
  ['tests/e2e/hearing-correction-chain.spec.ts'],
  ['tests/e2e/case-section-record-ui.spec.ts', '--list'],
])(
  'preserves the existing runner path for %j using offline dependencies',
  (...args) => {
    const events = [];
    const status = runE2e(process.cwd(), args, {
      pnpmVersion: '11.27.0',
      captureEnvironment() {
        events.push('capture');
        return environment;
      },
      acquireLock() {
        events.push('lock');
        return { release: () => events.push('release') };
      },
      spawn(command, childArgs) {
        events.push('spawn');
        assert.equal(command, process.execPath);
        assert.deepEqual(childArgs.slice(1), ['test', ...args]);
        return { status: 0 };
      },
    });
    assert.equal(status, 0);
    assert.deepEqual(events, ['capture', 'lock', 'spawn', 'release']);
  },
);

test('starts no child when environment or lock preconditions fail', () => {
  let spawnCalls = 0;
  assert.throws(
    () =>
      runE2e('C:/repo', ['tests/e2e/auth.spec.ts'], {
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
      runE2e('C:/repo', ['tests/e2e/auth.spec.ts'], {
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
