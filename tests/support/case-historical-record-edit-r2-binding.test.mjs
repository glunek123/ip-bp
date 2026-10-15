import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {
  assertHistoricalRecordR2Binding,
  withHistoricalRecordDatabase,
  createHistoricalRecordActor,
  historicalBaselineSecuritySnapshot,
} from './case-historical-record-edit-database.mjs';

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
const both = (value) => ({
  DATABASE_URL: value,
  DEV_COR_TEST_DATABASE_URL: value,
});
function offline(count = 156) {
  const migrations = Array.from({ length: count }, (_, i) => ({
    name: `2026010100${String(i).padStart(4, '0')}_synthetic`,
    checksum: `checksum-${i}`,
  }));
  if (count >= 156)
    migrations[155].name = '20261015150000_case_section_record_edits';
  if (count === 157)
    migrations[156].name = '20261015170000_case_section_record_uploads';
  const state = {
    calls: [],
    connected: 0,
    ended: 0,
    capture: 0,
    validate: 0,
    opened: 0,
    migrations,
    applied: migrations.map((m) => ({
      migration_name: m.name,
      checksum: m.checksum,
      finished_at: 'finished',
      rolled_back_at: null,
    })),
    identity: {
      db: 'dev_cor_test',
      schema: 'public',
      username: 'dev_cor_test',
    },
    failConnect: false,
    failInsert: false,
  };
  const client = {
    async connect() {
      state.connected++;
      if (state.failConnect) throw new Error('connect rejected');
    },
    async end() {
      state.ended++;
    },
    async query(sql, parameters = []) {
      state.calls.push({ sql, parameters });
      if (sql.includes('current_database()')) return { rows: [state.identity] };
      if (sql.includes('_prisma_migrations')) return { rows: state.applied };
      if (sql.startsWith('SELECT action FROM role_grants'))
        return { rows: [{ action: 'case.read' }, { action: 'lead.create' }] };
      if (sql.startsWith('SELECT to_jsonb')) {
        const table = sql.match(/FROM "([a-z_]+)"/u)?.[1];
        return {
          rows: Array.from(
            {
              length:
                table === 'user_accounts' || table === 'role_templates'
                  ? 3
                  : table === 'role_grants'
                    ? 66
                    : 1,
            },
            (_, i) => ({
              row: { id: `preserved-${i}`, all_fields: `${table}-${i}` },
            }),
          ),
        };
      }
      if (state.failInsert && sql.startsWith('INSERT INTO role_grants'))
        throw new Error('insert rejected');
      return { rows: [] };
    },
  };
  const deps = {
    environment: { ...valid },
    capture() {
      state.capture++;
      return { childEnvironment: { DATABASE_URL: url } };
    },
    validate() {
      state.validate++;
      return { connectionString: url, port: 15438 };
    },
    async migrations() {
      return state.migrations;
    },
    openClient() {
      state.opened++;
      return client;
    },
    async hashPassword() {
      return 'offline-hash';
    },
  };
  return { state, deps };
}
test('exact R2 pure binding accepts only the coordinated full tuple', () => {
  assert.equal(assertHistoricalRecordR2Binding(valid).port, 15438);
});
const negatives = [
  ...[15433, 15436, 15437, 55432, 3206, 5186, 49123].map((port) => [
    `port ${port}`,
    both(url.replace(':15438/', `:${port}/`)),
  ]),
  [
    'legacy tuple',
    {
      ...both(url.replace(':15438/', ':15437/')),
      DEV_COR_TEST_DATABASE_PROJECT: 'dev-cor-ui003',
      DEV_COR_TEST_DATABASE_CONTAINER_ID:
        'dbb1cbd29c6d65b5aa4fd85317c96167fbd94310c34946edc033fc4f2f9d3695',
    },
  ],
  ['CID missing', { DEV_COR_TEST_DATABASE_CONTAINER_ID: undefined }],
  [
    'CID short',
    {
      DEV_COR_TEST_DATABASE_CONTAINER_ID:
        valid.DEV_COR_TEST_DATABASE_CONTAINER_ID.slice(0, 12),
    },
  ],
  ['CID different', { DEV_COR_TEST_DATABASE_CONTAINER_ID: '0'.repeat(64) }],
  ['project missing', { DEV_COR_TEST_DATABASE_PROJECT: undefined }],
  ['project different', { DEV_COR_TEST_DATABASE_PROJECT: 'dev-cor-other' }],
  ['runtime production', { NODE_ENV: 'production' }],
  ['effective missing', { DATABASE_URL: undefined }],
  ['override missing', { DEV_COR_TEST_DATABASE_URL: undefined }],
  ['effective mismatch', { DATABASE_URL: url.replace(':15438/', ':15437/') }],
  [
    'password mismatch',
    { DATABASE_URL: url.replace('offline-only', 'different') },
  ],
  ['non-loopback', both(url.replace('127.0.0.1', '192.0.2.1'))],
  ['hostname alias', both(url.replace('127.0.0.1', 'localhost'))],
  ['wrong db', both(url.replace('/dev_cor_test', '/other_db'))],
  ['wrong user', both(url.replace('dev_cor_test:', 'other_user:'))],
  ['empty password', both(url.replace('offline-only', ''))],
  ['query', both(url + '?schema=public')],
  ['fragment', both(url + '#other')],
  ['empty query', both(url + '?')],
  ['empty fragment', both(url + '#')],
];
for (const [name, patch] of negatives)
  test(`rejects ${name} before capture/client/operation`, async () => {
    const f = offline();
    f.deps.environment = { ...valid, ...patch };
    let reached = false;
    await assert.rejects(
      withHistoricalRecordDatabase(async () => {
        reached = true;
      }, f.deps),
    );
    assert.equal(f.state.capture, 0);
    assert.equal(f.state.opened, 0);
    assert.equal(f.state.connected, 0);
    assert.equal(reached, false);
  });
test('rejects missing project runtime before capture', async () => {
  const f = offline();
  f.deps.environment.npm_config_user_agent = 'pnpm/12.0.0';
  await assert.rejects(withHistoricalRecordDatabase(() => {}, f.deps));
  assert.equal(f.state.capture, 0);
});
for (const count of [156, 157])
  test(`verifies full ${count} migrations and closes its client`, async () => {
    const f = offline(count);
    assert.equal(
      await withHistoricalRecordDatabase(async () => 'accepted', f.deps),
      'accepted',
    );
    assert.equal(f.state.capture, 1);
    assert.equal(f.state.validate, 1);
    assert.equal(f.state.ended, 1);
  });
test('155 is not sufficient for historical record commands and fails before client construction', async () => {
  const f = offline(155);
  await assert.rejects(withHistoricalRecordDatabase(() => {}, f.deps));
  assert.equal(f.state.opened, 0);
});
test('capture URL mismatch fails before constructing a client', async () => {
  const f = offline();
  f.deps.capture = () => ({
    childEnvironment: { DATABASE_URL: url.replace(':15438/', ':15437/') },
  });
  await assert.rejects(withHistoricalRecordDatabase(() => {}, f.deps));
  assert.equal(f.state.opened, 0);
});
for (const [name, change] of [
  ['wrong database', (s) => (s.identity.db = 'other')],
  ['wrong schema', (s) => (s.identity.schema = 'other')],
  ['wrong database user', (s) => (s.identity.username = 'other')],
  ['missing applied migration', (s) => s.applied.pop()],
  ['wrong migration name', (s) => (s.applied[10].migration_name = 'foreign')],
  ['checksum drift', (s) => (s.applied[10].checksum = 'wrong')],
  ['unfinished migration', (s) => (s.applied[10].finished_at = null)],
  ['rolled back migration', (s) => (s.applied[10].rolled_back_at = 'rolled')],
  ['failed connect', (s) => (s.failConnect = true)],
])
  test(`rejects ${name} and ends owned client without operation`, async () => {
    const f = offline();
    change(f.state);
    let reached = false;
    await assert.rejects(
      withHistoricalRecordDatabase(() => {
        reached = true;
      }, f.deps),
    );
    assert.equal(reached, false);
    assert.equal(f.state.ended, 1);
  });
test('operation failure still ends its owned client', async () => {
  const f = offline();
  await assert.rejects(
    withHistoricalRecordDatabase(() => {
      throw new Error('operation rejected');
    }, f.deps),
  );
  assert.equal(f.state.ended, 1);
});
test('creates only UUID owned security rows, never updates baseline, and preserves full cohort snapshots', async () => {
  const f = offline();
  const before = await historicalBaselineSecuritySnapshot(f.deps);
  const actor = await createHistoricalRecordActor({}, f.deps);
  const other = await createHistoricalRecordActor({ readOnly: true }, f.deps);
  assert.notEqual(actor.userId, other.userId);
  assert.notEqual(actor.roleId, other.roleId);
  const inserts = f.state.calls.filter((c) => c.sql.startsWith('INSERT'));
  assert.ok(inserts.length > 0);
  assert.ok(
    !f.state.calls.some((c) => /^(UPDATE|DELETE|TRUNCATE|ALTER)/u.test(c.sql)),
  );
  for (const call of inserts) {
    if (call.sql.startsWith('INSERT INTO role_grants'))
      assert.ok([actor.roleId, other.roleId].includes(call.parameters[1]));
    if (call.sql.startsWith('INSERT INTO role_assignments')) {
      assert.ok([actor.userId, other.userId].includes(call.parameters[1]));
      assert.ok([actor.roleId, other.roleId].includes(call.parameters[3]));
    }
    assert.ok(
      call.parameters.every(
        (value) =>
          ![
            '20000000-0000-4000-8000-000000000001',
            '30000000-0000-4000-8000-000000000001',
          ].includes(value),
      ),
    );
  }
  assert.deepEqual(await historicalBaselineSecuritySnapshot(f.deps), before);
});
test('new actor insert failure rolls back without changing a baseline row', async () => {
  const f = offline();
  f.state.failInsert = true;
  await assert.rejects(createHistoricalRecordActor({}, f.deps));
  assert.ok(f.state.calls.some((c) => c.sql === 'ROLLBACK'));
  assert.ok(!f.state.calls.some((c) => c.sql === 'COMMIT'));
  assert.equal(f.state.ended, 1);
});

function executeHistoricalSpec(names, globals) {
  const source = readFileSync(
    new URL('../e2e/case-historical-record-edit.spec.ts', import.meta.url),
    'utf8',
  );
  const parsed = ts.createSourceFile(
    'h.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const declarations = parsed.statements.filter(
    (node) =>
      (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) ||
      (ts.isVariableStatement(node) &&
        node.declarationList.declarations.some(
          (declaration) =>
            ts.isIdentifier(declaration.name) &&
            names.includes(declaration.name.text),
        )),
  );
  assert.equal(declarations.length, names.length);
  return vm.runInNewContext(
    ts.transpileModule(
      declarations.map((node) => node.getText(parsed)).join('\n') +
        `;({${names.join(',')}});`,
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.CommonJS,
        },
      },
    ).outputText,
    globals,
  );
}

test('actual H fixture uses one backend origin and separate cookie contexts for all three actors and the portal', async () => {
  const contexts = [];
  const identities = ['owned', 'foreign', 'read-only'].map((username) => ({
    username,
    password: `offline-${username}`,
  }));
  const remaining = [...identities];
  const snapshot = { baseline: 'unchanged' };
  let snapshots = 0;
  const globals = {
    base: { extend: (fixtures) => fixtures },
    actor: undefined,
    operator: undefined,
    foreign: undefined,
    readOnly: undefined,
    foreignRequest: undefined,
    readOnlyRequest: undefined,
    builderRequest: undefined,
    Buffer,
    body: async (response) => response.json(),
    historicalBaselineSecuritySnapshot: async () => {
      snapshots++;
      return snapshot;
    },
    createHistoricalRecordActor: async () => remaining.shift(),
    expect: (actual) => ({
      toEqual: (expected) => assert.equal(actual, expected),
    }),
  };
  const { test: fixture } = executeHistoricalSpec(
    ['origin', 'login', 'sourceBuilderRequest', 'test'],
    globals,
  );
  await fixture.hRequest(
    {
      playwright: {
        request: {
          async newContext(options) {
            const calls = [];
            const context = {
              options,
              calls,
              disposed: false,
              async post(url, request) {
                calls.push({ url, request });
                return {
                  json: async () => ({ csrfToken: `csrf-${context.id}` }),
                };
              },
              async dispose() {
                context.disposed = true;
              },
              id: contexts.length,
            };
            contexts.push(context);
            return context;
          },
        },
      },
    },
    async (request) => {
      assert.equal(request, contexts[0]);
      assert.equal(contexts.length, 4);
      assert.equal(new Set(contexts).size, 4);
      for (const [index, context] of contexts.entries()) {
        assert.equal(context.options.baseURL, 'http://127.0.0.1:3101');
        assert.equal(
          context.options.extraHTTPHeaders.Origin,
          context.options.baseURL,
        );
        if (index === 3) {
          assert.equal(context.calls.length, 0);
          continue;
        }
        const call = context.calls[0];
        assert.equal(call.url, '/api/v1/auth/login');
        assert.equal(call.request.headers.Origin, context.options.baseURL);
        assert.equal(call.request.data.username, identities[index].username);
        assert.equal(call.request.data.password, identities[index].password);
      }
      for (const [index, headers] of [
        globals.operator,
        globals.foreign,
        globals.readOnly,
      ].entries())
        assert.equal(headers['X-CSRF-Token'], `csrf-${index}`);
      assert.equal(globals.foreignRequest, contexts[1]);
      assert.equal(globals.readOnlyRequest, contexts[2]);
    },
    { attach: async () => {} },
  );
  assert.equal(snapshots, 2);
  assert.ok(contexts.every((context) => context.disposed));
});

test('actual H source adapter uses owned internal login and keeps external portal flows separate', async () => {
  const calls = [];
  const response = {
    async json() {
      return { csrfToken: 'rotated-owned-csrf' };
    },
  };
  const client = (kind) =>
    Object.fromEntries(
      ['get', 'post', 'put'].map((method) => [
        method,
        async (url, options) => {
          calls.push({ kind, method, url, options });
          return response;
        },
      ]),
    );
  const globals = {
    actor: { username: 'owned-actor', password: 'offline-owned-password' },
    operator: { 'X-CSRF-Token': 'owned-csrf' },
    coreLeadFixtures: {
      tokenA: 'baseline-token',
      operatorUsername: 'baseline-login',
    },
    body: async (response) => response.json(),
  };
  const { sourceBuilderRequest: factory } = executeHistoricalSpec(
    ['origin', 'sourceBuilderRequest'],
    globals,
  );
  const request = factory(client('owned'), client('portal'));
  await request.post('/api/v1/leads', {
    headers: {
      Origin: 'http://127.0.0.1:5174',
      Authorization: 'Bearer baseline-token',
      'Idempotency-Key': 'fixed-source-key',
    },
    data: { exact: 'body' },
  });
  assert.equal(calls.at(-1).kind, 'owned');
  assert.equal(calls.at(-1).options.headers.Authorization, undefined);
  assert.equal(calls.at(-1).options.data.exact, 'body');
  assert.equal(calls.at(-1).options.headers.Origin, 'http://127.0.0.1:3101');
  assert.equal(calls.at(-1).options.headers['X-CSRF-Token'], 'owned-csrf');
  assert.equal(
    calls.at(-1).options.headers['Idempotency-Key'],
    'fixed-source-key',
  );
  await request.post('/api/v1/auth/login', {
    headers: { Origin: 'http://127.0.0.1:5174' },
    data: { username: 'baseline-login', password: 'must-not-be-used' },
  });
  assert.equal(calls.at(-1).kind, 'owned');
  assert.equal(calls.at(-1).options.data.username, 'owned-actor');
  assert.equal(calls.at(-1).options.data.password, 'offline-owned-password');
  assert.equal(calls.at(-1).options.headers.Origin, 'http://127.0.0.1:3101');
  await request.post('/api/v1/auth/login', {
    data: { username: 'new-client', password: 'client-offline' },
  });
  assert.equal(calls.at(-1).kind, 'portal');
  await request.post('/api/v1/client/leads/x/reviews', {
    headers: { 'X-CSRF-Token': 'portal-csrf' },
  });
  assert.equal(calls.at(-1).kind, 'portal');
  await request.put('/api/v1/materials/upload-drafts/x/content', {
    headers: { 'X-CSRF-Token': 'rotated-owned-csrf' },
  });
  assert.equal(calls.at(-1).kind, 'owned');
  await request.get('/api/v1/lawyer/cases/x');
  assert.equal(calls.at(-1).kind, 'portal');
  for (const portal of ['client', 'notary', 'lawyer']) {
    const login = {
      headers: { Origin: 'http://127.0.0.1:5174' },
      data: { username: `new-${portal}`, password: `offline-${portal}` },
    };
    await request.post('/api/v1/auth/login', login);
    const loginCall = calls.at(-1);
    assert.equal(loginCall.kind, 'portal');
    assert.equal(loginCall.options.headers.Origin, 'http://127.0.0.1:3101');
    assert.equal(loginCall.options.data, login.data);
    assert.equal(login.headers.Origin, 'http://127.0.0.1:5174');
    const write = {
      headers: {
        Origin: 'http://127.0.0.1:5174',
        'X-CSRF-Token': `${portal}-csrf`,
        'Idempotency-Key': `${portal}-key`,
      },
      data: Buffer.from(`offline-${portal}-body`),
    };
    await request.put(`/api/v1/${portal}/records/x`, write);
    const writeCall = calls.at(-1);
    assert.equal(writeCall.kind, 'portal');
    assert.equal(writeCall.options.headers.Origin, 'http://127.0.0.1:3101');
    assert.equal(writeCall.options.headers['X-CSRF-Token'], `${portal}-csrf`);
    assert.equal(writeCall.options.headers['Idempotency-Key'], `${portal}-key`);
    assert.equal(writeCall.options.data, write.data);
    assert.equal(write.headers.Origin, 'http://127.0.0.1:5174');
  }
  const internalWrite = {
    headers: {
      Origin: 'http://127.0.0.1:5174',
      'X-CSRF-Token': 'rotated-owned-csrf',
      'Idempotency-Key': 'internal-key',
    },
    data: Buffer.from('offline-internal-body'),
  };
  await request.put('/api/v1/materials/upload-drafts/x/content', internalWrite);
  assert.equal(calls.at(-1).kind, 'owned');
  assert.equal(calls.at(-1).options.headers.Origin, 'http://127.0.0.1:3101');
  assert.equal(
    calls.at(-1).options.headers['X-CSRF-Token'],
    'rotated-owned-csrf',
  );
  assert.equal(calls.at(-1).options.headers['Idempotency-Key'], 'internal-key');
  assert.equal(calls.at(-1).options.data, internalWrite.data);
  assert.equal(internalWrite.headers.Origin, 'http://127.0.0.1:5174');
});
