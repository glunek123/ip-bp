import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';
import { coreLeadFixtures } from './core-lead-database.mjs';

const requireBackend = createRequire(resolve(process.cwd(), 'backend/package.json'));
const { Client } = requireBackend('pg');
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || process.env.NODE_ENV !== 'test') throw new Error('Isolated test database required');
validateIsolatedTestDatabaseUrl(databaseUrl, { allowRandomPort: true });

async function withClient(operation) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const database = (await client.query('SELECT current_database() AS name')).rows[0].name;
    if (database !== 'dev_cor_test') throw new Error('Unexpected database');
    return await operation(client);
  } finally { await client.end(); }
}

const faultTargets = {
  audit: { table: 'audit_events', condition: "NEW.action = 'case.complaint.mailed'" },
  fact: { table: 'case_complaint_mailings', condition: 'true' },
  freeze: { table: 'material_references', condition: "NEW.purpose = 'MAIL_RECEIPT'" },
  receipt: { table: 'case_complaint_mailing_receipts', condition: 'true' },
};

export async function clearCaseComplaintMailingFault() {
  await withClient(async (client) => {
    for (const target of Object.values(faultTargets))
      await client.query(`DROP TRIGGER IF EXISTS ca004_reject_mail_write ON "${target.table}"`);
    await client.query('DROP FUNCTION IF EXISTS ca004_reject_mail_write()');
  });
}

export async function rejectCaseComplaintMailingWrite(kind) {
  const target = faultTargets[kind];
  if (!target) throw new Error('Unknown fault kind');
  await clearCaseComplaintMailingFault();
  await withClient(async (client) => {
    await client.query(`CREATE FUNCTION ca004_reject_mail_write() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'injected mailing failure' USING ERRCODE = 'P0001'; END;
      $$ LANGUAGE plpgsql`);
    await client.query(`CREATE TRIGGER ca004_reject_mail_write BEFORE INSERT ON "${target.table}"
      FOR EACH ROW WHEN (${target.condition}) EXECUTE FUNCTION ca004_reject_mail_write()`);
  });
}

export async function prepareCaseComplaintMailingFixture() {
  await clearCaseComplaintMailingFault();
  await withClient(async (client) => {
    await client.query(`INSERT INTO role_grants(id,role_template_id,action,scope)
      VALUES ($1,$2,'case.complaint.mail','TEAM')
      ON CONFLICT (role_template_id,action,scope) DO NOTHING`, [randomUUID(), coreLeadFixtures.roleA]);
  });
}

export async function allowOtherEnterpriseAccountSetup() {
  await withClient((client) => client.query(`INSERT INTO role_grants(id,role_template_id,action,scope)
    VALUES ($1,$2,'customer.read','DEPARTMENT')
    ON CONFLICT (role_template_id,action,scope) DO NOTHING`,
  [randomUUID(), coreLeadFixtures.roleA]));
}

export async function revokeCaseComplaintMailGrant() {
  await withClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(`DELETE FROM role_grants WHERE role_template_id=$1
        AND action='case.complaint.mail' AND scope='TEAM'`, [coreLeadFixtures.roleA]);
      await client.query(`UPDATE user_accounts SET authorization_revision=authorization_revision+1
        WHERE id IN (SELECT user_id FROM role_assignments
          WHERE role_template_id=$1 AND active=true)`, [coreLeadFixtures.roleA]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  });
}

export async function clearCaseComplaintMailingFixture() {
  await clearCaseComplaintMailingFault();
  await withClient(async (client) => {
    await client.query('BEGIN');
    try {
      for (const table of ['case_complaint_mailing_receipts', 'case_complaint_mailing_versions', 'case_complaint_mailings'])
        await client.query(`ALTER TABLE "${table}" DISABLE TRIGGER USER`);
      const departments = [coreLeadFixtures.departmentA, coreLeadFixtures.departmentB];
      await client.query('DELETE FROM case_complaint_mailing_receipts WHERE department_id = ANY($1::uuid[])', [departments]);
      await client.query('DELETE FROM case_complaint_mailing_versions WHERE department_id = ANY($1::uuid[])', [departments]);
      await client.query('DELETE FROM case_complaint_mailings WHERE department_id = ANY($1::uuid[])', [departments]);
      for (const table of ['case_complaint_mailing_receipts', 'case_complaint_mailing_versions', 'case_complaint_mailings'])
        await client.query(`ALTER TABLE "${table}" ENABLE TRIGGER USER`);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  });
}

export async function countCaseComplaintMailingEffects(caseId) {
  return withClient(async (client) => {
    const query = async (sql) => Number((await client.query(sql, [caseId])).rows[0].n);
    const state = (await client.query('SELECT stage,version FROM cases WHERE id=$1', [caseId])).rows[0];
    return { stage: state.stage, version: state.version,
      facts: await query('SELECT COUNT(*) AS n FROM case_complaint_mailings WHERE case_id=$1'),
      versions: await query('SELECT COUNT(*) AS n FROM case_complaint_mailing_versions WHERE case_id=$1'),
      references: await query("SELECT COUNT(*) AS n FROM material_references WHERE resource_type='case' AND resource_id=$1 AND purpose='MAIL_RECEIPT'"),
      receipts: await query('SELECT COUNT(*) AS n FROM case_complaint_mailing_receipts WHERE case_id=$1'),
      audits: await query("SELECT COUNT(*) AS n FROM audit_events WHERE resource_type='CASE' AND resource_id=$1 AND action='case.complaint.mailed'") };
  });
}

export async function expireRevokedClientDraft(draftId) {
  return withClient(async (client) => {
    await client.query("UPDATE upload_drafts SET status='EXPIRED' WHERE id=$1", [draftId]);
    return (await client.query('SELECT status FROM upload_drafts WHERE id=$1', [draftId])).rows[0]?.status;
  });
}
