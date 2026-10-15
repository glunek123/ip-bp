import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {
  assertSectionRecordUiBinding,
  assertSectionRecordUiDatabaseProof,
} from './case-section-record-ui-database.mjs';

const url =
  'postgresql://dev_cor_test:offline-only@127.0.0.1:15438/dev_cor_test';
const valid = {
  NODE_ENV: 'test',
  DATABASE_URL: url,
  DEV_COR_TEST_DATABASE_URL: url,
  DEV_COR_TEST_DATABASE_PROJECT: 'dev-cor-ui003-r2',
  DEV_COR_TEST_DATABASE_CONTAINER_ID:
    '45addc0179e929dd1dcd4f835b6c6c14c36c2ac4aed5e6cd5842648bf5db5236',
  npm_config_user_agent: 'pnpm/11.27.0',
};
const gaps = [
  'case.complaint.mail',
  'case.filing.submit',
  'case.acceptance.register',
  'case.hearing.schedule',
  'case.execution.submit',
  'user.manage',
  'lawyer.account.manage',
];
const both = (value) => ({
  DATABASE_URL: value,
  DEV_COR_TEST_DATABASE_URL: value,
});
function proof() {
  const migrations = Array.from({ length: 157 }, (_, index) => ({
    name: `2026010100${String(index).padStart(4, '0')}_synthetic`,
    checksum: index.toString(16).padStart(64, '0'),
  }));
  migrations.splice(
    154,
    3,
    ...[
      '20261015130000_guard_direct_second_remand_child',
      '20261015150000_case_section_record_edits',
      '20261015170000_case_section_record_uploads',
    ].map((name, index) => ({ ...migrations[154 + index], name })),
  );
  return {
    capturedDatabaseUrl: url,
    validatedDatabaseUrl: url,
    migrations,
    identity: [
      { db: 'dev_cor_test', schema: 'public', username: 'dev_cor_test' },
    ],
    applied: migrations.map((m) => ({
      migration_name: m.name,
      checksum: m.checksum,
      finished_at: 'finished',
      rolled_back_at: null,
    })),
  };
}
function pending(error) {
  assert.equal(error?.code, 'NORMAL_SOURCE_PERMISSION_PENDING');
  assert.equal(error?.finding, 'I-SECTION-UI-GRANT01');
  assert.equal(error.name, 'SectionRecordUiPermissionPending');
  assert.ok(
    error.message.startsWith(
      'I-SECTION-UI-GRANT01 / NORMAL_SOURCE_PERMISSION_PENDING:',
    ),
  );
  assert.deepEqual(Array.from(error.requiredActions), gaps);
  for (const gap of gaps) assert.ok(error.message.includes(gap));
  return true;
}

// The sandbox executes the real support/spec source with all effectful boundaries
// replaced by counters that throw. It cannot load backend/S/H/core code, contact a
// database/browser, grant permissions, or return a synthetic successful actor/case.
const source = await readFile(
  new URL('./case-section-record-ui-database.mjs', import.meta.url),
  'utf8',
);
const specSource = await readFile(
  new URL('../e2e/case-section-record-ui.spec.ts', import.meta.url),
  'utf8',
);
function sandbox(environment = valid) {
  const calls = {
    capture: 0,
    backend: 0,
    pg: 0,
    http: 0,
    grant: 0,
    factory: 0,
    operation: 0,
  };
  const refused = (key) => () => {
    calls[key]++;
    throw new Error(`Forbidden sandbox boundary ${key}`);
  };
  const modules = {
    'node:assert/strict': assert,
    'node:crypto': {
      createHash: refused('backend'),
      randomUUID: refused('factory'),
    },
    'node:module': { createRequire: refused('backend') },
    'node:path': { resolve: () => 'offline-root' },
    'node:fs/promises': {
      readdir: refused('backend'),
      readFile: refused('backend'),
    },
    '../../scripts/test-environment.mjs': {
      captureTestEnvironment: refused('capture'),
      validateBrowserTestDatabaseUrl: refused('capture'),
    },
    './case-section-record-upload-database.mjs': {
      createSectionUploadActor: refused('grant'),
      ownSectionUploadCase: refused('pg'),
      sectionUploadFixture: refused('factory'),
      revokeSectionUploadActor: refused('grant'),
      sectionUploadSnapshot: refused('pg'),
    },
    './case-historical-record-edit-database.mjs': {
      historicalBaselineSecuritySnapshot: refused('pg'),
      createHistoricalRecordActor: refused('grant'),
    },
  };
  function load(text, filename, extra = {}) {
    const exports = {};
    const context = {
      exports,
      URL,
      Buffer,
      process: { env: { ...environment }, cwd: () => 'offline-root' },
      require(name) {
        if (Object.hasOwn(extra, name)) return extra[name];
        if (!Object.hasOwn(modules, name))
          throw new Error(`Unapproved sandbox import ${name}`);
        return modules[name];
      },
    };
    vm.runInNewContext(
      ts.transpileModule(text, {
        fileName: filename,
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2023,
          esModuleInterop: true,
        },
      }).outputText,
      context,
    );
    return exports;
  }
  const support = load(source, 'support.js');
  const registered = [],
    hooks = [];
  let fixtures;
  function testStub(name, callback) {
    registered.push({ name, callback });
  }
  testStub.extend = (value) => {
    fixtures = value;
    return testStub;
  };
  testStub.describe = (_name, callback) => callback();
  testStub.beforeAll = (callback) => hooks.push(callback);
  load(specSource, 'spec.ts', {
    '@playwright/test': {
      test: testStub,
      expect: (value) => ({
        toBe: (expected) => assert.equal(value, expected),
      }),
    },
    '../support/case-section-record-ui-database.mjs': support,
  });
  const page = {
    goto: refused('http'),
    on: refused('http'),
    route: refused('http'),
    request: {
      get: refused('http'),
      post: refused('http'),
      put: refused('http'),
    },
  };
  const operation = refused('operation');
  const offline = {
    environment,
    capture: refused('capture'),
    openClient: refused('pg'),
    grant: refused('grant'),
    http: refused('http'),
  };
  return {
    calls,
    support,
    registered,
    hooks,
    fixtures,
    page,
    operation,
    offline,
  };
}
function noEffects(f) {
  assert.deepEqual(f.calls, {
    capture: 0,
    backend: 0,
    pg: 0,
    http: 0,
    grant: 0,
    factory: 0,
    operation: 0,
  });
}

test('exact coordinated R2 tuple passes only the pure binding, not source admission', () => {
  assert.equal(assertSectionRecordUiBinding(valid), url);
});
const negatives = [
  ...[15433, 15436, 15437, 55432, 3206, 5186, 49123].map((port) => [
    `port ${port}`,
    both(url.replace(':15438/', `:${port}/`)),
  ]),
  ['missing CID', { DEV_COR_TEST_DATABASE_CONTAINER_ID: undefined }],
  [
    'short CID',
    {
      DEV_COR_TEST_DATABASE_CONTAINER_ID:
        valid.DEV_COR_TEST_DATABASE_CONTAINER_ID.slice(0, 12),
    },
  ],
  ['different CID', { DEV_COR_TEST_DATABASE_CONTAINER_ID: '0'.repeat(64) }],
  ['missing project', { DEV_COR_TEST_DATABASE_PROJECT: undefined }],
  ['wrong project', { DEV_COR_TEST_DATABASE_PROJECT: 'dev-cor-ui003' }],
  ['production', { NODE_ENV: 'production' }],
  ['missing effective URL', { DATABASE_URL: undefined }],
  ['missing override URL', { DEV_COR_TEST_DATABASE_URL: undefined }],
  [
    'different passwords',
    { DATABASE_URL: url.replace('offline-only', 'different') },
  ],
  ['remote host', both(url.replace('127.0.0.1', '192.0.2.1'))],
  ['alias host', both(url.replace('127.0.0.1', 'localhost'))],
  ['other database', both(url.replace('/dev_cor_test', '/other_test'))],
  ['other user', both(url.replace('dev_cor_test:', 'other_user:'))],
  ['empty password', both(url.replace('offline-only', ''))],
  ['wrong protocol', both(url.replace('postgresql:', 'http:'))],
  ...['?', '#', '?schema=public', '#public'].map((suffix) => [
    `suffix ${suffix}`,
    both(url + suffix),
  ]),
  ['missing runtime', { npm_config_user_agent: undefined }],
  ['wrong runtime', { npm_config_user_agent: 'pnpm/11.26.0' }],
  ['invalid URL', both('not-a-database-url')],
];
for (const [name, patch] of negatives) {
  test(`rejects ${name} with zero preparation side effects`, () => {
    assert.throws(() => assertSectionRecordUiBinding({ ...valid, ...patch }));
  });
}
test('exact157 evidence validates purely without admitting an operation', () => {
  assertSectionRecordUiDatabaseProof(valid, proof());
  const f = sandbox();
  assert.throws(() => f.support.assertSectionRecordUiSourceReady(), pending);
  noEffects(f);
});
for (const kind of [
  'capture',
  'validator',
  'source155',
  'source156',
  'tail',
  'duplicate',
  'badChecksum',
  'identity',
  'schema',
  'ledger155',
  'ledger156',
  'ledgerName',
  'ledgerChecksum',
  'unfinished',
  'rolledBack',
]) {
  test(`rejects ${kind} in the pure evidence validator`, () => {
    const p = proof();
    if (kind === 'capture') p.capturedDatabaseUrl += '?bad';
    if (kind === 'validator') p.validatedDatabaseUrl += '#bad';
    if (kind === 'source155') p.migrations.length = 155;
    if (kind === 'source156') p.migrations.length = 156;
    if (kind === 'tail') p.migrations[156].name = 'unapproved';
    if (kind === 'duplicate') p.migrations[0] = p.migrations[1];
    if (kind === 'badChecksum') p.migrations[0].checksum = 'bad';
    if (kind === 'identity') p.identity[0].username = 'other';
    if (kind === 'schema') p.identity[0].schema = 'other';
    if (kind === 'ledger155') p.applied.length = 155;
    if (kind === 'ledger156') p.applied.length = 156;
    if (kind === 'ledgerName') p.applied[3].migration_name = 'wrong';
    if (kind === 'ledgerChecksum') p.applied[3].checksum = '0'.repeat(64);
    if (kind === 'unfinished') p.applied[3].finished_at = null;
    if (kind === 'rolledBack') p.applied[3].rolled_back_at = 'rolled-back';
    assert.throws(() => assertSectionRecordUiDatabaseProof(valid, p));
  });
}
for (const entry of [
  'assertSectionRecordUiRunner',
  'createSectionRecordUiActor',
  'withSectionRecordUiDatabase',
  'ownSectionRecordUiCase',
  'revokeSectionRecordUiActor',
  'sectionRecordUiBaselineSecurity',
  'sectionRecordUiUploads',
  'sectionRecordUiSnapshot',
]) {
  test(`${entry} refuses before capture/backend/PG/HTTP/Grant even with injected dependencies`, async () => {
    const f = sandbox();
    await assert.rejects(f.support[entry](f.operation, f.offline), pending);
    noEffects(f);
  });
}
test('fixture constants cannot return an external source or fake actor/case', () => {
  const f = sandbox();
  assert.throws(() => f.support.sectionRecordUiFixture(), pending);
  noEffects(f);
});
test('no environment flag, alternate actor, or valid proof can unlock actual preparation', async () => {
  const f = sandbox({
    ...valid,
    ALLOW_UI_SOURCE: 'true',
    DEV_COR_UI_GRANT01_APPROVED: 'true',
  });
  assertSectionRecordUiDatabaseProof(valid, proof());
  await assert.rejects(
    f.support.createSectionRecordUiActor({ actor: 'alternate' }),
    pending,
  );
  noEffects(f);
});
test('all16 UI cases are discovered, without callbacks or skipped/fabricated acceptance', () => {
  const f = sandbox();
  assert.equal(f.registered.length, 16);
  assert.equal(f.hooks.length, 1);
  noEffects(f);
});
test('the real spec beforeAll refuses before any fixture or environment capture', () => {
  const f = sandbox();
  assert.throws(f.hooks[0], pending);
  noEffects(f);
});
for (const fixtureName of ['actor', 'page', 'csrf']) {
  test(`real spec ${fixtureName} fixture refuses before any preparation/API callback`, async () => {
    const f = sandbox();
    await assert.rejects(
      f.fixtures[fixtureName](
        {
          baseURL: 'http://127.0.0.1:5174',
          page: f.page,
          actor: Object.freeze({ sentinel: 'not-an-account' }),
        },
        f.operation,
      ),
      pending,
    );
    noEffects(f);
  });
}
for (let index = 0; index < 16; index++) {
  test(`real discovered UI callback ${index + 1} also refuses without reaching HTTP or Grant`, async () => {
    const f = sandbox();
    await assert.rejects(
      f.registered[index].callback({
        page: f.page,
        actor: Object.freeze({ sentinel: 'not-an-account' }),
        csrf: 'offline-only',
      }),
      pending,
    );
    noEffects(f);
  });
}
test('module has no effectful imports, factory delegation, business SQL, or environment unlock', () => {
  assert.doesNotMatch(
    source,
    /createSectionUploadActor|ownSectionUploadCase|revokeSectionUploadActor|sectionUploadSnapshot|createHistoricalRecordActor|createRequire|new Client|captureTestEnvironment|import[^;]+database\.mjs/u,
  );
  assert.doesNotMatch(
    source,
    /(?:INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|TRUNCATE\s|DROP\s|ALTER\s|execSync|spawn\(|seedCore|clearCore|dropFaults|disconnectDatabase)/iu,
  );
  assert.doesNotMatch(
    specSource,
    /external-entries|HISTORICAL_BACKFILL|test\.skip|test\.fixme/u,
  );
});
test('binding errors never echo either URL or password', () => {
  const secret = 'never-print-this-password';
  for (const patch of [
    { DATABASE_URL: url.replace('offline-only', secret) },
    both(`invalid://${secret}`),
  ]) {
    try {
      assertSectionRecordUiBinding({ ...valid, ...patch });
      assert.fail('Expected a sanitized binding failure');
    } catch (error) {
      assert.ok(error instanceof Error);
      assert.ok(!error.message.includes(secret));
      assert.ok(!String(error).includes('postgresql://'));
    }
  }
});
