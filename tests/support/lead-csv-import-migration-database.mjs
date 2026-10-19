import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout, clearTimeout } from 'node:timers';
import {
  captureTestEnvironment,
  validateBrowserTestDatabaseUrl,
  validateIsolatedTestDatabaseUrl,
} from '../../scripts/test-environment.mjs';
import {
  assertExecutionFilingFollowupHistoricalFailure,
  assertExecutionFilingFollowupResolveArtifacts,
} from './case-execution-filing-followup-database.mjs';

/* global __filename */
const root =
  typeof __filename === 'string'
    ? resolve(dirname(__filename), '../..')
    : resolve(process.cwd());
const frozen = resolve(
  root,
  '../minimal-page-actor-admission/.local/csv-owned-approval-freeze',
);
const migrationDirectory = resolve(root, 'backend/prisma/migrations');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const quote = (name) => `"${name.replaceAll('"', '""')}"`;
const manifestPins = Object.freeze({
  'migration-source-manifest.json':
    'b07a4be14225a3d223aa81df30ee1a218c2557b2b52afd7c13ba29b46339f60c',
  'source-replay-groups.json':
    '5a9c73eee2895182adc8014ca7dd58e3a6dfb5c5e0150aac48ab7f21de32f7b1',
  'owned-fixture-manifest.json':
    '248fca37ffafd093320a8d55170c005b288b1f696c2d836c50845eaefd386b5c',
  'csv-object-and-fault-manifest.json':
    '3c19eb127c9be740e3be9e75992458a74f67362d2db8f1ff492206c47630a6de',
  'owned-runner-plan-v1.md':
    '4fadbdf0820d8aff705dcda17368ece878a5ecf61167d4676048b0b6bc83e04f',
});
const csvName = '20261019090000_lead_csv_import_receipts';
const csvHash =
  'e1afd0956aaea74d2d22dd263e7a0baec77a91552877f1e9b0f434dbb6d7518d';
const cid = '45addc0179e929dd1dcd4f835b6c6c14c36c2ac4aed5e6cd5842648bf5db5236';

function safeError(code) {
  return Object.assign(new Error(code), { code });
}

function rejectUnless(condition, code) {
  if (!condition) throw safeError(code);
}

/** Pure: call this before filesystem capture, Docker discovery, or PG construction. */
export function assertLeadCsvR2Binding(env) {
  rejectUnless(
    env.NODE_ENV === 'test' &&
      env.DEV_COR_TEST_DATABASE_PROJECT === 'dev-cor-ui003-r2' &&
      env.DEV_COR_TEST_DATABASE_CONTAINER_ID === cid,
    'CSV_OWNED_R2_TUPLE_REJECTED',
  );
  rejectUnless(
    env.DATABASE_URL === env.DEV_COR_TEST_DATABASE_URL,
    'CSV_OWNED_URL_MISMATCH',
  );
  for (const value of [env.DATABASE_URL, env.DEV_COR_TEST_DATABASE_URL]) {
    rejectUnless(
      typeof value === 'string' && !value.includes('?') && !value.includes('#'),
      'CSV_OWNED_URL_REJECTED',
    );
    let target, url;
    try {
      target = validateIsolatedTestDatabaseUrl(value, {
        allowRandomPort: true,
      });
      url = new URL(value);
    } catch {
      throw safeError('CSV_OWNED_URL_REJECTED');
    }
    rejectUnless(
      target.hostname === '127.0.0.1' &&
        target.port === 15438 &&
        url.pathname === '/dev_cor_test' &&
        url.username === 'dev_cor_test' &&
        Boolean(url.password) &&
        target.connectionString === value,
      'CSV_OWNED_URL_REJECTED',
    );
  }
  rejectUnless(
    /\bpnpm\/11\.27\.0\b/u.test(env.npm_config_user_agent ?? ''),
    'CSV_OWNED_RUNTIME_REJECTED',
  );
  return env.DATABASE_URL;
}

/** Dependency injection is for offline rejection probes; the real call still uses official capture. */
export function captureLeadCsvTarget(env, budget, dependencies = {}) {
  const url = assertLeadCsvR2Binding(env);
  budget.remaining();
  let captured, target;
  try {
    captured = (dependencies.capture ?? captureTestEnvironment)(root, {
      pnpmVersion: '11.27.0',
    });
  } catch {
    throw safeError('CSV_OWNED_CAPTURE_REJECTED');
  }
  budget.remaining();
  try {
    target = (dependencies.validate ?? validateBrowserTestDatabaseUrl)(
      url,
      root,
    );
  } catch {
    throw safeError('CSV_OWNED_BROWSER_TARGET_REJECTED');
  }
  budget.remaining();
  assertLeadCsvR2Binding(captured?.childEnvironment ?? {});
  rejectUnless(
    target?.connectionString === url &&
      captured.childEnvironment.DATABASE_URL === url,
    'CSV_OWNED_CAPTURE_URL_MISMATCH',
  );
  return { url, captured };
}

export function createLeadCsvBudget({
  milliseconds = 360_000,
  now = () => performance.now(),
  parent,
} = {}) {
  const expiresAt = Math.min(
    now() + milliseconds,
    parent?.expiresAt ?? Infinity,
  );
  return Object.freeze({
    expiresAt,
    remaining() {
      const left = Math.floor(expiresAt - now());
      if (left <= 0) throw safeError('CSV_OWNED_DEADLINE_EXCEEDED');
      return left;
    },
    child(duration) {
      return createLeadCsvBudget({
        milliseconds: duration,
        now,
        parent: { expiresAt },
      });
    },
  });
}

// Only fixed phase names and SQLSTATE enter secondary evidence. Raw errors can contain URLs.
function keepFirst(primary, secondary, phase) {
  if (!primary) return secondary;
  const sqlState = [
    '22012',
    '57014',
    '25P02',
    '08006',
    '08003',
    '57P01',
  ].includes(secondary?.code)
    ? secondary.code
    : null;
  primary.csvOwnedSecondary ??= [];
  primary.csvOwnedSecondary.push({
    phase,
    code: 'CSV_OWNED_SECONDARY_FAILURE',
    sqlState,
  });
  for (const summary of secondary?.csvOwnedSecondary ?? []) {
    if (
      [
        'transaction-rollback',
        'connection-close',
        'public-snapshot',
        'fault-rollback',
        'fault-state-restore',
      ].includes(summary.phase)
    ) {
      primary.csvOwnedSecondary.push({
        phase: summary.phase,
        code: 'CSV_OWNED_SECONDARY_FAILURE',
        sqlState: [
          '22012',
          '57014',
          '25P02',
          '08006',
          '08003',
          '57P01',
        ].includes(summary.sqlState)
          ? summary.sqlState
          : null,
      });
    }
  }
  return primary;
}

export async function withLeadCsvSession(session, operation) {
  let failure, result;
  try {
    await session.connect();
    result = await operation(session);
  } catch (error) {
    failure = error;
  } finally {
    try {
      await session.end();
    } catch (error) {
      failure = keepFirst(failure, error, 'connection-close');
    }
  }
  if (failure) throw failure;
  return result;
}

export async function withLeadCsvTransaction(
  session,
  operation,
  readOnly = false,
) {
  await session.query(
    readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN',
  );
  try {
    const result = await operation(session);
    await session.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await session.query('ROLLBACK');
    } catch (rollbackError) {
      keepFirst(error, rollbackError, 'transaction-rollback');
    }
    throw error;
  }
}

export async function verifyLeadCsvFaultRollback(session, sql, verifyRestored) {
  let expected;
  try {
    await session.query(sql);
  } catch (error) {
    expected = error;
  }
  if (expected?.code !== '22012')
    throw expected ?? safeError('CSV_OWNED_EXPECTED_22012_MISSING');
  try {
    await session.query('ROLLBACK');
  } catch (error) {
    throw keepFirst(expected, error, 'fault-rollback');
  }
  try {
    await verifyRestored();
  } catch (error) {
    throw keepFirst(expected, error, 'fault-state-restore');
  }
}

export async function withLeadCsvPublicPreservation(
  session,
  operation,
  snapshot = () => catalog(session, 'public'),
) {
  let before, result, failure;
  try {
    before = await withLeadCsvTransaction(session, snapshot, true);
    result = await operation();
  } catch (error) {
    failure = error;
  } finally {
    if (before) {
      try {
        await withLeadCsvTransaction(
          session,
          async () => {
            const after = await snapshot();
            assert.deepEqual(after, before, 'Public structure or data changed');
          },
          true,
        );
      } catch (error) {
        failure = keepFirst(failure, error, 'public-snapshot');
      }
    }
  }
  if (failure) throw failure;
  return { before, result };
}

/** One socket per session. The deadline destroys that socket; it never opens a cancel connection. */
export function createLeadCsvSession(
  Client,
  connectionString,
  budget,
  timers = {},
) {
  const schedule = timers.schedule ?? setTimeout;
  const cancel = timers.cancel ?? clearTimeout;
  const remaining = budget.remaining();
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: Math.min(5_000, remaining),
    statement_timeout: remaining,
    lock_timeout: Math.min(5_000, remaining),
    // PG checks a closed socket during multi-statement raw migration execution.
    options: '-c client_connection_check_interval=10',
  });
  let stopped,
    queryFailed = false;
  const stop = (code) => {
    stopped ??= safeError(code);
    client.connection.stream.destroy();
  };
  const deadlineTimer = schedule(
    () => stop('CSV_OWNED_DEADLINE_EXCEEDED'),
    remaining,
  );
  // pg emits an idle connection error after a forced socket close.
  client.on('error', () => {});
  const check = () => {
    if (stopped) throw stopped;
    try {
      return budget.remaining();
    } catch (error) {
      stop('CSV_OWNED_DEADLINE_EXCEEDED');
      throw error;
    }
  };
  return {
    async connect() {
      const timeout = schedule(
        () => stop('CSV_OWNED_CONNECT_TIMEOUT'),
        Math.min(5_000, check()),
      );
      try {
        await client.connect();
        check();
      } catch (error) {
        throw stopped ?? error;
      } finally {
        cancel(timeout);
      }
    },
    async query(sql, values) {
      check();
      const rollback = sql === 'ROLLBACK';
      if (queryFailed && !rollback)
        throw safeError('CSV_OWNED_ROLLBACK_REQUIRED');
      try {
        if (!rollback) {
          const left = check();
          await client.query(
            "SELECT set_config('statement_timeout',$1,false),set_config('lock_timeout',$2,false)",
            [String(left), String(Math.min(5_000, left))],
          );
          check();
        }
        const result = await client.query(sql, values);
        check();
        queryFailed = false;
        return result;
      } catch (error) {
        queryFailed = true;
        throw stopped ?? error;
      }
    },
    async end() {
      try {
        await client.end();
      } catch (error) {
        // A failed graceful close must not leave this session alive after its timer is cleared.
        client.connection.stream.destroy();
        throw error;
      } finally {
        cancel(deadlineTimer);
      }
    },
  };
}

async function readBudgetFile(path, budget, encoding) {
  const signal = budget
    ? globalThis.AbortSignal.timeout(budget.remaining())
    : undefined;
  let bytes;
  try {
    bytes = await readFile(path, { encoding, signal });
  } catch (error) {
    if (signal?.aborted) throw safeError('CSV_OWNED_DEADLINE_EXCEEDED');
    throw error;
  }
  budget?.remaining();
  return bytes;
}

export function assertOwnedSchema(name, nonce, kind) {
  assert.match(nonce, /^[a-f0-9]{32}$/u);
  assert.ok(['empty', 'upgrade', 'fault'].includes(kind));
  assert.equal(name, `csv_risk_${nonce}_${kind}`);
  return quote(name);
}

export function assertFrozenFixture(fixture) {
  assert.deepEqual(fixture.scenarios, {
    empty: { rows: 0 },
    upgrade: { oldRows: 12, newPositiveRows: 5, retainedRows: 17 },
    fault: { rows: 0 },
  });
  assert.equal(Object.values(fixture.oldRows).flat().length, 12);
  assert.equal(Object.values(fixture.positive).flat().length, 5);
  assert.equal(fixture.oldRows.user_accounts[0].active, false);
  assert.equal(fixture.oldRows.department_memberships[0].active, false);
  assert.equal(
    fixture.oldRows.customers[0].admission_contact_snapshot_email,
    'csv-owned@example.invalid',
  );
  assert.equal(
    fixture.positive.lead_csv_import_receipts[0].result_snapshot.items[0].lead
      .evidenceDecision,
    null,
  );
  assert.ok(fixture.neverInsert.includes('local_credentials'));
  assert.ok(fixture.neverInsert.includes('role_grants'));
  assert.ok(fixture.neverInsert.includes('materials'));
  assert.ok(fixture.neverInsert.includes('lead_number_counters'));
  assert.deepEqual(fixture.insertOrder, [
    'departments',
    'user_accounts',
    'department_memberships',
    'customers',
    'rights_holders',
    'customer_rights_holder_links',
    'leads',
    'lead_products',
    'lead_infringements',
    'audit_events',
    'lead_csv_import_receipts',
  ]);
}

/** Reads bytes only. A changed frozen file or SQL stops before any capture/client. */
export async function readLeadCsvOfflinePlan(options = {}) {
  const freezeDir = options.frozen ?? frozen;
  const sqlDir = options.migrations ?? migrationDirectory;
  const documents = {};
  for (const [name, pin] of Object.entries(manifestPins)) {
    const bytes = await readBudgetFile(
      resolve(freezeDir, name),
      options.budget,
    );
    assert.equal(digest(bytes), pin, `Frozen document changed: ${name}`);
    if (name.endsWith('.json'))
      documents[name] = JSON.parse(bytes.toString('utf8'));
  }
  const manifest = documents['migration-source-manifest.json'];
  const groups = documents['source-replay-groups.json'];
  const fixture = documents['owned-fixture-manifest.json'];
  const objects = documents['csv-object-and-fault-manifest.json'];
  assertFrozenFixture(fixture);
  assert.equal(manifest.count, 166);
  assert.equal(manifest.files.length, 166);
  assert.equal(groups.groups.length, 166);
  assert.equal(manifest.files.at(-1).name, csvName);
  assert.equal(manifest.files.at(-1).sha256, csvHash);
  assert.equal(objects.original.sha256, csvHash);
  options.budget?.remaining();
  const actualNames = (await readdir(sqlDir))
    .filter((name) => /^\d{14}_/u.test(name))
    .sort();
  options.budget?.remaining();
  assert.deepEqual(
    actualNames,
    manifest.files.map((entry) => entry.name),
  );
  const source = [];
  let segments = 0;
  for (const [index, entry] of manifest.files.entries()) {
    const bytes = await readBudgetFile(
      resolve(sqlDir, entry.name, 'migration.sql'),
      options.budget,
    );
    assert.equal(
      bytes.length,
      entry.bytes,
      `SQL byte length changed: ${entry.name}`,
    );
    assert.equal(
      digest(bytes),
      entry.sha256,
      `SQL raw pin changed: ${entry.name}`,
    );
    const sql = bytes.toString('utf8');
    assert.deepEqual(Buffer.from(sql), bytes, `Non-UTF8 SQL: ${entry.name}`);
    const grouping = groups.groups[index];
    assert.equal(grouping.name, entry.name);
    assert.equal(grouping.sha256, entry.sha256);
    const parts = grouping.segments.map((part) => {
      const text = sql.slice(part.start, part.end);
      assert.equal(Buffer.byteLength(text), part.bytes);
      assert.equal(digest(text), part.sha256);
      return text;
    });
    assert.equal(
      parts.join(''),
      sql,
      `Replay groups do not reconstruct ${entry.name}`,
    );
    segments += parts.length;
    source.push({ name: entry.name, sha256: entry.sha256, sql, parts });
  }
  assert.equal(segments, 176);
  const fault = injectLeadCsvFault(source.at(-1).sql, objects.fault);
  assert.equal(digest(fault), objects.fault.sha256);
  return { source, fixture, objects, fault };
}

export function injectLeadCsvFault(sql, fault) {
  assert.equal(digest(sql), csvHash);
  assert.equal(fault.originalPrefixLengthChars, sql.lastIndexOf('COMMIT;'));
  assert.equal(sql.slice(fault.originalPrefixLengthChars), 'COMMIT;\n');
  const result =
    sql.slice(0, fault.originalPrefixLengthChars) +
    fault.injection +
    sql.slice(fault.originalPrefixLengthChars);
  assert.equal(result.replace(fault.injection, ''), sql);
  assert.equal(digest(result), fault.sha256);
  return result;
}

export function assertLeadCsvPublicLedger(identity, rows, source, receipt) {
  rejectUnless(
    identity.length === 1 &&
      identity[0].db === 'dev_cor_test' &&
      identity[0].schema === 'public' &&
      identity[0].username === 'dev_cor_test',
    'CSV_OWNED_DATABASE_IDENTITY_REJECTED',
  );
  assert.equal(source.length, 166);
  const historical = rows.filter(
    (row) => row.id === '9f547970-6eaa-4628-a670-f505590482e9',
  );
  assert.equal(historical.length, 1);
  assertExecutionFilingFollowupHistoricalFailure(
    historical[0],
    'RESOLVED',
    receipt,
  );
  const success = rows.filter((row) => row !== historical[0]);
  assert.equal(success.length, 165);
  for (const [index, row] of success.entries()) {
    assert.equal(row.migration_name, source[index].name);
    assert.equal(row.checksum, source[index].sha256);
    assert.ok(row.finished_at);
    assert.equal(row.rolled_back_at, null);
  }
}

async function readResolveReceipt(budget) {
  const dir = resolve(root, '.local/ef001-evidence/official-ef001-resolve');
  const receipt = JSON.parse(
    await readBudgetFile(resolve(dir, 'receipt.json'), budget, 'utf8'),
  );
  const [stdout, stderr] = await Promise.all([
    readBudgetFile(resolve(dir, 'stdout.log'), budget),
    readBudgetFile(resolve(dir, 'stderr.log'), budget),
  ]);
  assertExecutionFilingFollowupResolveArtifacts(receipt, stdout, stderr);
  return receipt;
}

async function catalog(client, schema) {
  const queries = [
    'SELECT n.nspname,n.nspowner::regrole::text AS owner,n.nspacl::text AS acl FROM pg_namespace n WHERE n.nspname=$1',
    'SELECT c.relname,c.relkind,c.relowner::regrole::text AS owner,c.relacl::text AS acl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 ORDER BY c.relname',
    'SELECT c.relname,a.attname,a.atttypid::regtype::text AS type,a.attnotnull,pg_get_expr(d.adbin,d.adrelid) AS default FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum',
    'SELECT c.relname,k.conname,k.contype,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 ORDER BY c.relname,k.conname',
    'SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS args,pg_get_functiondef(p.oid) AS definition,p.proowner::regrole::text AS owner,p.proacl::text AS acl,p.proconfig::text AS config FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 ORDER BY p.proname,args',
    'SELECT c.relname,t.tgname,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND NOT t.tgisinternal ORDER BY c.relname,t.tgname',
    'SELECT indexname,indexdef FROM pg_indexes WHERE schemaname=$1 ORDER BY indexname',
    'SELECT typname,typtype,typacl::text AS acl FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=$1 ORDER BY typname',
    'SELECT schemaname,sequencename,sequenceowner,data_type,start_value,min_value,max_value,increment_by,cycle,cache_size,last_value FROM pg_sequences WHERE schemaname=$1 ORDER BY sequencename',
    'SELECT d.defaclrole::regrole::text AS role,d.defaclnamespace::regnamespace::text AS namespace,d.defaclobjtype,d.defaclacl::text AS acl FROM pg_default_acl d WHERE d.defaclnamespace=0 OR d.defaclnamespace=(SELECT oid FROM pg_namespace WHERE nspname=$1) ORDER BY role,namespace,defaclobjtype',
  ];
  const structure = [];
  for (const sql of queries)
    structure.push((await client.query(sql, [schema])).rows);
  const tables = structure[1]
    .filter((row) => row.relkind === 'r' || row.relkind === 'p')
    .map((row) => row.relname);
  const data = [];
  for (const table of tables) {
    const rows = (
      await client.query(
        `SELECT to_jsonb(t)::text AS row FROM ${quote(schema)}.${quote(table)} t ORDER BY to_jsonb(t)::text`,
      )
    ).rows;
    data.push({
      table,
      count: rows.length,
      sha256: digest(JSON.stringify(rows)),
    });
  }
  return { structure, data };
}

function assertEmpty(snapshot, expectedTables) {
  assert.equal(
    snapshot.structure[1].filter(
      (row) => row.relkind === 'r' || row.relkind === 'p',
    ).length,
    expectedTables,
  );
  assert.ok(snapshot.data.every((row) => row.count === 0));
}

function assertCsvObjects(snapshot, objects) {
  const [relations, constraints, functions, triggers, indexes] = [
    snapshot.structure[1],
    snapshot.structure[3],
    snapshot.structure[4],
    snapshot.structure[5],
    snapshot.structure[6],
  ];
  assert.ok(
    relations.some((row) => row.relname === 'lead_csv_import_receipts'),
  );
  for (const name of objects.tableConstraints)
    assert.ok(constraints.some((row) => row.conname === name));
  assert.ok(
    constraints.some(
      (row) =>
        row.conname === 'lead_csv_import_receipt_integrity' &&
        row.contype === 't',
    ),
  );
  for (const name of objects.objects
    .filter((row) => row.kind === 'FUNCTION')
    .map((row) => row.name))
    assert.ok(functions.some((row) => row.proname === name));
  for (const name of [
    'reject_lead_csv_import_receipt_mutation',
    'lead_csv_import_receipt_integrity',
  ])
    assert.ok(triggers.some((row) => row.tgname === name));
  for (const name of objects.implicitIndexes)
    assert.ok(indexes.some((row) => row.indexname === name));
  assert.ok(
    constraints.some(
      (row) =>
        row.conname === 'leads_external_source_compatible_check' &&
        row.definition.includes("'CSV'"),
    ),
  );
}

async function selectOwned(client, schema) {
  await client.query(`SET search_path TO ${quote(schema)}, pg_catalog`);
  const found = (await client.query('SELECT current_schema() AS schema'))
    .rows[0];
  assert.equal(found.schema, schema);
}

async function replay(client, source) {
  for (const entry of source)
    for (const part of entry.parts) await client.query(part);
}

async function insertRows(client, schema, fixture, section) {
  for (const table of fixture.insertOrder) {
    for (const row of fixture[section][table] ?? []) {
      const keys = Object.keys(row);
      assert.ok(!fixture.neverInsert.includes(table));
      await client.query(
        `INSERT INTO ${quote(schema)}.${quote(table)} (${keys.map(quote).join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`,
        Object.values(row).map((value) =>
          value !== null && typeof value === 'object'
            ? JSON.stringify(value)
            : value,
        ),
      );
    }
  }
}

export async function runLeadCsvOwnedScenario(session, name, kind, plan) {
  let stage = 'before-connect';
  try {
    return await withLeadCsvSession(session, async (client) => {
      const defaultAcl = (
        await client.query(
          'SELECT defaclacl::text AS acl FROM pg_default_acl WHERE defaclrole=current_user::regrole AND defaclnamespace=0',
        )
      ).rows;
      assert.equal(
        defaultAcl.length,
        0,
        'Global default ACL requires separate review',
      );
      const exists = (
        await client.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [
          name,
        ])
      ).rows;
      assert.equal(exists.length, 0, 'Never adopt an existing schema');
      await client.query(`CREATE SCHEMA ${quote(name)}`);
      stage = 'schema-created';
      const schemaAcl = (
        await client.query(
          'SELECT nspacl::text AS acl FROM pg_namespace WHERE nspname=$1',
          [name],
        )
      ).rows;
      assert.deepEqual(
        schemaAcl,
        [{ acl: null }],
        'Unexpected owned-schema privileges',
      );
      await selectOwned(client, name);
      await replay(client, plan.source.slice(0, 165));
      stage = 'predecessor-replayed';
      const predecessor = await catalog(client, name);
      assertEmpty(predecessor, 164);
      if (kind === 'upgrade') {
        await withLeadCsvTransaction(client, async () => {
          await insertRows(client, name, plan.fixture, 'oldRows');
        });
        const oldData = (await catalog(client, name)).data;
        assert.equal(
          oldData.reduce((n, row) => n + row.count, 0),
          12,
        );
        stage = 'old-fixture-committed';
        await client.query(plan.source.at(-1).sql);
        stage = 'csv-committed';
        const afterMigration = await catalog(client, name);
        assertCsvObjects(afterMigration, plan.objects);
        for (const old of oldData)
          assert.deepEqual(
            afterMigration.data.find((row) => row.table === old.table),
            old,
          );
        await withLeadCsvTransaction(client, async () => {
          await insertRows(client, name, plan.fixture, 'positive');
        });
        const final = await catalog(client, name);
        assert.equal(
          final.data.reduce((n, row) => n + row.count, 0),
          17,
        );
        for (const table of plan.fixture.neverInsert)
          assert.equal(
            final.data.find((row) => row.table === table)?.count ?? 0,
            0,
          );
        return {
          name,
          stage: 'passed-retained',
          rows: 17,
          digest: digest(JSON.stringify(final)),
        };
      }
      if (kind === 'fault') {
        await verifyLeadCsvFaultRollback(client, plan.fault, async () => {
          const rolledBack = await catalog(client, name);
          assert.deepEqual(
            rolledBack,
            predecessor,
            'Expected exact catalog and row rollback',
          );
        });
        stage = 'exact-rollback-verified';
      }
      await client.query(plan.source.at(-1).sql);
      stage = 'csv-committed';
      const final = await catalog(client, name);
      assertEmpty(final, 165);
      assertCsvObjects(final, plan.objects);
      return {
        name,
        stage: 'passed-retained',
        rows: 0,
        digest: digest(JSON.stringify(final)),
      };
    });
  } catch (error) {
    error.csvOwnedStage = stage;
    error.csvOwnedSchema = name;
    throw error;
  }
}

/** Invoked only by the later approved protected Playwright entry. Never call offline. */
export async function verifyLeadCsvOwnedMigration() {
  const budget = createLeadCsvBudget();
  assertLeadCsvR2Binding(process.env);
  const plan = await readLeadCsvOfflinePlan({ budget });
  const receipt = await readResolveReceipt(budget);
  const { url } = captureLeadCsvTarget(process.env, budget);
  const { Client } = createRequire(resolve(root, 'backend/package.json'))('pg');
  const guard = createLeadCsvSession(Client, url, budget);
  const nonce = randomUUID().replaceAll('-', '');
  const names = ['empty', 'upgrade', 'fault'].map(
    (kind) => `csv_risk_${nonce}_${kind}`,
  );
  names.forEach((name, i) =>
    assertOwnedSchema(name, nonce, ['empty', 'upgrade', 'fault'][i]),
  );
  return withLeadCsvSession(guard, async () => {
    const identity = (
      await guard.query(
        'SELECT current_database() AS db,current_schema() AS schema,current_user AS username',
      )
    ).rows;
    const ledger = (
      await guard.query(
        'SELECT id,migration_name,checksum,started_at::text,finished_at::text,rolled_back_at::text,applied_steps_count,(logs IS NULL) AS logs_is_null FROM public._prisma_migrations ORDER BY migration_name,started_at',
      )
    ).rows;
    assertLeadCsvPublicLedger(identity, ledger, plan.source, receipt);
    await guard.query('SET search_path TO pg_catalog');
    const { before, result: results } = await withLeadCsvPublicPreservation(
      guard,
      async () => {
        const scenarios = [];
        for (const [index, kind] of ['empty', 'upgrade', 'fault'].entries()) {
          const session = createLeadCsvSession(
            Client,
            url,
            budget.child(120_000),
          );
          scenarios.push(
            await runLeadCsvOwnedScenario(session, names[index], kind, plan),
          );
        }
        return scenarios;
      },
    );
    return {
      schemas: results,
      publicDigest: digest(JSON.stringify(before)),
      sourceCount: 166,
      groupCount: 176,
      retainedRows: 17,
    };
  });
}
