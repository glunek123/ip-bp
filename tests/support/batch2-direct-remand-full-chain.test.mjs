import assert from 'node:assert/strict';
import test from 'node:test';
import {
  apply191WithFault,
  beforeFinalCommit,
  cleanupOwned191Schema,
  verifyBatch2DirectRemandFullChain,
} from './batch2-direct-remand-full-chain.mjs';

const schema = `b2drfull_${'a'.repeat(32)}`;

test('191 fault callback runs inside the original transaction before COMMIT', async () => {
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(sql);
    },
  };
  const fault = Object.assign(new Error('injected division by zero'), {
    code: '22012',
  });
  const sql = 'BEGIN;\nSELECT 42;\nCOMMIT;\n';
  assert.equal(beforeFinalCommit(sql), 'BEGIN;\nSELECT 42;\n');
  await assert.rejects(
    apply191WithFault(client, sql, async () => {
      calls.push('callback');
      throw fault;
    }),
    (error) => error === fault,
  );
  assert.deepEqual(calls, ['BEGIN;\nSELECT 42;\n', 'callback']);
  assert.throws(() => beforeFinalCommit('SELECT 42;'), /boundaries changed/);
});

function clientWith({ failures = {}, remaining = 0 } = {}) {
  const calls = [];
  const client = {
    async query(sql, parameters) {
      calls.push([sql, parameters]);
      if (failures[sql]) throw failures[sql];
      return { rows: [{ count: remaining }] };
    },
    async end() {
      calls.push(['end']);
    },
  };
  return { client, calls };
}

test('191 cleanup removes only its exact owned schema and verifies disappearance', async () => {
  const { client, calls } = clientWith();
  await cleanupOwned191Schema(client, schema, true, true);
  assert.deepEqual(calls, [
    ['ROLLBACK', undefined],
    ['RESET search_path', undefined],
    [`DROP SCHEMA "${schema}" CASCADE`, undefined],
    [
      'SELECT count(*)::integer AS count FROM pg_namespace WHERE nspname=$1',
      [schema],
    ],
    ['end'],
  ]);
});

test('191 cleanup propagates original failure and missing cleanup proof', async () => {
  const primary = new Error('migration failed');
  const drop = new Error('drop failed');
  const { client } = clientWith({
    failures: { [`DROP SCHEMA "${schema}" CASCADE`]: drop },
    remaining: 1,
  });
  await assert.rejects(
    cleanupOwned191Schema(client, schema, true, true, primary),
    (error) =>
      error instanceof AggregateError &&
      error.errors[0] === primary &&
      error.errors[1] === drop &&
      error.errors[2].message === 'Owned 191 schema remains',
  );
});

test('full-chain probe refuses database work without the 191 authorization flag', async () => {
  const previous = process.env.BATCH2_191_ACCEPTANCE_READY;
  delete process.env.BATCH2_191_ACCEPTANCE_READY;
  try {
    await assert.rejects(
      verifyBatch2DirectRemandFullChain(),
      /has not been approved/,
    );
  } finally {
    if (previous === undefined) delete process.env.BATCH2_191_ACCEPTANCE_READY;
    else process.env.BATCH2_191_ACCEPTANCE_READY = previous;
  }
});
