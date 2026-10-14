import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { coreLeadFixtures } from './core-lead-database.mjs';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';

const backendRequire = createRequire(
  resolve(process.cwd(), 'backend/package.json'),
);
const { Client } = backendRequire('pg');
const departments = [
  coreLeadFixtures.departmentA,
  coreLeadFixtures.departmentB,
];
const roles = [
  coreLeadFixtures.roleA,
  coreLeadFixtures.roleB,
  coreLeadFixtures.roleSelf,
];

async function withDatabase(operation) {
  const url = process.env.DATABASE_URL;
  if (process.env.NODE_ENV !== 'test' || !url)
    throw new Error('External-entry fixture requires isolated test database');
  validateIsolatedTestDatabaseUrl(url);
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const identity = (
      await client.query(
        'SELECT current_database() AS db,current_schema() AS schema',
      )
    ).rows[0];
    if (identity.db !== 'dev_cor_test' || identity.schema !== 'public')
      throw new Error('Unexpected external-entry fixture database');
    return await operation(client);
  } finally {
    await client.end();
  }
}

export async function setCaseExternalEntryGrant(
  roleId,
  action,
  scope,
  enabled,
) {
  const allowed = new Map([
    ['case.external-entry.create', ['SELF', 'TEAM', 'DEPARTMENT']],
    ['case.external-entry.archive', ['DEPARTMENT']],
  ]);
  if (!roles.includes(roleId) || !allowed.get(action)?.includes(scope))
    throw new Error('Grant is outside synthetic external-entry fixture');
  await withDatabase(async (client) => {
    const role = (
      await client.query(
        'SELECT id FROM role_templates WHERE id=$1 AND department_id=ANY($2::uuid[])',
        [roleId, departments],
      )
    ).rows;
    if (role.length !== 1) throw new Error('Synthetic role missing');
    if (enabled) {
      await client.query(
        'INSERT INTO role_grants(id,role_template_id,action,scope) VALUES(gen_random_uuid(),$1,$2::permission_action,$3::permission_scope) ON CONFLICT DO NOTHING',
        [roleId, action, scope],
      );
    } else {
      await client.query(
        'DELETE FROM role_grants WHERE role_template_id=$1 AND action=$2::permission_action AND scope=$3::permission_scope',
        [roleId, action, scope],
      );
    }
  });
}

export async function clearCaseExternalEntryFixture() {
  await withDatabase(async (client) => {
    await client.query('BEGIN');
    try {
      const caseIds = (
        await client.query(
          `SELECT id FROM cases
           WHERE department_id=ANY($1::uuid[])
             AND id IN (SELECT case_id FROM case_external_entries WHERE source LIKE 'CA018 E2E:%')`,
          [departments],
        )
      ).rows.map((row) => row.id);
      if (caseIds.length) {
        const auditIds = (
          await client.query(
            'SELECT audit_event_id FROM case_external_entries WHERE case_id=ANY($1::uuid[])',
            [caseIds],
          )
        ).rows.map((row) => row.audit_event_id);
        await client.query(
          'ALTER TABLE case_external_entry_receipts DISABLE TRIGGER USER',
        );
        await client.query(
          'ALTER TABLE case_external_entries DISABLE TRIGGER USER',
        );
        await client.query('ALTER TABLE audit_events DISABLE TRIGGER USER');
        await client.query(
          'DELETE FROM case_external_entry_receipts WHERE case_id=ANY($1::uuid[])',
          [caseIds],
        );
        await client.query(
          'DELETE FROM case_external_entries WHERE case_id=ANY($1::uuid[])',
          [caseIds],
        );
        if (auditIds.length)
          await client.query(
            'DELETE FROM audit_events WHERE id=ANY($1::uuid[])',
            [auditIds],
          );
        await client.query('ALTER TABLE audit_events ENABLE TRIGGER USER');
        await client.query(
          'ALTER TABLE case_external_entries ENABLE TRIGGER USER',
        );
        await client.query(
          'ALTER TABLE case_external_entry_receipts ENABLE TRIGGER USER',
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function caseExternalEntrySnapshot(caseId) {
  return withDatabase(async (client) => {
    const ownership = (
      await client.query(
        'SELECT id FROM cases WHERE id=$1 AND department_id=ANY($2::uuid[])',
        [caseId, departments],
      )
    ).rows;
    if (ownership.length !== 1)
      throw new Error('Case outside synthetic fixtures');
    const result = {};
    for (const [name, table] of [
      ['case', 'cases'],
      ['entries', 'case_external_entries'],
      ['receipts', 'case_external_entry_receipts'],
      ['finishFacts', 'case_execution_finishes'],
      ['finishVersions', 'case_execution_finish_versions'],
      ['finishReceipts', 'case_execution_finish_receipts'],
      ['closureFacts', 'case_closures'],
      ['closureVersions', 'case_closure_versions'],
      ['closureDocuments', 'case_closure_documents'],
      ['closureReceipts', 'case_closure_receipts'],
      ['archiveFacts', 'case_archives'],
      ['archiveVersions', 'case_archive_versions'],
      ['archiveReceipts', 'case_archive_receipts'],
    ]) {
      result[name] = (
        await client.query(
          `SELECT to_jsonb(t) AS row FROM "${table}" t WHERE ${name === 'case' ? 'id' : 'case_id'}=$1 ORDER BY to_jsonb(t)::text`,
          [caseId],
        )
      ).rows.map((row) => row.row);
    }
    return result;
  });
}
