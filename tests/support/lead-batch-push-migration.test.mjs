import assert from 'node:assert/strict';
import test from 'node:test';
import {
  admitLeadBatchPushMigration,
  assertLeadBatchMigrationFailure,
  assertMigrationIsolation,
  assertOwnedLeadBatchSchema,
  assertPreservedPredecessor,
  assertPublicPredecessorLedger,
  injectLeadBatchMigrationFailure,
  leadBatchPushMigrationPlan,
  ownedLeadBatchSchema,
  splitLeadBatchMigrationPrelude,
  snapshotDigest,
} from './lead-batch-push-migration.mjs';

const binding = () => ({
  NODE_ENV: 'test',
  DEV_COR_TEST_DATABASE_PROJECT: 'dev-cor-ui003-r2',
  DEV_COR_TEST_DATABASE_CONTAINER_ID:
    '45addc0179e929dd1dcd4f835b6c6c14c36c2ac4aed5e6cd5842648bf5db5236',
  DATABASE_URL: 'postgresql://dev_cor_test:opaque@127.0.0.1:15438/dev_cor_test',
  DEV_COR_TEST_DATABASE_URL:
    'postgresql://dev_cor_test:opaque@127.0.0.1:15438/dev_cor_test',
  npm_config_user_agent: 'pnpm/11.27.0 node/v24.21.0 win32 x64',
});
const clone = (value) => JSON.parse(JSON.stringify(value));

test('admits only exact normal protected R2 tuple and pnpm runner', () => {
  assert.equal(admitLeadBatchPushMigration(binding()).pnpmVersion, '11.27.0');
  for (const patch of [
    { DEV_COR_TEST_DATABASE_PROJECT: 'other' },
    { DEV_COR_TEST_DATABASE_CONTAINER_ID: 'wrong' },
    { DATABASE_URL: 'postgresql://x:y@localhost:15438/dev_cor_test' },
    { npm_config_user_agent: 'npm/11.0.0' },
    { NODE_ENV: 'development' },
    {
      DATABASE_URL:
        'postgresql://dev_cor_test:opaque@127.0.0.1:15438/dev_cor_test?',
    },
    {
      DEV_COR_TEST_DATABASE_URL:
        'postgresql://dev_cor_test:opaque@127.0.0.1:15438/dev_cor_test#',
    },
  ])
    assert.throws(() =>
      admitLeadBatchPushMigration({ ...binding(), ...patch }),
    );
});

test('161 source plan pins every migration and the raw 156 through 161 suffix', async () => {
  const plan = await leadBatchPushMigrationPlan();
  assert.equal(plan.length, 161);
  assert.deepEqual(
    plan.slice(-6).map(({ name }) => name),
    [
      '20261015150000_case_section_record_edits',
      '20261015170000_case_section_record_uploads',
      '20261016090000_case_record_material_guard_repair',
      '20261016093000_case_record_material_reference_reuse',
      '20261016100000_case_execution_filing_followups',
      '20261016110000_lead_batch_push',
    ],
  );
  assert.equal(plan.at(-1).sql.startsWith('BEGIN;'), true);
  assert.doesNotMatch(
    plan.at(-1).sql.slice(0, plan.at(-1).sql.indexOf('BEGIN;')),
    /\bALTER\s+TYPE\b/iu,
  );
  for (const entry of [plan[155], plan[159]]) {
    const [prefix, transaction] = splitLeadBatchMigrationPrelude(entry);
    assert.equal(prefix + transaction, entry.sql);
    assert.match(prefix, /ALTER TYPE[\s\S]+ADD VALUE/iu);
    assert.match(transaction, /^\nBEGIN;/u);
  }
  assert.equal(
    (splitLeadBatchMigrationPrelude(plan[159])[0].match(/ALTER TYPE/giu) ?? [])
      .length,
    5,
  );
  assert.deepEqual(splitLeadBatchMigrationPrelude(plan[160]), [plan[160].sql]);
});

test('public predecessor ledger is exactly the 160 source prefix', async () => {
  const plan = await leadBatchPushMigrationPlan();
  const rows = plan.slice(0, 160).map(({ name, sha256 }) => ({
    migration_name: name,
    checksum: sha256,
    finished_at: new Date(0),
    rolled_back_at: null,
  }));
  assert.doesNotThrow(() => assertPublicPredecessorLedger(rows, plan));
  assert.throws(() => assertPublicPredecessorLedger(rows.slice(1), plan));
  const drift = rows.map((row) => ({ ...row }));
  drift[159].checksum = 'f'.repeat(64);
  assert.throws(() => assertPublicPredecessorLedger(drift, plan));
  assert.throws(() =>
    assertPublicPredecessorLedger(
      [
        ...rows,
        { ...rows[0], migration_name: '20261016110000_lead_batch_push' },
      ],
      plan,
    ),
  );
});

test('isolation screen rejects public/schema changes and qualified references', () => {
  for (const sql of [
    'INSERT INTO public.leads VALUES (1)',
    'REFERENCES other.departments(id)',
    'SET search_path TO public',
    'CREATE SCHEMA extra',
    'CREATE EXTENSION example',
    "SELECT set_config('search_path','public',true)",
  ])
    assert.throws(() => assertMigrationIsolation(sql));
  assertMigrationIsolation(
    'CREATE TABLE "local_table" (id uuid REFERENCES "departments"(id));',
  );
});

test('owned schema requires this run nonce, local creation receipt and intact comment', () => {
  const nonce = 'c'.repeat(32);
  const name = ownedLeadBatchSchema(nonce, 'upgrade');
  assertOwnedLeadBatchSchema(name, nonce, new Set([name]), 'owned', 'owned');
  for (const args of [
    ['public', nonce, new Set(['public']), 'owned', 'owned'],
    [name, nonce, new Set(), 'owned', 'owned'],
    [name, 'd'.repeat(32), new Set([name]), 'owned', 'owned'],
    [name, nonce, new Set([name]), 'foreign', 'owned'],
  ])
    assert.throws(() => assertOwnedLeadBatchSchema(...args));
  assert.throws(() => ownedLeadBatchSchema('bad";drop', 'empty'));
  assert.throws(() => ownedLeadBatchSchema(nonce, 'public'));
});

test('failure injection changes only a copy before final COMMIT and requires exact marker', async () => {
  const sql = (await leadBatchPushMigrationPlan()).at(-1).sql;
  const injected = injectLeadBatchMigrationFailure(sql);
  assert.notEqual(injected, sql);
  assert.ok(injected.includes("'owned_lead_batch_push_migration_failure'"));
  assert.equal(sql, (await leadBatchPushMigrationPlan()).at(-1).sql);
  assert.doesNotThrow(() =>
    assertLeadBatchMigrationFailure({
      code: 'P0001',
      message: 'owned_lead_batch_push_migration_failure',
    }),
  );
  for (const error of [
    undefined,
    { code: '23514', message: 'owned_lead_batch_push_migration_failure' },
    { code: 'P0001', message: 'unrelated' },
  ])
    assert.throws(() => assertLeadBatchMigrationFailure(error));
});

test('predecessor comparison permits only new batch table, indexes, constraints, triggers and functions', () => {
  const before = {
    relations: [{ name: 'departments', acl: null }],
    columns: [{ table: 'departments', name: 'id' }],
    constraints: [{ table: 'departments', name: 'departments_pkey' }],
    functions: [{ name: 'old_guard', args: '' }],
    triggers: [{ table: 'departments', name: 'old_trigger' }],
    indexes: [{ name: 'departments_pkey' }],
    types: [{ name: 'department_kind' }],
    enums: [{ name: 'department_kind', label: 'ACTIVE', sort_order: 1 }],
    sequences: [{ name: 'old_seq', last_value: '7', is_called: true }],
    schema: { oid: '42', owner: 'owner', acl: null },
    acls: [{ kind: 'schema', object: 'owned', acl: null }],
    data: [{ table: 'departments', count: 1, sha256: 'a'.repeat(64) }],
  };
  const after = {
    ...before,
    relations: [
      ...before.relations,
      { name: 'lead_batch_push_receipts', acl: null },
      { name: 'lead_batch_push_receipts_pkey', relkind: 'i', acl: null },
    ],
    columns: [
      ...before.columns,
      { table: 'lead_batch_push_receipts', name: 'id' },
    ],
    constraints: [
      ...before.constraints,
      {
        table: 'lead_batch_push_receipts',
        name: 'lead_batch_push_receipts_pkey',
      },
    ],
    functions: [
      ...before.functions,
      { name: 'reject_lead_batch_push_receipt_mutation', args: '' },
      { name: 'validate_lead_batch_push_receipt', args: '' },
    ],
    triggers: [
      ...before.triggers,
      { table: 'lead_batch_push_receipts', name: 'guard' },
    ],
    indexes: [...before.indexes, { name: 'lead_batch_push_receipts_pkey' }],
    types: [
      ...before.types,
      { name: 'lead_batch_push_receipts' },
      { name: '_lead_batch_push_receipts' },
    ],
    acls: [
      ...before.acls,
      { kind: 'relation', object: 'lead_batch_push_receipts', acl: null },
      { kind: 'relation', object: 'lead_batch_push_receipts_pkey', acl: null },
    ],
    data: [
      ...before.data,
      { table: 'lead_batch_push_receipts', count: 0, sha256: 'b'.repeat(64) },
    ],
  };
  assert.doesNotThrow(() => assertPreservedPredecessor(before, after));
  assert.equal(snapshotDigest(before).length, 64);
  for (const [collection, patch] of [
    ['enums', { sort_order: 2 }],
    ['sequences', { last_value: '8' }],
    ['schema', { owner: 'other' }],
  ]) {
    const drift = clone(after);
    if (collection === 'schema') drift.schema = { ...drift.schema, ...patch };
    else drift[collection][0] = { ...drift[collection][0], ...patch };
    assert.throws(() => assertPreservedPredecessor(before, drift));
  }
  for (const [collection, patch] of [
    ['relations', { owner: 'other' }],
    ['functions', { oid: '900', config: ['search_path=public'] }],
    ['types', { owner: 'other' }],
  ]) {
    const drift = clone(after);
    drift[collection][0] = { ...drift[collection][0], ...patch };
    assert.throws(() => assertPreservedPredecessor(before, drift));
  }
  const changed = clone(after);
  changed.data[0].sha256 = 'f'.repeat(64);
  assert.throws(() => assertPreservedPredecessor(before, changed));
});
