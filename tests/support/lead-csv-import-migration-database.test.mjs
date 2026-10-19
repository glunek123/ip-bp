import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { inspect } from 'node:util';
import { setImmediate } from 'node:timers';
import {
  assertLeadCsvR2Binding,
  assertFrozenFixture,
  assertOwnedSchema,
  injectLeadCsvFault,
  readLeadCsvOfflinePlan,
  captureLeadCsvTarget,
  createLeadCsvBudget,
  createLeadCsvSession,
  runLeadCsvOwnedScenario,
  verifyLeadCsvFaultRollback,
  withLeadCsvPublicPreservation,
  withLeadCsvSession,
  withLeadCsvTransaction,
} from './lead-csv-import-migration-database.mjs';

const url =
  'postgresql://dev_cor_test:offline-only@127.0.0.1:15438/dev_cor_test';
const env = {
  NODE_ENV: 'test',
  DEV_COR_TEST_DATABASE_PROJECT: 'dev-cor-ui003-r2',
  DEV_COR_TEST_DATABASE_CONTAINER_ID:
    '45addc0179e929dd1dcd4f835b6c6c14c36c2ac4aed5e6cd5842648bf5db5236',
  DATABASE_URL: url,
  DEV_COR_TEST_DATABASE_URL: url,
  npm_config_user_agent: 'pnpm/11.27.0 npm/? node/v24.21.0',
};

function errorReport(error) {
  return [
    inspect(error, { showHidden: true, depth: 20 }),
    JSON.stringify(error, Object.getOwnPropertyNames(error)),
    JSON.stringify({
      message: error.message,
      stack: error.stack,
      cause: error.cause,
      ...error,
    }),
  ].join('\n');
}

test('URL rejection never exposes secret canaries in error objects or reports', () => {
  const canary = 'CSV_SECRET_CANARY_PASSWORD_01';
  const first = url.replace('offline-only', canary);
  let error;
  try {
    assertLeadCsvR2Binding({ ...env, DATABASE_URL: first });
  } catch (caught) {
    error = caught;
  }
  assert.ok(error);
  assert.equal(
    errorReport(error).includes(canary),
    false,
    'URL rejection leaked the secret canary',
  );
});

function mockTime() {
  let time = 0,
    next = 0;
  const pending = new Map();
  return {
    now: () => time,
    schedule(callback, delay) {
      const id = ++next;
      pending.set(id, { at: time + delay, callback });
      return id;
    },
    cancel: (id) => pending.delete(id),
    advance(duration) {
      const target = time + duration;
      for (;;) {
        const first = [...pending.entries()]
          .filter(([, task]) => task.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!first) break;
        time = first[1].at;
        pending.delete(first[0]);
        first[1].callback();
      }
      time = target;
    },
    pending: () => pending.size,
  };
}

function mockPg(handle = async () => ({ rows: [] }), hooks = {}) {
  const state = {
    config: undefined,
    calls: [],
    destroyed: 0,
    closed: 0,
    pendingReject: undefined,
  };
  class Client {
    constructor(config) {
      state.config = config;
      this.connection = {
        stream: {
          destroy() {
            state.destroyed++;
            state.pendingReject?.(new Error('MOCK_SOCKET_CLOSED'));
          },
        },
      };
    }
    on() {}
    async connect() {
      await hooks.connect?.(state);
    }
    async query(sql, values) {
      state.calls.push({ sql, values });
      return handle(sql, values, state);
    }
    async end() {
      state.closed++;
      await hooks.end?.(state);
    }
  }
  return { Client, state };
}

test('every environment/capture rejection serializes without either URL credential', () => {
  const password = 'CSV_SECRET_CANARY_PASSWORD_02';
  const username = 'CSV_SECRET_CANARY_USERNAME_02';
  const secretUrl = url.replace('offline-only', password);
  const budget = createLeadCsvBudget({ now: () => 0 });
  const cases = [
    () => assertLeadCsvR2Binding({ ...env, NODE_ENV: password }),
    () =>
      assertLeadCsvR2Binding({
        ...env,
        DATABASE_URL: secretUrl,
        DEV_COR_TEST_DATABASE_URL: secretUrl.replace(
          'dev_cor_test:',
          `${username}:`,
        ),
      }),
    () =>
      assertLeadCsvR2Binding({
        ...env,
        DATABASE_URL: `${secretUrl}?`,
        DEV_COR_TEST_DATABASE_URL: `${secretUrl}?`,
      }),
    () =>
      assertLeadCsvR2Binding({
        ...env,
        DATABASE_URL: `${secretUrl}#`,
        DEV_COR_TEST_DATABASE_URL: `${secretUrl}#`,
      }),
    () =>
      assertLeadCsvR2Binding({
        ...env,
        DATABASE_URL: `invalid:${username}:${password}`,
        DEV_COR_TEST_DATABASE_URL: `invalid:${username}:${password}`,
      }),
    () =>
      assertLeadCsvR2Binding({
        ...env,
        DATABASE_URL: secretUrl.replace('dev_cor_test:', `${username}:`),
        DEV_COR_TEST_DATABASE_URL: secretUrl.replace(
          'dev_cor_test:',
          `${username}:`,
        ),
      }),
    () =>
      captureLeadCsvTarget(env, budget, {
        capture() {
          throw Object.assign(new Error(secretUrl), {
            actual: secretUrl,
            cause: new Error(username),
          });
        },
      }),
    () =>
      captureLeadCsvTarget(env, budget, {
        capture: () => ({ childEnvironment: env }),
        validate() {
          throw Object.assign(new Error(password), { expected: secretUrl });
        },
      }),
    () =>
      captureLeadCsvTarget(env, budget, {
        capture: () => ({
          childEnvironment: {
            ...env,
            DATABASE_URL: secretUrl,
            DEV_COR_TEST_DATABASE_URL: secretUrl,
          },
        }),
        validate: () => ({ connectionString: url }),
      }),
    () =>
      captureLeadCsvTarget(env, budget, {
        capture: () => ({ childEnvironment: env }),
        validate: () => ({ connectionString: secretUrl }),
      }),
  ];
  for (const reject of cases) {
    assert.throws(reject, (error) => {
      assert.match(error.code, /^CSV_OWNED_/u);
      const serialized = errorReport(error);
      assert.equal(
        serialized.includes(password) || serialized.includes(username),
        false,
        'Credential leaked through an error/report field',
      );
      assert.equal(
        'actual' in error || 'expected' in error || 'cause' in error,
        false,
      );
      return true;
    });
  }
});

test('first owned upgrade error survives rollback and connection-close failures', async () => {
  const primary = Object.assign(new Error('FIRST_OWNED_INSERT_FAILURE'), {
    code: '23514',
  });
  const rollback = new Error('CSV_SECRET_CANARY_ROLLBACK');
  const closure = new Error('CSV_SECRET_CANARY_CLOSE');
  const name = 'csv_risk_0123456789abcdef0123456789abcdef_upgrade';
  const mock = mockPg(
    async (sql) => {
      if (sql.startsWith('INSERT INTO')) throw primary;
      if (sql === 'ROLLBACK') throw rollback;
      if (sql === 'SELECT current_schema() AS schema')
        return { rows: [{ schema: name }] };
      if (sql.startsWith('SELECT nspacl::text'))
        return { rows: [{ acl: null }] };
      if (sql.startsWith('SELECT c.relname,c.relkind'))
        return {
          rows: Array.from({ length: 164 }, (_, i) => ({
            relname: `mock_table_${i}`,
            relkind: 'r',
          })),
        };
      return { rows: [] };
    },
    {
      end() {
        throw closure;
      },
    },
  );
  const time = mockTime();
  const session = createLeadCsvSession(
    mock.Client,
    url,
    createLeadCsvBudget({ milliseconds: 120_000, now: time.now }),
    time,
  );
  const plan = await readLeadCsvOfflinePlan();
  await assert.rejects(
    runLeadCsvOwnedScenario(session, name, 'upgrade', plan),
    (error) => {
      assert.equal(error, primary);
      assert.equal(error.csvOwnedStage, 'predecessor-replayed');
      assert.deepEqual(
        error.csvOwnedSecondary.map((item) => item.phase),
        ['transaction-rollback', 'connection-close'],
      );
      assert.equal(errorReport(error).includes('CSV_SECRET_CANARY'), false);
      return true;
    },
  );
  assert.equal(mock.state.closed, 1);
  assert.equal(mock.state.destroyed, 1);
  assert.equal(time.pending(), 0);
});

test('public snapshot rollback and final close failures preserve the scenario error', async () => {
  const primary = new Error('FIRST_SCENARIO_FAILURE');
  const mock = mockPg(
    async (sql) => {
      if (sql === 'ROLLBACK')
        throw new Error('CSV_SECRET_CANARY_PUBLIC_ROLLBACK');
      return { rows: [] };
    },
    {
      end() {
        throw new Error('CSV_SECRET_CANARY_PUBLIC_CLOSE');
      },
    },
  );
  const time = mockTime();
  const session = createLeadCsvSession(
    mock.Client,
    url,
    createLeadCsvBudget({ now: time.now }),
    time,
  );
  let snapshots = 0;
  await assert.rejects(
    withLeadCsvSession(session, () =>
      withLeadCsvPublicPreservation(
        session,
        () => {
          throw primary;
        },
        async () => {
          if (++snapshots === 2)
            throw new Error('CSV_SECRET_CANARY_PUBLIC_SNAPSHOT');
          return { mockPublicHash: 'unchanged' };
        },
      ),
    ),
    (error) => {
      assert.equal(error, primary);
      assert.deepEqual(
        error.csvOwnedSecondary.map((item) => item.phase),
        ['public-snapshot', 'transaction-rollback', 'connection-close'],
      );
      assert.equal(errorReport(error).includes('CSV_SECRET_CANARY'), false);
      return true;
    },
  );
});

test('initial read-only snapshot failure keeps identity through rollback and close', async () => {
  const primary = new Error('FIRST_PUBLIC_SNAPSHOT_FAILURE');
  const session = {
    async connect() {},
    async query(sql) {
      if (sql === 'ROLLBACK') throw new Error('rollback failure');
      return { rows: [] };
    },
    async end() {
      throw new Error('close failure');
    },
  };
  await assert.rejects(
    withLeadCsvSession(session, () =>
      withLeadCsvTransaction(
        session,
        () => {
          throw primary;
        },
        true,
      ),
    ),
    (error) => {
      assert.equal(error, primary);
      assert.deepEqual(
        error.csvOwnedSecondary.map((item) => item.phase),
        ['transaction-rollback', 'connection-close'],
      );
      return true;
    },
  );
});

test('22012 permits the original retry only after rollback and exact state verification', async () => {
  for (const stopAt of ['rollback', 'state', 'success']) {
    const expected = Object.assign(new Error('expected divide by zero'), {
      code: '22012',
    });
    const sent = [];
    const session = {
      async query(sql) {
        sent.push(sql);
        if (sql === 'FAULT_RAW') throw expected;
        if (sql === 'ROLLBACK' && stopAt === 'rollback')
          throw new Error('CSV_SECRET_CANARY_FAULT_ROLLBACK');
        return { rows: [] };
      },
    };
    const run = async () => {
      await verifyLeadCsvFaultRollback(session, 'FAULT_RAW', async () => {
        sent.push('VERIFY_EXACT_OLD_STATE');
        if (stopAt === 'state')
          throw new Error('CSV_SECRET_CANARY_WRONG_STATE');
      });
      await session.query('ORIGINAL_RAW_ONCE');
    };
    if (stopAt === 'success') await run();
    else
      await assert.rejects(run(), (error) => {
        assert.equal(error, expected);
        assert.equal(errorReport(error).includes('CSV_SECRET_CANARY'), false);
        return true;
      });
    assert.equal(
      sent.filter((sql) => sql === 'ORIGINAL_RAW_ONCE').length,
      stopAt === 'success' ? 1 : 0,
    );
    assert.equal(
      sent.includes('VERIFY_EXACT_OLD_STATE'),
      stopAt !== 'rollback',
    );
  }
});

test('cumulative scenario deadline decreases server timeouts and blocks later SQL', async () => {
  const time = mockTime();
  const mock = mockPg(async (sql) => {
    if (!sql.startsWith('SELECT set_config')) time.advance(45_000);
    return { rows: [] };
  });
  const session = createLeadCsvSession(
    mock.Client,
    url,
    createLeadCsvBudget({ milliseconds: 120_000, now: time.now }),
    time,
  );
  await session.connect();
  await session.query('RAW_GROUP_1');
  await session.query('RAW_GROUP_2');
  await assert.rejects(session.query('RAW_GROUP_3'), {
    code: 'CSV_OWNED_DEADLINE_EXCEEDED',
  });
  const count = mock.state.calls.length;
  await assert.rejects(session.query('RAW_GROUP_4_MUST_NOT_SEND'), {
    code: 'CSV_OWNED_DEADLINE_EXCEEDED',
  });
  assert.equal(mock.state.calls.length, count);
  assert.deepEqual(
    mock.state.calls
      .filter((item) => item.sql.startsWith('SELECT set_config'))
      .map((item) => item.values),
    [
      ['120000', '5000'],
      ['75000', '5000'],
      ['30000', '5000'],
    ],
  );
  assert.ok(mock.state.destroyed > 0);
  await session.end();
});

test('whole-run budget caps later scenarios at the remaining six-minute deadline', () => {
  const time = mockTime();
  const overall = createLeadCsvBudget({ now: time.now });
  time.advance(300_000);
  const final = overall.child(120_000);
  assert.equal(final.remaining(), 60_000);
  time.advance(60_000);
  assert.throws(() => final.remaining(), {
    code: 'CSV_OWNED_DEADLINE_EXCEEDED',
  });
  assert.throws(() => overall.remaining(), {
    code: 'CSV_OWNED_DEADLINE_EXCEEDED',
  });
});

test('configuration round trips consume the same budget and cannot start a late raw group', async () => {
  const time = mockTime();
  const mock = mockPg(async (sql) => {
    if (sql.startsWith('SELECT set_config')) time.advance(120_000);
    return { rows: [] };
  });
  const session = createLeadCsvSession(
    mock.Client,
    url,
    createLeadCsvBudget({ milliseconds: 120_000, now: time.now }),
    time,
  );
  await session.connect();
  await assert.rejects(session.query('RAW_GROUP_MUST_NOT_START'), {
    code: 'CSV_OWNED_DEADLINE_EXCEEDED',
  });
  assert.equal(
    mock.state.calls.some((item) => item.sql === 'RAW_GROUP_MUST_NOT_START'),
    false,
  );
  await session.end();
});

test('expired preparation budget rejects before opening a frozen input', async () => {
  const time = mockTime();
  const budget = createLeadCsvBudget({ now: time.now });
  time.advance(360_000);
  await assert.rejects(
    readLeadCsvOfflinePlan({ frozen: 'THIS_PATH_MUST_NOT_BE_OPENED', budget }),
    { code: 'CSV_OWNED_DEADLINE_EXCEEDED' },
  );
});

test('active raw query is terminated on its original socket and awaited before timeout returns', async () => {
  const time = mockTime();
  const mock = mockPg(async (sql, _, state) => {
    if (sql === 'BEGIN; RAW_PINNED_MIGRATION; COMMIT;')
      return new Promise((resolve, reject) => {
        state.pendingReject = reject;
      });
    return { rows: [] };
  });
  const session = createLeadCsvSession(
    mock.Client,
    url,
    createLeadCsvBudget({ milliseconds: 120_000, now: time.now }),
    time,
  );
  await session.connect();
  const pending = session.query('BEGIN; RAW_PINNED_MIGRATION; COMMIT;');
  await new Promise((resolve) => setImmediate(resolve));
  time.advance(120_000);
  await assert.rejects(pending, { code: 'CSV_OWNED_DEADLINE_EXCEEDED' });
  assert.equal(mock.state.destroyed, 1);
  assert.equal(mock.state.config.connectionTimeoutMillis, 5_000);
  assert.equal(mock.state.config.lock_timeout, 5_000);
  assert.match(
    mock.state.config.options,
    /client_connection_check_interval=10/u,
  );
  assert.equal(
    mock.state.calls.filter(
      (item) => item.sql === 'BEGIN; RAW_PINNED_MIGRATION; COMMIT;',
    ).length,
    1,
  );
  await session.end();
});

test('public read-only statements and connection establishment have bounded waits', async () => {
  const time = mockTime();
  const mock = mockPg(async (sql) => {
    if (!sql.startsWith('SELECT set_config')) time.advance(1_000);
    return { rows: [] };
  });
  const session = createLeadCsvSession(
    mock.Client,
    url,
    createLeadCsvBudget({ milliseconds: 8_000, now: time.now }),
    time,
  );
  await withLeadCsvSession(session, () =>
    withLeadCsvTransaction(
      session,
      () => session.query('READ_ONLY_PUBLIC_SNAPSHOT'),
      true,
    ),
  );
  assert.deepEqual(
    mock.state.calls
      .filter((item) => item.sql.startsWith('SELECT set_config'))
      .map((item) => item.values),
    [
      ['8000', '5000'],
      ['7000', '5000'],
      ['6000', '5000'],
    ],
  );
  const hung = mockPg(async () => ({ rows: [] }), {
    connect(state) {
      return new Promise((resolve, reject) => {
        state.pendingReject = reject;
      });
    },
  });
  const connecting = createLeadCsvSession(
    hung.Client,
    url,
    createLeadCsvBudget({ now: time.now }),
    time,
  );
  const pending = connecting.connect();
  time.advance(5_000);
  await assert.rejects(pending, { code: 'CSV_OWNED_CONNECT_TIMEOUT' });
  assert.equal(hung.state.destroyed, 1);
  await connecting.end();
});

test('pure R2 guard rejects changed tuple and ambiguous URL before capture', () => {
  assert.equal(assertLeadCsvR2Binding(env), url);
  for (const change of [
    {
      DEV_COR_TEST_DATABASE_CONTAINER_ID:
        env.DEV_COR_TEST_DATABASE_CONTAINER_ID.slice(0, 12),
    },
    { DEV_COR_TEST_DATABASE_PROJECT: 'different' },
    { NODE_ENV: 'development' },
    { DATABASE_URL: url.replace('15438', '15437') },
    { DEV_COR_TEST_DATABASE_URL: url + '?' },
    { DATABASE_URL: url + '#x', DEV_COR_TEST_DATABASE_URL: url + '#x' },
    {
      DATABASE_URL: url.replace('127.0.0.1', 'localhost'),
      DEV_COR_TEST_DATABASE_URL: url.replace('127.0.0.1', 'localhost'),
    },
    { npm_config_user_agent: 'pnpm/0.0.0' },
  ])
    assert.throws(() => assertLeadCsvR2Binding({ ...env, ...change }));
});

test('all 166 raw pins, 176 source groups, and reversible fault are frozen', async () => {
  const plan = await readLeadCsvOfflinePlan();
  assert.equal(plan.source.length, 166);
  assert.equal(
    plan.source.reduce((count, item) => count + item.parts.length, 0),
    176,
  );
  assert.equal(
    plan.source.at(-1).sha256,
    'e1afd0956aaea74d2d22dd263e7a0baec77a91552877f1e9b0f434dbb6d7518d',
  );
  assert.equal(
    plan.fault,
    injectLeadCsvFault(plan.source.at(-1).sql, plan.objects.fault),
  );
  assert.equal(
    plan.fault.replace(plan.objects.fault.injection, ''),
    plan.source.at(-1).sql,
  );
  assertFrozenFixture(plan.fixture);
  const nonce = '0123456789abcdef0123456789abcdef';
  assert.equal(
    assertOwnedSchema(`csv_risk_${nonce}_fault`, nonce, 'fault'),
    `"csv_risk_${nonce}_fault"`,
  );
  assert.throws(() => assertOwnedSchema('public', nonce, 'fault'));
  assert.throws(() =>
    assertOwnedSchema(`csv_risk_${nonce}_fault`, nonce, 'upgrade'),
  );
});

test('helper import and spec do not hide cleanup, grants, or credential writes', async () => {
  const helper = await readFile(
    resolve('tests/support/lead-csv-import-migration-database.mjs'),
    'utf8',
  );
  const spec = await readFile(
    resolve('tests/e2e/lead-csv-import-migration.spec.ts'),
    'utf8',
  );
  assert.doesNotMatch(
    helper,
    /DROP SCHEMA|TRUNCATE|CREATE ROLE|CREATE USER|GRANT\s|REVOKE\s/iu,
  );
  assert.doesNotMatch(spec, /page\.|browser\.|request\.|webServer/iu);
});
