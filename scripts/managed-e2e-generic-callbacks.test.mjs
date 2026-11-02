import assert from 'node:assert/strict';
import { beforeAll, beforeEach, afterEach, test, vi } from 'vitest';
import { resolve } from 'node:path';

const offline = vi.hoisted(() => ({
  guard: vi.fn(),
  pg: vi.fn(),
  prisma: vi.fn(),
  events: [],
  fixtures: {
    departmentA: '10000000-0000-4000-8000-000000000001',
    departmentB: '10000000-0000-4000-8000-000000000002',
    roleA: '30000000-0000-4000-8000-000000000001',
    roleB: '30000000-0000-4000-8000-000000000002',
    roleSelf: '30000000-0000-4000-8000-000000000003',
    admittedCustomer: '50000000-0000-4000-8000-000000000002',
  },
}));
vi.mock('./managed-e2e-worker-admission.mjs', async (original) => ({
  ...(await original()),
  admitManagedWorkerDatabase: offline.guard,
}));
vi.mock('../tests/support/core-lead-database.mjs', () => ({
  coreLeadFixtures: offline.fixtures,
}));
vi.mock('./test-environment.mjs', async (original) => ({
  ...(await original()),
  validateBrowserTestDatabaseUrl: (url) => ({ connectionString: url }),
}));
// Intercept backend constructors before importing any fixture module. No socket
// can be opened even if a regression tries to construct a PG/Prisma client early.
vi.mock('node:module', async (original) => {
  const actual = await original();
  return {
    ...actual,
    createRequire(...args) {
      const native = actual.createRequire(...args);
      const wrapped = (name) => {
        if (name === 'pg') return { Client: offline.pg };
        if (name === './dist/generated/prisma/client.js')
          return { PrismaClient: offline.prisma };
        if (name === '@prisma/adapter-pg')
          return {
            PrismaPg: function () {
              offline.events.push('pg-adapter-constructor');
            },
          };
        // Hearing's generic callback uses only Prisma. Do not load its unrelated
        // compiled business services; accidentally invoking one must still fail.
        const hearingBusinessExports = {
          './dist/access-control/access-control.service.js':
            'AccessControlService',
          './dist/access-control/prisma-access-control.store.js':
            'PrismaAccessControlStore',
          './dist/modules/cases/case-hearing.service.js': 'CaseHearingService',
          './dist/modules/cases/case-hearing-scheduler.service.js':
            'CaseHearingSchedulerService',
          './dist/modules/cases/case-hearing-signal.js': 'CaseHearingSignal',
          './dist/modules/cases/case-read.service.js': 'CaseReadService',
          './dist/auth/password.js': 'hashPassword',
          './dist/access-control/permission-catalog.js':
            'internalAssignablePermissionActions',
        };
        if (Object.hasOwn(hearingBusinessExports, name))
          return {
            [hearingBusinessExports[name]]() {
              throw new Error(
                `Unexpected business dependency in generic callback: ${name}`,
              );
            },
          };
        return native(name);
      };
      return Object.assign(wrapped, native);
    },
  };
});

const managedUrl =
  'postgresql://dev_cor_test:offline@127.0.0.1:15446/dev_cor_test';
const legacyUrl =
  'postgresql://dev_cor_test:offline@127.0.0.1:15433/dev_cor_test';
let closure, archive, external, hearing, second;
const run = {
  closure: () =>
    closure.setCaseClosureFixtureGrant(
      offline.fixtures.roleA,
      'case.closure.record',
      'SELF',
    ),
  archive: () =>
    archive.setCaseArchiveFixtureGrant(
      offline.fixtures.roleA,
      'case.archive',
      'SELF',
    ),
  external: () =>
    external.setCaseExternalEntryGrant(
      offline.fixtures.roleA,
      'case.external-entry.create',
      'DEPARTMENT',
    ),
  hearing: () => hearing.clearCoreCaseHearingAdminSessions(),
  second: () =>
    second.withSecondInstanceAcceptanceDatabase(async () =>
      offline.events.push('callback'),
    ),
};
const cleanup = {
  closure: () => closure.clearCaseClosureFixture(),
  archive: () => archive.clearCaseArchiveFixture(),
  external: () => external.clearCaseExternalEntryFixture(),
  hearing: () => hearing.clearCoreCaseHearingAdminSessions(),
  second: () => second.clearSecondInstanceAcceptanceFixture(),
};
function environment(url = managedUrl) {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('DATABASE_URL', url);
  vi.stubEnv('PRIVATE_FILE_ROOT', resolve('.local/private-files/test'));
}
beforeAll(async () => {
  environment();
  offline.pg.mockImplementation(function () {
    offline.events.push('pg-constructor');
    return {
      async connect() {
        offline.events.push('connect');
      },
      async query(sql) {
        offline.events.push('query');
        return {
          rows: sql.includes('role_templates')
            ? [{ id: offline.fixtures.roleA }]
            : [{ db: 'dev_cor_test', schema: 'public' }],
        };
      },
      async end() {
        offline.events.push('end');
      },
    };
  });
  offline.prisma.mockImplementation(function () {
    offline.events.push('prisma-constructor');
    const database = {
      async $queryRawUnsafe() {
        offline.events.push('query');
        return [{ db: 'dev_cor_test', schema: 'public' }];
      },
      async $transaction(operation) {
        return operation(database);
      },
      userAccount: {
        async findUnique() {
          offline.events.push('query');
          return null;
        },
      },
      authSession: {
        async deleteMany() {
          offline.events.push('callback');
        },
      },
      async $disconnect() {
        offline.events.push('end');
      },
    };
    return database;
  });
  closure = await import('../tests/support/case-closure-database.mjs');
  archive = await import('../tests/support/case-archive-database.mjs');
  external = await import('../tests/support/case-external-entry-database.mjs');
  hearing = await import('../tests/support/case-hearing-database.mjs');
  second =
    await import('../tests/support/case-second-instance-acceptance-database.mjs');
  assert.equal(
    offline.guard.mock.calls.length,
    0,
    'module import must not invoke admission',
  );
  assert.equal(
    offline.events.includes('query'),
    false,
    'module import must not query',
  );
});
beforeEach(() => {
  environment();
  offline.events.length = 0;
  offline.guard.mockReset();
  offline.pg.mockClear();
  offline.prisma.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

test.each(Object.keys(run))(
  '%s rejects before business constructor/query/callback, including cleanup',
  async (name) => {
    offline.guard.mockRejectedValue(
      new Error('actual managed admission rejected'),
    );
    await assert.rejects(run[name](), /actual managed admission rejected/);
    assert.equal(offline.guard.mock.calls.length, 1);
    assert.deepEqual(offline.events, []);
    assert.equal(offline.pg.mock.calls.length, 0);
    assert.equal(offline.prisma.mock.calls.length, 0);
  },
);

test.each(Object.keys(cleanup))(
  '%s cleanup has no admission exemption',
  async (name) => {
    offline.guard.mockRejectedValue(new Error('cleanup admission rejected'));
    await assert.rejects(cleanup[name](), /cleanup admission rejected/);
    assert.equal(offline.guard.mock.calls.length, 1);
    assert.deepEqual(offline.events, []);
  },
);

test.each(Object.keys(run))(
  '%s awaits each callback admission and does not cache',
  async (name) => {
    let finish;
    offline.guard.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const first = run[name]();
    assert.deepEqual(offline.events, []);
    finish({
      kind: 'managed-e2e-callback-target',
      connectionString: managedUrl,
    });
    await first;
    assert.ok(offline.events.includes('query'));
    assert.equal(offline.events.at(-1), 'end');
    offline.guard.mockRejectedValueOnce(new Error('changed role or ledger'));
    offline.events.length = 0;
    await assert.rejects(run[name](), /changed role or ledger/);
    assert.deepEqual(offline.events, []);
    assert.equal(offline.guard.mock.calls.length, 2);
  },
);

test.each(Object.keys(run))(
  '%s legacy keeps rejecting the managed port without a worker tuple',
  async (name) => {
    offline.guard.mockResolvedValue(null);
    await assert.rejects(run[name](), /isolated local test database/);
    assert.deepEqual(offline.events, []);
  },
);

test.each(['closure', 'archive', 'external', 'second'])(
  '%s retains the original 15433 legacy connection',
  async (name) => {
    environment(legacyUrl);
    offline.guard.mockResolvedValue(null);
    await run[name]();
    assert.ok(offline.events.includes('query'));
    assert.equal(offline.events.at(-1), 'end');
  },
);

test('hearing retains a separately imported 15433 legacy URL', async () => {
  environment(legacyUrl);
  offline.guard.mockResolvedValue(null);
  const legacyHearing =
    await import('../tests/support/case-hearing-database.mjs?legacy-15433');
  await legacyHearing.clearCoreCaseHearingAdminSessions();
  assert.ok(offline.events.includes('query'));
  assert.equal(offline.events.at(-1), 'end');
});
