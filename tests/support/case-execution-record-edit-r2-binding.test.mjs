import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';

const root = resolve(import.meta.dirname, '../..');
const support = resolve(
  root,
  'tests/support/case-execution-record-edit-database.mjs',
);
const ast = ts.createSourceFile(
  support,
  readFileSync(support, 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JS,
);
const functionNames = [
  'assertExecutionRecordEditR2Binding',
  'captureExecutionRecordEditTarget',
  'readExecutionRecordEditMigrations',
  'assertExecutionRecordEditMigrations',
  'withDatabase',
];
const declarations = functionNames
  .map((name) => {
    const declaration = ast.statements.find(
      (item) => ts.isFunctionDeclaration(item) && item.name?.text === name,
    );
    assert.ok(declaration, `Missing actual support function ${name}`);
    return declaration.getText(ast).replace(/^export\s+/u, '');
  })
  .join('\n');
const url =
  'postgresql://dev_cor_test:synthetic-offline-only@127.0.0.1:15438/dev_cor_test';
const valid = {
  NODE_ENV: 'test',
  DATABASE_URL: url,
  DEV_COR_TEST_DATABASE_URL: url,
  DEV_COR_TEST_DATABASE_PROJECT: 'dev-cor-ui003-r2',
  DEV_COR_TEST_DATABASE_CONTAINER_ID:
    '45addc0179e929dd1dcd4f835b6c6c14c36c2ac4aed5e6cd5842648bf5db5236',
};
const both = (value) => ({
  DATABASE_URL: value,
  DEV_COR_TEST_DATABASE_URL: value,
});
const sourceNames = [
  ...Array.from(
    { length: 154 },
    (_, index) => `202609${String(index).padStart(8, '0')}_synthetic`,
  ),
  '20261015130000_guard_direct_second_remand_child',
  '20261015150000_case_section_record_edits',
];
const checksum = (name) =>
  createHash('sha256').update(`synthetic:${name}`).digest('hex');
const applied = (names) =>
  names.map((name) => ({
    migration_name: name,
    checksum: checksum(name),
    finished_at: new Date(0),
    rolled_back_at: null,
  }));
function fixture(options = {}) {
  const environment = { ...valid, ...options.environment };
  const names = options.names ?? sourceNames;
  const calls = {
    capture: 0,
    validate: 0,
    constructed: 0,
    connected: 0,
    ended: 0,
    operation: 0,
  };
  const factory = new Function(
    'process',
    'root',
    'validateIsolatedTestDatabaseUrl',
    'captureTestEnvironment',
    'validateBrowserTestDatabaseUrl',
    'readdir',
    'readFile',
    'resolve',
    'createHash',
    'requireBackend',
    declarations + `\nreturn {${functionNames.join(',')}};`,
  );
  const functions = factory(
    { env: environment },
    root,
    validateIsolatedTestDatabaseUrl,
    () => {
      calls.capture++;
      return { childEnvironment: { DATABASE_URL: options.capturedUrl ?? url } };
    },
    (value) => {
      calls.validate++;
      return validateIsolatedTestDatabaseUrl(value, { allowRandomPort: true });
    },
    async () => names,
    async (path) => Buffer.from(`synthetic:${path.split(/[\\/]/u).at(-2)}`),
    resolve,
    createHash,
    () => ({
      Client: class {
        constructor() {
          calls.constructed++;
        }
        async connect() {
          calls.connected++;
          if (options.connectFailure)
            throw new Error('synthetic connect failure');
        }
        async end() {
          calls.ended++;
        }
        async query(sql) {
          return {
            rows: sql.includes('current_database()')
              ? (options.identity ?? [
                  {
                    db: 'dev_cor_test',
                    schema: 'public',
                    username: 'dev_cor_test',
                  },
                ])
              : (options.rows ?? applied(names)),
          };
        }
      },
    }),
  );
  return {
    ...functions,
    calls,
    operation: async () => {
      calls.operation++;
      if (options.operationFailure)
        throw new Error('synthetic operation failure');
      return 'ok';
    },
  };
}

test('complete R2 binding reaches formal capture and exact 156 migration admission using only fakes', async () => {
  const f = fixture();
  assert.equal(await f.withDatabase(f.operation), 'ok');
  assert.deepEqual(f.calls, {
    capture: 1,
    validate: 1,
    constructed: 1,
    connected: 1,
    ended: 1,
    operation: 1,
  });
});
test('the compatible 157 source and exact complete applied ledger are admitted offline', async () => {
  const f = fixture({
    names: [...sourceNames, '20261015170000_case_section_record_uploads'],
  });
  assert.equal(await f.withDatabase(f.operation), 'ok');
});
for (const [name, environment] of [
  ...[15437, 15433, 15436, 49123].map((port) => [
    `wrong port ${port}`,
    both(url.replace(':15438/', `:${port}/`)),
  ]),
  [
    'old full tuple',
    {
      ...both(url.replace(':15438/', ':15437/')),
      DEV_COR_TEST_DATABASE_PROJECT: 'dev-cor-ui003',
      DEV_COR_TEST_DATABASE_CONTAINER_ID:
        'dbb1cbd29c6d65b5aa4fd85317c96167fbd94310c34946edc033fc4f2f9d3695',
    },
  ],
  [
    'old CID at R2 port',
    {
      DEV_COR_TEST_DATABASE_CONTAINER_ID:
        'dbb1cbd29c6d65b5aa4fd85317c96167fbd94310c34946edc033fc4f2f9d3695',
    },
  ],
  ['short CID', { DEV_COR_TEST_DATABASE_CONTAINER_ID: '45addc0179e9' }],
  ['missing CID', { DEV_COR_TEST_DATABASE_CONTAINER_ID: undefined }],
  ['wrong project', { DEV_COR_TEST_DATABASE_PROJECT: 'other-project' }],
  ['missing project', { DEV_COR_TEST_DATABASE_PROJECT: undefined }],
  ['non-test', { NODE_ENV: 'production' }],
  ['missing override', { DEV_COR_TEST_DATABASE_URL: undefined }],
  ['missing effective URL', { DATABASE_URL: undefined }],
  ['mixed URL port', { DATABASE_URL: url.replace(':15438/', ':15437/') }],
  [
    'mixed password',
    {
      DATABASE_URL: url.replace(
        'synthetic-offline-only',
        'different-synthetic',
      ),
    },
  ],
  ['wrong host', both(url.replace('127.0.0.1', '192.0.2.1'))],
  ['hostname alias', both(url.replace('127.0.0.1', 'localhost'))],
  ['wrong database', both(url.replace('/dev_cor_test', '/other_database'))],
  ['wrong user', both(url.replace('dev_cor_test:', 'other_user:'))],
  ['missing password', both(url.replace(':synthetic-offline-only', ''))],
  ['query', both(url + '?schema=public')],
  ['hash', both(url + '#public')],
])
  test(`rejects ${name} before formal capture or Client construction`, async () => {
    const f = fixture({ environment });
    await assert.rejects(() => f.withDatabase(f.operation));
    assert.deepEqual(f.calls, {
      capture: 0,
      validate: 0,
      constructed: 0,
      connected: 0,
      ended: 0,
      operation: 0,
    });
  });
test('formal capture mismatched target is rejected before a Client is constructed', async () => {
  const f = fixture({ capturedUrl: url.replace(':15438/', ':15437/') });
  await assert.rejects(() => f.withDatabase(f.operation));
  assert.equal(f.calls.constructed, 0);
});
for (const [name, names] of [
  ['155-only source', sourceNames.slice(0, -1)],
  [
    'unknown 156 suffix',
    [...sourceNames.slice(0, -1), '20261015150000_unknown'],
  ],
  ['unknown 157 suffix', [...sourceNames, '20261015170000_unknown']],
  [
    'extra migration',
    [
      ...sourceNames,
      '20261015170000_case_section_record_uploads',
      '20261015180000_unknown',
    ],
  ],
])
  test(`rejects ${name} before a Client is constructed`, async () => {
    const f = fixture({ names });
    await assert.rejects(() => f.withDatabase(f.operation));
    assert.equal(f.calls.constructed, 0);
  });
for (const [name, rows] of [
  ['missing row', applied(sourceNames).slice(0, -1)],
  ['extra row', [...applied(sourceNames), ...applied(['unknown'])]],
  [
    'wrong checksum',
    applied(sourceNames).map((row, index) =>
      index ? row : { ...row, checksum: '0'.repeat(64) },
    ),
  ],
  [
    'wrong name',
    applied(sourceNames).map((row, index) =>
      index ? row : { ...row, migration_name: 'wrong' },
    ),
  ],
  [
    'unfinished',
    applied(sourceNames).map((row, index) =>
      index ? row : { ...row, finished_at: null },
    ),
  ],
  [
    'rolled back',
    applied(sourceNames).map((row, index) =>
      index ? row : { ...row, rolled_back_at: new Date(0) },
    ),
  ],
])
  test(`rejects ${name} ledger without running operation and still ends own Client`, async () => {
    const f = fixture({ rows });
    await assert.rejects(() => f.withDatabase(f.operation));
    assert.equal(f.calls.operation, 0);
    assert.equal(f.calls.ended, 1);
  });
for (const change of [
  { db: 'other' },
  { schema: 'other' },
  { username: 'other' },
])
  test(`rejects mismatched identity ${Object.keys(change)[0]}`, async () => {
    const f = fixture({
      identity: [
        {
          db: 'dev_cor_test',
          schema: 'public',
          username: 'dev_cor_test',
          ...change,
        },
      ],
    });
    await assert.rejects(() => f.withDatabase(f.operation));
    assert.equal(f.calls.operation, 0);
    assert.equal(f.calls.ended, 1);
  });
for (const failure of ['connectFailure', 'operationFailure'])
  test(`ends own Client after ${failure}`, async () => {
    const f = fixture({ [failure]: true });
    await assert.rejects(() => f.withDatabase(f.operation));
    assert.equal(f.calls.ended, 1);
  });
