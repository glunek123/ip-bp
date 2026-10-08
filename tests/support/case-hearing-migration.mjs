import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';

const root = process.cwd();
const requireBackend = createRequire(resolve(root, 'backend/package.json'));
const { Client } = requireBackend('pg');
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || process.env.NODE_ENV !== 'test')
  throw new Error('Isolated test database required');
validateIsolatedTestDatabaseUrl(databaseUrl, { allowRandomPort: true });

export async function verifyCaseHearingMigration() {
  const migrations = resolve(root, 'backend/prisma/migrations');
  const target = [
    '20261008010000_add_case_hearing_enums',
    '20261008011000_add_case_hearing_facts',
    '20261008012000_add_case_hearing_grants',
    '20261008013000_allow_lawyer_hearing_schedule_audit',
    '20261008014000_bind_case_hearing_correction_audit',
    '20261008015000_require_latest_case_hearing_chain',
  ];
  const previous = (await readdir(migrations))
    .filter((name) => /^\d{14}_/u.test(name) && name < target[0])
    .sort();
  if (
    previous.length !== 76 ||
    previous.at(-1) !== '20261006013000_seal_case_acceptance_versions'
  )
    throw new Error('Unexpected previous schema');
  const suffix = randomUUID().replaceAll('-', '');
  const schemas = {
    empty: `ca007_empty_${suffix}`,
    upgrade: `ca007_upgrade_${suffix}`,
    failure: `ca007_failure_${suffix}`,
  };
  const client = new Client({ connectionString: databaseUrl });
  const use = (name) => client.query(`SET search_path TO "${name}"`);
  const apply = async (names) => {
    for (const name of names)
      await client.query(
        await readFile(resolve(migrations, name, 'migration.sql'), 'utf8'),
      );
  };
  const count = async (sql, params = []) =>
    Number((await client.query(sql, params)).rows[0].n);
  const code = async (sql, params = []) => {
    try {
      await client.query('BEGIN');
      await client.query(sql, params);
      await client.query('COMMIT');
      return null;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      return error.code ?? null;
    }
  };
  await client.connect();
  try {
    if (
      (await client.query('SELECT current_database() AS name')).rows[0].name !==
      'dev_cor_test'
    )
      throw new Error('Unexpected database');
    for (const schema of Object.values(schemas))
      await client.query(`CREATE SCHEMA "${schema}"`);
    await use(schemas.empty);
    await apply([...previous, ...target]);
    const emptyFactTable = await count(
      "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=$1 AND table_name='case_hearing_advances'",
      [schemas.empty],
    );

    await use(schemas.upgrade);
    await apply(previous);
    const departmentId = randomUUID(),
      actorId = randomUUID(),
      caseId = randomUUID();
    const acceptanceId = randomUUID(),
      acceptanceAuditId = randomUUID(),
      oldReceiptId = randomUUID();
    const managerId = randomUUID(),
      splitId = randomUUID(),
      roleOnlyId = randomUUID();
    const splitAccountId = randomUUID();
    await client.query(
      'INSERT INTO departments(id,name,updated_at) VALUES ($1,$2,now())',
      [departmentId, 'CA007 isolated'],
    );
    await client.query(
      'INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES ($1,$2,$3,now())',
      [actorId, `ca007-${actorId}`, 'CA007 actor'],
    );
    await client.query(
      'INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES ($1,$2,$3,now())',
      [splitAccountId, `ca007-${splitAccountId}`, 'CA007 split actor'],
    );
    await client.query(
      'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES ($1,$2,$3,now())',
      [randomUUID(), actorId, departmentId],
    );
    await client.query(
      'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES ($1,$2,$3,now())',
      [randomUUID(), splitAccountId, departmentId],
    );
    await client.query(
      'INSERT INTO role_templates(id,department_id,name,updated_at) VALUES ($1,$2,$3,now()),($4,$2,$5,now()),($6,$2,$7,now())',
      [
        managerId,
        departmentId,
        'manager',
        splitId,
        'split-match',
        roleOnlyId,
        'split-role',
      ],
    );
    await client.query(
      "INSERT INTO role_grants(id,role_template_id,action,scope) VALUES ($1,$2,'case.acceptance.register','SELF'),($3,$2,'case.match','DEPARTMENT'),($4,$2,'role.manage','DEPARTMENT'),($5,$6,'case.match','DEPARTMENT'),($7,$8,'role.manage','DEPARTMENT')",
      [
        randomUUID(),
        managerId,
        randomUUID(),
        randomUUID(),
        randomUUID(),
        splitId,
        randomUUID(),
        roleOnlyId,
      ],
    );
    await client.query(
      'INSERT INTO role_assignments(id,user_id,department_id,role_template_id,active,updated_at) VALUES ($1,$2,$3,$4,true,now())',
      [randomUUID(), actorId, departmentId, managerId],
    );
    await client.query(
      'INSERT INTO role_assignments(id,user_id,department_id,role_template_id,active,updated_at) VALUES ($1,$2,$3,$4,true,now()),($5,$2,$3,$6,true,now())',
      [
        randomUUID(),
        splitAccountId,
        departmentId,
        splitId,
        randomUUID(),
        roleOnlyId,
      ],
    );
    await client.query('SET session_replication_role = replica');
    try {
      await client.query(
        "INSERT INTO cases(id,business_no,department_id,source_lead_id,source_notary_matter_id,certificate_id,customer_id,rights_holder_id,responsible_user_id,stage,version,matched_at,complaint_amount_state,complaint_amount,complaint_submitted_at,complaint_submitted_by_user_id,court_case_no) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'WAITING_HEARING',7,now(),'KNOWN',123.45,now(),$9,'CA007-No')",
        [
          caseId,
          `CA007-${suffix}`,
          departmentId,
          randomUUID(),
          randomUUID(),
          randomUUID(),
          randomUUID(),
          randomUUID(),
          actorId,
        ],
      );
      await client.query(
        "INSERT INTO audit_events(id,department_id,actor_user_id,internal_actor_user_id,resource_type,resource_id,action) VALUES ($1,$2,$3,$3,'CASE',$4,'case.acceptance.registered')",
        [acceptanceAuditId, departmentId, actorId, caseId],
      );
      await client.query(
        "INSERT INTO case_acceptances(id,department_id,case_id,accepted_at,court_case_no,recorded_by_user_id,audit_event_id) VALUES ($1,$2,$3,'2026-10-01','CA007-No',$4,$5)",
        [acceptanceId, departmentId, caseId, actorId, acceptanceAuditId],
      );
      await client.query(
        'INSERT INTO case_acceptance_receipts(id,department_id,actor_user_id,case_id,idempotency_key,request_fingerprint,result_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [
          oldReceiptId,
          departmentId,
          actorId,
          caseId,
          'old-accepted',
          'a'.repeat(64),
          { id: caseId },
        ],
      );
    } finally {
      await client.query('SET session_replication_role = origin');
    }
    await apply(target);
    const oldAcceptance = await count(
      'SELECT COUNT(*) AS n FROM case_acceptances WHERE id=$1',
      [acceptanceId],
    );
    const oldReceipt = await count(
      'SELECT COUNT(*) AS n FROM case_acceptance_receipts WHERE id=$1',
      [oldReceiptId],
    );
    const draftId = randomUUID(),
      legacyAuditId = randomUUID();
    await client.query(
      "INSERT INTO upload_drafts(id,department_id,actor_user_id,owner_type,owner_id,category,purpose,original_filename,declared_mime_type,expires_at,updated_at) VALUES ($1,$2,$3,'CASE',$4,'ACCEPTANCE_NOTICE','ACCEPTANCE_NOTICE','notice.pdf','application/pdf',now() + interval '1 hour',now())",
      [draftId, departmentId, actorId, caseId],
    );
    const uploadHumanPath = await count(
      'SELECT COUNT(*) AS n FROM upload_drafts WHERE id=$1 AND actor_user_id=$2 AND internal_actor_user_id=$2',
      [draftId, actorId],
    );
    await client.query(
      "INSERT INTO audit_events(id,department_id,actor_user_id,resource_type,resource_id,action) VALUES ($1,$2,$3,'CASE',$4,'case.filing.submitted')",
      [legacyAuditId, departmentId, actorId, caseId],
    );
    const legacyHumanAudit = await count(
      "SELECT COUNT(*) AS n FROM audit_events WHERE id=$1 AND actor_kind='HUMAN' AND actor_user_id=$2 AND internal_actor_user_id=$2",
      [legacyAuditId, actorId],
    );
    const scheduleGrant = await count(
      "SELECT COUNT(*) AS n FROM role_grants WHERE role_template_id=$1 AND action='case.hearing.schedule'",
      [managerId],
    );
    const correctGrant = await count(
      "SELECT COUNT(*) AS n FROM role_grants WHERE role_template_id=$1 AND action='case.hearing.correct'",
      [managerId],
    );
    const splitGrant = await count(
      "SELECT COUNT(*) AS n FROM role_grants WHERE role_template_id=$1 AND action='case.hearing.correct'",
      [splitId],
    );
    const roleOnlyGrant = await count(
      "SELECT COUNT(*) AS n FROM role_grants WHERE role_template_id=$1 AND action='case.hearing.correct'",
      [roleOnlyId],
    );
    const templateVersion = await count(
      'SELECT version AS n FROM role_templates WHERE id=$1',
      [managerId],
    );
    const accountRevision = await count(
      'SELECT authorization_revision AS n FROM user_accounts WHERE id=$1',
      [actorId],
    );
    const splitAccountRevision = await count(
      'SELECT authorization_revision AS n FROM user_accounts WHERE id=$1',
      [splitAccountId],
    );
    const systemWithHuman = await code(
      "INSERT INTO audit_events(id,department_id,actor_kind,actor_user_id,resource_type,resource_id,action) VALUES ($1,$2,'SYSTEM',$3,'CASE',$4,'case.hearing.auto_advanced')",
      [randomUUID(), departmentId, actorId, caseId],
    );
    const systemWrongAction = await code(
      "INSERT INTO audit_events(id,department_id,actor_kind,resource_type,resource_id,action) VALUES ($1,$2,'SYSTEM','CASE',$3,'case.hearing.scheduled')",
      [randomUUID(), departmentId, caseId],
    );
    const systemWrongResource = await code(
      "INSERT INTO audit_events(id,department_id,actor_kind,resource_type,resource_id,action) VALUES ($1,$2,'SYSTEM','customer',$3,'case.hearing.auto_advanced')",
      [randomUUID(), departmentId, caseId],
    );
    const systemWithBinding = await code(
      "INSERT INTO audit_events(id,department_id,actor_kind,lawyer_account_binding_id,resource_type,resource_id,action) VALUES ($1,$2,'SYSTEM',$3,'CASE',$4,'case.hearing.auto_advanced')",
      [randomUUID(), departmentId, randomUUID(), caseId],
    );
    const otherDepartmentId = randomUUID();
    await client.query(
      'INSERT INTO departments(id,name,updated_at) VALUES ($1,$2,now())',
      [otherDepartmentId, 'CA007 other'],
    );
    const systemCrossDepartment = await code(
      "INSERT INTO audit_events(id,department_id,actor_kind,resource_type,resource_id,action,details) VALUES ($1,$2,'SYSTEM','CASE',$3,'case.hearing.auto_advanced',$4)",
      [
        randomUUID(),
        otherDepartmentId,
        caseId,
        {
          advanceId: randomUUID(),
          arrangementId: randomUUID(),
          dueAt: new Date().toISOString(),
          executedAt: new Date().toISOString(),
        },
      ],
    );
    const systemWithoutFact = await code(
      "INSERT INTO audit_events(id,department_id,actor_kind,resource_type,resource_id,action,details) VALUES ($1,$2,'SYSTEM','CASE',$3,'case.hearing.auto_advanced',$4)",
      [
        randomUUID(),
        departmentId,
        caseId,
        {
          advanceId: randomUUID(),
          arrangementId: randomUUID(),
          dueAt: new Date().toISOString(),
          executedAt: new Date().toISOString(),
        },
      ],
    );
    const humanWithoutActor = await code(
      "INSERT INTO audit_events(id,department_id,resource_type,resource_id,action) VALUES ($1,$2,'CASE',$3,'case.hearing.scheduled')",
      [randomUUID(), departmentId, caseId],
    );
    const humanAutoAction = await code(
      "INSERT INTO audit_events(id,department_id,actor_user_id,internal_actor_user_id,resource_type,resource_id,action) VALUES ($1,$2,$3,$3,'CASE',$4,'case.hearing.auto_advanced')",
      [randomUUID(), departmentId, actorId, caseId],
    );

    await use(schemas.failure);
    await apply([...previous, target[0]]);
    await client.query('CREATE TABLE case_hearing_arrangements(id UUID)');
    let factMigrationFailure;
    try {
      await apply([target[1]]);
      factMigrationFailure = null;
    } catch (error) {
      factMigrationFailure = error.code ?? null;
      await client.query('ROLLBACK').catch(() => undefined);
    }
    const noPartialAuditColumn = await count(
      "SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema=$1 AND table_name='audit_events' AND column_name='actor_kind'",
      [schemas.failure],
    );
    await client.query('DROP TABLE case_hearing_arrangements');
    await apply([target[1], target[2], target[3], target[4], target[5]]);
    const retryTable = await count(
      "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=$1 AND table_name='case_hearing_advances'",
      [schemas.failure],
    );
    return {
      previous: previous.length,
      total: previous.length + target.length,
      emptyFactTable,
      oldAcceptance,
      oldReceipt,
      uploadHumanPath,
      legacyHumanAudit,
      scheduleGrant,
      correctGrant,
      splitGrant,
      roleOnlyGrant,
      templateVersion,
      accountRevision,
      splitAccountRevision,
      factMigrationFailure,
      noPartialAuditColumn,
      retryTable,
      systemWithHuman,
      systemWrongAction,
      systemWrongResource,
      systemWithBinding,
      systemCrossDepartment,
      systemWithoutFact,
      humanWithoutActor,
      humanAutoAction,
    };
  } finally {
    for (const schema of Object.values(schemas)) {
      await client
        .query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        .catch(() => undefined);
    }
    await client.end();
  }
}
