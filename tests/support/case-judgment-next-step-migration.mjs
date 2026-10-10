import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';

const root = process.cwd();
const requireBackend = createRequire(resolve(root, 'backend/package.json'));
const { Client } = requireBackend('pg');
const directory = resolve(root, 'backend/prisma/migrations');
const names = readdirSync(directory).filter((name) => /^\d{14}_/u.test(name)).sort();
const previous = '20261010013000_restore_customer_deletion_guard';
const added = [
  '20261010030000_add_case_judgment_next_step_enums',
  '20261010031000_add_case_judgment_next_step_facts',
  '20261010032000_guard_case_judgment_next_step_chain',
  '20261010033000_allow_lawyer_judgment_next_step_audit',
];
const sql = (name) => readFileSync(resolve(directory, name, 'migration.sql'), 'utf8');

export async function verifyCaseJudgmentNextStepMigration() {
  if (process.env.NODE_ENV !== 'test') throw new Error('Isolated migration probe requires NODE_ENV=test');
  validateIsolatedTestDatabaseUrl(process.env.DATABASE_URL, { allowRandomPort: true });
  const previousNames = names.filter((name) => name <= previous);
  if (previousNames.length !== 112 || previousNames.at(-1) !== previous ||
      names.length !== 116 || added.some((name, i) => names[112 + i] !== name))
    throw new Error('Unexpected prior 112 migration chain or CA-009 suffix');
  const schema = `ca009_next_${randomUUID().replaceAll('-', '')}`;
  if (!/^ca009_next_[0-9a-f]{32}$/u.test(schema)) throw new Error('Unsafe temporary schema');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  let created = false;
  try {
    await client.connect();
    const location = (await client.query('SELECT current_database() AS db, current_schema() AS schema')).rows[0];
    if (location.db !== 'dev_cor_test' || location.schema !== 'public') throw new Error('Isolated public test database required');
    await client.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    await client.query(`SET search_path TO "${schema}"`);
    for (const name of names) {
      try { await client.query(sql(name)); }
      catch (error) { throw new Error(`Migration ${name}: ${error.message}`, { cause: error }); }
    }
    const rows = (await client.query(`SELECT
      to_regclass('case_judgment_next_steps') IS NOT NULL AS choice,
      to_regclass('case_judgment_next_step_revocations') IS NOT NULL AS revoke,
      to_regclass('case_judgment_next_step_receipts') IS NOT NULL AS receipt,
      (SELECT count(*)::int FROM pg_trigger t
        JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=current_schema() AND t.tgname IN
        ('case_judgment_next_step_case_guard','case_judgment_next_step_fact_guard','case_judgment_next_step_revoke_guard')) AS guards`)).rows[0];
    if (!rows.choice || !rows.revoke || !rows.receipt || rows.guards !== 3)
      throw new Error('CA-009 migrated schema incomplete');
    return { migrationCount: names.length, priorMigrationCount: previousNames.length, guards: rows.guards };
  } finally {
    if (created) {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.query('SET search_path TO public');
      await client.query(`DROP SCHEMA "${schema}" CASCADE`);
    }
    await client.end();
  }
}
