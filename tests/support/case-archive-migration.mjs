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
import { caseArchiveSourceSnapshot } from './case-archive-database.mjs';

const root = process.cwd();
const directory = resolve(root, 'backend/prisma/migrations');
const allNames = readdirSync(directory)
  .filter((n) => /^\d{14}_/u.test(n))
  .sort();
const suffix = [
  '20261014090000_add_case_archive_enums',
  '20261014090100_guard_case_archive',
];
const quote = (n) => `"${n.replaceAll('"', '""')}"`;
const sql = (n) => readFileSync(resolve(directory, n, 'migration.sql'), 'utf8');
const archiveActions = new Set(['case.archive', 'case.archive.correct']);
async function source(client, caseId) {
  return {
    ...(await caseArchiveSourceSnapshot(client, caseId)),
    oldExecution: await executionSourceSnapshot(client, caseId),
  };
}
function oldCompatible(value) {
  return {
    ...value,
    grants: value.grants.filter(({ row }) => !archiveActions.has(row.action)),
  };
}
async function blobs(content) {
  const fileRoot = resolve(process.env.PRIVATE_FILE_ROOT ?? '');
  if (fileRoot !== resolve(root, '.local/private-files/test'))
    throw new Error('Archive migration requires isolated file root');
  const backend = createRequire(resolve(root, 'backend/package.json'));
  const { LocalPrivateBlobStorage } = backend(
    './dist/modules/materials/local-private-blob-storage.js',
  );
  const storage = new LocalPrivateBlobStorage(fileRoot);
  const result = [];
  for (const { row } of content) {
    const chunks = [];
    for await (const chunk of await storage.open(row.storage_key))
      chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    if (
      createHash('sha256').update(bytes).digest('hex') !== row.sha256 ||
      bytes.length !== Number(row.size_bytes)
    )
      throw new Error('Old archive-source bytes mismatch');
    result.push({ id: row.id, bytes: bytes.toString('base64') });
  }
  return result;
}
async function replay(client, names) {
  for (const name of names) {
    try {
      await client.query(sql(name));
    } catch (e) {
      throw new Error(`Archive migration replay failed at ${name}`, {
        cause: e,
      });
    }
  }
}
export async function verifyCaseArchiveMigration(caseId) {
  if (process.env.NODE_ENV !== 'test')
    throw new Error('Archive migration requires isolated tests');
  validateIsolatedTestDatabaseUrl(process.env.DATABASE_URL);
  if (
    allNames.length !== 146 ||
    allNames.at(-2) !== suffix[0] ||
    allNames.at(-1) !== suffix[1]
  )
    throw new Error(
      'Expected explicit 144 predecessor and two archive migrations',
    );
  const backend = createRequire(resolve(root, 'backend/package.json'));
  const { Client } = backend('pg');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const schemas = [
    `ca017_empty_${randomUUID().replaceAll('-', '')}`,
    `ca017_upgrade_${randomUUID().replaceAll('-', '')}`,
  ];
  try {
    const identity = (
      await client.query(
        'SELECT current_database() AS db,current_schema() AS schema',
      )
    ).rows[0];
    if (identity.db !== 'dev_cor_test' || identity.schema !== 'public')
      throw new Error('Unexpected archive migration database');
    const current = await source(client, caseId);
    if (
      current.case.length !== 1 ||
      current.case[0].row.stage !== 'WAITING_ARCHIVE' ||
      current.case_closures.length !== 1 ||
      current.case_closure_versions.length !== 1 ||
      current.case_closure_receipts.length !== 1 ||
      current.case_closure_documents.length !== 1 ||
      current.content.length === 0
    )
      throw new Error('Normal API closure source with exact PDF required');
    const currentBytes = await blobs(current.content);
    await client.query(`CREATE SCHEMA ${quote(schemas[0])}`);
    await client.query(`SET search_path TO ${quote(schemas[0])}`);
    await replay(client, allNames);
    const empty = (
      await client.query(
        "SELECT to_regclass('case_archives') IS NOT NULL AS head,to_regclass('case_archive_versions') IS NOT NULL AS versions,to_regclass('case_archive_receipts') IS NOT NULL AS receipts",
      )
    ).rows[0];
    if (!Object.values(empty).every(Boolean))
      throw new Error('Empty 146 replay omitted archive tables');
    await client.query(`CREATE SCHEMA ${quote(schemas[1])}`);
    await client.query(`SET search_path TO ${quote(schemas[1])}`);
    await replay(client, allNames.slice(0, 144));
    await copyOldTables(client, schemas[1]);
    const oldForeignKeys = await assertNoOrphanedOldForeignKeys(
      client,
      schemas[1],
    );
    const before = await source(client, caseId);
    if (JSON.stringify(before) !== JSON.stringify(oldCompatible(current)))
      throw new Error(
        '144 copy changed prior facts/grants/receipts/references',
      );
    await replay(client, suffix.slice(0, 1));
    const enumCommitted =
      (
        await client.query(
          "SELECT count(*)::int AS n FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=current_schema() AND ((t.typname='case_stage' AND e.enumlabel='ARCHIVED') OR (t.typname='permission_action' AND e.enumlabel IN ('case.archive','case.archive.correct')))",
        )
      ).rows[0].n === 3;
    const ddl = sql(suffix[1]);
    if (!/COMMIT;\s*$/u.test(ddl))
      throw new Error('Second archive DDL must have explicit final COMMIT');
    let injectedFailure = false;
    try {
      await client.query(ddl.replace(/COMMIT;\s*$/u, 'SELECT 1/0;\nCOMMIT;'));
    } catch (e) {
      injectedFailure = e.code === '22012';
      await client.query('ROLLBACK');
    }
    const ddlRolledBack = (
      await client.query(
        "SELECT to_regclass('case_archives') IS NULL AND to_regclass('case_archive_versions') IS NULL AND to_regclass('case_archive_receipts') IS NULL AS absent",
      )
    ).rows[0].absent;
    if (
      !enumCommitted ||
      !injectedFailure ||
      !ddlRolledBack ||
      JSON.stringify(before) !== JSON.stringify(await source(client, caseId))
    )
      throw new Error('Failed archive DDL did not leave atomic old 144 state');
    await replay(client, suffix.slice(1));
    const after = await source(client, caseId);
    const preserved = JSON.stringify(before) === JSON.stringify(after);
    const oldBytesPreserved =
      JSON.stringify(currentBytes) ===
      JSON.stringify(await blobs(after.content));
    if (!preserved || !oldBytesPreserved)
      throw new Error(
        'Archive upgrade changed prior facts/grants/receipts/metadata/bytes',
      );
    let stageOnlyRejected = false;
    await client.query('BEGIN');
    try {
      await client.query(
        "UPDATE cases SET stage='ARCHIVED',version=version+1 WHERE id=$1",
        [caseId],
      );
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    } catch (e) {
      stageOnlyRejected = e.code === '23514';
    } finally {
      await client.query('ROLLBACK');
    }
    if (
      !stageOnlyRejected ||
      JSON.stringify(before) !== JSON.stringify(await source(client, caseId))
    )
      throw new Error('Direct archive stage/version bypass not rejected');
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
        JSON.stringify(before.grants) === JSON.stringify(after.grants),
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
