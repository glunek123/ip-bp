import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  assertSectionRecordUiBinding,
  withSectionRecordUiDatabase,
  ownSectionRecordUiCase,
  revokeSectionRecordUiActor,
  sectionRecordUiSnapshot,
  sectionRecordUiUploads,
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
const both = (value) => ({
  DATABASE_URL: value,
  DEV_COR_TEST_DATABASE_URL: value,
});
function fixture() {
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
  const state = {
    capture: 0,
    validate: 0,
    opened: 0,
    connect: 0,
    end: 0,
    queries: [],
    failConnect: false,
    failQuery: false,
    identity: [
      { db: 'dev_cor_test', schema: 'public', username: 'dev_cor_test' },
    ],
    migrations,
    applied: migrations.map((m) => ({
      migration_name: m.name,
      checksum: m.checksum,
      finished_at: 'finished',
      rolled_back_at: null,
    })),
  };
  const deps = {
    environment: { ...valid },
    capture() {
      state.capture++;
      return { childEnvironment: { DATABASE_URL: url } };
    },
    validate() {
      state.validate++;
      return { connectionString: url };
    },
    async migrations() {
      return state.migrations;
    },
    openClient() {
      state.opened++;
      return {
        async connect() {
          state.connect++;
          if (state.failConnect) throw new Error('connect rejected');
        },
        async end() {
          state.end++;
        },
        async query(sql) {
          state.queries.push(sql);
          if (state.failQuery) throw new Error('query rejected');
          return {
            rows: sql.includes('current_database()')
              ? state.identity
              : state.applied,
          };
        },
      };
    },
  };
  return { state, deps };
}

test('exact coordinated R2 tuple passes the pure first gate', () => {
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
  test(`rejects ${name} before capture, connection, or operation`, async () => {
    const f = fixture();
    f.deps.environment = { ...valid, ...patch };
    let reached = false;
    await assert.rejects(
      withSectionRecordUiDatabase(async () => {
        reached = true;
      }, f.deps),
    );
    assert.equal(reached, false);
    assert.equal(f.state.capture, 0);
    assert.equal(f.state.opened, 0);
    assert.equal(f.state.connect, 0);
    assert.equal(f.state.end, 0);
  });
}
test('exact full chain and identity admit one operation and close only its client', async () => {
  const f = fixture();
  assert.equal(
    await withSectionRecordUiDatabase(async () => 'accepted', f.deps),
    'accepted',
  );
  assert.equal(f.state.capture, 1);
  assert.equal(f.state.validate, 1);
  assert.equal(f.state.connect, 1);
  assert.equal(f.state.end, 1);
  assert.equal(f.state.queries.length, 2);
});
for (const kind of [
  'capture',
  'validator',
  'source155',
  'source156',
  'tail',
  'duplicate',
  'badChecksum',
]) {
  test(`rejects ${kind} before opening a client`, async () => {
    const f = fixture();
    if (kind === 'capture')
      f.deps.capture = () => ({
        childEnvironment: { DATABASE_URL: url + '?bad' },
      });
    if (kind === 'validator')
      f.deps.validate = () => ({ connectionString: url + '#bad' });
    if (kind === 'source155') f.state.migrations.length = 155;
    if (kind === 'source156') f.state.migrations.length = 156;
    if (kind === 'tail') f.state.migrations[156].name = 'unapproved';
    if (kind === 'duplicate') f.state.migrations[0] = f.state.migrations[1];
    if (kind === 'badChecksum') f.state.migrations[0].checksum = 'bad';
    await assert.rejects(
      withSectionRecordUiDatabase(async () => assert.fail('reached'), f.deps),
    );
    assert.equal(f.state.opened, 0);
  });
}
for (const kind of [
  'connect',
  'query',
  'identity',
  'ledger155',
  'ledger156',
  'ledgerName',
  'ledgerChecksum',
  'unfinished',
  'rolledBack',
  'operation',
]) {
  test(`rejects ${kind} and closes the owned client`, async () => {
    const f = fixture();
    if (kind === 'connect') f.state.failConnect = true;
    if (kind === 'query') f.state.failQuery = true;
    if (kind === 'identity') f.state.identity[0].username = 'other';
    if (kind === 'ledger155') f.state.applied.length = 155;
    if (kind === 'ledger156') f.state.applied.length = 156;
    if (kind === 'ledgerName') f.state.applied[3].migration_name = 'wrong';
    if (kind === 'ledgerChecksum') f.state.applied[3].checksum = '0'.repeat(64);
    if (kind === 'unfinished') f.state.applied[3].finished_at = null;
    if (kind === 'rolledBack')
      f.state.applied[3].rolled_back_at = 'rolled-back';
    let reached = false;
    await assert.rejects(
      withSectionRecordUiDatabase(async () => {
        reached = true;
        if (kind === 'operation') throw new Error('operation rejected');
        assert.fail('gate admitted unapproved operation');
      }, f.deps),
    );
    assert.equal(reached, kind === 'operation');
    assert.equal(f.state.end, 1);
  });
}
test('UI support has no destructive fixture import, shell, migrations, or direct business writes', async () => {
  const source = await readFile(
    new URL('./case-section-record-ui-database.mjs', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(
    source,
    /(?:INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|TRUNCATE\s|DROP\s|ALTER\s|execSync|spawn\(|seedCore|clearCore|dropFaults|disconnectDatabase)/iu,
  );
  assert.doesNotMatch(source, /from ['"][^'"]*core-lead-database/u);
  assert.match(source, /case-section-record-upload-database\.mjs/u);
  assert.match(source, /case-historical-record-edit-database\.mjs/u);
  assert.doesNotMatch(source, /createHistoricalRecordActor/u);
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

test('a baseline account cannot own a case in this UI fixture map', async () => {
  await assert.rejects(
    ownSectionRecordUiCase(
      '70000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
    ),
    /UI case must belong to this run actor/u,
  );
});
test('baseline role revocation is rejected before any database admission', async () => {
  await assert.rejects(
    revokeSectionRecordUiActor('20000000-0000-4000-8000-000000000001'),
    /Only this run upload actor/u,
  );
});
test('reading an unowned case snapshot is rejected before database admission', async () => {
  await assert.rejects(
    sectionRecordUiSnapshot('70000000-0000-4000-8000-000000000001'),
    /Only this run verified external case/u,
  );
});
test('reading unowned upload context is rejected before database admission', async () => {
  await assert.rejects(
    sectionRecordUiUploads('70000000-0000-4000-8000-000000000001'),
    /Only this run upload case/u,
  );
});
