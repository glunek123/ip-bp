import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';
import { coreLeadFixtures } from './core-lead-database.mjs';
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
export const externalEntryNormalGuardMigration =
  '20261015114500_guard_normal_case_fact_source';
export const externalEntryReferenceMigration =
  '20261015123000_disambiguate_execution_reference_locals';
export const externalEntryRemandChildMigration =
  '20261015130000_guard_direct_second_remand_child';
const atomicExternalEntryMigrations = new Set([
  externalEntryNormalGuardMigration,
  externalEntryReferenceMigration,
  externalEntryRemandChildMigration,
]);
const quote = (value) => `"${value.replaceAll('"', '""')}"`;

function assertMigrationSchema(client, schema) {
  if (!/^ca018_(?:empty|upgrade|retry)_[a-f0-9]{32}$/u.test(schema))
    throw new Error('Invalid CA018 migration test schema');
  return client.query('SELECT current_schema() AS schema').then(({ rows }) => {
    if (rows[0]?.schema !== schema)
      throw new Error('CA018 migration schema is not the active schema');
  });
}

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

export async function withOld150CompatibleCoreLeadGrants(operation) {
  // The preserved 150-migration Prisma client cannot decode the CA018 actions.
  // This compatibility window is restricted to the fixed synthetic E2E roles.
  const url = process.env.DATABASE_URL;
  if (process.env.NODE_ENV !== 'test' || !url)
    throw new Error('Old150 grant fixture requires isolated test database');
  if (validateIsolatedTestDatabaseUrl(url).port !== 15433)
    throw new Error('Old150 grant fixture requires test database port 15433');

  return withCaseExternalEntryMigrationDatabase(async (client) => {
    const roles = [
      coreLeadFixtures.roleA,
      coreLeadFixtures.roleB,
      coreLeadFixtures.roleSelf,
    ];
    const actions = [
      'case.external-entry.create',
      'case.external-entry.archive',
    ];
    const saved = (
      await client.query(
        `DELETE FROM public.role_grants AS g
         WHERE g.role_template_id = ANY($1::uuid[])
           AND g.action::text = ANY($2::text[])
         RETURNING to_jsonb(g) AS row`,
        [roles, actions],
      )
    ).rows.map(({ row }) => row);

    let result;
    let operationError;
    let restorationError;
    try {
      result = await operation();
    } catch (error) {
      operationError = error;
    } finally {
      try {
        await client.query('BEGIN');
        for (const row of saved)
          await client.query(
            `INSERT INTO public.role_grants
             SELECT * FROM jsonb_populate_record(NULL::public.role_grants, $1::jsonb)`,
            [JSON.stringify(row)],
          );
        const restored = (
          await client.query(
            `SELECT to_jsonb(g) AS row FROM public.role_grants AS g
             WHERE g.id = ANY($1::uuid[]) ORDER BY g.id`,
            [saved.map(({ id }) => id)],
          )
        ).rows.map(({ row }) => row);
        const byId = (left, right) => left.id.localeCompare(right.id);
        if (
          JSON.stringify(restored.sort(byId)) ===
          JSON.stringify(saved.sort(byId))
        )
          await client.query('COMMIT');
        else {
          restorationError = new Error(
            'Old150 grant fixture did not restore exact grant rows',
          );
          await client.query('ROLLBACK');
        }
      } catch (error) {
        restorationError = restorationError
          ? new AggregateError(
              [restorationError, error],
              'Old150 grant fixture verification and rollback failed',
            )
          : error;
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          restorationError = new AggregateError(
            [restorationError, rollbackError],
            'Old150 grant fixture restoration and rollback failed',
          );
        }
      }
    }
    if (operationError && restorationError)
      throw new AggregateError(
        [operationError, restorationError],
        'Old150 operation and grant restoration failed',
      );
    if (restorationError) throw restorationError;
    if (operationError) throw operationError;
    return result;
  });
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
  try {
    await client.query(sql);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export async function createCaseExternalFactSourceProbe(client, schema) {
  await assertMigrationSchema(client, schema);
  const table = `${quote(schema)}."ca018_normal_fact_source_probe"`;
  await client.query(
    `CREATE TABLE ${table} (
       id uuid PRIMARY KEY,
       case_id uuid NOT NULL,
       department_id uuid NOT NULL,
       external_entry_id uuid
     )`,
  );
  await client.query(
    `CREATE CONSTRAINT TRIGGER "ca018_normal_fact_source_probe_guard"
     AFTER INSERT OR UPDATE ON ${table}
     DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
     EXECUTE FUNCTION ${quote(schema)}."check_case_external_fact_source"()`,
  );
}

export async function assertCaseExternalFactSourceProbe(
  client,
  schema,
  caseId,
  departmentId,
  migrationApplied,
) {
  await assertMigrationSchema(client, schema);
  if (typeof migrationApplied !== 'boolean')
    throw new Error('Expected explicit CA018 normal-guard migration state');
  const table = `${quote(schema)}."ca018_normal_fact_source_probe"`;
  const runInsert = async (externalEntryId) => {
    await client.query('BEGIN');
    let errorCode = null;
    try {
      await client.query(
        `INSERT INTO ${table} (id,case_id,department_id,external_entry_id)
         VALUES ($1,$2,$3,$4)`,
        [randomUUID(), caseId, departmentId, externalEntryId],
      );
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    } catch (error) {
      errorCode = error.code ?? null;
    } finally {
      await client.query('ROLLBACK');
    }
    return errorCode;
  };
  const normalError = await runInsert(null);
  const expectedNormalError = migrationApplied ? null : '42703';
  if (normalError !== expectedNormalError)
    throw new Error(
      `Normal fact source probe expected ${expectedNormalError ?? 'success'}, received ${normalError ?? 'success'}`,
    );
  if (migrationApplied) {
    const externalError = await runInsert(randomUUID());
    if (externalError !== '23514')
      throw new Error(
        `External fact source probe expected 23514, received ${externalError ?? 'success'}`,
      );
  }
}

export async function failCaseExternalEntryMigrationAtomically(
  client,
  schema,
  migrationName,
) {
  await assertMigrationSchema(client, schema);
  if (!atomicExternalEntryMigrations.has(migrationName))
    throw new Error('Unsupported CA018 atomic migration probe');
  const migrationPath = resolve(
    currentMigrationRoot,
    migrationName,
    'migration.sql',
  );
  const sql = readFileSync(migrationPath, 'utf8');
  const parameterizedRemandChild =
    migrationName === externalEntryRemandChildMigration;
  const functionNames = parameterizedRemandChild
    ? [
        ...sql.matchAll(
          /\bCREATE\s+OR\s+REPLACE\s+FUNCTION\s+"?([a-z_][a-z0-9_]*)"?\s*\(\s*target_case\s+uuid\s*,\s*target_department\s+uuid\s*\)/giu,
        ),
      ].map((match) => match[1])
    : [
        ...sql.matchAll(
          /\bCREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:"?[a-z_][a-z0-9_]*"?\s*\.\s*)?"?([a-z_][a-z0-9_]*)"?\s*\(\s*\)/giu,
        ),
      ].map((match) => match[1]);
  if (
    functionNames.length === 0 ||
    new Set(functionNames).size !== functionNames.length ||
    (parameterizedRemandChild &&
      (functionNames.length !== 1 ||
        functionNames[0] !== 'ca018_h_direct_second_chain'))
  )
    throw new Error(
      `${migrationName} must define only the expected unique functions`,
    );
  const commits = sql.match(/\bCOMMIT\s*;/giu) ?? [];
  const terminalCommit = /\bCOMMIT\s*;\s*$/iu;
  if (
    !/^\s*BEGIN\s*;/iu.test(sql) ||
    commits.length !== 1 ||
    !terminalCommit.test(sql)
  )
    throw new Error(`${migrationName} must have one BEGIN and terminal COMMIT`);
  const forcedFailure = sql.replace(terminalCommit, 'SELECT 1 / 0;\nCOMMIT;');
  if (forcedFailure === sql)
    throw new Error(
      `Unable to place the ${migrationName} rollback probe before COMMIT`,
    );

  const functionDefinitions = async () => {
    const definitions = {};
    for (const functionName of functionNames) {
      if (!/^[a-z_][a-z0-9_]*$/iu.test(functionName))
        throw new Error('Unsafe CA018 migration function identifier');
      const definition = (
        await client.query(
          `SELECT pg_get_functiondef(
             to_regprocedure(format('%I.%I(%s)', $1::text, $2::text, $3::text))
           ) AS definition`,
          [schema, functionName, parameterizedRemandChild ? 'uuid,uuid' : ''],
        )
      ).rows[0]?.definition;
      if (typeof definition !== 'string')
        throw new Error(`${migrationName} function ${functionName} is missing`);
      definitions[functionName] = definition;
    }
    return definitions;
  };
  const before = await functionDefinitions();

  let failure;
  try {
    await client.query(forcedFailure);
  } catch (error) {
    failure = error;
  }
  await client.query('ROLLBACK');
  if (failure?.code !== '22012')
    throw new Error(
      `${migrationName} rollback probe expected SQLSTATE 22012, received ${failure?.code ?? 'success'}`,
    );
  const after = await functionDefinitions();
  if (JSON.stringify(after) !== JSON.stringify(before))
    throw new Error(`Failed ${migrationName} migration changed functions`);
  return { errorCode: failure.code, before, after };
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
  } catch (error) {
    if (!/^23[0-9]{3}$/u.test(error.code ?? '')) throw error;
    rejected = true;
  } finally {
    await client.query('ROLLBACK');
  }
  if (!rejected) throw new Error('Invalid direct SQL unexpectedly accepted');
}
