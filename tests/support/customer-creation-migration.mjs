import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';

const requireBackend = createRequire(
  resolve(process.cwd(), 'backend/package.json'),
);
const { Client } = requireBackend('pg');
const target = '20261026090000_customer_agreement_settlement_formula';
const migrationRoot = resolve(process.cwd(), 'backend/prisma/migrations');
const names = readdirSync(migrationRoot)
  .filter((name) => /^\d{14}_/u.test(name) && name <= target)
  .sort();
const sql = (name) =>
  readFileSync(resolve(migrationRoot, name, 'migration.sql'), 'utf8');

export async function verifyCustomerCreationMigration() {
  if (process.env.NODE_ENV !== 'test')
    throw new Error(
      'Customer creation migration requires the isolated test environment',
    );
  validateIsolatedTestDatabaseUrl(process.env.DATABASE_URL, {
    allowRandomPort: true,
  });
  if (names.at(-1) !== target)
    throw new Error('Customer creation migration was not found');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  const owned = new Set();
  const checks = [];
  let primaryError;
  let result;
  async function createSchema(kind, migrations) {
    const schema = `cucreate_${kind}_${randomUUID().replaceAll('-', '')}`;
    if (!/^cucreate_(empty|upgrade)_[a-f0-9]{32}$/u.test(schema))
      throw new Error('Unsafe owned schema');
    await client.query(`CREATE SCHEMA "${schema}"`);
    owned.add(schema);
    await client.query(`SET search_path TO "${schema}"`);
    for (const name of migrations) await client.query(sql(name));
    return schema;
  }
  async function dropSchema(schema) {
    if (!owned.has(schema))
      throw new Error('Refusing cleanup of an unowned schema');
    await client.query('RESET search_path');
    await client.query(`DROP SCHEMA "${schema}" CASCADE`);
    owned.delete(schema);
  }
  async function rejects(work, expected) {
    await client.query('BEGIN');
    try {
      await work();
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      throw new Error('Expected a database constraint rejection');
    } catch (error) {
      if (error.code !== expected) throw error;
    } finally {
      await client.query('ROLLBACK');
    }
  }
  try {
    await client.connect();
    if (
      (await client.query('SELECT current_database() AS db')).rows[0].db !==
      'dev_cor_test'
    )
      throw new Error('Unexpected test database');
    const empty = await createSchema('empty', names);
    const column = (
      await client.query(
        `SELECT is_nullable,character_maximum_length FROM information_schema.columns
      WHERE table_schema=$1 AND table_name='customer_agreement_versions' AND column_name='settlement_formula'`,
        [empty],
      )
    ).rows;
    if (
      column.length !== 1 ||
      column[0].is_nullable !== 'YES' ||
      column[0].character_maximum_length !== 500
    )
      throw new Error(
        'The empty migration chain did not produce the expected column',
      );
    checks.push('empty full migration chain');
    await dropSchema(empty);

    const upgrade = await createSchema('upgrade', names.slice(0, -1));
    const department = randomUUID(),
      actor = randomUUID(),
      customer = randomUUID(),
      agreement = randomUUID(),
      version = randomUUID(),
      audit = randomUUID();
    await client.query(
      'INSERT INTO departments(id,name,updated_at) VALUES ($1,$2,now())',
      [department, '首版迁移合成部门'],
    );
    await client.query(
      'INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES ($1,$2,$3,now())',
      [actor, `cucreate-${actor}`, '合成运营'],
    );
    await client.query(
      'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES ($1,$2,$3,now())',
      [randomUUID(), actor, department],
    );
    await client.query(
      'INSERT INTO customers(id,name,normalized_name,department_id,responsible_user_id,updated_at) VALUES ($1,$2,$3,$4,$5,now())',
      [customer, '旧客户', '旧客户', department, actor],
    );
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO customer_agreements(id,customer_id,department_id) VALUES ($1,$2,$3)',
      [agreement, customer, department],
    );
    await client.query(
      `INSERT INTO audit_events(id,department_id,actor_user_id,resource_type,resource_id,action,details,created_at)
      VALUES ($1,$2,$3,'customer_agreement',$4,'customer.agreement.created','{"version":1}'::jsonb,now())`,
      [audit, department, actor, agreement],
    );
    await client.query(
      `INSERT INTO customer_agreement_versions(id,agreement_id,customer_id,department_id,version,title,validity_mode,content_version_ids,recorded_by_user_id,audit_event_id)
      VALUES ($1,$2,$3,$4,1,'旧合作协议','UNKNOWN','{}'::uuid[],$5,$6)`,
      [version, agreement, customer, department, actor, audit],
    );
    await client.query(
      'UPDATE customer_agreements SET current_version_id=$1 WHERE id=$2',
      [version, agreement],
    );
    await client.query('COMMIT');
    const prior = (
      await client.query(
        'SELECT * FROM customer_agreement_versions WHERE id=$1',
        [version],
      )
    ).rows[0];

    await client.query(
      'ALTER TABLE customer_agreement_versions ADD CONSTRAINT customer_agreement_settlement_formula_text CHECK (true)',
    );
    await rejects(() => client.query(sql(target)), '42710');
    const afterFailure = (
      await client.query(
        `SELECT count(*)::int AS count FROM information_schema.columns
      WHERE table_schema=$1 AND table_name='customer_agreement_versions' AND column_name='settlement_formula'`,
        [upgrade],
      )
    ).rows[0].count;
    if (afterFailure !== 0)
      throw new Error('Failed migration left a partial column');
    checks.push('failed migration is atomic');
    await client.query(
      'ALTER TABLE customer_agreement_versions DROP CONSTRAINT customer_agreement_settlement_formula_text',
    );
    await client.query(sql(target));
    const after = (
      await client.query(
        'SELECT * FROM customer_agreement_versions WHERE id=$1',
        [version],
      )
    ).rows[0];
    const { settlement_formula: historicalFormula, ...originalFields } = after;
    if (
      historicalFormula !== null ||
      JSON.stringify(originalFields) !== JSON.stringify(prior)
    )
      throw new Error('Existing agreement facts changed during upgrade');
    checks.push('prior agreement preserved without backfill');
    checks.push('migration retry succeeds');

    async function appendFormula(formula) {
      const nextAudit = randomUUID(),
        nextVersion = randomUUID();
      await client.query(
        `INSERT INTO audit_events(id,department_id,actor_user_id,resource_type,resource_id,action,details,created_at)
        VALUES ($1,$2,$3,'customer_agreement',$4,'customer.agreement.revised','{"version":2}'::jsonb,now())`,
        [nextAudit, department, actor, agreement],
      );
      await client.query(
        `INSERT INTO customer_agreement_versions(id,agreement_id,customer_id,department_id,version,title,validity_mode,content_version_ids,recorded_by_user_id,audit_event_id,settlement_formula)
        VALUES ($1,$2,$3,$4,2,'新合作协议','UNKNOWN','{}'::uuid[],$5,$6,$7)`,
        [
          nextVersion,
          agreement,
          customer,
          department,
          actor,
          nextAudit,
          formula,
        ],
      );
      await client.query(
        'UPDATE customer_agreements SET version=2,current_version_id=$1 WHERE id=$2',
        [nextVersion, agreement],
      );
      return nextVersion;
    }
    await rejects(() => appendFormula(' 未去除空格 '), '23514');
    await rejects(() => appendFormula('长'.repeat(501)), '22001');
    checks.push('direct SQL rejects invalid settlement text');
    await client.query('BEGIN');
    const latest = await appendFormula('客户结算金额=结案金额*70%');
    await client.query('COMMIT');
    const saved = (
      await client.query(
        'SELECT settlement_formula FROM customer_agreement_versions WHERE id=$1',
        [latest],
      )
    ).rows[0].settlement_formula;
    if (saved !== '客户结算金额=结案金额*70%')
      throw new Error('Recorded settlement text was not preserved');
    checks.push('new agreement records text without calculating');
    await rejects(
      () =>
        client.query(
          'UPDATE customer_agreement_versions SET settlement_formula=$1 WHERE id=$2',
          ['changed', latest],
        ),
      '23514',
    );
    checks.push('agreement history remains immutable');
    result = {
      checks,
      migrationCount: names.length,
      previousMigration: names.at(-2),
    };
  } catch (error) {
    primaryError = error;
  }
  const cleanupErrors = [];
  if (owned.size > 0) {
    try {
      await client.query('ROLLBACK');
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    for (const schema of [...owned])
      try {
        await dropSchema(schema);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
  }
  try {
    await client.end();
  } catch (cleanupError) {
    cleanupErrors.push(cleanupError);
  }
  if (primaryError && cleanupErrors.length > 0)
    throw new AggregateError(
      [primaryError, ...cleanupErrors],
      'Migration verification and owned-schema cleanup failed',
    );
  if (primaryError) throw primaryError;
  if (cleanupErrors.length > 0)
    throw new AggregateError(cleanupErrors, 'Owned-schema cleanup failed');
  return result;
}
