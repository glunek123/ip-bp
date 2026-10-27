import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { assertBatch2Admission } from './batch2-proxy-calendar-acceptance.mjs';

const root = process.cwd();
const migrationsRoot = resolve(root, 'backend/prisma/migrations');
const through190 = '20261027160000_batch2_import_responsible_operator';
const target191 = '20261027170000_fix_re_registered_direct_remand_guard';
const backend = createRequire(resolve(root, 'backend/package.json'));
const { Client } = backend('pg');

export function beforeFinalCommit(sql) {
  if (!/^BEGIN;\s/u.test(sql) || !/COMMIT;\s*$/u.test(sql))
    throw new Error('191 transaction boundaries changed');
  return sql.replace(/COMMIT;\s*$/u, '');
}

export async function apply191WithFault(client, sql, beforeCommit) {
  await client.query(beforeFinalCommit(sql));
  await beforeCommit(client);
  await client.query('COMMIT');
}

export async function cleanupOwned191Schema(
  client,
  schema,
  connected,
  created,
  primaryError,
) {
  const errors = [];
  if (connected) {
    try {
      await client.query('ROLLBACK');
    } catch (error) {
      errors.push(error);
    }
    if (created) {
      if (!/^b2drfull_[a-f0-9]{32}$/u.test(schema)) {
        errors.push(new Error('Invalid owned 191 schema'));
      } else {
        try {
          await client.query('RESET search_path');
        } catch (error) {
          errors.push(error);
        }
        try {
          await client.query(`DROP SCHEMA "${schema}" CASCADE`);
        } catch (error) {
          errors.push(error);
        }
        try {
          const remaining = (
            await client.query(
              'SELECT count(*)::integer AS count FROM pg_namespace WHERE nspname=$1',
              [schema],
            )
          ).rows[0].count;
          if (remaining !== 0) throw new Error('Owned 191 schema remains');
        } catch (error) {
          errors.push(error);
        }
      }
    }
    try {
      await client.end();
    } catch (error) {
      errors.push(error);
    }
  }
  if (primaryError && errors.length)
    throw new AggregateError(
      [primaryError, ...errors],
      '191 probe and cleanup failed',
    );
  if (primaryError) throw primaryError;
  if (errors.length)
    throw new AggregateError(errors, '191 probe cleanup failed');
}

// Unlike the three-table predicate probe, this applies the complete historical
// migration chain in one random schema, then exercises 191 rollback and retry.
export async function verifyBatch2DirectRemandFullChain() {
  if (process.env.BATCH2_191_ACCEPTANCE_READY !== 'approved-191-owned-schema')
    throw new Error('191 owned-schema migration probe has not been approved');
  const { databaseUrl } = assertBatch2Admission();
  const names = (await readdir(migrationsRoot))
    .filter((name) => /^\d{14}_/u.test(name) && name <= through190)
    .sort();
  if (names.at(-1) !== through190 || names.length < 190)
    throw new Error('Complete 184-190 migration chain is missing');
  const sql191 = await readFile(
    resolve(migrationsRoot, target191, 'migration.sql'),
    'utf8',
  );
  beforeFinalCommit(sql191);
  const schema = `b2drfull_${randomUUID().replaceAll('-', '')}`;
  const client = new Client({ connectionString: databaseUrl });
  let connected = false;
  let created = false;
  let primaryError;
  let result;
  const functionDefinition = async () =>
    (
      await client.query(
        "SELECT pg_get_functiondef(to_regprocedure('ca018_h_direct_second_chain(uuid,uuid)')) AS definition",
      )
    ).rows[0].definition;
  const helperExists = async () =>
    (
      await client.query(
        "SELECT to_regprocedure('ca018_h_direct_remand_history(uuid,uuid,uuid,uuid,integer,integer)') IS NOT NULL AS present",
      )
    ).rows[0].present;
  const tableNames = async () =>
    (
      await client.query(
        'SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename',
        [schema],
      )
    ).rows.map((row) => row.tablename);
  try {
    await client.connect();
    connected = true;
    const identity = (
      await client.query(
        'SELECT current_database() AS db,current_schema() AS schema',
      )
    ).rows[0];
    if (identity.db !== 'dev_cor_test' || identity.schema !== 'public')
      throw new Error('Unexpected 191 full-chain namespace');
    await client.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    await client.query(`SET search_path TO "${schema}"`);
    for (const name of names)
      await client.query(
        await readFile(resolve(migrationsRoot, name, 'migration.sql'), 'utf8'),
      );
    const oldDefinition = await functionDefinition();
    const baselineTables = await tableNames();
    if (
      !oldDefinition?.includes('r."sequence"=root_round."sequence"+1') ||
      baselineTables.length === 0 ||
      (await helperExists())
    )
      throw new Error('190 direct remand baseline differs from source');

    let fault;
    try {
      await apply191WithFault(client, sql191, async (transaction) => {
        await transaction.query('SELECT 1/0');
      });
    } catch (error) {
      fault = error;
    }
    if (fault?.code !== '22012')
      throw fault ?? new Error('191 fault was not injected');
    await client.query('ROLLBACK');
    if (
      (await functionDefinition()) !== oldDefinition ||
      (await helperExists())
    )
      throw new Error(
        '191 failed transaction changed old function or left helper',
      );
    if (JSON.stringify(await tableNames()) !== JSON.stringify(baselineTables))
      throw new Error('191 failed transaction changed 190 tables');

    await client.query(sql191);
    const newDefinition = await functionDefinition();
    if (
      !newDefinition?.includes('ca018_h_direct_remand_history(') ||
      newDefinition === oldDefinition ||
      !(await helperExists())
    )
      throw new Error('191 retry did not install the replacement guard');
    if (JSON.stringify(await tableNames()) !== JSON.stringify(baselineTables))
      throw new Error('191 retry changed 190 tables');
    result = {
      through: through190,
      migrationCount: names.length,
      baselineTableCount: baselineTables.length,
      faultSqlstate: fault.code,
      oldDefinitionRestored: true,
      helperRolledBack: true,
      retryInstalled: true,
    };
  } catch (error) {
    primaryError = error;
  }
  await cleanupOwned191Schema(client, schema, connected, created, primaryError);
  return result;
}
