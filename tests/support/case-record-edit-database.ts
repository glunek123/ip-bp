import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { coreLeadFixtures } from './core-lead-database.mjs';

type QueryRow = Record<string, unknown>;
type DbClient = {
  connect(): Promise<void>;
  end(): Promise<void>;
  query(sql: string, parameters?: unknown[]): Promise<{ rows: QueryRow[] }>;
};
const backendRequire = createRequire(
  resolve(process.cwd(), 'backend/package.json'),
);
const testEnvironmentRequire = createRequire(
  resolve(process.cwd(), 'package.json'),
);
const testEnvironment = testEnvironmentRequire(
  './scripts/test-environment.mjs',
) as {
  validateIsolatedTestDatabaseUrl(value: string): unknown;
};
const PgClient = backendRequire('pg').Client as new (options: {
  connectionString: string;
}) => DbClient;
const departments = [
  coreLeadFixtures.departmentA,
  coreLeadFixtures.departmentB,
];
const roles = [
  coreLeadFixtures.roleA,
  coreLeadFixtures.roleB,
  coreLeadFixtures.roleSelf,
];
const actions = [
  'case.defendant-contact.update',
  'case.acceptance.correct',
] as const;
type Action = (typeof actions)[number];

export async function withRecordEditDatabase<T>(
  operation: (client: DbClient) => Promise<T>,
): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (process.env.NODE_ENV !== 'test' || !url)
    throw new Error('Record-edit fixture requires isolated test database');
  testEnvironment.validateIsolatedTestDatabaseUrl(url);
  const client = new PgClient({ connectionString: url });
  await client.connect();
  try {
    const identity = (
      await client.query(
        'SELECT current_database() AS db,current_schema() AS schema',
      )
    ).rows[0];
    if (identity.db !== 'dev_cor_test' || identity.schema !== 'public')
      throw new Error('Unexpected record-edit fixture database');
    return await operation(client);
  } finally {
    await client.end();
  }
}

export async function setRecordEditGrant(
  roleId: string,
  action: Action,
  scope: 'SELF' | 'TEAM' | 'DEPARTMENT',
  enabled: boolean,
): Promise<void> {
  if (!roles.includes(roleId) || !actions.includes(action))
    throw new Error('Record-edit grant outside synthetic fixtures');
  await withRecordEditDatabase(async (client) => {
    const role = (
      await client.query(
        'SELECT id FROM role_templates WHERE id=$1 AND department_id=ANY($2::uuid[])',
        [roleId, departments],
      )
    ).rows;
    if (role.length !== 1) throw new Error('Synthetic role missing');
    await client.query('BEGIN');
    try {
      if (enabled)
        await client.query(
          'INSERT INTO role_grants(id,role_template_id,action,scope) VALUES($1,$2,$3::permission_action,$4::permission_scope) ON CONFLICT DO NOTHING',
          [randomUUID(), roleId, action, scope],
        );
      else
        await client.query(
          'DELETE FROM role_grants WHERE role_template_id=$1 AND action=$2::permission_action AND scope=$3::permission_scope',
          [roleId, action, scope],
        );
      await client.query(
        'UPDATE user_accounts SET authorization_revision=authorization_revision+1 WHERE id IN (SELECT user_id FROM role_assignments WHERE role_template_id=$1 AND active=true)',
        [roleId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function grantRecordEditPredecessorActions(): Promise<void> {
  const actions = [
    'case.hearing.schedule',
    'case.judgment.register',
    'case.judgment.next_step',
    'case.second_instance.result',
    'case.second_instance.result.revoke',
  ];
  await withRecordEditDatabase(async (client) => {
    for (const action of actions)
      await client.query(
        'INSERT INTO role_grants(id,role_template_id,action,scope) VALUES($1,$2,$3::permission_action,$4::permission_scope) ON CONFLICT DO NOTHING',
        [randomUUID(), coreLeadFixtures.roleA, action, 'TEAM'],
      );
    await client.query(
      'UPDATE user_accounts SET authorization_revision=authorization_revision+1 WHERE id=$1',
      [coreLeadFixtures.userA],
    );
  });
}

export async function clearRecordEditFixture(): Promise<void> {
  await clearRecordEditFault();
  await withRecordEditDatabase(async (client) => {
    await client.query('BEGIN');
    try {
      const tables = [
        'case_record_edit_receipts',
        'case_defendant_contact_changes',
        'case_acceptance_corrections',
      ];
      const auditIds = (
        await client.query(
          `SELECT audit_event_id FROM case_defendant_contact_changes WHERE department_id=ANY($1::uuid[])
           UNION SELECT audit_event_id FROM case_acceptance_corrections WHERE department_id=ANY($1::uuid[])`,
          [departments],
        )
      ).rows.map((row) => row.audit_event_id);
      for (const table of tables)
        await client.query(`ALTER TABLE "${table}" DISABLE TRIGGER USER`);
      for (const table of tables)
        await client.query(
          `DELETE FROM "${table}" WHERE department_id=ANY($1::uuid[])`,
          [departments],
        );
      await client.query('ALTER TABLE audit_events DISABLE TRIGGER USER');
      if (auditIds.length)
        await client.query(
          'DELETE FROM audit_events WHERE id=ANY($1::uuid[])',
          [auditIds],
        );
      await client.query('ALTER TABLE audit_events ENABLE TRIGGER USER');
      for (const table of tables)
        await client.query(`ALTER TABLE "${table}" ENABLE TRIGGER USER`);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function recordEditSnapshot(caseId: string) {
  return withRecordEditDatabase(async (client) => {
    const owned = (
      await client.query(
        'SELECT id FROM cases WHERE id=$1 AND department_id=ANY($2::uuid[])',
        [caseId, departments],
      )
    ).rows;
    if (owned.length !== 1) throw new Error('Case outside synthetic fixtures');
    const rows = async (sql: string) =>
      (await client.query(sql, [caseId])).rows.map((row) => row.row);
    return {
      case: await rows('SELECT to_jsonb(t) AS row FROM cases t WHERE id=$1'),
      defendants: await rows(
        'SELECT to_jsonb(t) AS row FROM case_defendants t WHERE case_id=$1 ORDER BY id',
      ),
      originalAcceptances: await rows(
        'SELECT to_jsonb(t) AS row FROM case_acceptances t WHERE case_id=$1 ORDER BY id',
      ),
      contactChanges: await rows(
        'SELECT to_jsonb(t) AS row FROM case_defendant_contact_changes t WHERE case_id=$1 ORDER BY recorded_at,id',
      ),
      acceptanceCorrections: await rows(
        'SELECT to_jsonb(t) AS row FROM case_acceptance_corrections t WHERE case_id=$1 ORDER BY recorded_at,id',
      ),
      recordEditReceipts: await rows(
        'SELECT to_jsonb(t) AS row FROM case_record_edit_receipts t WHERE case_id=$1 ORDER BY id',
      ),
      matchingReceipts: await rows(
        'SELECT to_jsonb(t) AS row FROM case_match_receipts t WHERE case_id=$1 ORDER BY id',
      ),
      acceptanceReceipts: await rows(
        'SELECT to_jsonb(t) AS row FROM case_acceptance_receipts t WHERE case_id=$1 ORDER BY id',
      ),
      archiveVersions: await rows(
        'SELECT to_jsonb(t) AS row FROM case_archive_versions t WHERE case_id=$1 ORDER BY id',
      ),
      archiveReceipts: await rows(
        'SELECT to_jsonb(t) AS row FROM case_archive_receipts t WHERE case_id=$1 ORDER BY id',
      ),
      materials: await rows(
        "SELECT to_jsonb(t) AS row FROM material_references t WHERE resource_type='case' AND resource_id=$1 ORDER BY id",
      ),
      audits: await rows(
        "SELECT to_jsonb(t) AS row FROM audit_events t WHERE resource_type='CASE' AND resource_id=$1 ORDER BY id",
      ),
    };
  });
}

const faultTables = {
  contact: 'case_defendant_contact_changes',
  acceptance: 'case_acceptance_corrections',
  receipt: 'case_record_edit_receipts',
} as const;

export async function clearRecordEditFault(): Promise<void> {
  await withRecordEditDatabase(async (client) => {
    for (const table of Object.values(faultTables))
      await client.query(
        `DROP TRIGGER IF EXISTS ce001_reject_insert ON "${table}"`,
      );
    await client.query('DROP FUNCTION IF EXISTS ce001_reject_insert()');
  });
}

export async function rejectRecordEditWrite(
  kind: keyof typeof faultTables,
): Promise<void> {
  await clearRecordEditFault();
  await withRecordEditDatabase(async (client) => {
    await client.query(
      "CREATE FUNCTION ce001_reject_insert() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected CE write failure' USING ERRCODE='P0001'; END; $$ LANGUAGE plpgsql",
    );
    await client.query(
      `CREATE TRIGGER ce001_reject_insert BEFORE INSERT ON "${faultTables[kind]}" FOR EACH ROW EXECUTE FUNCTION ce001_reject_insert()`,
    );
  });
}
