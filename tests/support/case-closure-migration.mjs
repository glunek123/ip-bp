import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';
import {
  assertNoOrphanedOldForeignKeys,
  copyOldTables,
} from './case-execution-mailing-migration.mjs';
import { executionSourceSnapshot } from './case-execution-finish-migration.mjs';

const root = process.cwd();
const migrationDirectory = resolve(root, 'backend/prisma/migrations');
const allNames = readdirSync(migrationDirectory)
  .filter((name) => /^\d{14}_/u.test(name))
  .sort();
const newNames = [
  '20261013190000_add_case_closure_enums',
  '20261013190100_guard_case_closure',
];
// Retain the exact CA016 boundary; later slices validate their own full chain.
const closureBoundary = allNames.indexOf(newNames[1]);
if (closureBoundary < 0) throw new Error('Missing case closure boundary');
const names = allNames.slice(0, closureBoundary + 1);
const quote = (name) => `"${name.replaceAll('"', '""')}"`;
const sql = (name) =>
  readFileSync(resolve(migrationDirectory, name, 'migration.sql'), 'utf8');
const closureGrantActions = new Set([
  'case.closure.record',
  'case.closure.correct',
  'case.archive',
  'case.archive.correct',
]);

function oldCompatibleSource(snapshot) {
  return {
    ...snapshot,
    // A 142 permission_action enum cannot hold CA016 or CA017 actions. Keep
    // every older grant and compare the full copied 142 grant set thereafter.
    grants: snapshot.grants.filter(
      ({ row }) => !closureGrantActions.has(row.action),
    ),
  };
}

function changedSourceFields(left, right) {
  const changed = [];
  for (const key of Object.keys(left)) {
    if (key === 'oldExecution') {
      for (const child of Object.keys(left.oldExecution)) {
        if (
          JSON.stringify(left.oldExecution[child]) !==
          JSON.stringify(right.oldExecution[child])
        )
          changed.push(`oldExecution.${child}`);
      }
    } else if (JSON.stringify(left[key]) !== JSON.stringify(right[key])) {
      const count = (value) =>
        Array.isArray(value) ? value.length : value === null ? 0 : 1;
      changed.push(`${key}(${count(left[key])}/${count(right[key])})`);
    }
  }
  return changed.join(', ');
}

async function sourceSnapshot(client, caseId) {
  const oldExecution = await executionSourceSnapshot(client, caseId);
  const result = { oldExecution };
  result.case = (
    await client.query('SELECT to_jsonb(c) AS row FROM cases c WHERE id=$1', [
      caseId,
    ])
  ).rows;
  for (const table of [
    'case_execution_finishes',
    'case_execution_finish_versions',
    'case_execution_finish_receipts',
  ]) {
    result[table] = (
      await client.query(
        `SELECT to_jsonb(t) AS row FROM ${quote(table)} t WHERE case_id=$1 ORDER BY to_jsonb(t)::text`,
        [caseId],
      )
    ).rows;
  }
  result.materials = (
    await client.query(
      `SELECT to_jsonb(m) AS row FROM materials m WHERE m.owner_type='CASE' AND m.owner_id=$1 ORDER BY m.id`,
      [caseId],
    )
  ).rows;
  result.content = (
    await client.query(
      `SELECT to_jsonb(v) AS row FROM content_versions v JOIN materials m ON m.id=v.material_id
       WHERE m.owner_type='CASE' AND m.owner_id=$1 ORDER BY v.id`,
      [caseId],
    )
  ).rows;
  result.references = (
    await client.query(
      `SELECT to_jsonb(r) AS row FROM material_references r WHERE r.resource_type='case' AND r.resource_id=$1 ORDER BY r.id`,
      [caseId],
    )
  ).rows;
  result.audits = (
    await client.query(
      `SELECT to_jsonb(a) AS row FROM audit_events a WHERE a.resource_type='CASE' AND a.resource_id=$1 ORDER BY a.id`,
      [caseId],
    )
  ).rows;
  result.grants = (
    await client.query(
      'SELECT to_jsonb(g) AS row FROM role_grants g ORDER BY g.id',
    )
  ).rows;
  return result;
}

async function blobSnapshot(contents) {
  const rootPath = resolve(process.env.PRIVATE_FILE_ROOT ?? '');
  if (rootPath !== resolve(root, '.local/private-files/test'))
    throw new Error(
      'Closure migration requires the isolated private file root',
    );
  const requireBackend = createRequire(resolve(root, 'backend/package.json'));
  const { LocalPrivateBlobStorage } = requireBackend(
    './dist/modules/materials/local-private-blob-storage.js',
  );
  const storage = new LocalPrivateBlobStorage(rootPath);
  const result = [];
  for (const { row } of contents) {
    const chunks = [];
    for await (const chunk of await storage.open(row.storage_key))
      chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    if (
      createHash('sha256').update(bytes).digest('hex') !== row.sha256 ||
      bytes.length !== Number(row.size_bytes)
    )
      throw new Error('Old source blob metadata and bytes differ');
    result.push({ id: row.id, bytes: bytes.toString('base64') });
  }
  return result;
}

async function replay(client, names) {
  for (const name of names) {
    try {
      await client.query(sql(name));
    } catch (error) {
      throw new Error(`Closure migration replay failed at ${name}`, {
        cause: error,
      });
    }
  }
}

export async function verifyCaseClosureMigration(caseId) {
  if (process.env.NODE_ENV !== 'test')
    throw new Error('Closure migration requires isolated tests');
  validateIsolatedTestDatabaseUrl(process.env.DATABASE_URL, {
    allowRandomPort: true,
  });
  if (new URL(process.env.DATABASE_URL).port !== '15433')
    throw new Error('Closure migration requires the fixed 15433 test database');
  if (
    resolve(process.env.PRIVATE_FILE_ROOT ?? '') !==
    resolve(root, '.local/private-files/test')
  )
    throw new Error(
      'Closure migration requires the isolated private file root',
    );
  if (
    names.length !== 144 ||
    names[142] !== newNames[0] ||
    names[143] !== newNames[1]
  )
    throw new Error('Expected exact 142 + 2 closure migration chain');
  const requireBackend = createRequire(resolve(root, 'backend/package.json'));
  const { Client } = requireBackend('pg');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  const schemas = [
    `ca016_empty_${randomUUID().replaceAll('-', '')}`,
    `ca016_upgrade_${randomUUID().replaceAll('-', '')}`,
  ];
  await client.connect();
  try {
    const identity = (
      await client.query(
        'SELECT current_database() AS db,current_schema() AS schema',
      )
    ).rows[0];
    if (identity.db !== 'dev_cor_test' || identity.schema !== 'public')
      throw new Error(
        'Closure migration must start in isolated test public schema',
      );
    const current = await sourceSnapshot(client, caseId);
    if (
      current.case.length !== 1 ||
      current.case[0].row.stage !== 'WAITING_ARCHIVE' ||
      current.case_execution_finishes.length !== 1 ||
      current.case_execution_finish_receipts.length !== 1 ||
      current.oldExecution.case_execution_filings.length !== 1 ||
      current.oldExecution.case_execution_filing_receipts.length !== 1 ||
      current.content.length === 0 ||
      current.audits.length === 0
    )
      throw new Error('Complete real API Finish source required');
    const currentBytes = await blobSnapshot(current.content);

    await client.query(`CREATE SCHEMA ${quote(schemas[0])}`);
    await client.query(`SET search_path TO ${quote(schemas[0])}`);
    await replay(client, names);
    const empty = (
      await client.query(
        `SELECT to_regclass('case_closures') IS NOT NULL AS head,
          to_regclass('case_closure_versions') IS NOT NULL AS versions,
          to_regclass('case_closure_documents') IS NOT NULL AS documents,
          to_regclass('case_closure_receipts') IS NOT NULL AS receipts`,
      )
    ).rows[0];
    if (!Object.values(empty).every(Boolean))
      throw new Error('Empty 144 migration replay omitted closure tables');

    await client.query(`CREATE SCHEMA ${quote(schemas[1])}`);
    await client.query(`SET search_path TO ${quote(schemas[1])}`);
    await replay(client, names.slice(0, 142));
    await copyOldTables(client, schemas[1]);
    const oldForeignKeys = await assertNoOrphanedOldForeignKeys(
      client,
      schemas[1],
    );
    const before = await sourceSnapshot(client, caseId);
    const comparableCurrent = oldCompatibleSource(current);
    if (JSON.stringify(before) !== JSON.stringify(comparableCurrent))
      throw new Error(
        `Copy into 142 schema changed old source facts: ${changedSourceFields(before, comparableCurrent)}`,
      );
    await replay(client, newNames.slice(0, 1));
    const enumCommitted =
      (
        await client.query(
          `SELECT count(*)::int AS n FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
         JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=current_schema()
         AND ((t.typname='permission_action' AND e.enumlabel IN ('case.closure.record','case.closure.correct'))
           OR (t.typname='material_category' AND e.enumlabel='CASE_CLOSURE_DOCUMENT'))`,
        )
      ).rows[0].n === 3 &&
      (
        await client.query(
          `SELECT count(*)::int AS n FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
           WHERE n.nspname=current_schema() AND t.typname IN ('case_closure_kind','case_closure_command')`,
        )
      ).rows[0].n === 2;
    let injectedFailure = false;
    try {
      await client.query(
        sql(newNames[1]).replace(/COMMIT;\s*$/u, 'SELECT 1/0;\nCOMMIT;'),
      );
    } catch (error) {
      injectedFailure = error.code === '22012';
      await client.query('ROLLBACK');
    }
    const ddlRolledBack = (
      await client.query(
        `SELECT to_regclass('case_closures') IS NULL
          AND to_regclass('case_closure_versions') IS NULL
          AND to_regclass('case_closure_documents') IS NULL
          AND to_regclass('case_closure_receipts') IS NULL
          AND to_regprocedure('case_closure_terminal_version(uuid,uuid,uuid,integer)') IS NULL AS absent`,
      )
    ).rows[0].absent;
    if (!enumCommitted || !injectedFailure || !ddlRolledBack)
      throw new Error('Second DDL step failed atomic rollback/enum retention');
    if (
      JSON.stringify(await sourceSnapshot(client, caseId)) !==
      JSON.stringify(before)
    )
      throw new Error('Injected failure changed old source');
    await replay(client, newNames.slice(1));
    const after = await sourceSnapshot(client, caseId);
    const preserved = JSON.stringify(after) === JSON.stringify(before);
    const oldBytesPreserved =
      JSON.stringify(await blobSnapshot(after.content)) ===
      JSON.stringify(currentBytes);
    if (!preserved || !oldBytesPreserved)
      throw new Error(
        'Forward recovery changed old facts, grants, metadata or bytes',
      );
    let stageOnlyRejected = false;
    await client.query('BEGIN');
    try {
      await client.query('UPDATE cases SET version=version+1 WHERE id=$1', [
        caseId,
      ]);
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    } catch (error) {
      stageOnlyRejected = error.code === '23514';
    } finally {
      await client.query('ROLLBACK');
    }
    if (
      !stageOnlyRejected ||
      JSON.stringify(await sourceSnapshot(client, caseId)) !==
        JSON.stringify(before)
    )
      throw new Error(
        'Direct SQL version-only closure bypass was not rejected',
      );
    return {
      empty: true,
      oldForeignKeys,
      enumCommitted,
      injectedFailure,
      ddlRolledBack,
      forwardRecovery: true,
      preserved,
      oldBytesPreserved,
      noGrantBackfill:
        JSON.stringify(after.grants) === JSON.stringify(before.grants),
      stageOnlyRejected,
    };
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.query('SET search_path TO public').catch(() => undefined);
    for (const schema of schemas)
      await client
        .query(`DROP SCHEMA IF EXISTS ${quote(schema)} CASCADE`)
        .catch(() => undefined);
    await client.end();
  }
}
