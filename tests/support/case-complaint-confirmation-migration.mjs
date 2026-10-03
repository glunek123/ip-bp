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

export async function verifyCaseComplaintConfirmationMigration() {
  const migrationRoot = resolve(root, 'backend/prisma/migrations');
  const enumTarget = '20261002020000_add_case_complaint_confirmation';
  const factsTarget = '20261002020500_add_case_complaint_confirmation_facts';
  const grantTarget = '20261002021000_add_case_complaint_confirmation_grants';
  const migrations = (await readdir(migrationRoot))
    .filter((name) => /^\d{14}_/u.test(name) && name <= grantTarget)
    .sort();
  if (
    migrations.at(-3) !== enumTarget ||
    migrations.at(-2) !== factsTarget ||
    migrations.at(-1) !== grantTarget
  )
    throw new Error('Unexpected migration order');
  const suffix = randomUUID().replaceAll('-', '');
  const schemas = {
    empty: `ca003_empty_${suffix}`,
    upgrade: `ca003_upgrade_${suffix}`,
    failure: `ca003_failure_${suffix}`,
  };
  const client = new Client({ connectionString: databaseUrl });
  async function apply(names) {
    for (const name of names)
      await client.query(
        await readFile(resolve(migrationRoot, name, 'migration.sql'), 'utf8'),
      );
  }
  async function use(schema) {
    await client.query(`SET search_path TO "${schema}"`);
  }
  async function count(sql, values = []) {
    return Number((await client.query(sql, values)).rows[0].n);
  }
  async function sqlCode(sql, values = []) {
    try {
      await client.query(sql, values);
      return null;
    } catch (error) {
      return error.code ?? null;
    }
  }
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
    await apply(migrations);
    const empty = {
      migrationCount: migrations.length,
      previousMigrationCount: migrations.filter((name) => name < enumTarget)
        .length,
      stage: await count(
        "SELECT COUNT(*) AS n FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace p ON p.oid=t.typnamespace WHERE p.nspname=$1 AND t.typname='case_stage' AND e.enumlabel='WAITING_COMPLAINT_STAMP'",
        [schemas.empty],
      ),
      factTable: await count(
        "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=$1 AND table_name='case_complaint_confirmations'",
        [schemas.empty],
      ),
      receiptTable: await count(
        "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=$1 AND table_name='case_complaint_confirmation_receipts'",
        [schemas.empty],
      ),
    };

    await use(schemas.upgrade);
    await apply(migrations.filter((name) => name < enumTarget));
    const departmentId = randomUUID();
    const actorId = randomUUID();
    const inactiveId = randomUUID();
    const caseId = randomUUID();
    const oldReceiptId = randomUUID();
    const roleSelf = randomUUID();
    const roleTeam = randomUUID();
    const roleManual = randomUUID();
    await client.query(
      'INSERT INTO departments(id,name,updated_at) VALUES ($1,$2,now())',
      [departmentId, 'CA003 upgrade department'],
    );
    for (const id of [actorId, inactiveId])
      await client.query(
        'INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES ($1,$2,$3,now())',
        [id, `ca003-${id}`, 'CA003 operator'],
      );
    for (const [role, name] of [
      [roleSelf, 'self'],
      [roleTeam, 'team'],
      [roleManual, 'manual'],
    ]) {
      await client.query(
        'INSERT INTO role_templates(id,department_id,name,updated_at) VALUES ($1,$2,$3,now())',
        [role, departmentId, name],
      );
    }
    await client.query(
      "INSERT INTO role_grants(id,role_template_id,action,scope) VALUES ($1,$2,'case.complaint.submit','SELF'),($3,$4,'case.complaint.submit','TEAM')",
      [randomUUID(), roleSelf, randomUUID(), roleTeam],
    );
    await client.query(
      'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES ($1,$2,$3,now()),($4,$5,$3,now())',
      [randomUUID(), actorId, departmentId, randomUUID(), inactiveId],
    );
    await client.query(
      'INSERT INTO role_assignments(id,user_id,department_id,role_template_id,active,updated_at) VALUES ($1,$2,$3,$4,true,now()),($5,$6,$3,$4,false,now())',
      [randomUUID(), actorId, departmentId, roleSelf, randomUUID(), inactiveId],
    );
    const beforeRevision = await count(
      'SELECT authorization_revision AS n FROM user_accounts WHERE id=$1',
      [actorId],
    );
    // A synthetic prior case and receipt preserve the old schema's complete submitted columns.
    // This probe isolates migration preservation from the unrelated notary source graph.
    await client.query('SET session_replication_role = replica');
    try {
      await client.query(
        `INSERT INTO cases(id,business_no,department_id,source_lead_id,source_notary_matter_id,certificate_id,customer_id,rights_holder_id,responsible_user_id,stage,version,matched_at,complaint_amount_state,complaint_amount,complaint_submitted_at,complaint_submitted_by_user_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'WAITING_COMPLAINT_CONFIRMATION',3,now(),'KNOWN',100.00,now(),$9)`,
        [
          caseId,
          `CA003-${suffix}`,
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
        'INSERT INTO case_complaint_receipts(id,department_id,actor_user_id,case_id,idempotency_key,request_fingerprint,result_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [
          oldReceiptId,
          departmentId,
          actorId,
          caseId,
          'old-submit',
          'a'.repeat(64),
          { id: caseId, stage: 'WAITING_COMPLAINT_CONFIRMATION', version: 3 },
        ],
      );
    } finally {
      await client.query('SET session_replication_role = origin');
    }
    await apply([enumTarget, factsTarget, grantTarget]);
    const preserved = (
      await client.query(
        'SELECT stage,version,complaint_amount_state,complaint_amount,complaint_submitted_at FROM cases WHERE id=$1',
        [caseId],
      )
    ).rows[0];
    const oldReceiptCount = await count(
      'SELECT COUNT(*) AS n FROM case_complaint_receipts WHERE id=$1',
      [oldReceiptId],
    );
    const grants = (
      await client.query(
        "SELECT role_template_id,scope FROM role_grants WHERE action='case.complaint.confirm' ORDER BY scope",
      )
    ).rows;
    const revisions = {
      active: await count(
        'SELECT authorization_revision AS n FROM user_accounts WHERE id=$1',
        [actorId],
      ),
      inactive: await count(
        'SELECT authorization_revision AS n FROM user_accounts WHERE id=$1',
        [inactiveId],
      ),
    };
    const versions = (
      await client.query('SELECT id,version FROM role_templates ORDER BY id')
    ).rows;
    const badAmountCode = await sqlCode(
      `INSERT INTO case_complaint_confirmations(id,department_id,case_id,confirmed_complaint_content_version_id,amount_state,amount,confirm_disclose,confirmed_by_user_id,confirmed_at,audit_event_id) VALUES ($1,$2,$3,$4,'KNOWN',-1,true,$5,now(),$6)`,
      [randomUUID(), departmentId, caseId, randomUUID(), actorId, randomUUID()],
    );
    const badStageCode = await sqlCode(
      `INSERT INTO case_complaint_confirmations(id,department_id,case_id,confirmed_complaint_content_version_id,amount_state,amount,confirm_disclose,confirmed_by_user_id,confirmed_at,audit_event_id) VALUES ($1,$2,$3,$4,'KNOWN',1,true,$5,now(),$6)`,
      [randomUUID(), departmentId, caseId, randomUUID(), actorId, randomUUID()],
    );

    await use(schemas.failure);
    await apply(migrations.filter((name) => name < enumTarget));
    await client.query('ALTER TYPE case_stage RENAME TO case_stage_held');
    const enumFailedCode = await sqlCode(
      await readFile(
        resolve(migrationRoot, enumTarget, 'migration.sql'),
        'utf8',
      ),
    );
    await client.query('ROLLBACK');
    const enumNoPartialAction = await count(
      "SELECT COUNT(*) AS n FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace p ON p.oid=t.typnamespace WHERE p.nspname=$1 AND t.typname='permission_action' AND e.enumlabel='case.complaint.confirm'",
      [schemas.failure],
    );
    const enumNoPartialStage = await count(
      "SELECT COUNT(*) AS n FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace p ON p.oid=t.typnamespace WHERE p.nspname=$1 AND t.typname='case_stage_held' AND e.enumlabel='WAITING_COMPLAINT_STAMP'",
      [schemas.failure],
    );
    await client.query('ALTER TYPE case_stage_held RENAME TO case_stage');
    await apply([enumTarget]);
    const enumRecoveredAction = await count(
      "SELECT COUNT(*) AS n FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace p ON p.oid=t.typnamespace WHERE p.nspname=$1 AND t.typname='permission_action' AND e.enumlabel='case.complaint.confirm'",
      [schemas.failure],
    );
    const enumRecoveredStage = await count(
      "SELECT COUNT(*) AS n FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace p ON p.oid=t.typnamespace WHERE p.nspname=$1 AND t.typname='case_stage' AND e.enumlabel='WAITING_COMPLAINT_STAMP'",
      [schemas.failure],
    );
    await client.query(
      'CREATE TABLE case_complaint_confirmations (collision integer)',
    );
    const factsFailedCode = await sqlCode(
      await readFile(
        resolve(migrationRoot, factsTarget, 'migration.sql'),
        'utf8',
      ),
    );
    await client.query('ROLLBACK');
    const noPartialStageCheck = await count(
      "SELECT COUNT(*) AS n FROM information_schema.check_constraints WHERE constraint_schema=$1 AND constraint_name='cases_complaint_state_check' AND check_clause LIKE '%WAITING_COMPLAINT_STAMP%'",
      [schemas.failure],
    );
    const noReceipt = await count(
      "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=$1 AND table_name='case_complaint_confirmation_receipts'",
      [schemas.failure],
    );
    await client.query('DROP TABLE case_complaint_confirmations');
    await apply([factsTarget]);
    const factsRecovered = await count(
      "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=$1 AND table_name='case_complaint_confirmation_receipts'",
      [schemas.failure],
    );
    const failedDepartmentId = randomUUID();
    const failedUserId = randomUUID();
    const failedRoleId = randomUUID();
    await client.query(
      'INSERT INTO departments(id,name,updated_at) VALUES ($1,$2,now())',
      [failedDepartmentId, 'CA003 grant rollback department'],
    );
    await client.query(
      'INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES ($1,$2,$3,now())',
      [failedUserId, `ca003-${failedUserId}`, 'CA003 grant rollback user'],
    );
    await client.query(
      'INSERT INTO role_templates(id,department_id,name,updated_at) VALUES ($1,$2,$3,now())',
      [failedRoleId, failedDepartmentId, 'grant rollback role'],
    );
    await client.query(
      "INSERT INTO role_grants(id,role_template_id,action,scope) VALUES ($1,$2,'case.complaint.submit','TEAM')",
      [randomUUID(), failedRoleId],
    );
    await client.query(
      'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES ($1,$2,$3,now())',
      [randomUUID(), failedUserId, failedDepartmentId],
    );
    await client.query(
      'INSERT INTO role_assignments(id,user_id,department_id,role_template_id,active,updated_at) VALUES ($1,$2,$3,$4,true,now())',
      [randomUUID(), failedUserId, failedDepartmentId, failedRoleId],
    );
    await client.query(
      'ALTER TABLE user_accounts ADD CONSTRAINT ca003_reject_revision CHECK (authorization_revision = 1)',
    );
    const grantsFailedCode = await sqlCode(
      await readFile(
        resolve(migrationRoot, grantTarget, 'migration.sql'),
        'utf8',
      ),
    );
    await client.query('ROLLBACK');
    const grantCount = () =>
      count(
        "SELECT COUNT(*) AS n FROM role_grants WHERE role_template_id=$1 AND action='case.complaint.confirm'",
        [failedRoleId],
      );
    const roleVersion = () =>
      count('SELECT version AS n FROM role_templates WHERE id=$1', [
        failedRoleId,
      ]);
    const accountRevision = () =>
      count(
        'SELECT authorization_revision AS n FROM user_accounts WHERE id=$1',
        [failedUserId],
      );
    const noPartialGrant = await grantCount();
    const unchangedTemplateVersion = await roleVersion();
    const unchangedAccountRevision = await accountRevision();
    await client.query(
      'ALTER TABLE user_accounts DROP CONSTRAINT ca003_reject_revision',
    );
    await apply([grantTarget]);
    const recoveredGrant = await grantCount();
    const recoveredTemplateVersion = await roleVersion();
    const recoveredAccountRevision = await accountRevision();
    return {
      empty,
      upgrade: {
        preserved,
        oldReceiptCount,
        grants,
        revisions,
        beforeRevision,
        versions,
        badAmountCode,
        badStageCode,
      },
      failure: {
        enum: {
          failedCode: enumFailedCode,
          noPartialAction: enumNoPartialAction,
          noPartialStage: enumNoPartialStage,
          recoveredAction: enumRecoveredAction,
          recoveredStage: enumRecoveredStage,
        },
        facts: {
          failedCode: factsFailedCode,
          noPartialStageCheck,
          noReceipt,
          recovered: factsRecovered,
        },
        grants: {
          failedCode: grantsFailedCode,
          noPartialGrant,
          unchangedTemplateVersion,
          unchangedAccountRevision,
          recoveredGrant,
          recoveredTemplateVersion,
          recoveredAccountRevision,
        },
      },
    };
  } finally {
    await client.query('RESET search_path').catch(() => undefined);
    for (const schema of Object.values(schemas))
      await client
        .query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        .catch(() => undefined);
    await client.end();
  }
}
