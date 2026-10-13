import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';
import {
  assertNoOrphanedOldForeignKeys,
  copyOldTables,
} from './case-execution-mailing-migration.mjs';

const directory = resolve(process.cwd(), 'backend/prisma/migrations');
const allNames = readdirSync(directory)
  .filter((name) => /^\d{14}_/u.test(name))
  .sort();
const suffix = [
  '20261013070000_add_case_execution_finish_enums',
  '20261013070100_guard_case_execution_finish',
];
// CA015 probes its original supported prefix. Later slices own their full-chain
// migration probes; adding a forward migration must not rewrite this boundary.
const finishBoundary = allNames.indexOf(suffix[1]);
if (finishBoundary < 0) throw new Error('Missing execution finish boundary');
const names = allNames.slice(0, finishBoundary + 1);
const quote = (value) => `"${value.replaceAll('"', '""')}"`;
const sql = (name) =>
  readFileSync(resolve(directory, name, 'migration.sql'), 'utf8');

async function exactBlobSnapshot(contents) {
  const root = resolve(process.env.PRIVATE_FILE_ROOT ?? '');
  if (root !== resolve(process.cwd(), '.local/private-files/test'))
    throw new Error('Exact blob check requires the isolated test file root');
  const backend = createRequire(resolve(process.cwd(), 'backend/package.json'));
  const { LocalPrivateBlobStorage } = backend(
    './dist/modules/materials/local-private-blob-storage.js',
  );
  const storage = new LocalPrivateBlobStorage(root);
  const result = [];
  for (const content of contents) {
    const chunks = [];
    for await (const chunk of await storage.open(content.storage_key))
      chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (
      sha256 !== content.sha256 ||
      bytes.length !== Number(content.size_bytes)
    )
      throw new Error(
        'Stored source blob differs from its exact content version',
      );
    result.push({ id: content.id, bytes: bytes.toString('base64') });
  }
  return result;
}

export async function executionSourceSnapshot(client, caseId) {
  const result = {};
  for (const table of [
    'case_execution_submissions',
    'case_execution_submission_versions',
    'case_execution_submission_receipts',
    'case_execution_confirmations',
    'case_execution_confirmation_receipts',
    'case_execution_mailings',
    'case_execution_mailing_versions',
    'case_execution_mailing_receipts',
    'case_execution_filings',
    'case_execution_filing_versions',
    'case_execution_filing_receipts',
  ])
    result[table] = (
      await client.query(
        `SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows
         FROM "${table}" t WHERE case_id=$1`,
        [caseId],
      )
    ).rows[0].rows;
  result.references = (
    await client.query(
      `SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]'::jsonb) AS rows
       FROM material_references r WHERE resource_type='case' AND resource_id=$1
         AND purpose IN ('EXECUTION_APPLICATION','MAIL_RECEIPT','EXECUTION_FILING_PROOF')`,
      [caseId],
    )
  ).rows[0].rows;
  result.content = (
    await client.query(
      `SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.id),'[]'::jsonb) AS rows
       FROM content_versions v JOIN materials m ON m.id=v.material_id
       WHERE m.owner_type='CASE' AND m.owner_id=$1
         AND m.category IN ('EXECUTION_APPLICATION','MAIL_RECEIPT','EXECUTION_FILING_PROOF')`,
      [caseId],
    )
  ).rows[0].rows;
  result.audits = (
    await client.query(
      `SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb) AS rows
       FROM audit_events a WHERE resource_type='CASE' AND resource_id=$1
         AND action IN ('case.execution.submitted','case.execution.confirmed',
           'case.execution.mailed','case.execution.filing.submitted')`,
      [caseId],
    )
  ).rows[0].rows;
  return result;
}

export async function verifyExecutionFinishMigration(caseId) {
  if (process.env.NODE_ENV !== 'test')
    throw new Error('Execution finish migration requires isolated tests');
  validateIsolatedTestDatabaseUrl(process.env.DATABASE_URL, {
    allowRandomPort: true,
  });
  if (suffix.some((name, index) => names.at(index - 2) !== name))
    throw new Error('Unexpected execution finish migration suffix');
  const backend = createRequire(resolve(process.cwd(), 'backend/package.json'));
  const { Client } = backend('pg');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  const schemas = [
    `ca015_empty_${randomUUID().replaceAll('-', '')}`,
    `ca015_upgrade_${randomUUID().replaceAll('-', '')}`,
  ];
  await client.connect();
  try {
    const identity = (
      await client.query(
        'SELECT current_database() AS db,current_schema() AS schema',
      )
    ).rows[0];
    if (identity.db !== 'dev_cor_test' || identity.schema !== 'public')
      throw new Error('Unexpected execution finish migration database');
    const head = (
      await client.query('SELECT stage FROM cases WHERE id=$1', [caseId])
    ).rows[0];
    if (head?.stage !== 'EXECUTING')
      throw new Error('A complete current execution filing source is required');
    const before = await executionSourceSnapshot(client, caseId);
    const beforeBlobs = await exactBlobSnapshot(before.content);
    if (
      before.case_execution_filings.length !== 1 ||
      before.case_execution_filing_receipts.length !== 1
    )
      throw new Error('Missing immutable execution filing source');
    await client.query(`CREATE SCHEMA ${quote(schemas[0])}`);
    await client.query(`SET search_path TO ${quote(schemas[0])}`);
    for (const name of names) await client.query(sql(name));
    const empty = (
      await client.query(
        "SELECT to_regclass('case_execution_finishes') IS NOT NULL AS ready",
      )
    ).rows[0].ready;

    await client.query(`CREATE SCHEMA ${quote(schemas[1])}`);
    await client.query(`SET search_path TO ${quote(schemas[1])}`);
    for (const name of names.slice(0, -2)) await client.query(sql(name));
    await copyOldTables(client, schemas[1]);
    const foreignKeys = await assertNoOrphanedOldForeignKeys(
      client,
      schemas[1],
    );
    if (
      JSON.stringify(await executionSourceSnapshot(client, caseId)) !==
      JSON.stringify(before)
    )
      throw new Error('Copied execution facts changed before upgrade');
    await client.query(sql(suffix[0]));
    const enumCommitted = (
      await client.query(
        "SELECT EXISTS(SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=current_schema() AND t.typname='case_stage' AND e.enumlabel='WAITING_ARCHIVE') AS ready",
      )
    ).rows[0].ready;
    let injectedFailure = false;
    try {
      await client.query(
        sql(suffix[1]).replace(/COMMIT;\s*$/u, 'SELECT 1/0;\nCOMMIT;'),
      );
    } catch (error) {
      injectedFailure = error.code === '22012';
      await client.query('ROLLBACK');
    }
    const ddlRolledBack = (
      await client.query(
        "SELECT to_regclass('case_execution_finishes') IS NULL AS absent",
      )
    ).rows[0].absent;
    if (!injectedFailure || !ddlRolledBack)
      throw new Error('Execution finish second-step failure did not roll back');
    await client.query(sql(suffix[1]));
    const preserved =
      JSON.stringify(await executionSourceSnapshot(client, caseId)) ===
      JSON.stringify(before);
    if (!preserved)
      throw new Error(
        'Finish migration changed prior execution facts or exact versions',
      );
    const oldBytesPreserved =
      JSON.stringify(await exactBlobSnapshot(before.content)) ===
      JSON.stringify(beforeBlobs);
    if (!oldBytesPreserved)
      throw new Error('Upgrade changed exact source blob bytes');
    let stageOnlyRejected = false;
    await client.query('BEGIN');
    try {
      await client.query(
        "UPDATE cases SET stage='WAITING_ARCHIVE',version=version+1 WHERE id=$1",
        [caseId],
      );
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    } catch (error) {
      stageOnlyRejected = error.code === '23514';
    } finally {
      await client.query('ROLLBACK');
    }
    return {
      empty,
      foreignKeys,
      enumCommitted,
      injectedFailure,
      ddlRolledBack,
      forwardRecovery: true,
      preserved,
      oldBytesPreserved,
      stageOnlyRejected,
    };
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.query('SET search_path TO public').catch(() => undefined);
    for (const schema of schemas)
      await client.query(`DROP SCHEMA IF EXISTS ${quote(schema)} CASCADE`);
    await client.end();
  }
}
