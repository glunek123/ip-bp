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

export async function verifyCaseAcceptanceMigration() {
  const migrationRoot = resolve(root, 'backend/prisma/migrations');
  const targets = [
    '20261006010000_add_case_acceptance_enums',
    '20261006011000_add_case_acceptance_facts',
    '20261006012000_add_case_acceptance_grants',
  ];
  const previous = (await readdir(migrationRoot))
    .filter((name) => /^\d{14}_/u.test(name) && name < targets[0])
    .sort();
  if (
    previous.length !== 72 ||
    previous.at(-1) !==
      '20261004024000_anchor_lawyer_profile_and_cleanup_drafts'
  )
    throw new Error('Unexpected previous schema');
  const suffix = randomUUID().replaceAll('-', '');
  const schemas = {
    empty: `ca006_empty_${suffix}`,
    upgrade: `ca006_upgrade_${suffix}`,
    failure: `ca006_failure_${suffix}`,
  };
  const client = new Client({ connectionString: databaseUrl });
  const use = (schema) => client.query(`SET search_path TO "${schema}"`);
  const apply = async (names) => {
    for (const name of names)
      await client.query(
        await readFile(resolve(migrationRoot, name, 'migration.sql'), 'utf8'),
      );
  };
  const count = async (sql, params = []) =>
    Number((await client.query(sql, params)).rows[0].n);
  const sqlCode = async (sql, params = []) => {
    try {
      await client.query(sql, params);
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
    await apply([...previous, ...targets]);
    const empty = {
      previous: previous.length,
      total: previous.length + targets.length,
      enumValue: await count(
        "SELECT COUNT(*) AS n FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace p ON p.oid=t.typnamespace WHERE p.nspname=$1 AND t.typname='case_stage' AND e.enumlabel='WAITING_HEARING'",
        [schemas.empty],
      ),
      factTable: await count(
        "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=$1 AND table_name='case_acceptances'",
        [schemas.empty],
      ),
    };

    await use(schemas.upgrade);
    await apply(previous);
    const departmentId = randomUUID(),
      actorId = randomUUID(),
      caseId = randomUUID(),
      roleId = randomUUID();
    const oldFilingId = randomUUID(),
      oldReceiptId = randomUUID();
    await client.query(
      'INSERT INTO departments(id,name,updated_at) VALUES ($1,$2,now())',
      [departmentId, 'CA006 department'],
    );
    await client.query(
      'INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES ($1,$2,$3,now())',
      [actorId, `ca006-${actorId}`, 'CA006 actor'],
    );
    await client.query(
      'INSERT INTO role_templates(id,department_id,name,updated_at) VALUES ($1,$2,$3,now())',
      [roleId, departmentId, 'CA006 role'],
    );
    await client.query(
      "INSERT INTO role_grants(id,role_template_id,action,scope) VALUES ($1,$2,'case.filing.submit','SELF')",
      [randomUUID(), roleId],
    );
    await client.query(
      'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES ($1,$2,$3,now())',
      [randomUUID(), actorId, departmentId],
    );
    await client.query(
      'INSERT INTO role_assignments(id,user_id,department_id,role_template_id,active,updated_at) VALUES ($1,$2,$3,$4,true,now())',
      [randomUUID(), actorId, departmentId, roleId],
    );
    await client.query('SET session_replication_role = replica');
    try {
      await client.query(
        "INSERT INTO cases(id,business_no,department_id,source_lead_id,source_notary_matter_id,certificate_id,customer_id,rights_holder_id,responsible_user_id,stage,version,matched_at,complaint_amount_state,complaint_amount,complaint_submitted_at,complaint_submitted_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'WAITING_FORMAL_ACCEPTANCE',6,now(),'KNOWN',123.45,now(),$9)",
        [
          caseId,
          `CA006-${suffix}`,
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
        'INSERT INTO case_filing_submissions(id,department_id,case_id,court_id,court_name,submitted_at,recorded_by_user_id,audit_event_id) VALUES ($1,$2,$3,$4,$5,current_date,$6,$7)',
        [
          oldFilingId,
          departmentId,
          caseId,
          randomUUID(),
          'Old court',
          actorId,
          randomUUID(),
        ],
      );
      await client.query(
        'INSERT INTO case_filing_receipts(id,department_id,actor_user_id,case_id,idempotency_key,request_fingerprint,result_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [
          oldReceiptId,
          departmentId,
          actorId,
          caseId,
          'old-filing',
          'a'.repeat(64),
          { id: caseId },
        ],
      );
    } finally {
      await client.query('SET session_replication_role = origin');
    }
    await apply(targets);
    const upgrade = {
      oldFiling: await count(
        'SELECT COUNT(*) AS n FROM case_filing_submissions WHERE id=$1',
        [oldFilingId],
      ),
      oldReceipt: await count(
        'SELECT COUNT(*) AS n FROM case_filing_receipts WHERE id=$1',
        [oldReceiptId],
      ),
      copiedGrant: await count(
        "SELECT COUNT(*) AS n FROM role_grants WHERE role_template_id=$1 AND action='case.acceptance.register'",
        [roleId],
      ),
      revision: await count(
        'SELECT authorization_revision AS n FROM user_accounts WHERE id=$1',
        [actorId],
      ),
    };
    await client.query(
      "UPDATE cases SET stage='WAITING_HEARING',court_case_no='CA006-Court-No' WHERE id=$1",
      [caseId],
    );
    const auditId = randomUUID();
    await client.query(
      "INSERT INTO audit_events(id,department_id,actor_user_id,internal_actor_user_id,resource_type,resource_id,action) VALUES ($1,$2,$3,$3,'CASE',$4,'case.acceptance.registered')",
      [auditId, departmentId, actorId, caseId],
    );
    const insertFact =
      'INSERT INTO case_acceptances(id,department_id,case_id,accepted_at,court_case_no,recorded_by_user_id,audit_event_id) VALUES ($1,$2,$3,$4,$5,$6,$7)';
    const params = [
      randomUUID(),
      departmentId,
      caseId,
      new Date(),
      'CA006-Court-No',
      actorId,
      auditId,
    ];
    const earlyDate = await sqlCode(insertFact, [
      randomUUID(),
      departmentId,
      caseId,
      new Date(Date.now() - 86400000),
      'CA006-Court-No',
      actorId,
      auditId,
    ]);
    const futureDate = await sqlCode(insertFact, [
      randomUUID(),
      departmentId,
      caseId,
      new Date(Date.now() + 3 * 86400000),
      'CA006-Court-No',
      actorId,
      auditId,
    ]);
    const wrongAudit = await sqlCode(insertFact, [
      randomUUID(),
      departmentId,
      caseId,
      new Date(),
      'CA006-Court-No',
      actorId,
      randomUUID(),
    ]);
    await client.query(insertFact, params);
    const badVersion = await sqlCode(
      "INSERT INTO case_acceptance_versions(acceptance_id,case_id,department_id,material_id,content_version_id,category) VALUES ($1,$2,$3,$4,$5,'ACCEPTANCE_NOTICE')",
      [params[0], caseId, departmentId, randomUUID(), randomUUID()],
    );
    const immutableFact = await sqlCode(
      'UPDATE case_acceptances SET accepted_at=accepted_at WHERE id=$1',
      [params[0]],
    );
    const lawyerId = randomUUID(),
      profileId = randomUUID(),
      bindingId = randomUUID(),
      oldCaseId = randomUUID();
    await client.query('BEGIN');
    try {
      await client.query(
        "INSERT INTO user_accounts(id,external_subject,display_name,account_type,updated_at) VALUES ($1,$2,$3,'LAWYER',now())",
        [lawyerId, `ca006-lawyer-${lawyerId}`, 'CA006 lawyer'],
      );
      await client.query(
        'INSERT INTO lawyer_profiles(id,department_id,full_name,bound_user_id) VALUES ($1,$2,$3,$4)',
        [profileId, departmentId, 'CA006 lawyer', lawyerId],
      );
      await client.query(
        'INSERT INTO lawyer_account_bindings(id,user_id,department_id,profile_id,updated_at) VALUES ($1,$2,$3,$4,now())',
        [bindingId, lawyerId, departmentId, profileId],
      );
      await client.query(
        'INSERT INTO case_lawyer_assignments(id,case_id,department_id,lawyer_id,role,started_at) VALUES ($1,$2,$3,$4,$5,now())',
        [randomUUID(), caseId, departmentId, profileId, 'PRIMARY'],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    await client.query(
      "INSERT INTO audit_events(id,department_id,actor_user_id,lawyer_account_binding_id,resource_type,resource_id,action) VALUES ($1,$2,$3,$4,'CASE',$5,'case.acceptance.registered')",
      [randomUUID(), departmentId, lawyerId, bindingId, caseId],
    );
    const lawyerNewAction = await count(
      "SELECT COUNT(*) AS n FROM audit_events WHERE actor_user_id=$1 AND action='case.acceptance.registered'",
      [lawyerId],
    );
    await client.query('SET session_replication_role = replica');
    try {
      await client.query(
        "INSERT INTO cases(id,business_no,department_id,source_lead_id,source_notary_matter_id,certificate_id,customer_id,rights_holder_id,responsible_user_id,stage,version,matched_at,complaint_amount_state,complaint_amount,complaint_submitted_at,complaint_submitted_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'WAITING_FORMAL_ACCEPTANCE',6,now(),'KNOWN',123.45,now(),$9)",
        [
          oldCaseId,
          `CA006-old-${suffix}`,
          departmentId,
          randomUUID(),
          randomUUID(),
          randomUUID(),
          randomUUID(),
          randomUUID(),
          actorId,
        ],
      );
    } finally {
      await client.query('SET session_replication_role = origin');
    }
    await client.query(
      'INSERT INTO case_lawyer_assignments(id,case_id,department_id,lawyer_id,role,started_at) VALUES ($1,$2,$3,$4,$5,now())',
      [randomUUID(), oldCaseId, departmentId, profileId, 'PRIMARY'],
    );
    const lawyerWrongStage = await sqlCode(
      "INSERT INTO audit_events(id,department_id,actor_user_id,lawyer_account_binding_id,resource_type,resource_id,action) VALUES ($1,$2,$3,$4,'CASE',$5,'case.acceptance.registered')",
      [randomUUID(), departmentId, lawyerId, bindingId, oldCaseId],
    );
    await client.query(
      "INSERT INTO audit_events(id,department_id,actor_user_id,lawyer_account_binding_id,resource_type,resource_id,action) VALUES ($1,$2,$3,$4,'CASE',$5,'case.filing.submitted')",
      [randomUUID(), departmentId, lawyerId, bindingId, oldCaseId],
    );
    const lawyerOldAction = await count(
      "SELECT COUNT(*) AS n FROM audit_events WHERE actor_user_id=$1 AND resource_id=$2 AND action='case.filing.submitted'",
      [lawyerId, oldCaseId],
    );
    const constraints = {
      earlyDate,
      futureDate,
      wrongAudit,
      badVersion,
      immutableFact,
      lawyerNewAction,
      lawyerWrongStage,
      lawyerOldAction,
    };

    await use(schemas.failure);
    await apply(previous);
    await client.query('ALTER TYPE case_stage RENAME TO case_stage_held');
    const enumFailed = await sqlCode(
      await readFile(
        resolve(migrationRoot, targets[0], 'migration.sql'),
        'utf8',
      ),
    );
    const enumNoPartial = await count(
      "SELECT COUNT(*) AS n FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace p ON p.oid=t.typnamespace WHERE p.nspname=$1 AND t.typname='permission_action' AND e.enumlabel='case.acceptance.register'",
      [schemas.failure],
    );
    await client.query('ALTER TYPE case_stage_held RENAME TO case_stage');
    await apply([targets[0]]);
    await client.query('CREATE TABLE case_acceptances (collision integer)');
    const factsFailed = await sqlCode(
      await readFile(
        resolve(migrationRoot, targets[1], 'migration.sql'),
        'utf8',
      ),
    );
    const factsNoPartial = await count(
      "SELECT COUNT(*) AS n FROM information_schema.check_constraints WHERE constraint_schema=$1 AND constraint_name='cases_complaint_state_check' AND check_clause LIKE '%WAITING_HEARING%'",
      [schemas.failure],
    );
    await client.query('DROP TABLE case_acceptances');
    await apply([targets[1]]);
    const fDept = randomUUID(),
      fActor = randomUUID(),
      fRole = randomUUID();
    await client.query(
      'INSERT INTO departments(id,name,updated_at) VALUES ($1,$2,now())',
      [fDept, 'CA006 failure dept'],
    );
    await client.query(
      'INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES ($1,$2,$3,now())',
      [fActor, `ca006-${fActor}`, 'CA006 failure actor'],
    );
    await client.query(
      'INSERT INTO role_templates(id,department_id,name,updated_at) VALUES ($1,$2,$3,now())',
      [fRole, fDept, 'CA006 failure role'],
    );
    await client.query(
      "INSERT INTO role_grants(id,role_template_id,action,scope) VALUES ($1,$2,'case.filing.submit','TEAM')",
      [randomUUID(), fRole],
    );
    await client.query(
      'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES ($1,$2,$3,now())',
      [randomUUID(), fActor, fDept],
    );
    await client.query(
      'INSERT INTO role_assignments(id,user_id,department_id,role_template_id,active,updated_at) VALUES ($1,$2,$3,$4,true,now())',
      [randomUUID(), fActor, fDept, fRole],
    );
    await client.query(
      "CREATE FUNCTION fail_acceptance_grant() RETURNS trigger AS $$ BEGIN IF NEW.action = 'case.acceptance.register' THEN RAISE EXCEPTION 'forced failure' USING ERRCODE='23514'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql",
    );
    await client.query(
      'CREATE TRIGGER fail_acceptance_grant BEFORE INSERT ON role_grants FOR EACH ROW EXECUTE FUNCTION fail_acceptance_grant()',
    );
    const grantsFailed = await sqlCode(
      await readFile(
        resolve(migrationRoot, targets[2], 'migration.sql'),
        'utf8',
      ),
    );
    const grantsNoPartial = await count(
      "SELECT COUNT(*) AS n FROM role_grants WHERE role_template_id=$1 AND action='case.acceptance.register'",
      [fRole],
    );
    const revisionNoPartial = await count(
      'SELECT authorization_revision AS n FROM user_accounts WHERE id=$1',
      [fActor],
    );
    await client.query('DROP TRIGGER fail_acceptance_grant ON role_grants');
    await apply([targets[2]]);
    const recoveredGrant = await count(
      "SELECT COUNT(*) AS n FROM role_grants WHERE role_template_id=$1 AND action='case.acceptance.register'",
      [fRole],
    );
    const failure = {
      enumFailed,
      enumNoPartial,
      factsFailed,
      factsNoPartial,
      grantsFailed,
      grantsNoPartial,
      revisionNoPartial,
      recoveredGrant,
    };
    return { empty, upgrade, constraints, failure };
  } finally {
    await client.query('SET search_path TO public').catch(() => undefined);
    for (const schema of Object.values(schemas))
      await client
        .query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        .catch(() => undefined);
    await client.end();
  }
}
