import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const supportFile = new URL(
  './hearing-correction-chain-database.mjs',
  import.meta.url,
);
const guardName = 'assertHearingCorrectionChainR2Binding';
const migrationCount = 155;
const inputUrl =
  'postgresql://dev_cor_test:synthetic-offline-only@127.0.0.1:15438/dev_cor_test';
const valid = Object.freeze({
  NODE_ENV: 'test',
  DATABASE_URL: inputUrl,
  DEV_COR_TEST_DATABASE_URL: inputUrl,
  DEV_COR_TEST_DATABASE_PROJECT: 'dev-cor-ui003-r2',
  DEV_COR_TEST_DATABASE_CONTAINER_ID:
    '45addc0179e929dd1dcd4f835b6c6c14c36c2ac4aed5e6cd5842648bf5db5236',
  npm_config_user_agent: 'pnpm/11.27.0',
});
const url = (port) => inputUrl.replace(':15438/', `:${port}/`);
const both = (value) => ({
  DATABASE_URL: value,
  DEV_COR_TEST_DATABASE_URL: value,
});
const negatives = [
  [
    'old full tuple',
    {
      ...both(url(15437)),
      DEV_COR_TEST_DATABASE_PROJECT: 'dev-cor-ui003',
      DEV_COR_TEST_DATABASE_CONTAINER_ID:
        'dbb1cbd29c6d65b5aa4fd85317c96167fbd94310c34946edc033fc4f2f9d3695',
    },
  ],
  ...[15437, 15433, 15436, 55432, 3206, 5186, 49123].map((port) => [
    `wrong port ${port}`,
    both(url(port)),
  ]),
  [
    'old CID at new port',
    {
      DEV_COR_TEST_DATABASE_CONTAINER_ID:
        'dbb1cbd29c6d65b5aa4fd85317c96167fbd94310c34946edc033fc4f2f9d3695',
    },
  ],
  [
    'one digit wrong CID',
    {
      DEV_COR_TEST_DATABASE_CONTAINER_ID:
        valid.DEV_COR_TEST_DATABASE_CONTAINER_ID.slice(0, -1) + '7',
    },
  ],
  ['short CID', { DEV_COR_TEST_DATABASE_CONTAINER_ID: '45addc0179e9' }],
  ['missing CID', { DEV_COR_TEST_DATABASE_CONTAINER_ID: undefined }],
  [
    'old project at new port',
    { DEV_COR_TEST_DATABASE_PROJECT: 'dev-cor-ui003' },
  ],
  [
    'unrelated managed project',
    { DEV_COR_TEST_DATABASE_PROJECT: 'dev-cor-unrelated' },
  ],
  ['missing project', { DEV_COR_TEST_DATABASE_PROJECT: undefined }],
  ['non-test runtime', { NODE_ENV: 'production' }],
  ['missing runtime', { NODE_ENV: undefined }],
  ['missing override URL', { DEV_COR_TEST_DATABASE_URL: undefined }],
  ['missing effective URL', { DATABASE_URL: undefined }],
  ['effective old URL', { DATABASE_URL: url(15437) }],
  ['override old URL', { DEV_COR_TEST_DATABASE_URL: url(15437) }],
  [
    'password mismatch',
    {
      DATABASE_URL: inputUrl.replace(
        'synthetic-offline-only',
        'other-synthetic',
      ),
    },
  ],
  ['wrong host', both(inputUrl.replace('127.0.0.1', '192.0.2.1'))],
  ['hostname alias', both(inputUrl.replace('127.0.0.1', 'localhost'))],
  ['wrong user', both(inputUrl.replace('dev_cor_test:', 'other_user:'))],
  ['wrong database', both(inputUrl.replace('/dev_cor_test', '/other_db'))],
  ['missing password', both(inputUrl.replace(':synthetic-offline-only', ''))],
  ['query override', both(inputUrl + '?schema=public')],
];

// Load only the three actual function declarations. Importing the complete support
// would load application dist; the injected capture and PG reader stay synthetic.
const source = ts.createSourceFile(
  fileURLToPath(supportFile),
  readFileSync(supportFile, 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JS,
);
const declarations = [guardName, 'capture', 'assertCurrentMigrations']
  .map((name) => {
    const node = source.statements.find(
      (item) => ts.isFunctionDeclaration(item) && item.name?.text === name,
    );
    assert.ok(node, `Missing actual support function ${name}`);
    return node.getText(source).replace(/^export\s+/u, '');
  })
  .join('\n');
function fixture(environment = { ...valid }) {
  const calls = { formalCapture: 0, browserValidator: 0 };
  const factory = new Function(
    'assert',
    'validateIsolatedTestDatabaseUrl',
    'captureTestEnvironment',
    'validateBrowserTestDatabaseUrl',
    'process',
    'root',
    'readdir',
    'readFile',
    'resolve',
    'createHash',
    declarations +
      `\nreturn { guard: ${guardName}, capture, assertCurrentMigrations };`,
  );
  const functions = factory(
    assert,
    validateIsolatedTestDatabaseUrl,
    (_root, options) => {
      calls.formalCapture++;
      assert.equal(options.pnpmVersion, '11.27.0');
      return { childEnvironment: { DATABASE_URL: inputUrl } };
    },
    (value) => {
      calls.browserValidator++;
      return validateIsolatedTestDatabaseUrl(value, { allowRandomPort: true });
    },
    { env: environment },
    root,
    readdir,
    readFile,
    resolve,
    createHash,
  );
  return { ...functions, calls };
}

test('exact R2 binding reaches both existing capture steps with synthetic inputs', () => {
  const accepted = fixture();
  assert.doesNotThrow(() => accepted.guard(valid));
  accepted.capture();
  assert.deepEqual(accepted.calls, { formalCapture: 1, browserValidator: 1 });
});
for (const [name, override] of negatives) {
  test(`rejects ${name} before formal capture or browser validation`, () => {
    const rejected = fixture({ ...valid, ...override });
    assert.throws(() => rejected.capture());
    assert.deepEqual(rejected.calls, { formalCapture: 0, browserValidator: 0 });
  });
}

const migrationRoot = resolve(root, 'backend/prisma/migrations');
const names = (await readdir(migrationRoot))
  .filter((name) => /^\d{14}_/u.test(name))
  .sort();
const rows = await Promise.all(
  names.map(async (name) => ({
    migration_name: name,
    checksum: createHash('sha256')
      .update(await readFile(resolve(migrationRoot, name, 'migration.sql')))
      .digest('hex'),
    finished_at: new Date(0),
    rolled_back_at: null,
  })),
);
const syntheticDatabase = (values) => ({
  $queryRawUnsafe: async (sql) =>
    sql.includes('current_database()')
      ? [{ db: 'dev_cor_test', schema: 'public' }]
      : values,
});
test('exact migration names, checksums and successful states pass without PG', async () => {
  assert.equal(names.length, migrationCount);
  await fixture().assertCurrentMigrations(syntheticDatabase(rows));
});
for (const [name, values] of [
  ['missing migration', rows.slice(0, -1)],
  [
    'changed checksum',
    rows.map((row, index) =>
      index ? row : { ...row, checksum: '0'.repeat(64) },
    ),
  ],
  [
    'unfinished migration',
    rows.map((row, index) => (index ? row : { ...row, finished_at: null })),
  ],
  [
    'rolled-back migration',
    rows.map((row, index) =>
      index ? row : { ...row, rolled_back_at: new Date(0) },
    ),
  ],
]) {
  test(`rejects ${name} with synthetic migration rows`, async () => {
    await assert.rejects(() =>
      fixture().assertCurrentMigrations(syntheticDatabase(values)),
    );
  });
}
