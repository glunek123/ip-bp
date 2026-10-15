import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const url =
  'postgresql://dev_cor_test:offline-only@127.0.0.1:15438/dev_cor_test';
const binding = {
  NODE_ENV: 'test',
  DATABASE_URL: url,
  DEV_COR_TEST_DATABASE_URL: url,
  DEV_COR_TEST_DATABASE_PROJECT: 'dev-cor-ui003-r2',
  DEV_COR_TEST_DATABASE_CONTAINER_ID:
    '45addc0179e929dd1dcd4f835b6c6c14c36c2ac4aed5e6cd5842648bf5db5236',
};
Object.assign(process.env, binding);
const support = await import('./ui003-r2-baseline.mjs');
const directory = resolve(root, 'backend/prisma/migrations');
const migrations = await Promise.all(
  (await readdir(directory))
    .filter((name) => /^\d{14}_/u.test(name))
    .sort()
    .map(async (name) => ({
      name,
      checksum: createHash('sha256')
        .update(await readFile(resolve(directory, name, 'migration.sql')))
        .digest('hex'),
    })),
);
const permissionLabels = new Set(
  [
    ...(await readFile(resolve(root, 'backend/prisma/schema.prisma'), 'utf8'))
      .match(/enum PermissionAction \{([\s\S]*?)\n\}/u)[1]
      .matchAll(/@map\("([^"]+)"\)/gu),
  ].map((match) => match[1]),
);

function harness() {
  const tables = new Map();
  const events = [];
  let snapshot;
  let inserts = 0;
  let failInsert = false;
  let failClose = false;
  const client = {
    async connect() {
      events.push('connect');
    },
    async end() {
      events.push('end');
      if (failClose) throw new Error('offline close');
    },
    async query(sql, parameters = []) {
      events.push(sql.split(' ')[0]);
      if (sql.startsWith('BEGIN')) {
        snapshot = globalThis.structuredClone(tables);
        return { rows: [] };
      }
      if (sql === 'ROLLBACK') {
        tables.clear();
        for (const [key, rows] of snapshot) tables.set(key, rows);
        return { rows: [] };
      }
      if (sql === 'COMMIT') return { rows: [] };
      if (sql.startsWith('SELECT current_database'))
        return {
          rows: [
            { db: 'dev_cor_test', schema: 'public', username: 'dev_cor_test' },
          ],
        };
      if (sql.includes('public._prisma_migrations'))
        return {
          rows: migrations.map((row) => ({
            migration_name: row.name,
            checksum: row.checksum,
            finished_at: new Date(),
            rolled_back_at: null,
          })),
        };
      const table = sql.match(/public\."([a-z_]+)"/u)?.[1];
      assert.ok(table, 'Only scoped known-table SQL is allowed');
      if (sql.startsWith('SELECT')) {
        assert.ok(sql.includes(' WHERE '));
        return { rows: globalThis.structuredClone(tables.get(table) ?? []) };
      }
      assert.ok(
        sql.startsWith('INSERT INTO '),
        'No update/delete/cleanup SQL is allowed',
      );
      if (failInsert) throw new Error('offline insert');
      const columns = [
        ...sql
          .slice(sql.indexOf('('), sql.indexOf(')'))
          .matchAll(/"([a-z_]+)"/gu),
      ].map((match) => match[1]);
      const row = Object.fromEntries(
        columns.map((column, i) => [column, parameters[i]]),
      );
      if (table === 'role_grants')
        assert.ok(
          permissionLabels.has(row.action),
          'Use PostgreSQL permission labels',
        );
      const rows = tables.get(table) ?? [];
      rows.push(row);
      tables.set(table, rows);
      inserts++;
      return { rows: [] };
    },
  };
  const dependencies = {
    capture() {
      events.push('capture');
      return { childEnvironment: { DATABASE_URL: url } };
    },
    validate() {
      events.push('validate');
      return { connectionString: url, port: 15438 };
    },
    migrations: async () => migrations,
    acquireLock() {
      events.push('lock');
      return {
        release() {
          events.push('release');
        },
      };
    },
    openClient() {
      events.push('client');
      return client;
    },
    passwordCodec: () => ({
      hashPassword: async () => 'offline-opaque-value',
      verifyPassword: async (_, encoded) => encoded === 'offline-opaque-value',
    }),
  };
  return {
    tables,
    events,
    client,
    dependencies,
    api: support.createUi003R2BaselineSupport(dependencies),
    get inserts() {
      return inserts;
    },
    failInsert() {
      failInsert = true;
    },
    failClose(value) {
      failClose = value;
    },
  };
}

test('import is offline and all old, partial or mismatched instance tuples fail before dependencies', async () => {
  for (const changes of [
    { DEV_COR_TEST_DATABASE_PROJECT: 'dev-cor-ui003' },
    { DEV_COR_TEST_DATABASE_PROJECT: 'dev-cor-other' },
    { DEV_COR_TEST_DATABASE_CONTAINER_ID: 'a'.repeat(64) },
    { DEV_COR_TEST_DATABASE_CONTAINER_ID: undefined },
    { NODE_ENV: 'development' },
    ...[15433, 15436, 15437, 3206, 5186].map((port) => ({
      DATABASE_URL: url.replace(':15438/', `:${port}/`),
      DEV_COR_TEST_DATABASE_URL: url.replace(':15438/', `:${port}/`),
    })),
    {
      DATABASE_URL: url.replace('127.0.0.1', '0.0.0.0'),
      DEV_COR_TEST_DATABASE_URL: url.replace('127.0.0.1', '0.0.0.0'),
    },
    { DEV_COR_TEST_DATABASE_URL: `${url}?host=example.com` },
  ]) {
    assert.throws(
      () => support.assertUi003R2Binding({ ...binding, ...changes }),
      /R2 requires/,
    );
    const env = { ...process.env, ...binding, ...changes };
    for (const [key, value] of Object.entries(env))
      if (value === undefined) delete env[key];
    const child = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `await import(${JSON.stringify(new URL('./ui003-r2-baseline.mjs', import.meta.url).href)})`,
      ],
      { env, encoding: 'utf8' },
    );
    assert.equal(child.status, 1, 'Wrong binding must refuse module import');
    assert.ok(
      !child.stderr.includes('offline-only'),
      'Error must not echo credential input',
    );
  }
  const h = harness();
  const old = process.env.DEV_COR_TEST_DATABASE_CONTAINER_ID;
  delete process.env.DEV_COR_TEST_DATABASE_CONTAINER_ID;
  try {
    await assert.rejects(h.api.prepare(), /R2 requires/);
    assert.equal(h.events.length, 0);
  } finally {
    process.env.DEV_COR_TEST_DATABASE_CONTAINER_ID = old;
  }
});

test('fresh append is atomic, contains no business stage facts, and repeated baseline is read-only', async () => {
  const h = harness();
  const first = await h.api.prepare();
  assert.equal(first.migrationCount, 155);
  assert.equal(first.created.role_grants, 66);
  assert.equal(first.created.customer_contacts, 3);
  assert.ok(first.ids.length > 0);
  assert.ok(
    ![...h.tables.keys()].some((name) =>
      /lead|notary|case|session/u.test(name),
    ),
  );
  assert.ok(h.events.indexOf('lock') < h.events.indexOf('connect'));
  assert.ok(h.events.lastIndexOf('SELECT') < h.events.indexOf('INSERT'));
  assert.deepEqual(h.events.slice(-3), ['COMMIT', 'end', 'release']);
  const count = h.inserts;
  const second = await h.api.prepare();
  assert.equal(Object.keys(second.created).length, 0);
  assert.equal(h.inserts, count);
  const before = h.events.length;
  await h.api.disconnect();
  assert.equal(
    h.events.length,
    before,
    'Disconnect must not issue cleanup or even query a closed client',
  );
});

test('existing changed or revoked security fails before any append', async () => {
  for (const mutate of [
    (h) => {
      h.tables.get('user_accounts')[0].active = false;
    },
    (h) => {
      h.tables.get('user_accounts')[0].authorization_revision = 2;
    },
    (h) => {
      h.tables.get('role_templates')[0].version = 2;
    },
    (h) => {
      h.tables.get('role_grants').pop();
    },
    (h) => {
      h.tables.get('role_assignments')[0].active = false;
    },
    (h) => {
      h.tables.get('local_credentials')[0].password_hash =
        'different-opaque-value';
    },
    (h) => {
      h.tables.get('customers')[0].name = 'changed';
    },
    (h) => {
      h.tables.get('customer_contacts')[0].ended_at = new Date();
    },
    (h) => {
      h.tables.get('role_grants').push({
        id: 'unapproved',
        role_template_id: support.ui003R2BaselineFixtures.roleA,
        action: 'UNAPPROVED',
        scope: 'DEPARTMENT',
      });
    },
  ]) {
    const h = harness();
    await h.api.prepare();
    mutate(h);
    const count = h.inserts;
    await assert.rejects(h.api.prepare(), /R2 baseline rejected/);
    assert.equal(h.inserts, count);
    assert.deepEqual(h.events.slice(-3), ['ROLLBACK', 'end', 'release']);
  }
});

test('migrations, effective URL and database identity must match before inserts', async () => {
  const h = harness();
  h.dependencies.migrations = async () => migrations.slice(1);
  await assert.rejects(h.api.prepare(), /155 migrations/);
  assert.ok(!h.events.includes('client'));
  h.dependencies.migrations = async () => migrations;
  h.dependencies.validate = () => ({
    connectionString: url.replace(':15438/', ':15437/'),
    port: 15437,
  });
  await assert.rejects(h.api.prepare(), /effective target/);
  assert.ok(!h.events.includes('client'));
  h.dependencies.validate = () => ({ connectionString: url, port: 15438 });
  const query = h.client.query;
  h.client.query = async (sql, args) =>
    sql.startsWith('SELECT current_database')
      ? { rows: [{ db: 'other', schema: 'public', username: 'dev_cor_test' }] }
      : query(sql, args);
  await assert.rejects(h.api.prepare(), /R2 baseline rejected/);
  assert.equal(h.inserts, 0);
});

test('migration checksum/completion drift and occupied lock fail closed without inserts', async () => {
  for (const change of [
    (rows) => {
      rows.pop();
    },
    (rows) => {
      rows[0].checksum = 'wrong';
    },
    (rows) => {
      rows[0].finished_at = null;
    },
    (rows) => {
      rows[0].rolled_back_at = new Date();
    },
    (rows) => {
      rows[1].migration_name = rows[0].migration_name;
    },
  ]) {
    const h = harness();
    const query = h.client.query;
    h.client.query = async (sql, args) => {
      const result = await query(sql, args);
      if (sql.includes('public._prisma_migrations')) change(result.rows);
      return result;
    };
    await assert.rejects(h.api.prepare(), /R2 baseline rejected/);
    assert.equal(h.inserts, 0);
    assert.deepEqual(h.events.slice(-3), ['ROLLBACK', 'end', 'release']);
  }
  const h = harness();
  h.dependencies.acquireLock = () => {
    throw new Error('offline busy lock');
  };
  await assert.rejects(h.api.prepare(), /busy lock/);
  assert.ok(!h.events.includes('client'));
});

test('connection failure closes its own socket and releases the existing lock', async () => {
  const h = harness();
  h.client.connect = async () => {
    throw new Error('offline connect');
  };
  await assert.rejects(h.api.prepare(), /R2 baseline rejected/);
  assert.equal(h.inserts, 0);
  assert.deepEqual(h.events.slice(-2), ['end', 'release']);
});

test('failed writes roll back and disconnect retries only its own failed close', async () => {
  const h = harness();
  h.failInsert();
  await assert.rejects(h.api.prepare(), /R2 baseline rejected/);
  assert.equal(h.tables.size, 0);
  assert.deepEqual(h.events.slice(-3), ['ROLLBACK', 'end', 'release']);
  const k = harness();
  k.failClose(true);
  await assert.rejects(k.api.prepare(), /connection close failed/);
  assert.equal(k.events.at(-1), 'release');
  k.failClose(false);
  const before = k.events.length;
  await k.api.disconnect();
  assert.deepEqual(k.events.slice(before), ['end']);
});
