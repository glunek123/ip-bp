import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanupBatch2CaseConsolidationMigration } from './batch2-case-consolidation-migration.mjs';

const schema = `batch2_consolidation_${'a'.repeat(32)}`;

function clientWith({ failures = {}, remains = 0 } = {}) {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push([sql, values]);
      if (failures[sql]) throw failures[sql];
      return { rows: [{ count: remains }] };
    },
    async end() {
      calls.push(['end']);
      if (failures.end) throw failures.end;
    },
  };
  return { client, calls };
}

test('owned schema cleanup resets the path, drops the schema, and checks absence', async () => {
  const { client, calls } = clientWith();
  await cleanupBatch2CaseConsolidationMigration(client, schema, true, true);
  assert.deepEqual(calls, [
    ['ROLLBACK', undefined],
    ['RESET search_path', undefined],
    [`DROP SCHEMA "${schema}" CASCADE`, undefined],
    [
      'SELECT count(*)::int AS count FROM pg_namespace WHERE nspname=$1',
      [schema],
    ],
    ['end'],
  ]);
});

test('a failed drop and remaining schema cannot report success', async () => {
  const dropError = new Error('drop failed');
  const { client, calls } = clientWith({
    failures: { [`DROP SCHEMA "${schema}" CASCADE`]: dropError },
    remains: 1,
  });
  await assert.rejects(
    cleanupBatch2CaseConsolidationMigration(client, schema, true, true),
    (error) =>
      error instanceof AggregateError &&
      error.errors[0] === dropError &&
      error.errors[1].message === 'Owned consolidation schema remains',
  );
  assert.equal(calls.at(-1)[0], 'end');
});

test('a successful drop response still requires namespace absence', async () => {
  const { client } = clientWith({ remains: 1 });
  await assert.rejects(
    cleanupBatch2CaseConsolidationMigration(client, schema, true, true),
    (error) =>
      error instanceof AggregateError &&
      error.errors[0].message === 'Owned consolidation schema remains',
  );
});

test('cleanup failure retains the primary migration error', async () => {
  const primaryError = new Error('migration failed');
  const cleanupError = new Error('reset failed');
  const { client } = clientWith({
    failures: { 'RESET search_path': cleanupError },
  });
  await assert.rejects(
    cleanupBatch2CaseConsolidationMigration(
      client,
      schema,
      true,
      true,
      primaryError,
    ),
    (error) =>
      error instanceof AggregateError &&
      error.errors[0] === primaryError &&
      error.errors[1] === cleanupError,
  );
});

test('uncreated or invalid schemas are never dropped', async () => {
  const uncreated = clientWith();
  await cleanupBatch2CaseConsolidationMigration(
    uncreated.client,
    schema,
    true,
    false,
  );
  assert.deepEqual(uncreated.calls, [['ROLLBACK', undefined], ['end']]);

  const invalid = clientWith();
  await assert.rejects(
    cleanupBatch2CaseConsolidationMigration(
      invalid.client,
      'public',
      true,
      true,
    ),
    /Consolidation migration cleanup failed/u,
  );
  assert.deepEqual(invalid.calls, [['ROLLBACK', undefined], ['end']]);
});
