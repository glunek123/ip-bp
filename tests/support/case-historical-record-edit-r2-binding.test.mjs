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
  restoreHistoricalRecordActor,
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

test('actual restored H fixture uses one backend origin and separate cookie contexts for all three actors and the portal', async () => {
  const contexts = [];
  const identities = ['owned', 'foreign', 'read-only'].map(
    (username, index) => ({
      userId: `synthetic-user-${index}`,
      departmentId: `synthetic-department-${index}`,
      username,
      password: `offline-${username}`,
    }),
  );
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
    recoverHistoricalActors: async () => ({
      operator: identities[0],
      foreign: identities[1],
      readOnly: identities[2],
    }),
    expect: (actual) => ({
      toEqual: (expected) => assert.equal(actual, expected),
    }),
  };
  const { test: fixture } = executeHistoricalSpec(
    [
      'origin',
      'historicalSessionHeaders',
      'login',
      'sourceBuilderRequest',
      'test',
    ],
    globals,
  );
  assert.equal(fixture.hActorRecovery[0], undefined);
  assert.equal(fixture.hActorRecovery[1].scope, 'worker');
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
                const identity = identities[context.id];
                return {
                  json: async () => ({
                    csrfToken: `csrf-${context.id}`,
                    principalType: 'INTERNAL',
                    user: { id: identity.userId, username: identity.username },
                    department: { id: identity.departmentId },
                  }),
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
      return {
        csrfToken: 'rotated-owned-csrf',
        principalType: 'INTERNAL',
        user: { id: 'owned-id', username: 'owned-actor' },
        department: { id: 'owned-department' },
      };
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
    actor: {
      userId: 'owned-id',
      departmentId: 'owned-department',
      username: 'owned-actor',
      password: 'offline-owned-password',
    },
    operator: { 'X-CSRF-Token': 'owned-csrf' },
    coreLeadFixtures: {
      tokenA: 'baseline-token',
      operatorUsername: 'baseline-login',
    },
    body: async (response) => response.json(),
  };
  const { sourceBuilderRequest: factory } = executeHistoricalSpec(
    ['origin', 'historicalSessionHeaders', 'sourceBuilderRequest'],
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

const retainedBinding = {
  manifestSha256:
    'a5307e17af39d842c1ed01b59acae261de8eee16a5454685a8d9137978c340af',
  creationDeltaSha256:
    'f61ab7550209b531a7dc66d9a32bc5b023b47014feccda9730b17c3a4ca26d83',
  fourGrantManifestSha256:
    'e6baa1d3b7e94b59cc2a83e90b43696bc6563046fd927206e8a3306fe02073de',
  threeCorrectionManifestSha256:
    '32331cbbc325cd2fb76d1fde7e4e7e0f2d3cee0e6d5ec8688892cee8bbd83021',
  credentialFileSha256:
    'd9367f33ac67ad2353648ade02b3c110aaa1785a51944207882de56e34a94de1',
  userId: 'edc8bf6f-6660-41f6-8418-f72f87443a1c',
  roleId: '51c34a8b-fb00-45b1-ab9f-d077d59d4878',
  departmentId: '10000000-0000-4000-8000-000000000001',
  assignmentId: '8bed4da1-c61e-40d9-bd78-170380421ce8',
  membershipId: '36ea4166-dce8-48bd-bb9b-216222f0ea2a',
  credentialId: 'f695cb82-e0d1-4dcc-9135-d1e3c75ecc8b',
};
const retainedCredential = {
  username: 'historical-record-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  password: 'offline-retained-password',
};
// Non-secret synthetic creation IDs and actions from the frozen H object delta.
const originalGrantPairs = [
  ['271f1e93-9d0c-44ff-beaa-ce8d2414b017', 'case.archive'],
  ['e1f96825-40ab-4829-bb44-90356f9676ca', 'case.archive.correct'],
  ['175bfc39-4b52-464b-aec8-168dc7952719', 'case.closure.correct'],
  ['37c4a9f4-f4e8-463d-9c12-f24fcd5a4341', 'case.closure.record'],
  ['c40ca267-df2b-417e-afad-f48643e94c95', 'case.complaint.confirm'],
  ['0c1c7dda-5dca-46e9-b522-86882beb8052', 'case.complaint.submit'],
  ['c50f0da5-816b-4f4f-a496-cb8b53bc2b2c', 'case.execution.confirm'],
  ['386a7042-3aba-43b3-9e08-263e8a841618', 'case.execution.filing.submit'],
  ['fbadd7a4-1d2a-4515-a9df-5a804b710d5c', 'case.execution.finish'],
  ['f595dbd3-aa86-4cb7-9b79-be4a1aadbdb5', 'case.execution.mail'],
  ['b776a5cc-fdc4-4fc7-835c-07f37a3de85f', 'case.execution.submit'],
  ['f9443003-0eee-450c-9546-3e84b62bbaaa', 'case.hearing.correct'],
  ['c3a47725-1120-428b-8369-c81bdeb9bc12', 'case.hearing.schedule'],
  ['f1e39a1d-34ed-4657-862a-6cc912aeb7d2', 'case.judgment.correct'],
  ['635a1b8a-d050-4674-91e8-fe46433ab800', 'case.judgment.next_step'],
  ['5f586e49-f882-433b-93f1-99048cca6183', 'case.judgment.register'],
  ['7578eafa-be66-4e79-bde3-02df2ccb7c8b', 'case.match'],
  ['b15a2899-2aff-40d0-97e9-e83743d6f38e', 'case.read'],
  ['84de156b-b7a4-4adb-8d31-76ce9fe86e8e', 'case.second_instance.result'],
  ['95287db6-32ef-43ae-92c1-b0e40bac7960', 'customer.admit'],
  ['7f9e8452-c32b-449c-bd08-98e99787d1cb', 'customer.read'],
  ['0c467442-b353-415d-b310-d8953b8f95d5', 'lawyer.account.manage'],
  ['f04faccd-e560-45f1-b5ee-37e9d6b5d682', 'lead.create'],
  ['2f4d9d11-5806-4e2a-b4d5-5fc917fa685b', 'lead.edit'],
  ['9601fe3b-0a00-4e23-a2eb-2249da72e776', 'lead.evidence.decide'],
  ['21ffedfa-663c-4ee6-9720-6b2e7dc847ea', 'lead.push'],
  ['4fab3964-c162-4358-bfec-8d771186f869', 'lead.read'],
  ['36d13519-e99a-4c52-818c-2e15114d5874', 'lead.withdraw.apply'],
  ['67760ac2-0a1a-4ebb-82b4-0dfb802e1b68', 'notary.evidence.record'],
  ['d987b632-aca3-4bb8-b739-7e4502509ece', 'notary.issuance.decide'],
  ['ae00d94e-a5b6-4a30-bd10-664e70039bd1', 'notary.office.manage'],
  ['a5193737-de02-4412-8bb0-ed463f7c816d', 'notary.opening.review'],
  ['c4ae499d-a7fa-42cf-b6e0-df894ebae5fc', 'notary.return.archive'],
  ['de2fbfe7-86d5-4ada-9597-c5b599d423d6', 'notary.unbox.record'],
  ['37d64515-e5f4-4599-a07a-0c07f1378a7c', 'user.manage'],
];
function restorationOffline(count = 157) {
  const f = offline(count);
  f.state.actorRows = [
    {
      user_id: retainedBinding.userId,
      role_id: retainedBinding.roleId,
      department_id: retainedBinding.departmentId,
      assignment_id: retainedBinding.assignmentId,
      team_id: null,
      membership_id: retainedBinding.membershipId,
      credential_id: retainedBinding.credentialId,
      username: retainedCredential.username,
    },
  ];
  f.state.grants = originalGrantPairs.map(([id, action]) => ({
    id,
    action,
    scope: 'DEPARTMENT',
  }));
  // Exact seven additions from the approved four/three transaction receipts.
  for (const [id, action] of [
    ['c45f5968-f1b1-4b7f-9958-fe95224e63ec', 'case.complaint.mail'],
    ['ccee168c-b7c1-4f0c-a045-cf6aa1cea7a8', 'case.filing.submit'],
    ['031911aa-9794-415a-b4ea-6dd6e5a050e9', 'case.acceptance.register'],
    ['604ac717-4e8e-46fc-9eb2-9946a06c2063', 'case.external-entry.create'],
    ['221b4dfd-6ad6-48aa-933e-5cc48d31e07c', 'case.execution.mailing.correct'],
    ['e8a738ff-28fa-435b-a81f-6850e15248b6', 'case.execution.filing.correct'],
    ['4fdb897a-36af-4c40-971b-dfc247c6422f', 'case.execution.finish.correct'],
  ])
    f.state.grants.push({
      id,
      action,
      scope: 'DEPARTMENT',
    });
  const open = f.deps.openClient;
  f.deps.openClient = () => {
    const client = open();
    const query = client.query.bind(client);
    client.query = async (sql, parameters = []) => {
      if (
        sql.startsWith('SELECT count(*)') ||
        sql.startsWith('SELECT u.id') ||
        sql.startsWith('SELECT id,action::text')
      ) {
        f.state.calls.push({ sql, parameters });
        return {
          rows: sql.startsWith('SELECT count(*)')
            ? [{ count: f.state.applied.length }]
            : sql.startsWith('SELECT u.id')
              ? f.state.actorRows
              : f.state.grants,
        };
      }
      return query(sql, parameters);
    };
    return client;
  };
  f.deps.hashPassword = () => {
    throw new Error('Recovery must not create credentials');
  };
  return f;
}
function assertRecoveryReadOnly(f) {
  assert.ok(f.state.calls.every((call) => call.sql.startsWith('SELECT')));
  assert.ok(
    f.state.calls.every(
      (call) => !call.parameters.includes(retainedCredential.password),
    ),
  );
}
test('restore admits only the retained actor with preserved 35 plus exactly seven approved grants', async () => {
  const f = restorationOffline();
  const identity = await restoreHistoricalRecordActor(
    retainedBinding,
    retainedCredential,
    f.deps,
  );
  assert.equal(identity.userId, retainedBinding.userId);
  assert.equal(identity.roleId, retainedBinding.roleId);
  assert.equal(identity.username, retainedCredential.username);
  assert.equal(identity.password, retainedCredential.password);
  assert.ok(Object.isFrozen(identity));
  assert.equal(f.state.ended, 1);
  assertRecoveryReadOnly(f);
});
for (const key of Object.keys(retainedBinding))
  test(`restore rejects mismatched ${key} before capture`, async () => {
    const f = restorationOffline();
    await assert.rejects(
      restoreHistoricalRecordActor(
        { ...retainedBinding, [key]: 'mismatched' },
        retainedCredential,
        f.deps,
      ),
    );
    assert.equal(f.state.capture, 0);
    assert.equal(f.state.opened, 0);
    assertRecoveryReadOnly(f);
  });
for (const credential of [
  undefined,
  null,
  {},
  { ...retainedCredential, username: '' },
  { ...retainedCredential, password: '' },
])
  test(`restore rejects missing original credential ${JSON.stringify(credential && Object.keys(credential))}`, async () => {
    const f = restorationOffline();
    await assert.rejects(
      restoreHistoricalRecordActor(retainedBinding, credential, f.deps),
      /credential is required/u,
    );
    assert.equal(f.state.capture, 0);
    assert.equal(f.state.opened, 0);
    assertRecoveryReadOnly(f);
  });
for (const key of [
  'user_id',
  'role_id',
  'department_id',
  'assignment_id',
  'team_id',
  'membership_id',
  'credential_id',
  'username',
])
  test(`restore rejects live ${key} mismatch without writes`, async () => {
    const f = restorationOffline();
    f.state.actorRows[0][key] = 'wrong';
    await assert.rejects(
      restoreHistoricalRecordActor(retainedBinding, retainedCredential, f.deps),
      /active identity/u,
    );
    assert.equal(f.state.ended, 1);
    assertRecoveryReadOnly(f);
  });
for (const [name, change] of [
  [
    'inactive or missing association',
    (f) => {
      f.state.actorRows = [];
    },
  ],
  [
    'multiple associations',
    (f) => f.state.actorRows.push({ ...f.state.actorRows[0] }),
  ],
  ['missing approved grant', (f) => f.state.grants.pop()],
  [
    'extra grant',
    (f) =>
      f.state.grants.push({
        id: retainedBinding.userId,
        action: 'role.manage',
        scope: 'DEPARTMENT',
      }),
  ],
  [
    'original grant replacement',
    (f) => {
      f.state.grants[0].id = retainedBinding.userId;
    },
  ],
  [
    'wrong grant scope',
    (f) => {
      f.state.grants.at(-1).scope = 'SELF';
    },
  ],
  [
    'foreign R2 tuple',
    (f) => {
      f.deps.environment.DEV_COR_TEST_DATABASE_PROJECT = 'other';
    },
  ],
  [
    'ledger checksum drift',
    (f) => {
      f.state.applied[156].checksum = 'wrong';
    },
  ],
])
  test(`restore rejects ${name} without identity or grant writes`, async () => {
    const f = restorationOffline();
    change(f);
    await assert.rejects(
      restoreHistoricalRecordActor(retainedBinding, retainedCredential, f.deps),
    );
    assertRecoveryReadOnly(f);
  });
test('restore rejects 156 even when that source ledger otherwise passes existing admission', async () => {
  const f = restorationOffline(156);
  await assert.rejects(
    restoreHistoricalRecordActor(retainedBinding, retainedCredential, f.deps),
    /157 ledger/u,
  );
  assertRecoveryReadOnly(f);
});

for (const index of Array.from({ length: 7 }, (_, i) => i))
  test(`restore rejects added grant ID replacement ${index} despite unchanged action and scope`, async () => {
    const f = restorationOffline();
    f.state.grants[35 + index].id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await assert.rejects(
      restoreHistoricalRecordActor(retainedBinding, retainedCredential, f.deps),
      /exactly seven approved grants/u,
    );
    assert.equal(f.state.ended, 1);
    assertRecoveryReadOnly(f);
  });
test('restore rejects all seven recreated grant IDs despite unchanged actions and scopes', async () => {
  const f = restorationOffline();
  for (let index = 0; index < 7; index++)
    f.state.grants[35 + index].id =
      `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`;
  await assert.rejects(
    restoreHistoricalRecordActor(retainedBinding, retainedCredential, f.deps),
    /exactly seven approved grants/u,
  );
  assert.equal(f.state.ended, 1);
  assertRecoveryReadOnly(f);
});

function recoveryInputs() {
  return {
    binding: { ...retainedBinding },
    credential: { ...retainedCredential },
    foreign: {
      manifestSha256: 'e'.repeat(64),
      actor: {
        userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        roleId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        departmentId: '10000000-0000-4000-8000-000000000002',
        username: 'historical-record-foreign',
        password: 'offline-foreign',
      },
    },
    readOnly: {
      manifestSha256: 'e'.repeat(64),
      actor: {
        userId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        roleId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        departmentId: retainedBinding.departmentId,
        username: 'historical-record-readonly',
        password: 'offline-readonly',
      },
    },
  };
}
for (const [name, change] of [
  [
    'missing foreign manifest',
    (r) => {
      delete r.foreign;
    },
  ],
  [
    'missing read-only manifest',
    (r) => {
      delete r.readOnly;
    },
  ],
  [
    'unrecorded negative manifest',
    (r) => {
      r.foreign.manifestSha256 = '';
    },
  ],
  [
    'old operator manifest as negative proof',
    (r) => {
      r.foreign.manifestSha256 = retainedBinding.manifestSha256;
    },
  ],
  [
    'operator user as foreign',
    (r) => {
      r.foreign.actor.userId = retainedBinding.userId;
    },
  ],
  [
    'operator role as read-only',
    (r) => {
      r.readOnly.actor.roleId = retainedBinding.roleId;
    },
  ],
  [
    'foreign/read-only swapped',
    (r) => {
      [r.foreign, r.readOnly] = [r.readOnly, r.foreign];
    },
  ],
  [
    'negative actor reused',
    (r) => {
      r.readOnly.actor.userId = r.foreign.actor.userId;
    },
  ],
  [
    'baseline role',
    (r) => {
      r.readOnly.actor.roleId = '30000000-0000-4000-8000-000000000001';
    },
  ],
  [
    'missing negative credential',
    (r) => {
      delete r.foreign.actor.password;
    },
  ],
])
  test(`recovery preflight rejects ${name} before restore/login/factory`, async () => {
    const recovery = recoveryInputs();
    change(recovery);
    let restores = 0;
    const { recoverHistoricalActors } = executeHistoricalSpec(
      ['recoverHistoricalActors'],
      {
        restoreHistoricalRecordActor: async () => {
          restores++;
        },
        createHistoricalRecordActor: () => {
          throw new Error('Factory must not run');
        },
      },
    );
    await assert.rejects(
      recoverHistoricalActors({ load: async () => recovery }),
    );
    assert.equal(restores, 0);
  });
test('recovery requires the private loader and has no factory fallback', async () => {
  const { recoverHistoricalActors } = executeHistoricalSpec(
    ['recoverHistoricalActors'],
    {},
  );
  await assert.rejects(
    recoverHistoricalActors(undefined),
    /Runner must supply/u,
  );
});
test('recovery forwards only the retained main binding and original credential to restore', async () => {
  const recovery = recoveryInputs();
  const main = { userId: retainedBinding.userId };
  const calls = [];
  const { recoverHistoricalActors } = executeHistoricalSpec(
    ['recoverHistoricalActors'],
    {
      restoreHistoricalRecordActor: async (...args) => {
        calls.push(args);
        return main;
      },
    },
  );
  const result = await recoverHistoricalActors({ load: async () => recovery });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], recovery.binding);
  assert.equal(calls[0][1], recovery.credential);
  assert.equal(result.operator, main);
  assert.equal(result.foreign, recovery.foreign.actor);
  assert.equal(result.readOnly, recovery.readOnly.actor);
});
for (const [name, change] of [
  [
    'principal',
    (s) => {
      s.principalType = 'CLIENT';
    },
  ],
  [
    'user',
    (s) => {
      s.user.id = 'different-user';
    },
  ],
  [
    'username',
    (s) => {
      s.user.username = 'different-username';
    },
  ],
  [
    'department',
    (s) => {
      s.department.id = 'different-department';
    },
  ],
  [
    'CSRF',
    (s) => {
      s.csrfToken = '';
    },
  ],
])
  test(`restored session identity rejects wrong ${name}`, () => {
    const { historicalSessionHeaders } = executeHistoricalSpec(
      ['origin', 'historicalSessionHeaders'],
      {},
    );
    const identity = { ...retainedBinding, ...retainedCredential };
    const session = {
      principalType: 'INTERNAL',
      user: { id: identity.userId, username: identity.username },
      department: { id: identity.departmentId },
      csrfToken: 'offline-csrf',
    };
    change(session);
    assert.throws(
      () => historicalSessionHeaders(session, identity),
      /identity or CSRF mismatch/u,
    );
  });
