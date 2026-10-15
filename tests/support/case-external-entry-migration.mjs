import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';
import {
  assertNoOrphanedOldForeignKeys,
  copyOldTables,
} from './case-execution-mailing-migration.mjs';

const root = process.cwd();
const requireBackend = createRequire(resolve(root, 'backend/package.json'));
const { Client } = requireBackend('pg');
const old150PrismaRoot = process.env.CA018_OLD150_PRISMA_DIR;
if (!old150PrismaRoot)
  throw new Error('CA018 requires the preserved old150 Prisma directory');
const migrationRoot = resolve(old150PrismaRoot, 'migrations');
const currentMigrationRoot = resolve(root, 'backend/prisma/migrations');
export const externalEntryActionMigration =
  '20261014170000_case_external_entry_actions';
export const externalEntryFoundationMigration =
  '20261014170100_case_external_entry_foundation';
const quote = (value) => `"${value.replaceAll('"', '""')}"`;

export const oldCaseMigrations = readdirSync(migrationRoot)
  .filter(
    (name) => /^\d{14}_/u.test(name) && name < externalEntryActionMigration,
  )
  .sort();
if (
  oldCaseMigrations.length !== 150 ||
  resolve(old150PrismaRoot) !==
    resolve(
      root,
      '..',
      'ca015-integration',
      '.local/ca018-evidence/old150-runtime/backend/prisma',
    )
)
  throw new Error(
    'CA018 migration tests require the preserved exact old150 snapshot',
  );

export async function withCaseExternalEntryMigrationDatabase(operation) {
  const url = process.env.DATABASE_URL;
  if (process.env.NODE_ENV !== 'test' || !url)
    throw new Error(
      'External-entry migration fixture requires isolated test database',
    );
  validateIsolatedTestDatabaseUrl(url, { allowRandomPort: true });
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const identity = (
      await client.query(
        'SELECT current_database() AS db,current_schema() AS schema',
      )
    ).rows[0];
    if (identity.db !== 'dev_cor_test' || identity.schema !== 'public')
      throw new Error('Unexpected external-entry migration database');
    return await operation(client);
  } finally {
    await client.end();
  }
}

export function newCaseExternalEntrySchema(prefix) {
  if (!/^[a-z][a-z0-9_]{0,20}$/u.test(prefix))
    throw new Error('Invalid migration test schema prefix');
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

export async function createCaseExternalEntrySchema(client, schema) {
  await client.query(`CREATE SCHEMA ${quote(schema)}`);
  await client.query(`SET search_path TO ${quote(schema)}`);
}

export async function dropCaseExternalEntrySchema(client, schema) {
  await client.query('SET search_path TO public');
  await client.query(`DROP SCHEMA IF EXISTS ${quote(schema)} CASCADE`);
}

export async function applyCaseExternalEntryMigration(client, name) {
  const sql = readFileSync(
    resolve(currentMigrationRoot, name, 'migration.sql'),
    'utf8',
  );
  await client.query(sql);
}

export async function replayOldCaseMigrations(client) {
  for (const name of oldCaseMigrations) {
    const sql = readFileSync(
      resolve(migrationRoot, name, 'migration.sql'),
      'utf8',
    );
    await client.query(sql);
  }
}

export async function copyOldCaseSchema(client, schema) {
  await copyOldTables(client, schema);
  await assertNoOrphanedOldForeignKeys(client, schema);
  await client.query(`SET search_path TO ${quote(schema)}`);
}

export async function snapshotOldCaseRows(
  client,
  schema,
  caseId,
  priorColumns,
) {
  const tables = priorColumns
    ? Object.keys(priorColumns).filter(
        (table) => !['audit_events', 'material_references'].includes(table),
      )
    : (
        await client.query(
          `SELECT DISTINCT table_name FROM information_schema.columns
           WHERE table_schema=$1 AND column_name='case_id'
           UNION SELECT 'cases' ORDER BY table_name`,
          [schema],
        )
      ).rows.map((row) => row.table_name);
  const columns = priorColumns ? { ...priorColumns } : {};
  const result = {};
  for (const table of tables) {
    columns[table] ??= (
      await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position`,
        [schema, table],
      )
    ).rows.map((row) => row.column_name);
    const column = table === 'cases' ? 'id' : 'case_id';
    result[table] = (
      await client.query(
        `SELECT to_jsonb(t) - ARRAY(
           SELECT column_name FROM information_schema.columns
           WHERE table_schema=$1 AND table_name=$2
             AND NOT (column_name = ANY($3::text[]))
         ) AS row
         FROM ${quote(schema)}.${quote(table)} t
         WHERE ${quote(column)}=$4 ORDER BY to_jsonb(t)::text`,
        [schema, table, columns[table], caseId],
      )
    ).rows.map((row) => row.row);
  }
  for (const table of ['audit_events', 'material_references']) {
    columns[table] ??= (
      await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position`,
        [schema, table],
      )
    ).rows.map((row) => row.column_name);
  }
  result.auditEvents = (
    await client.query(
      `SELECT to_jsonb(t) - ARRAY(
         SELECT column_name FROM information_schema.columns
         WHERE table_schema=$1 AND table_name='audit_events'
           AND NOT (column_name = ANY($2::text[]))
       ) AS row FROM ${quote(schema)}.audit_events t
       WHERE resource_type='CASE' AND resource_id=$3 ORDER BY id`,
      [schema, columns.audit_events, caseId],
    )
  ).rows.map((row) => row.row);
  result.materialReferences = (
    await client.query(
      `SELECT to_jsonb(t) - ARRAY(
         SELECT column_name FROM information_schema.columns
         WHERE table_schema=$1 AND table_name='material_references'
           AND NOT (column_name = ANY($2::text[]))
       ) AS row FROM ${quote(schema)}.material_references t
       WHERE resource_type='case' AND resource_id=$3 ORDER BY id`,
      [schema, columns.material_references, caseId],
    )
  ).rows.map((row) => row.row);
  result.columnManifest = columns;
  return result;
}

export async function externalEntryActionGrantRows(client, schema) {
  return (
    await client.query(
      `SELECT to_jsonb(t) AS row FROM ${quote(schema)}.role_grants t
       WHERE action IN ('case.external-entry.create','case.external-entry.archive') ORDER BY id`,
    )
  ).rows.map((row) => row.row);
}

export async function assertSqlRejected(client, operation) {
  await client.query('BEGIN');
  let rejected = false;
  try {
    await operation();
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
  } catch {
    rejected = true;
  } finally {
    await client.query('ROLLBACK');
  }
  if (!rejected) throw new Error('Invalid direct SQL unexpectedly committed');
}
