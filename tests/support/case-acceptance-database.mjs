import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';
import { coreLeadFixtures } from './core-lead-database.mjs';

const requireBackend = createRequire(
  resolve(process.cwd(), 'backend/package.json'),
);
const { Client } = requireBackend('pg');
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || process.env.NODE_ENV !== 'test')
  throw new Error('Isolated test database required');
validateIsolatedTestDatabaseUrl(databaseUrl, { allowRandomPort: true });

async function withClient(operation) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    if (
      (await client.query('SELECT current_database() AS name')).rows[0].name !==
      'dev_cor_test'
    )
      throw new Error('Unexpected database');
    return await operation(client);
  } finally {
    await client.end();
  }
}

const faultTargets = {
  audit: {
    table: 'audit_events',
    condition: "NEW.action = 'case.acceptance.registered'",
  },
  fact: { table: 'case_acceptances', condition: 'true' },
  freeze: {
    table: 'material_references',
    condition: "NEW.purpose = 'ACCEPTANCE_NOTICE'",
  },
  receipt: { table: 'case_acceptance_receipts', condition: 'true' },
};
export async function clearCaseAcceptanceFault() {
  await withClient(async (client) => {
    for (const target of Object.values(faultTargets))
      await client.query(
        `DROP TRIGGER IF EXISTS ca006_reject_write ON "${target.table}"`,
      );
    await client.query('DROP FUNCTION IF EXISTS ca006_reject_write()');
  });
}
export async function rejectCaseAcceptanceWrite(kind) {
  const target = faultTargets[kind];
  if (!target) throw new Error('Unknown fault kind');
  await clearCaseAcceptanceFault();
  await withClient(async (client) => {
    await client.query(
      "CREATE FUNCTION ca006_reject_write() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected acceptance failure' USING ERRCODE='P0001'; END; $$ LANGUAGE plpgsql",
    );
    await client.query(
      `CREATE TRIGGER ca006_reject_write BEFORE INSERT ON "${target.table}" FOR EACH ROW WHEN (${target.condition}) EXECUTE FUNCTION ca006_reject_write()`,
    );
  });
}
export async function prepareCaseAcceptanceFixture() {
  await clearCaseAcceptanceFault();
  await withClient(async (client) => {
    await client.query(
      "INSERT INTO role_grants(id,role_template_id,action,scope) VALUES ($1,$2,'case.acceptance.register','TEAM') ON CONFLICT (role_template_id,action,scope) DO NOTHING",
      [randomUUID(), coreLeadFixtures.roleA],
    );
  });
}
export async function revokeCaseAcceptanceGrant() {
  await withClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(
        "DELETE FROM role_grants WHERE role_template_id=$1 AND action='case.acceptance.register' AND scope='TEAM'",
        [coreLeadFixtures.roleA],
      );
      await client.query(
        'UPDATE user_accounts SET authorization_revision=authorization_revision+1 WHERE id IN (SELECT user_id FROM role_assignments WHERE role_template_id=$1 AND active=true)',
        [coreLeadFixtures.roleA],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}
export async function clearCaseAcceptanceFixture() {
  await clearCaseAcceptanceFault();
  await withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const tables = [
        'case_acceptance_receipts',
        'case_acceptance_versions',
        'case_acceptances',
      ];
      for (const table of tables)
        await client.query(`ALTER TABLE "${table}" DISABLE TRIGGER USER`);
      for (const table of tables)
        await client.query(
          `DELETE FROM "${table}" WHERE department_id = ANY($1::uuid[])`,
          [[coreLeadFixtures.departmentA, coreLeadFixtures.departmentB]],
        );
      for (const table of tables)
        await client.query(`ALTER TABLE "${table}" ENABLE TRIGGER USER`);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}
export async function countCaseAcceptanceEffects(caseId) {
  return withClient(async (client) => {
    const count = async (sql) =>
      Number((await client.query(sql, [caseId])).rows[0].n);
    const state = (
      await client.query(
        'SELECT stage,version,court_case_no FROM cases WHERE id=$1',
        [caseId],
      )
    ).rows[0];
    return {
      stage: state.stage,
      version: state.version,
      courtCaseNo: state.court_case_no,
      facts: await count(
        'SELECT COUNT(*) AS n FROM case_acceptances WHERE case_id=$1',
      ),
      versions: await count(
        'SELECT COUNT(*) AS n FROM case_acceptance_versions WHERE case_id=$1',
      ),
      references: await count(
        "SELECT COUNT(*) AS n FROM material_references WHERE resource_type='case' AND resource_id=$1 AND purpose IN ('ACCEPTANCE_NOTICE','PAYMENT_LIST','SERVICE_DOCUMENT')",
      ),
      receipts: await count(
        'SELECT COUNT(*) AS n FROM case_acceptance_receipts WHERE case_id=$1',
      ),
      audits: await count(
        "SELECT COUNT(*) AS n FROM audit_events WHERE resource_type='CASE' AND resource_id=$1 AND action='case.acceptance.registered'",
      ),
    };
  });
}
