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
const customers = [
  coreLeadFixtures.draftCustomer,
  coreLeadFixtures.admittedCustomer,
  coreLeadFixtures.foreignCustomer,
  coreLeadFixtures.selfCustomer,
];
const holders = [
  coreLeadFixtures.holder,
  coreLeadFixtures.unlinkedHolder,
  coreLeadFixtures.foreignHolder,
  coreLeadFixtures.selfHolder,
];
const users = [
  coreLeadFixtures.userA,
  coreLeadFixtures.userB,
  coreLeadFixtures.userSelf,
];

async function withDatabase(operation) {
  const url = process.env.DATABASE_URL;
  if (process.env.NODE_ENV !== 'test' || !url)
    throw new Error('External-entry fixture requires isolated test database');
  const database = validateIsolatedTestDatabaseUrl(url);
  if (database.port !== 15433)
    throw new Error('External-entry fixture requires protected port 15433');
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

async function assertSyntheticCaseRows(client) {
  const hasExternalEntries = (
    await client.query(
      `SELECT to_regclass('public.case_external_entries') IS NOT NULL AS present`,
    )
  ).rows[0].present;
  const cases = (
    await client.query(
      `SELECT c.id,c.department_id,c.customer_id,c.rights_holder_id,
              c.responsible_user_id,c.source_lead_id,c.source_notary_matter_id,
              c.certificate_id AS case_certificate_id,
              l.id AS lead_id,m.id AS matter_id,
              cert.id AS linked_certificate_id,
              ${hasExternalEntries ? 'e.id' : 'NULL'} AS external_entry_id,
              ${hasExternalEntries ? 'e.source' : 'NULL'} AS source
       FROM cases c
       LEFT JOIN leads l ON l.id=c.source_lead_id
         AND l.department_id=c.department_id
       LEFT JOIN notary_matters m ON m.id=c.source_notary_matter_id
         AND m.department_id=c.department_id
       LEFT JOIN notary_certificates cert ON cert.id=c.certificate_id
         AND cert.department_id=c.department_id
       ${hasExternalEntries ? 'LEFT JOIN case_external_entries e ON e.case_id=c.id' : ''}`,
    )
  ).rows;
  for (const row of cases) {
    if (
      !departments.includes(row.department_id) ||
      !customers.includes(row.customer_id) ||
      !holders.includes(row.rights_holder_id) ||
      !users.includes(row.responsible_user_id)
    )
      throw new Error(
        'Refusing to clear a case outside fixed synthetic fixtures',
      );

    if (row.external_entry_id !== null) {
      if (
        !row.source?.startsWith('CA018 E2E:') ||
        row.source_lead_id !== null ||
        row.source_notary_matter_id !== null ||
        row.case_certificate_id !== null
      )
        throw new Error(
          'Refusing to clear an unrecognized external-entry source',
        );
      continue;
    }

    const validLead =
      row.source_lead_id !== null && row.lead_id === row.source_lead_id;
    const validMatter =
      row.source_notary_matter_id !== null &&
      row.matter_id === row.source_notary_matter_id;
    const validCertificate =
      row.case_certificate_id !== null &&
      row.linked_certificate_id === row.case_certificate_id;
    if (
      (row.source_lead_id !== null && !validLead) ||
      (row.source_notary_matter_id !== null && !validMatter) ||
      (row.case_certificate_id !== null && !validCertificate) ||
      (!validLead && !validMatter && !validCertificate)
    )
      throw new Error(
        'Refusing to clear a case without fixed synthetic provenance',
      );
  }

  const externalEntries = hasExternalEntries
    ? (
        await client.query(
          `SELECT e.case_id,e.department_id,e.source,c.id AS linked_case_id,
                  c.department_id AS case_department_id
           FROM case_external_entries e
           LEFT JOIN cases c ON c.id=e.case_id`,
        )
      ).rows
    : [];
  for (const entry of externalEntries) {
    if (
      entry.linked_case_id === null ||
      !departments.includes(entry.department_id) ||
      entry.case_department_id !== entry.department_id ||
      !entry.source?.startsWith('CA018 E2E:')
    )
      throw new Error('Refusing to clear an unrecognized external-entry row');
  }
  return cases.map((row) => row.id);
}

async function caseForeignKeyClosure(client) {
  const closure = (
    await client.query(
      `WITH RECURSIVE closure(table_oid) AS (
         SELECT 'public.cases'::regclass::oid
         UNION
         SELECT fk.conrelid
         FROM pg_constraint fk
         JOIN closure parent ON fk.confrelid=parent.table_oid
         JOIN pg_class child ON child.oid=fk.conrelid
         JOIN pg_namespace n ON n.oid=child.relnamespace
         WHERE fk.contype='f' AND n.nspname='public'
       )
       SELECT DISTINCT n.nspname,c.relname,c.relkind
       FROM closure x
       JOIN pg_class c ON c.oid=x.table_oid
       JOIN pg_namespace n ON n.oid=c.relnamespace
       ORDER BY n.nspname,c.relname`,
    )
  ).rows;
  if (
    closure.length === 0 ||
    closure.some(
      (row) =>
        row.nspname !== 'public' ||
        !['r', 'p'].includes(row.relkind) ||
        !(row.relname === 'cases' || /^case_[a-z0-9_]+$/u.test(row.relname)) ||
        /(customer|user|role|grant|credential|audit|auth)/u.test(row.relname),
    )
  )
    throw new Error(
      'Refusing to truncate a foreign-key closure outside case tables',
    );
  return closure.map((row) => `"${row.nspname}"."${row.relname}"`);
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
      const caseIds = await assertSyntheticCaseRows(client);
      if (caseIds.length > 0) {
        const tables = await caseForeignKeyClosure(client);
        await client.query(`TRUNCATE TABLE ${tables.join(', ')}`);
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
      ['secondAcceptanceChanges', 'case_second_instance_acceptance_changes'],
      ['executionSubmissions', 'case_execution_submissions'],
      ['submissionVersions', 'case_execution_submission_versions'],
      ['confirmations', 'case_execution_confirmations'],
      ['confirmationVersions', 'case_execution_confirmation_versions'],
      ['executionSubmissionReceipts', 'case_execution_submission_receipts'],
      ['executionConfirmationReceipts', 'case_execution_confirmation_receipts'],
      ['recordEditReceipts', 'case_record_edit_receipts'],
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

export async function assertCaseExternalEntrySqlGuards(caseId, otherEntryId) {
  return withDatabase(async (client) => {
    const target = (
      await client.query(
        `SELECT c.id,c.department_id,c.current_trial_round_id,
                e.id AS entry_id,e.audit_event_id,e.recorded_by_user_id
         FROM cases c JOIN case_external_entries e ON e.case_id=c.id
           AND e.department_id=c.department_id
         WHERE c.id=$1 AND c.department_id=ANY($2::uuid[])`,
        [caseId, departments],
      )
    ).rows[0];
    const other = (
      await client.query(
        `SELECT id,department_id FROM case_external_entries WHERE id=$1`,
        [otherEntryId],
      )
    ).rows[0];
    if (
      !target ||
      !other ||
      !departments.includes(target.department_id) ||
      target.department_id !== other.department_id ||
      target.entry_id === otherEntryId
    )
      throw new Error('SQL guard probes require two fixed synthetic entries');

    async function rejected(sql, values) {
      await client.query('BEGIN');
      let failure;
      try {
        await client.query(sql, values);
        await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      } catch (error) {
        failure = error;
      } finally {
        await client.query('ROLLBACK');
      }
      if (!failure)
        throw new Error(
          'Expected the external-entry SQL guard to reject write',
        );
      if (!/^23[0-9]{3}$/u.test(failure.code ?? '')) throw failure;
    }

    await rejected(
      `UPDATE case_external_entries SET initial_stage='WAITING_HEARING'
       WHERE id=$1`,
      [target.entry_id],
    );
    await rejected(`UPDATE cases SET stage='WAITING_ARCHIVE' WHERE id=$1`, [
      caseId,
    ]);
    await rejected(
      `UPDATE case_second_instance_acceptance_changes SET external_entry_id=$2
       WHERE case_id=$1`,
      [caseId, otherEntryId],
    );
    await rejected(
      `UPDATE case_second_instance_acceptance_changes SET department_id=$2
       WHERE case_id=$1`,
      [caseId, departments.find((id) => id !== target.department_id)],
    );
    await rejected(
      `UPDATE case_second_instance_acceptance_changes SET choice_id=gen_random_uuid()
       WHERE case_id=$1 AND choice_id IS NULL`,
      [caseId],
    );
    await rejected(
      `DELETE FROM case_external_entry_receipts WHERE case_id=$1`,
      [caseId],
    );
    await rejected(`DELETE FROM audit_events WHERE id=$1`, [
      target.audit_event_id,
    ]);
    await rejected(
      `INSERT INTO case_second_instance_acceptance_changes
         (id,case_id,department_id,trial_round_id,choice_id,external_entry_id,
          prior_change_id,from_revision,to_revision,accepted_at,court_case_no,
          reason,recorded_at,recorded_by_user_id,audit_event_id)
       VALUES (gen_random_uuid(),$1,$2,$3,NULL,$4,NULL,90,91,NULL,
          'CA018 SQL probe','missing audit must rollback',now(),$5,gen_random_uuid())`,
      [
        caseId,
        target.department_id,
        target.current_trial_round_id,
        target.entry_id,
        target.recorded_by_user_id,
      ],
    );
  });
}
