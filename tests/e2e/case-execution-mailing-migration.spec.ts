import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const root = process.cwd();
const backend = createRequire(resolve(root, 'backend/package.json'));
const { Client } = backend('pg');
const { validateIsolatedTestDatabaseUrl } = backend(
  '../scripts/test-environment.mjs',
) as {
  validateIsolatedTestDatabaseUrl: (
    url: string | undefined,
    options: { allowRandomPort: boolean },
  ) => void;
};
const migrations = resolve(root, 'backend/prisma/migrations');
const names = readdirSync(migrations)
  .filter((name) => /^\d{14}_/u.test(name))
  .sort();
const suffix = [
  '20261012030000_add_execution_mailing_filing_enums',
  '20261012031000_guard_execution_mailing_filing',
];
const sql = (name: string) =>
  readFileSync(resolve(migrations, name, 'migration.sql'), 'utf8');
async function replay(client: InstanceType<typeof Client>, selected: string[]) {
  for (const name of selected) {
    try {
      await client.query(sql(name));
    } catch (error) {
      throw new Error(`Migration ${name}: ${String(error)}`, { cause: error });
    }
  }
}
async function sqlCode(
  client: InstanceType<typeof Client>,
  statement: string,
  values: unknown[] = [],
) {
  await client.query('BEGIN');
  try {
    await client.query(statement, values);
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? null;
  } finally {
    await client.query('ROLLBACK');
  }
}
test('CA-013/014 migrates empty and legacy schemas, rejects direct SQL bypass, and retries atomically', async () => {
  if (process.env.NODE_ENV !== 'test')
    throw new Error('Isolated test database required');
  validateIsolatedTestDatabaseUrl(process.env.DATABASE_URL, {
    allowRandomPort: true,
  });
  expect(names.slice(136, 138)).toEqual(suffix);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  const prefix = `ca013_migration_${randomUUID().replaceAll('-', '')}`;
  const schemas = ['empty', 'upgrade', 'retry'].map(
    (part) => `${prefix}_${part}`,
  );
  const use = (schema: string) =>
    client.query(`SET search_path TO "${schema}"`);
  const count = async (statement: string, values: unknown[] = []) =>
    Number((await client.query(statement, values)).rows[0].n);
  try {
    await client.connect();
    const location = (
      await client.query(
        'SELECT current_database() AS db,current_schema() AS schema',
      )
    ).rows[0];
    if (location.db !== 'dev_cor_test' || location.schema !== 'public')
      throw new Error('CA013 migration requires isolated public test database');
    for (const schema of schemas)
      await client.query(`CREATE SCHEMA "${schema}"`);

    await use(schemas[0]);
    await replay(client, names);
    expect(
      await count(
        `SELECT count(*) AS n FROM information_schema.tables
      WHERE table_schema=$1 AND table_name IN ('case_execution_mailings',
      'case_execution_mailing_versions','case_execution_mailing_receipts',
      'case_execution_filings','case_execution_filing_versions',
      'case_execution_filing_receipts')`,
        [schemas[0]],
      ),
    ).toBe(6);
    expect(
      await count(`SELECT count(*) AS n FROM pg_trigger WHERE tgrelid IN
      ('case_execution_mailings'::regclass,'case_execution_filings'::regclass)
      AND NOT tgisinternal`),
    ).toBeGreaterThanOrEqual(4);

    await use(schemas[1]);
    await replay(client, names.slice(0, 136));
    const ids = {
      department: randomUUID(),
      actor: randomUUID(),
      customer: randomUUID(),
      holder: randomUUID(),
      case: randomUUID(),
      role: randomUUID(),
    };
    await client.query('BEGIN');
    try {
      await client.query('SET LOCAL session_replication_role = replica');
      await client.query(
        'INSERT INTO departments(id,name,updated_at) VALUES ($1,$2,now())',
        [ids.department, 'CA013 legacy synthetic department'],
      );
      await client.query(
        `INSERT INTO user_accounts(id,external_subject,display_name,updated_at)
        VALUES ($1,$2,'CA013 legacy actor',now())`,
        [ids.actor, `ca013-${ids.actor}`],
      );
      await client.query(
        `INSERT INTO department_memberships(id,user_id,department_id,updated_at)
        VALUES ($1,$2,$3,now())`,
        [randomUUID(), ids.actor, ids.department],
      );
      await client.query(
        `INSERT INTO customers(id,name,normalized_name,department_id,responsible_user_id,updated_at)
        VALUES ($1,'CA013 legacy customer',$2,$3,$4,now())`,
        [ids.customer, `ca013-${ids.customer}`, ids.department, ids.actor],
      );
      await client.query(
        `INSERT INTO rights_holders(id,name,department_id,updated_at)
        VALUES ($1,'CA013 legacy holder',$2,now())`,
        [ids.holder, ids.department],
      );
      await client.query(
        `INSERT INTO cases(id,business_no,department_id,source_lead_id,
        source_notary_matter_id,certificate_id,customer_id,rights_holder_id,
        responsible_user_id,stage,version)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDING_MATCH',1)`,
        [
          ids.case,
          `CA013-${ids.case}`,
          ids.department,
          randomUUID(),
          randomUUID(),
          randomUUID(),
          ids.customer,
          ids.holder,
          ids.actor,
        ],
      );
      await client.query(
        `INSERT INTO role_templates(id,department_id,name,updated_at)
        VALUES ($1,$2,'CA013 legacy role',now())`,
        [ids.role, ids.department],
      );
      await client.query(
        `INSERT INTO role_grants(id,role_template_id,action,scope)
        VALUES ($1,$2,'case.execution.confirm','TEAM')`,
        [randomUUID(), ids.role],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    const roleBefore = (
      await client.query(`SELECT version FROM role_templates WHERE id=$1`, [
        ids.role,
      ])
    ).rows[0].version;
    await replay(client, suffix);
    const roleAfter = (
      await client.query(
        `SELECT action,scope FROM role_grants
      WHERE role_template_id=$1 AND action IN ('case.execution.mail',
      'case.execution.filing.submit') ORDER BY action::text`,
        [ids.role],
      )
    ).rows;
    expect(roleAfter).toEqual([
      { action: 'case.execution.filing.submit', scope: 'TEAM' },
      { action: 'case.execution.mail', scope: 'TEAM' },
    ]);
    expect(
      (
        await client.query('SELECT version FROM role_templates WHERE id=$1', [
          ids.role,
        ])
      ).rows[0].version,
    ).toBe(roleBefore + 1);
    expect(
      (
        await client.query('SELECT stage,version FROM cases WHERE id=$1', [
          ids.case,
        ])
      ).rows[0],
    ).toEqual({ stage: 'PENDING_MATCH', version: 1 });
    expect(
      await sqlCode(
        client,
        `UPDATE cases SET stage='WAITING_EXECUTION_FILING',
      version=2,matched_at=now() WHERE id=$1`,
        [ids.case],
      ),
    ).toBe('23514');
    expect(
      await sqlCode(
        client,
        `INSERT INTO case_execution_mailings(id,case_id,
      department_id,confirmation_id,from_version,to_version,mailed_at,
      recorded_by_user_id,actor_type,audit_event_id)
      VALUES ($1,$2,$3,$4,1,2,CURRENT_DATE,$5,'INTERNAL',$6)`,
        [
          randomUUID(),
          ids.case,
          ids.department,
          randomUUID(),
          ids.actor,
          randomUUID(),
        ],
      ),
    ).toBe('23503');

    await use(schemas[2]);
    await replay(client, names.slice(0, 136));
    await replay(client, suffix.slice(0, 1));
    const original = (
      await client.query(`SELECT pg_get_functiondef(p.oid) AS definition
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname=current_schema() AND p.proname='check_case_judgment_final' AND p.pronargs=0`)
    ).rows[0].definition as string;
    const needle = "expected_stage := 'WAITING_EXECUTION_STAMP';";
    expect(original).toContain(needle);
    await client.query(
      original.replace(needle, "expected_stage := 'CA013_UNKNOWN_STAGE';"),
    );
    let failure: string | null = null;
    try {
      await client.query(sql(suffix[1]));
    } catch (error) {
      failure = (error as { code?: string }).code ?? null;
      await client.query('ROLLBACK');
    }
    expect(failure).toBe('23514');
    expect(
      await count(
        `SELECT count(*) AS n FROM information_schema.tables
      WHERE table_schema=$1 AND table_name IN ('case_execution_mailings','case_execution_filings')`,
        [schemas[2]],
      ),
    ).toBe(0);
    await client.query(original);
    await replay(client, suffix.slice(1));
    expect(
      await count(
        `SELECT count(*) AS n FROM information_schema.tables
      WHERE table_schema=$1 AND table_name IN ('case_execution_mailings','case_execution_filings')`,
        [schemas[2]],
      ),
    ).toBe(2);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.query('SET search_path TO public').catch(() => undefined);
    for (const schema of schemas)
      await client
        .query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        .catch(() => undefined);
    await client.end().catch(() => undefined);
  }
});
