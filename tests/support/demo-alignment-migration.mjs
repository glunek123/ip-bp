import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const suffix = [
  [
    '20261016110000_lead_batch_push',
    '1e267e104e4a7a1b20f1014dfd10506ce1aa831e32a11175e3a4dde2430c9e87',
  ],
  [
    '20261016115000_fee_proof_category_prepare',
    'a7b80c1143035aa0526fcb6a90857a737e505b692c2ea95efd7ff3f465e9f4d4',
  ],
  [
    '20261016120000_settlement_demo_alignment',
    'fbb81d7cb424beb9b1bad103a498c2bee66c1e7c15ef806d47631b5685a810e7',
  ],
  [
    '20261016130000_evidence_demo_alignment',
    'fd138a179438bac39a7bf30bc31373ac4ca2b9eef454ef8229c78ab0a1135de9',
  ],
];
const historical = {
  id: '9f547970-6eaa-4628-a670-f505590482e9',
  migration_name: '20261016100000_case_execution_filing_followups',
  checksum: 'e125a3278b0530860b1be49273fc667224451f8a6d35b420bdf14e2b9c684105',
  started_at: '2026-10-16 09:36:04.56343+00',
  finished_at: null,
  rolled_back_at: '2026-10-17 01:46:38.755138+00',
  applied_steps_count: 0,
  logs: null,
};
const quote = (value) => `"${value.replaceAll('"', '""')}"`;
const digest = (value) =>
  createHash('sha256')
    .update(
      typeof value === 'string' || Buffer.isBuffer(value)
        ? value
        : JSON.stringify(value),
    )
    .digest('hex');

// Import is inert: no environment capture, pg import, Client or connection.
export function admitDemoMigration(environment) {
  assert.notEqual(
    environment.DEV_COR_DEMO_OFFLINE_LIST,
    '1',
    'Offline discovery cannot execute the database callback',
  );
  assert.equal(environment.NODE_ENV, 'test');
  assert.equal(environment.DEV_COR_TEST_DATABASE_PROJECT, 'dev-cor-ui003-r2');
  assert.equal(
    environment.DEV_COR_TEST_DATABASE_CONTAINER_ID,
    '45addc0179e929dd1dcd4f835b6c6c14c36c2ac4aed5e6cd5842648bf5db5236',
  );
  const urls = [
    environment.DATABASE_URL,
    environment.DEV_COR_TEST_DATABASE_URL,
  ];
  for (const value of urls) {
    assert.ok(value, 'Both explicit database URLs are required');
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error('Malformed explicit test database URL');
    }
    assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.port, '15438');
    assert.equal(url.pathname, '/dev_cor_test');
    assert.equal(url.search, '');
    assert.equal(url.hash, '');
    assert.ok(
      url.username && url.password,
      'Explicit test credentials required',
    );
    assert.equal(value.includes('?') || value.includes('#'), false);
  }
  assert.ok(urls[0] === urls[1], 'Both database URLs must match exactly');
  const pnpmVersion = (environment.npm_config_user_agent ?? '').match(
    /\bpnpm\/([^\s]+)/u,
  )?.[1];
  assert.ok(
    pnpmVersion,
    'Use pnpm test:e2e and its existing exclusive resource lock',
  );
  assert.equal(pnpmVersion, '11.27.0');
  return { connectionString: urls[0], pnpmVersion };
}

// Preserve the predecessor's exact conservative source isolation rules locally;
// importing that module also imports test-environment/pg before admission.
function assertMigrationIsolation(sql) {
  assert.doesNotMatch(
    sql,
    /\bpublic\b|\bsearch_path\b|session_replication_role|\bdblink\b|\blo_import\b|\blo_export\b/iu,
  );
  assert.doesNotMatch(
    sql,
    /\b(?:CREATE|ALTER|DROP)\s+(?:DATABASE|ROLE|USER|TABLESPACE|EXTENSION|SCHEMA)\b/iu,
  );
  assert.doesNotMatch(sql, /\bCOPY\b|\bset_config\s*\(/iu);
  assert.doesNotMatch(
    sql,
    /\b(?:CREATE(?:\s+OR\s+REPLACE)?\s+(?:TABLE|TYPE|FUNCTION|VIEW|SEQUENCE)|ALTER\s+(?:TABLE|TYPE|FUNCTION|SEQUENCE)|DROP\s+(?:TABLE|TYPE|FUNCTION|VIEW|SEQUENCE)|INSERT\s+INTO|UPDATE|DELETE\s+FROM|REFERENCES|TRUNCATE(?:\s+TABLE)?)\s+"?[a-z_][\w]*"?\s*\./iu,
  );
}

export async function demoMigrationPlan(
  directory = resolve(process.cwd(), 'backend/prisma/migrations'),
) {
  const names = (await readdir(directory))
    .filter((name) => /^\d{14}_/u.test(name))
    .sort();
  assert.equal(names.length, 165, 'Exactly the approved165 source chain');
  assert.deepEqual(
    names.slice(161),
    suffix.map(([name]) => name),
  );
  const plan = [];
  for (const name of names) {
    const bytes = await readFile(resolve(directory, name, 'migration.sql'));
    const sql = bytes.toString('utf8');
    plan.push({ name, sha256: digest(bytes), sql });
  }
  assertDemoPlan(plan);
  return plan;
}

export function assertDemoPlan(plan) {
  assert.equal(plan.length, 165);
  assert.deepEqual(
    plan.slice(161).map((entry) => entry.name),
    suffix.map(([name]) => name),
  );
  for (const entry of plan) {
    assert.equal(
      digest(entry.sql),
      entry.sha256,
      'Raw UTF-8 bytes must survive transport unchanged',
    );
    assertMigrationIsolation(entry.sql);
  }
  assert.deepEqual(
    plan.slice(161).map((entry) => entry.sha256),
    suffix.map(([, hash]) => hash),
  );
}

export function assertDemoLedger(rows, plan) {
  assert.equal(
    rows.length,
    162,
    'public161 plus the single original resolved failure',
  );
  const successful = rows
    .filter((row) => row.finished_at !== null && row.rolled_back_at === null)
    .sort((a, b) => a.migration_name.localeCompare(b.migration_name));
  assert.equal(successful.length, 161);
  assert.deepEqual(
    successful.map((row) => [row.migration_name, row.checksum]),
    plan.slice(0, 161).map((entry) => [entry.name, entry.sha256]),
  );
  const others = rows.filter((row) => !successful.includes(row));
  assert.deepEqual(
    others,
    [historical],
    'Do not resolve, remove, alter or replace the historical failed row',
  );
}

export function ownedDemoSchema(nonce, kind) {
  assert.match(nonce, /^[a-f0-9]{32}$/u);
  assert.ok(['empty', 'upgrade'].includes(kind));
  return `d165_${nonce}_${kind}`;
}

export function assertOwnedDemoSchema(name, nonce, created, comment) {
  assert.ok(
    ['empty', 'upgrade'].some((kind) => ownedDemoSchema(nonce, kind) === name),
  );
  assert.ok(created.has(name), 'Never adopt an existing schema');
  assert.equal(comment, `d165-owned:${nonce}`);
}

export function injectDemoMigrationFailure(entry) {
  const index = suffix.findIndex(([name]) => name === entry.name);
  assert.notEqual(index, -1);
  const marker = `d165_failure_${162 + index}`;
  const failure = `DO $d165$ BEGIN RAISE EXCEPTION '${marker}' USING ERRCODE = 'P0001'; END $d165$;\n`;
  if (index === 1) {
    const body = entry.sql.replace(/--[^\n]*/gu, '').trim();
    assert.equal(
      body,
      `ALTER TYPE "material_category" ADD VALUE IF NOT EXISTS 'FEE_PROOF';`,
    );
    return { sql: `${entry.sql}\n${failure}`, marker };
  }
  assert.match(entry.sql, /^BEGIN;/u);
  assert.equal((entry.sql.match(/^COMMIT;\s*$/gmu) ?? []).length, 1);
  assert.match(entry.sql, /COMMIT;\s*$/u);
  return {
    sql: entry.sql.replace(/COMMIT;\s*$/u, `${failure}COMMIT;\n`),
    marker,
  };
}

export function assertDemoFault(error, marker) {
  assert.equal(error?.code, 'P0001');
  assert.equal(error?.message, marker);
}

export function assertDemoMirror(source, mirrored) {
  assert.equal(source.length, 152, 'Expected predecessor161 business tables');
  assert.deepEqual(
    mirrored,
    source,
    'Mirror differs: enum filtering may not silently omit rows or columns',
  );
}

const expectedDelta = {
  tables: 12,
  enumTypes: 5,
  functions: 16,
  userTriggers: 23,
  constraints: 73,
  indexes: 43,
  existingEnumLabels: 15,
};
export function assertDemoCatalogDelta(before, after) {
  const delta = Object.fromEntries(
    Object.keys(expectedDelta).map((key) => [key, after[key] - before[key]]),
  );
  assert.deepEqual(
    delta,
    expectedDelta,
    'Owned suffix exceeded or differs from the approved DDL budget',
  );
  return delta;
}

const expectedImports = [
  [
    '498096c8-982d-45d6-99e8-9c8806d2a86c',
    '9a658c0e-97bf-484f-b3d1-dfcb33722f17',
    '14e8f547-fe67-49b8-a6c4-263198629214',
    '6d67e817-9f9b-4e13-9e02-ab319e855528',
    'b1fb2f9a-e976-4b0b-9c2f-ba667ac8c5dc',
    'a0b38d1f-ce2f-44d0-b302-20f1059cd597',
    '095dfd70-425b-4dc9-b9ca-30fff80f6257',
    'a70ae1cc-8a20-41a6-b538-f54d77f825d3',
  ],
  [
    'bc36619d-a8d0-4942-b76b-23f364e3313f',
    '64f48c1f-d003-4f33-9130-de9bd0879c81',
    '2c64c319-0c20-4073-a4c4-0c07b2ffe05f',
    '72fb2bf2-c3be-4164-89c4-f1a4bde5f6f8',
    '0214c0df-d982-4441-a389-9491686bc5a6',
    'a5eb1774-7ad9-4272-a418-6eb1c90a51a7',
    '14ae2818-2116-4e0e-a501-fdff62c4fba4',
    '9305bd4f-fe11-47af-bd15-c8c3f4504cc0',
  ],
];
export function assertDemoImportedSources(rows) {
  assert.equal(rows.length, 2);
  const actual = [...rows]
    .sort((a, b) => a.matter.localeCompare(b.matter))
    .map((row) => {
      assert.equal(row.department, '10000000-0000-4000-8000-000000000001');
      assert.equal(row.itemCase, row.caseId);
      assert.equal(row.paperCase, row.caseId);
      assert.equal(row.sourceVersion, 6);
      assert.equal(row.issuanceVersion, 6);
      assert.equal(row.files.length, 1);
      assert.equal(row.originalAudits.length, 1);
      assert.equal(row.files[0].filename, row.filename);
      assert.equal(row.size, '46');
      assert.equal(
        row.sha256,
        'b8274cd2f933ba897ac5a626e96063aa6ed45d4389b105279661a55aedd2bc6f',
      );
      return [
        row.matter,
        row.caseId,
        row.certificate,
        row.actor,
        row.binding,
        row.originalAudits[0],
        row.files[0].materialId,
        row.files[0].contentVersionId,
      ];
    });
  assert.deepEqual(
    actual,
    expectedImports,
    'N2 counts alone do not prove exact original source/CV identity',
  );
}

async function origin(client) {
  assert.equal(
    (await client.query('SHOW session_replication_role')).rows[0]
      .session_replication_role,
    'origin',
  );
}

async function tableShape(client, schema) {
  const rows = (
    await client.query(
      `SELECT c.relname AS name,
    array(SELECT a.attname::text FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum) AS columns,
    array(SELECT a.attname::text FROM pg_constraint k CROSS JOIN LATERAL unnest(k.conkey) WITH ORDINALITY key(attnum,ord)
      JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=key.attnum WHERE k.conrelid=c.oid AND k.contype='p' ORDER BY key.ord) AS pk
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=$1 AND c.relkind IN ('r','p') ORDER BY c.relname`,
      [schema],
    )
  ).rows;
  for (const row of rows)
    assert.ok(row.pk.length > 0, `No stable primary key: ${row.name}`);
  return rows;
}

async function data(client, schema, shape) {
  const result = [];
  for (const table of shape) {
    const keys = table.pk.map((name) => `t.${quote(name)}`).join(',');
    const columns = table.columns.map(quote).join(',');
    // Hash inside PostgreSQL: credential payloads never leave the server.
    const row = (
      await client.query(`SELECT count(*)::text AS count,
      encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'), chr(10)
      ORDER BY jsonb_build_array(${keys})::text),''),'UTF8')),'hex') AS hash
      FROM (SELECT ${columns} FROM ${quote(schema)}.${quote(table.name)}) t`)
    ).rows[0];
    result.push({
      name: table.name,
      columns: table.columns,
      pk: table.pk,
      ...row,
    });
  }
  return result;
}

async function catalog(client, schema) {
  const queries = [
    `SELECT c.oid::text,c.relname,c.relkind,c.relowner::text,c.relacl::text,c.reloptions FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 ORDER BY c.relname`,
    `SELECT c.relname,a.attnum,a.attname,a.atttypid::regtype::text,a.attnotnull,pg_get_expr(d.adbin,d.adrelid) AS def FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`,
    `SELECT c.relname,k.conname,k.convalidated,k.condeferrable,k.condeferred,pg_get_constraintdef(k.oid) AS def FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 ORDER BY c.relname,k.conname`,
    `SELECT p.oid::text,p.proname,pg_get_function_identity_arguments(p.oid) AS args,p.proowner::text,p.proacl::text,p.proconfig,pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.prokind IN ('f','p') ORDER BY p.proname,args`,
    `SELECT c.relname,t.tgname,pg_get_triggerdef(t.oid) AS def FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 ORDER BY c.relname,t.tgname`,
    `SELECT indexname,indexdef FROM pg_indexes WHERE schemaname=$1 ORDER BY indexname`,
    `SELECT t.oid::text,t.typname,t.typtype,t.typowner::text,t.typacl::text,e.enumlabel,e.enumsortorder::text FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace LEFT JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname=$1 ORDER BY t.typname,e.enumsortorder`,
  ];
  const result = [];
  for (const sql of queries)
    result.push((await client.query(sql, [schema])).rows);
  return result;
}

async function snapshot(client, schema) {
  const shape = await tableShape(client, schema);
  const sequences = (
    await client.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind='S' ORDER BY c.relname`,
      [schema],
    )
  ).rows;
  const values = [];
  for (const row of sequences)
    values.push({
      name: row.relname,
      ...(
        await client.query(
          `SELECT last_value::text,is_called FROM ${quote(schema)}.${quote(row.relname)}`,
        )
      ).rows[0],
    });
  return {
    shape,
    data: await data(client, schema, shape),
    catalog: await catalog(client, schema),
    sequences: values,
  };
}

async function functions(client, schema) {
  return (
    await client.query(
      `SELECT p.oid::text,p.proname,pg_get_function_identity_arguments(p.oid) AS args,p.proowner::text,p.proacl::text,p.proconfig,pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.prokind IN ('f','p') ORDER BY p.proname,args`,
      [schema],
    )
  ).rows;
}

async function metrics(client, schema) {
  return (
    await client.query(
      `SELECT
    (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind IN ('r','p')) AS tables,
    (SELECT count(*)::int FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=$1 AND t.typtype='e') AS "enumTypes",
    (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.prokind IN ('f','p')) AS functions,
    (SELECT count(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND NOT t.tgisinternal) AS "userTriggers",
    (SELECT count(*)::int FROM pg_constraint k JOIN pg_namespace n ON n.oid=k.connamespace WHERE n.nspname=$1 AND k.contype IN ('p','u','f','c','x')) AS constraints,
    (SELECT count(*)::int FROM pg_indexes WHERE schemaname=$1) AS indexes,
    (SELECT count(*)::int FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=$1 AND t.typname IN ('material_category','permission_action')) AS "existingEnumLabels"`,
      [schema],
    )
  ).rows[0];
}

async function namespace(client, schema) {
  const dependencies = (
    await client.query(
      `SELECT obj.type,obj.schema AS source_schema,ref.type AS target_type,ref.schema AS target_schema,d.deptype
    FROM pg_depend d CROSS JOIN LATERAL pg_identify_object(d.classid,d.objid,d.objsubid) obj
    CROSS JOIN LATERAL pg_identify_object(d.refclassid,d.refobjid,d.refobjsubid) ref
    WHERE (obj.schema=$1 AND ref.schema IS NOT NULL AND ref.schema<>$1 AND ref.schema<>'pg_catalog')
       OR (ref.schema=$1 AND obj.schema IS NOT NULL AND obj.schema<>$1 AND NOT (obj.schema='pg_toast' AND d.deptype='i'))`,
      [schema],
    )
  ).rows;
  assert.deepEqual(
    dependencies,
    [],
    'Cross-namespace dependency blocks replay or cleanup',
  );
  const invalid = (
    await client.query(
      `SELECT k.conname FROM pg_constraint k JOIN pg_namespace n ON n.oid=k.connamespace WHERE n.nspname=$1 AND k.contype IN ('f','c') AND NOT k.convalidated`,
      [schema],
    )
  ).rows;
  assert.deepEqual(
    invalid,
    [],
    'All owned FK/check constraints must be validated',
  );
}

export async function cleanupDemoSchemas(
  client,
  names,
  verify,
  readPublic,
  report,
  result,
) {
  assert.equal(names.length, 2);
  assert.equal(new Set(names).size, 2);
  // No destructive query until the evidence consumer has accepted this phase.
  await report({
    ...globalThis.structuredClone(result),
    phase: 'before-cleanup',
  });
  let commitAttempted = false;
  try {
    await client.query('BEGIN');
    result.cleanup = { state: 'transaction-open', schemasRetained: null };
    for (const name of names) {
      await verify(name);
      await client.query(`DROP SCHEMA ${quote(name)} CASCADE`);
    }
    result.publicDigests.afterDropInTransaction = await readPublic();
    assert.equal(
      result.publicDigests.afterDropInTransaction,
      result.publicDigests.before,
    );
    result.publicUnchanged = true;
    result.cleanup = { state: 'ready-to-commit', schemasRetained: null };
    await report({
      ...globalThis.structuredClone(result),
      phase: 'cleanup-transaction-verified',
    });
    // A lost COMMIT acknowledgement cannot prove either commit or retention.
    commitAttempted = true;
    result.cleanup = { state: 'commit-uncertain', schemasRetained: null };
    result.cleanedSchemas = null;
    await client.query('COMMIT');
    result.cleanup = { state: 'committed', schemasRetained: false };
    result.cleanedSchemas = names.length;
  } catch (error) {
    if (commitAttempted) throw error;
    result.publicUnchanged = false;
    try {
      await client.query('ROLLBACK');
      result.cleanup = { state: 'rolled-back', schemasRetained: true };
      result.cleanedSchemas = 0;
    } catch (rollbackError) {
      result.cleanup = { state: 'rollback-uncertain', schemasRetained: null };
      result.cleanedSchemas = null;
      throw new AggregateError(
        [error, rollbackError],
        'Cleanup failed; rollback acknowledgement is uncertain',
      );
    }
    throw error;
  }
}

export async function endDemoConnection(client, result, primaryFailure) {
  try {
    await client.end();
    result.connectionEnd = 'confirmed';
  } catch (error) {
    result.connectionEnd = 'uncertain';
    return primaryFailure
      ? new AggregateError(
          [primaryFailure, error],
          'Risk failed and its own connection could not end',
        )
      : error;
  }
  return primaryFailure;
}

/** Sole protected runner, DB-only configuration; never a public Prisma deploy. */
export async function verifyDemoAlignmentMigration(report = () => {}) {
  const admitted = admitDemoMigration(process.env);
  const plan = await demoMigrationPlan();
  // Capture/driver/helper imports only after pure environment/source admission.
  const { captureTestEnvironment, validateBrowserTestDatabaseUrl } =
    await import('../../scripts/test-environment.mjs');
  const root = process.cwd();
  const captured = captureTestEnvironment(root, {
    pnpmVersion: admitted.pnpmVersion,
  });
  assert.equal(
    validateBrowserTestDatabaseUrl(admitted.connectionString, root)
      .connectionString,
    admitted.connectionString,
  );
  assert.equal(
    captured.childEnvironment.DATABASE_URL,
    admitted.connectionString,
  );
  const { copyOldTables, assertNoOrphanedOldForeignKeys } =
    await import('./case-execution-mailing-migration.mjs');
  const backend = createRequire(resolve(root, 'backend/package.json'));
  const { Client } = backend('pg');
  const client = new Client({ connectionString: admitted.connectionString });
  const nonce = randomUUID().replaceAll('-', '');
  const created = new Set();
  const result = {
    fingerprint: captured.fingerprint,
    source: plan.map(({ name, sha256 }) => ({ name, sha256 })),
    checks: [],
    faults: [],
    sends: 0,
    rollbacks: 0,
    retries: 0,
    createdSchemas: [],
    cleanedSchemas: 0,
    publicUnchanged: false,
    publicDigests: {},
    cleanup: { state: 'not-started', schemasRetained: true },
    connectionEnd: 'pending',
  };
  let primaryFailure;
  let cleanupStarted = false;
  let publicBefore;
  const owned = async (name) => {
    const rows = (
      await client.query(
        "SELECT obj_description(oid,'pg_namespace') AS comment FROM pg_namespace WHERE nspname=$1",
        [name],
      )
    ).rows;
    assert.equal(rows.length, 1);
    assertOwnedDemoSchema(name, nonce, created, rows[0].comment);
  };
  const select = async (name) => {
    await owned(name);
    await client.query(`SET search_path TO ${quote(name)},pg_catalog`);
    assert.equal(
      (await client.query('SELECT current_schema() AS schema')).rows[0].schema,
      name,
    );
    await origin(client);
  };
  const create = async (kind) => {
    const name = ownedDemoSchema(nonce, kind);
    await client.query(`CREATE SCHEMA ${quote(name)}`);
    created.add(name);
    result.createdSchemas.push(name);
    await client.query(
      `COMMENT ON SCHEMA ${quote(name)} IS 'd165-owned:${nonce}'`,
    );
    await select(name);
    return name;
  };
  const send = async (sql) => {
    await origin(client);
    result.sends += 1;
    await client.query(sql);
  };
  try {
    await client.connect();
    assert.deepEqual(
      (
        await client.query(
          'SELECT current_database() AS db,current_schema() AS schema',
        )
      ).rows[0],
      { db: 'dev_cor_test', schema: 'public' },
    );
    await origin(client);
    await client.query(
      "SET TIME ZONE 'UTC'; SET statement_timeout='120s'; SET lock_timeout='5s'",
    );
    const ledger = (
      await client.query(
        'SELECT id,migration_name,checksum,started_at::text,finished_at::text,rolled_back_at::text,applied_steps_count,logs FROM public._prisma_migrations ORDER BY migration_name,id',
      )
    ).rows;
    assertDemoLedger(ledger, plan);
    await client.query('SET search_path TO pg_catalog');
    publicBefore = await snapshot(client, 'public');
    result.publicDigests.before = digest(publicBefore);
    const empty = await create('empty');
    for (const entry of plan) await send(entry.sql);
    assert.equal((await tableShape(client, empty)).length, 164);
    await namespace(client, empty);
    await assertNoOrphanedOldForeignKeys(client, empty);
    result.checks.push('empty-original-whole-file-chain165');
    const upgrade = await create('upgrade');
    for (const entry of plan.slice(0, 161)) await send(entry.sql);
    const oldShape = await tableShape(client, upgrade);
    assert.equal(oldShape.length, 152);
    const publicShape = publicBefore.shape.filter(
      (table) => table.name !== '_prisma_migrations',
    );
    assert.deepEqual(
      oldShape,
      publicShape,
      'Predecessor column/PK mirror must be exact',
    );
    const oldSource = await data(client, 'public', publicShape);
    let copyError;
    try {
      await copyOldTables(client, upgrade);
    } catch (error) {
      copyError = error;
    }
    try {
      await origin(client);
    } catch (error) {
      if (copyError)
        throw new AggregateError(
          [copyError, error],
          'Mirror failed and origin restoration could not be confirmed',
        );
      throw error;
    }
    if (copyError) throw copyError;
    const oldData = await data(client, upgrade, oldShape);
    assertDemoMirror(oldSource, oldData);
    await assertNoOrphanedOldForeignKeys(client, upgrade);
    await namespace(client, upgrade);
    const oldFunctions = await functions(client, upgrade);
    const oldMetrics = await metrics(client, upgrade);
    const oldSequences = (await snapshot(client, upgrade)).sequences;
    result.checks.push('old161-same-id-pk-hash-fk-mirror-origin');
    for (const entry of plan.slice(161)) {
      await select(upgrade);
      const before = await snapshot(client, upgrade);
      const failure = injectDemoMigrationFailure(entry);
      let caught;
      try {
        await send(failure.sql);
      } catch (error) {
        caught = error;
      }
      result.rollbacks += 1;
      await client.query('ROLLBACK');
      await origin(client);
      assertDemoFault(caught, failure.marker);
      assert.deepEqual(
        await snapshot(client, upgrade),
        before,
        'Fault must roll back data, DDL, enum, functions and sequences',
      );
      assert.equal(
        (
          await client.query(
            "SELECT to_regclass('pg_temp.evidence_import_sources_1300')::text AS name",
          )
        ).rows[0].name,
        null,
      );
      result.retries += 1;
      await send(entry.sql);
      if (entry.name === suffix[1][0]) {
        assert.equal(
          (
            await client.query(
              `SELECT EXISTS(SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=$1 AND t.typname='material_category' AND e.enumlabel='FEE_PROOF') AS ready`,
              [upgrade],
            )
          ).rows[0].ready,
          true,
          '1150 must have committed before1200',
        );
      }
      assert.deepEqual(await data(client, upgrade, oldShape), oldData);
      assert.deepEqual(
        (await snapshot(client, upgrade)).sequences,
        oldSequences,
        'Old owned sequence states changed',
      );
      const currentFunctions = new Map(
        (await functions(client, upgrade)).map((row) => [row.oid, row]),
      );
      for (const row of oldFunctions)
        assert.deepEqual(
          currentFunctions.get(row.oid),
          row,
          'New suffix must not replace old functions/OID/ACL/config',
        );
      await namespace(client, upgrade);
      await assertNoOrphanedOldForeignKeys(client, upgrade);
      assert.equal(
        digest(await snapshot(client, 'public')),
        result.publicDigests.before,
      );
      result.faults.push({
        name: entry.name,
        code: caught.code,
        marker: failure.marker,
        rolledBack: true,
        rawRetrySha256: entry.sha256,
      });
    }
    assert.equal(result.sends, 334);
    assert.equal(result.rollbacks, 4);
    assert.equal(result.retries, 4);
    assert.equal((await tableShape(client, upgrade)).length, 164);
    result.catalogDelta = assertDemoCatalogDelta(
      oldMetrics,
      await metrics(client, upgrade),
    );
    const projection = (
      await client.query(`SELECT (SELECT count(*)::int FROM fee_records) AS fees,
      (SELECT count(*)::int FROM evidence_group_versions) AS groups,(SELECT count(*)::int FROM evidence_items) AS items,
      (SELECT count(*)::int FROM evidence_paper_certificates) AS papers,(SELECT count(*)::int FROM evidence_audit_events WHERE operation='IMPORT_NOTARY_SOURCE') AS audits,
      (SELECT count(*)::int FROM evidence_command_receipts) AS receipts`)
    ).rows[0];
    assert.deepEqual(projection, {
      fees: 0,
      groups: 2,
      items: 2,
      papers: 2,
      audits: 2,
      receipts: 0,
    });
    const imported = (
      await client.query(`SELECT g.source_id::text AS matter,g.case_id::text AS "caseId",g.department_id::text AS department,
      i.case_id::text AS "itemCase",p.case_id::text AS "paperCase",p.source_certificate_id::text AS certificate,
      a.actor_user_id::text AS actor,a.notary_office_account_binding_id::text AS binding,
      a.after_snapshot->'originalAuditEventIds' AS "originalAudits",a.after_snapshot->'electronicFiles' AS files,
      (a.after_snapshot->>'sourceVersion')::int AS "sourceVersion",(a.after_snapshot->>'issuanceVersion')::int AS "issuanceVersion",
      cv.original_filename AS filename,cv.size_bytes::text AS size,cv.sha256
      FROM evidence_group_versions g JOIN evidence_items i ON i.group_id=g.id AND i.department_id=g.department_id
      JOIN evidence_paper_certificates p ON p.group_id=g.id AND p.department_id=g.department_id
      JOIN evidence_audit_events a ON a.group_id=g.id AND a.item_id=i.id AND a.paper_certificate_id=p.id AND a.operation='IMPORT_NOTARY_SOURCE'
      JOIN content_versions cv ON cv.id=(a.after_snapshot->'electronicFiles'->0->>'contentVersionId')::uuid
        AND cv.material_id=(a.after_snapshot->'electronicFiles'->0->>'materialId')::uuid
      WHERE g.source_kind='NOTARY_MATTER' ORDER BY g.source_id`)
    ).rows;
    assertDemoImportedSources(imported);
    result.projection = projection;
    result.checks.push(
      'four-whole-file-fault-rollbacks-and-raw-retries',
      'old161-columns-functions-acl-sequences-preserved',
      'Q0-N2-exact-projection',
      'owned-fk-and-namespace',
    );
    await client.query('SET search_path TO pg_catalog');
    result.publicDigests.beforeCleanup = digest(
      await snapshot(client, 'public'),
    );
    assert.equal(
      result.publicDigests.beforeCleanup,
      result.publicDigests.before,
    );
    cleanupStarted = true;
    await cleanupDemoSchemas(
      client,
      [...created],
      async (name) => {
        await owned(name);
        await namespace(client, name);
      },
      async () => digest(await snapshot(client, 'public')),
      report,
      result,
    );
  } catch (error) {
    primaryFailure = error;
    // No cleanup or retry on failure. Preserve both owned and preexisting failures.
    result.failure = {
      phase: cleanupStarted
        ? `cleanup-${result.cleanup.state}`
        : (result.checks.at(-1) ?? 'admission-or-replay'),
      code: typeof error?.code === 'string' ? error.code : null,
    };
    if (!cleanupStarted)
      try {
        await report(result);
      } catch (reportError) {
        primaryFailure = new AggregateError(
          [error, reportError],
          'Risk failed and evidence attachment failed',
        );
      }
  } finally {
    primaryFailure = await endDemoConnection(client, result, primaryFailure);
  }
  if (primaryFailure) {
    // Carry the final acknowledged/uncertain state without a fallible report
    // after COMMIT, and never promise that a committed cleanup was rolled back.
    const failure = new Error(
      `Demo165 outcome: cleanup=${result.cleanup.state}; connectionEnd=${result.connectionEnd}; cleanedSchemas=${result.cleanedSchemas}`,
      { cause: primaryFailure },
    );
    failure.outcome = globalThis.structuredClone(result);
    throw failure;
  }
  return result;
}
