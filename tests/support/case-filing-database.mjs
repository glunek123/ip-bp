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
    condition: "NEW.action = 'case.filing.submitted'",
  },
  fact: { table: 'case_filing_submissions', condition: 'true' },
  freeze: {
    table: 'material_references',
    condition: "NEW.purpose = 'FILING_EVIDENCE'",
  },
  receipt: { table: 'case_filing_receipts', condition: 'true' },
};

export async function clearCaseFilingFault() {
  await withClient(async (client) => {
    for (const target of Object.values(faultTargets))
      await client.query(
        `DROP TRIGGER IF EXISTS ca005_reject_filing_write ON "${target.table}"`,
      );
    await client.query('DROP FUNCTION IF EXISTS ca005_reject_filing_write()');
  });
}

export async function rejectCaseFilingWrite(kind) {
  const target = faultTargets[kind];
  if (!target) throw new Error('Unknown fault kind');
  await clearCaseFilingFault();
  await withClient(async (client) => {
    await client.query(
      "CREATE FUNCTION ca005_reject_filing_write() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected filing failure' USING ERRCODE = 'P0001'; END; $$ LANGUAGE plpgsql",
    );
    await client.query(
      `CREATE TRIGGER ca005_reject_filing_write BEFORE INSERT ON "${target.table}" FOR EACH ROW WHEN (${target.condition}) EXECUTE FUNCTION ca005_reject_filing_write()`,
    );
  });
}

export async function prepareCaseFilingFixture() {
  await clearCaseFilingFault();
  await withClient(async (client) => {
    for (const action of ['case.complaint.mail', 'case.filing.submit'])
      await client.query(
        "INSERT INTO role_grants(id,role_template_id,action,scope) VALUES ($1,$2,$3,'TEAM') ON CONFLICT (role_template_id,action,scope) DO NOTHING",
        [randomUUID(), coreLeadFixtures.roleA, action],
      );
  });
}

export async function revokeCaseFilingGrant() {
  await withClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(
        "DELETE FROM role_grants WHERE role_template_id=$1 AND action='case.filing.submit' AND scope='TEAM'",
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

export async function clearCaseFilingFixture() {
  await clearCaseFilingFault();
  await withClient(async (client) => {
    await client.query('BEGIN');
    try {
      for (const table of [
        'case_filing_receipts',
        'case_filing_versions',
        'case_filing_submissions',
      ])
        await client.query(`ALTER TABLE "${table}" DISABLE TRIGGER USER`);
      const departments = [
        coreLeadFixtures.departmentA,
        coreLeadFixtures.departmentB,
      ];
      for (const table of [
        'case_filing_receipts',
        'case_filing_versions',
        'case_filing_submissions',
        'filing_courts',
      ])
        await client.query(
          `DELETE FROM "${table}" WHERE department_id = ANY($1::uuid[])`,
          [departments],
        );
      for (const table of [
        'case_filing_receipts',
        'case_filing_versions',
        'case_filing_submissions',
      ])
        await client.query(`ALTER TABLE "${table}" ENABLE TRIGGER USER`);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function countCaseFilingEffects(caseId) {
  return withClient(async (client) => {
    const count = async (sql) =>
      Number((await client.query(sql, [caseId])).rows[0].n);
    const state = (
      await client.query('SELECT stage,version FROM cases WHERE id=$1', [
        caseId,
      ])
    ).rows[0];
    return {
      stage: state.stage,
      version: state.version,
      facts: await count(
        'SELECT COUNT(*) AS n FROM case_filing_submissions WHERE case_id=$1',
      ),
      versions: await count(
        'SELECT COUNT(*) AS n FROM case_filing_versions WHERE case_id=$1',
      ),
      references: await count(
        "SELECT COUNT(*) AS n FROM material_references WHERE resource_type='case' AND resource_id=$1 AND purpose IN ('FILING_EVIDENCE','FILING_SCREENSHOT')",
      ),
      receipts: await count(
        'SELECT COUNT(*) AS n FROM case_filing_receipts WHERE case_id=$1',
      ),
      audits: await count(
        "SELECT COUNT(*) AS n FROM audit_events WHERE resource_type='CASE' AND resource_id=$1 AND action='case.filing.submitted'",
      ),
    };
  });
}
