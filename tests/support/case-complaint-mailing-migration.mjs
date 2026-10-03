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

export async function verifyCaseComplaintMailingMigration() {
  const migrationRoot = resolve(root, 'backend/prisma/migrations');
  const targets = [
    '20261003010000_add_case_complaint_mailing_enums',
    '20261003011000_add_case_complaint_mailing_facts',
    '20261003012000_add_case_complaint_mailing_grants',
    '20261003013000_add_case_client_mailing_actor_paths',
  ];
  const migrations = (await readdir(migrationRoot)).filter((name) => /^\d{14}_/u.test(name)).sort();
  if (migrations.slice(-4).join('|') !== targets.join('|')) throw new Error('Unexpected migration order');
  const suffix = randomUUID().replaceAll('-', '');
  const schemas = {
    empty: `ca004_empty_${suffix}`,
    upgrade: `ca004_upgrade_${suffix}`,
    failure: `ca004_failure_${suffix}`,
  };
  const client = new Client({ connectionString: databaseUrl });
  const apply = async (names) => {
    for (const name of names) await client.query(await readFile(resolve(migrationRoot, name, 'migration.sql'), 'utf8'));
  };
  const use = (schema) => client.query(`SET search_path TO "${schema}"`);
  const count = async (sql, values = []) => Number((await client.query(sql, values)).rows[0].n);
  const sqlCode = async (sql, values = []) => {
    try { await client.query(sql, values); return null; }
    catch (error) { await client.query('ROLLBACK').catch(() => undefined); return error.code ?? null; }
  };
  await client.connect();
  try {
    if ((await client.query('SELECT current_database() AS name')).rows[0].name !== 'dev_cor_test')
      throw new Error('Unexpected database');
    for (const schema of Object.values(schemas)) await client.query(`CREATE SCHEMA "${schema}"`);

    await use(schemas.empty);
    await apply(migrations);
    const empty = {
      migrationCount: migrations.length,
      previousMigrationCount: migrations.length - 4,
      stage: await count("SELECT COUNT(*) AS n FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace p ON p.oid=t.typnamespace WHERE p.nspname=$1 AND t.typname='case_stage' AND e.enumlabel='WAITING_FILING'", [schemas.empty]),
      factTable: await count("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=$1 AND table_name='case_complaint_mailings'", [schemas.empty]),
      receiptTable: await count("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=$1 AND table_name='case_complaint_mailing_receipts'", [schemas.empty]),
    };

    await use(schemas.upgrade);
    await apply(migrations.slice(0, -4));
    const departmentId = randomUUID();
    const actorId = randomUUID();
    const caseId = randomUUID();
    const customerId = randomUUID();
    const roleId = randomUUID();
    await client.query('INSERT INTO departments(id,name,updated_at) VALUES ($1,$2,now())', [departmentId, 'CA004 upgrade department']);
    await client.query('INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES ($1,$2,$3,now())', [actorId, `ca004-${actorId}`, 'CA004 operator']);
    await client.query('INSERT INTO role_templates(id,department_id,name,updated_at) VALUES ($1,$2,$3,now())', [roleId, departmentId, 'CA004 role']);
    await client.query("INSERT INTO role_grants(id,role_template_id,action,scope) VALUES ($1,$2,'case.complaint.confirm','TEAM')", [randomUUID(), roleId]);
    await client.query('INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES ($1,$2,$3,now())', [randomUUID(), actorId, departmentId]);
    await client.query('INSERT INTO role_assignments(id,user_id,department_id,role_template_id,active,updated_at) VALUES ($1,$2,$3,$4,true,now())', [randomUUID(), actorId, departmentId, roleId]);
    const oldSubmitReceiptId = randomUUID();
    const oldConfirmReceiptId = randomUUID();
    const oldConfirmationId = randomUUID();
    await client.query('SET session_replication_role = replica');
    try {
      await client.query(`INSERT INTO cases(id,business_no,department_id,source_lead_id,source_notary_matter_id,certificate_id,customer_id,rights_holder_id,responsible_user_id,stage,version,matched_at,complaint_amount_state,complaint_amount,complaint_submitted_at,complaint_submitted_by_user_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'WAITING_COMPLAINT_STAMP',4,now(),'KNOWN',123.45,now(),$9)`,
      [caseId, `CA004-${suffix}`, departmentId, randomUUID(), randomUUID(), randomUUID(), customerId, randomUUID(), actorId]);
      await client.query(`INSERT INTO case_complaint_confirmations(id,department_id,case_id,confirmed_complaint_content_version_id,amount_state,amount,confirm_disclose,confirmed_by_user_id,confirmed_at,audit_event_id)
        VALUES ($1,$2,$3,$4,'KNOWN',123.45,true,$5,now(),$6)`, [oldConfirmationId, departmentId, caseId, randomUUID(), actorId, randomUUID()]);
      for (const [table, id, key] of [
        ['case_complaint_receipts', oldSubmitReceiptId, 'old-submit'],
        ['case_complaint_confirmation_receipts', oldConfirmReceiptId, 'old-confirm'],
      ]) await client.query(`INSERT INTO ${table}(id,department_id,actor_user_id,case_id,idempotency_key,request_fingerprint,result_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, departmentId, actorId, caseId, key, 'a'.repeat(64), { id: caseId }]);
    } finally { await client.query('SET session_replication_role = origin'); }
    await apply(targets);
    const upgrade = {
      preservedStage: (await client.query('SELECT stage FROM cases WHERE id=$1', [caseId])).rows[0].stage,
      oldSubmitReceipt: await count('SELECT COUNT(*) AS n FROM case_complaint_receipts WHERE id=$1', [oldSubmitReceiptId]),
      oldConfirmation: await count('SELECT COUNT(*) AS n FROM case_complaint_confirmations WHERE id=$1', [oldConfirmationId]),
      oldConfirmReceipt: await count('SELECT COUNT(*) AS n FROM case_complaint_confirmation_receipts WHERE id=$1', [oldConfirmReceiptId]),
      copiedScope: (await client.query("SELECT scope FROM role_grants WHERE role_template_id=$1 AND action='case.complaint.mail'", [roleId])).rows[0]?.scope,
      authorizationRevision: await count('SELECT authorization_revision AS n FROM user_accounts WHERE id=$1', [actorId]),
    };
    const clientActorId = randomUUID(), clientBindingId = randomUUID();
    const foreignBindingId = randomUUID(), foreignCustomerId = randomUUID(), foreignActorId = randomUUID();
    await client.query('BEGIN');
    try {
      await client.query('SET LOCAL session_replication_role = replica');
      await client.query("INSERT INTO user_accounts(id,external_subject,display_name,account_type,updated_at) VALUES ($1,$2,$3,'CLIENT',now())", [clientActorId, `ca004-client-${clientActorId}`, 'CA004 client']);
      await client.query("INSERT INTO user_accounts(id,external_subject,display_name,account_type,updated_at) VALUES ($1,$2,$3,'CLIENT',now())", [foreignActorId, `ca004-client-${foreignActorId}`, 'CA004 foreign client']);
      await client.query('INSERT INTO customer_account_bindings(id,user_id,customer_id,department_id,updated_at) VALUES ($1,$2,$3,$4,now())', [clientBindingId, clientActorId, customerId, departmentId]);
      await client.query('INSERT INTO customer_account_bindings(id,user_id,customer_id,department_id,updated_at) VALUES ($1,$2,$3,$4,now())', [foreignBindingId, foreignActorId, foreignCustomerId, departmentId]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    const draftSql = `INSERT INTO upload_drafts(id,department_id,actor_user_id,customer_account_binding_id,owner_type,owner_id,category,purpose,original_filename,declared_mime_type,expires_at,updated_at)
      VALUES ($1,$2,$3,$4,'CASE',$5,$6,$7,'receipt.pdf','application/pdf',now()+interval '1 day',now())`;
    const validDraftId = randomUUID();
    await client.query(draftSql, [validDraftId, departmentId, clientActorId, clientBindingId, caseId, 'MAIL_RECEIPT', 'MAIL_RECEIPT']);
    const crossEnterprise = await sqlCode(draftSql, [randomUUID(), departmentId, foreignActorId, foreignBindingId, caseId, 'MAIL_RECEIPT', 'MAIL_RECEIPT']);
    const crossDepartment = await sqlCode(draftSql, [randomUUID(), randomUUID(), clientActorId, clientBindingId, caseId, 'MAIL_RECEIPT', 'MAIL_RECEIPT']);
    const wrongCategory = await sqlCode(draftSql, [randomUUID(), departmentId, clientActorId, clientBindingId, caseId, 'COMPLAINT', 'COMPLAINT']);
    const mixedActor = await sqlCode(`INSERT INTO upload_drafts(id,department_id,actor_user_id,internal_actor_user_id,customer_account_binding_id,owner_type,owner_id,category,purpose,original_filename,declared_mime_type,expires_at,updated_at)
      VALUES ($1,$2,$3,$3,$4,'CASE',$5,'MAIL_RECEIPT','MAIL_RECEIPT','receipt.pdf','application/pdf',now()+interval '1 day',now())`,
    [randomUUID(), departmentId, clientActorId, clientBindingId, caseId]);
    await client.query('UPDATE customer_account_bindings SET active=false WHERE id=$1', [clientBindingId]);
    await client.query("UPDATE upload_drafts SET status='EXPIRED' WHERE id=$1", [validDraftId]);
    const revokedCleanup = (await client.query('SELECT status FROM upload_drafts WHERE id=$1', [validDraftId])).rows[0].status;
    await client.query('UPDATE customer_account_bindings SET active=true WHERE id=$1', [clientBindingId]);
    const auditId = randomUUID();
    await client.query("UPDATE cases SET stage='WAITING_FILING' WHERE id=$1", [caseId]);
    const wrongAuditAction = await sqlCode(`INSERT INTO audit_events(id,department_id,actor_user_id,customer_account_binding_id,resource_type,resource_id,action)
      VALUES ($1,$2,$3,$4,'CASE',$5,'material.deleted')`, [randomUUID(), departmentId, clientActorId, clientBindingId, caseId]);
    await client.query("INSERT INTO audit_events(id,department_id,actor_user_id,internal_actor_user_id,resource_type,resource_id,action) VALUES ($1,$2,$3,$3,'CASE',$4,'case.complaint.mailed')", [auditId, departmentId, actorId, caseId]);
    const badIdentity = await sqlCode(`INSERT INTO case_complaint_mailings(id,department_id,case_id,mailed_at,recorded_by_user_id,actor_type,audit_event_id) VALUES ($1,$2,$3,current_date,$4,'CLIENT',$5)`, [randomUUID(), departmentId, caseId, actorId, auditId]);
    const badDate = await sqlCode(`INSERT INTO case_complaint_mailings(id,department_id,case_id,mailed_at,recorded_by_user_id,actor_type,audit_event_id) VALUES ($1,$2,$3,current_date + 10,$4,'INTERNAL',$5)`, [randomUUID(), departmentId, caseId, actorId, auditId]);
    const mailingId = randomUUID();
    await client.query(`INSERT INTO case_complaint_mailings(id,department_id,case_id,mailed_at,recorded_by_user_id,actor_type,audit_event_id) VALUES ($1,$2,$3,current_date,$4,'INTERNAL',$5)`, [mailingId, departmentId, caseId, actorId, auditId]);
    const badVersion = await sqlCode('INSERT INTO case_complaint_mailing_versions(mailing_id,case_id,department_id,material_id,content_version_id) VALUES ($1,$2,$3,$4,$5)', [mailingId, caseId, departmentId, randomUUID(), randomUUID()]);
    const immutableFact = await sqlCode('UPDATE case_complaint_mailings SET mailed_at=mailed_at WHERE id=$1', [mailingId]);

    await use(schemas.failure);
    await apply(migrations.slice(0, -4));
    await client.query('ALTER TYPE case_stage RENAME TO case_stage_held');
    const enumFailed = await sqlCode(await readFile(resolve(migrationRoot, targets[0], 'migration.sql'), 'utf8'));
    const enumNoPartial = await count("SELECT COUNT(*) AS n FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace p ON p.oid=t.typnamespace WHERE p.nspname=$1 AND t.typname='permission_action' AND e.enumlabel='case.complaint.mail'", [schemas.failure]);
    await client.query('ALTER TYPE case_stage_held RENAME TO case_stage');
    await apply([targets[0]]);
    await client.query('CREATE TABLE case_complaint_mailings (collision integer)');
    const factsFailed = await sqlCode(await readFile(resolve(migrationRoot, targets[1], 'migration.sql'), 'utf8'));
    const factsNoPartial = await count("SELECT COUNT(*) AS n FROM information_schema.check_constraints WHERE constraint_schema=$1 AND constraint_name='cases_complaint_state_check' AND check_clause LIKE '%WAITING_FILING%'", [schemas.failure]);
    await client.query('DROP TABLE case_complaint_mailings');
    await apply([targets[1]]);
    const failedDepartment = randomUUID(), failedActor = randomUUID(), failedRole = randomUUID();
    await client.query('INSERT INTO departments(id,name,updated_at) VALUES ($1,$2,now())', [failedDepartment, 'CA004 failure department']);
    await client.query('INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES ($1,$2,$3,now())', [failedActor, `ca004-${failedActor}`, 'CA004 failure actor']);
    await client.query('INSERT INTO role_templates(id,department_id,name,updated_at) VALUES ($1,$2,$3,now())', [failedRole, failedDepartment, 'CA004 failure role']);
    await client.query("INSERT INTO role_grants(id,role_template_id,action,scope) VALUES ($1,$2,'case.complaint.confirm','SELF')", [randomUUID(), failedRole]);
    await client.query('INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES ($1,$2,$3,now())', [randomUUID(), failedActor, failedDepartment]);
    await client.query('INSERT INTO role_assignments(id,user_id,department_id,role_template_id,active,updated_at) VALUES ($1,$2,$3,$4,true,now())', [randomUUID(), failedActor, failedDepartment, failedRole]);
    await client.query('ALTER TABLE user_accounts ADD CONSTRAINT ca004_reject_revision CHECK (authorization_revision = 1)');
    const grantsFailed = await sqlCode(await readFile(resolve(migrationRoot, targets[2], 'migration.sql'), 'utf8'));
    const grantsNoPartial = await count("SELECT COUNT(*) AS n FROM role_grants WHERE role_template_id=$1 AND action='case.complaint.mail'", [failedRole]);
    await client.query('ALTER TABLE user_accounts DROP CONSTRAINT ca004_reject_revision');
    await apply([targets[2]]);
    await client.query('ALTER TABLE upload_drafts ADD COLUMN customer_account_binding_id UUID');
    const actorPathFailed = await sqlCode(await readFile(resolve(migrationRoot, targets[3], 'migration.sql'), 'utf8'));
    const actorPathNoPartial = await count("SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema=$1 AND table_name='audit_events' AND column_name='customer_account_binding_id'", [schemas.failure]);
    await client.query('ALTER TABLE upload_drafts DROP COLUMN customer_account_binding_id');
    await apply([targets[3]]);
    const failure = { enumFailed, enumNoPartial, factsFailed, factsNoPartial,
      grantsFailed, grantsNoPartial, actorPathFailed, actorPathNoPartial,
      recoveredGrant: await count("SELECT COUNT(*) AS n FROM role_grants WHERE role_template_id=$1 AND action='case.complaint.mail'", [failedRole]),
      recoveredRevision: await count('SELECT authorization_revision AS n FROM user_accounts WHERE id=$1', [failedActor]) };
    return { empty, upgrade, constraints: { badIdentity, badDate, badVersion, immutableFact,
      crossEnterprise, crossDepartment, wrongCategory, mixedActor, wrongAuditAction, revokedCleanup }, failure };
  } finally {
    await client.query('RESET search_path').catch(() => undefined);
    for (const schema of Object.values(schemas))
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
    await client.end();
  }
}
