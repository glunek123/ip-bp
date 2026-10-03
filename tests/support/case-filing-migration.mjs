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

export async function verifyCaseFilingMigration() {
  const migrationRoot = resolve(root, 'backend/prisma/migrations');
  const targets = [
    '20261004010000_add_case_filing_enums',
    '20261004011000_add_case_filing_facts',
    '20261004012000_add_case_filing_grants',
  ];
  const previous = (await readdir(migrationRoot))
    .filter((name) => /^\d{14}_/u.test(name) && name < targets[0])
    .sort();
  if (
    previous.length !== 64 ||
    previous.at(-1) !== '20261003013000_add_case_client_mailing_actor_paths'
  )
    throw new Error('Unexpected previous schema');
  const suffix = randomUUID().replaceAll('-', '');
  const schemas = {
    empty: `ca005_empty_${suffix}`,
    upgrade: `ca005_upgrade_${suffix}`,
    failure: `ca005_failure_${suffix}`,
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
      previousMigrationCount: previous.length,
      migrationCount: previous.length + targets.length,
      stage: await count(
        "SELECT COUNT(*) AS n FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace p ON p.oid=t.typnamespace WHERE p.nspname=$1 AND t.typname='case_stage' AND e.enumlabel='WAITING_FORMAL_ACCEPTANCE'",
        [schemas.empty],
      ),
      courts: await count(
        "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=$1 AND table_name='filing_courts'",
        [schemas.empty],
      ),
      facts: await count(
        "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=$1 AND table_name='case_filing_submissions'",
        [schemas.empty],
      ),
    };

    await use(schemas.upgrade);
    await apply(previous);
    const departmentId = randomUUID(),
      actorId = randomUUID(),
      caseId = randomUUID(),
      roleId = randomUUID();
    await client.query(
      'INSERT INTO departments(id,name,updated_at) VALUES ($1,$2,now())',
      [departmentId, 'CA005 department'],
    );
    await client.query(
      'INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES ($1,$2,$3,now())',
      [actorId, `ca005-${actorId}`, 'CA005 actor'],
    );
    await client.query(
      'INSERT INTO role_templates(id,department_id,name,updated_at) VALUES ($1,$2,$3,now())',
      [roleId, departmentId, 'CA005 role'],
    );
    await client.query(
      "INSERT INTO role_grants(id,role_template_id,action,scope) VALUES ($1,$2,'case.complaint.mail','SELF')",
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
    const oldReceipt = randomUUID(),
      oldMail = randomUUID();
    await client.query('SET session_replication_role = replica');
    try {
      await client.query(
        "INSERT INTO cases(id,business_no,department_id,source_lead_id,source_notary_matter_id,certificate_id,customer_id,rights_holder_id,responsible_user_id,stage,version,matched_at,complaint_amount_state,complaint_amount,complaint_submitted_at,complaint_submitted_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'WAITING_FILING',5,now(),'KNOWN',123.45,now(),$9)",
        [
          caseId,
          `CA005-${suffix}`,
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
        "INSERT INTO case_complaint_mailings(id,department_id,case_id,mailed_at,recorded_by_user_id,actor_type,audit_event_id) VALUES ($1,$2,$3,current_date,$4,'INTERNAL',$5)",
        [oldMail, departmentId, caseId, actorId, randomUUID()],
      );
      await client.query(
        'INSERT INTO case_complaint_mailing_receipts(id,department_id,actor_user_id,case_id,idempotency_key,request_fingerprint,result_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [
          oldReceipt,
          departmentId,
          actorId,
          caseId,
          'old-mail',
          'a'.repeat(64),
          { id: caseId },
        ],
      );
    } finally {
      await client.query('SET session_replication_role = origin');
    }
    await apply(targets);
    const upgrade = {
      stage: (
        await client.query('SELECT stage FROM cases WHERE id=$1', [caseId])
      ).rows[0].stage,
      oldMail: await count(
        'SELECT COUNT(*) AS n FROM case_complaint_mailings WHERE id=$1',
        [oldMail],
      ),
      oldReceipt: await count(
        'SELECT COUNT(*) AS n FROM case_complaint_mailing_receipts WHERE id=$1',
        [oldReceipt],
      ),
      grantScope: (
        await client.query(
          "SELECT scope FROM role_grants WHERE role_template_id=$1 AND action='case.filing.submit'",
          [roleId],
        )
      ).rows[0]?.scope,
      revision: await count(
        'SELECT authorization_revision AS n FROM user_accounts WHERE id=$1',
        [actorId],
      ),
    };
    const courtId = randomUUID();
    await client.query(
      'INSERT INTO filing_courts(id,department_id,name) VALUES ($1,$2,$3)',
      [courtId, departmentId, 'CA005 real court'],
    );
    const duplicateCourt = await sqlCode(
      'INSERT INTO filing_courts(id,department_id,name) VALUES ($1,$2,$3)',
      [randomUUID(), departmentId, 'CA005 real court'],
    );
    const crossDepartmentCourt = await sqlCode(
      'INSERT INTO case_filing_submissions(id,department_id,case_id,court_id,court_name,submitted_at,recorded_by_user_id,audit_event_id) VALUES ($1,$2,$3,$4,$5,current_date,$6,$7)',
      [
        randomUUID(),
        randomUUID(),
        caseId,
        courtId,
        'CA005 real court',
        actorId,
        randomUUID(),
      ],
    );
    await client.query(
      "UPDATE cases SET stage='WAITING_FORMAL_ACCEPTANCE' WHERE id=$1",
      [caseId],
    );
    const auditId = randomUUID();
    await client.query(
      "INSERT INTO audit_events(id,department_id,actor_user_id,internal_actor_user_id,resource_type,resource_id,action) VALUES ($1,$2,$3,$3,'CASE',$4,'case.filing.submitted')",
      [auditId, departmentId, actorId, caseId],
    );
    const badDate = await sqlCode(
      'INSERT INTO case_filing_submissions(id,department_id,case_id,court_id,court_name,submitted_at,recorded_by_user_id,audit_event_id) VALUES ($1,$2,$3,$4,$5,current_date+10,$6,$7)',
      [
        randomUUID(),
        departmentId,
        caseId,
        courtId,
        'CA005 real court',
        actorId,
        auditId,
      ],
    );
    const badCourtSnapshot = await sqlCode(
      'INSERT INTO case_filing_submissions(id,department_id,case_id,court_id,court_name,submitted_at,recorded_by_user_id,audit_event_id) VALUES ($1,$2,$3,$4,$5,current_date,$6,$7)',
      [
        randomUUID(),
        departmentId,
        caseId,
        courtId,
        'Wrong court',
        actorId,
        auditId,
      ],
    );
    const submissionId = randomUUID();
    await client.query(
      'INSERT INTO case_filing_submissions(id,department_id,case_id,court_id,court_name,submitted_at,recorded_by_user_id,audit_event_id) VALUES ($1,$2,$3,$4,$5,current_date,$6,$7)',
      [
        submissionId,
        departmentId,
        caseId,
        courtId,
        'CA005 real court',
        actorId,
        auditId,
      ],
    );
    const badVersion = await sqlCode(
      "INSERT INTO case_filing_versions(submission_id,case_id,department_id,material_id,content_version_id,category) VALUES ($1,$2,$3,$4,$5,'FILING_EVIDENCE')",
      [submissionId, caseId, departmentId, randomUUID(), randomUUID()],
    );
    const immutableFact = await sqlCode(
      'UPDATE case_filing_submissions SET submitted_at=submitted_at WHERE id=$1',
      [submissionId],
    );
    const constraints = {
      duplicateCourt,
      crossDepartmentCourt,
      badDate,
      badCourtSnapshot,
      badVersion,
      immutableFact,
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
      "SELECT COUNT(*) AS n FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace p ON p.oid=t.typnamespace WHERE p.nspname=$1 AND t.typname='permission_action' AND e.enumlabel='case.filing.submit'",
      [schemas.failure],
    );
    await client.query('ALTER TYPE case_stage_held RENAME TO case_stage');
    await apply([targets[0]]);
    await client.query('CREATE TABLE filing_courts (collision integer)');
    const factsFailed = await sqlCode(
      await readFile(
        resolve(migrationRoot, targets[1], 'migration.sql'),
        'utf8',
      ),
    );
    const factsNoPartial = await count(
      "SELECT COUNT(*) AS n FROM information_schema.check_constraints WHERE constraint_schema=$1 AND constraint_name='cases_complaint_state_check' AND check_clause LIKE '%WAITING_FORMAL_ACCEPTANCE%'",
      [schemas.failure],
    );
    await client.query('DROP TABLE filing_courts');
    await apply([targets[1]]);
    const fDept = randomUUID(),
      fActor = randomUUID(),
      fRole = randomUUID();
    await client.query(
      'INSERT INTO departments(id,name,updated_at) VALUES ($1,$2,now())',
      [fDept, 'CA005 failure dept'],
    );
    await client.query(
      'INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES ($1,$2,$3,now())',
      [fActor, `ca005-${fActor}`, 'CA005 failure actor'],
    );
    await client.query(
      'INSERT INTO role_templates(id,department_id,name,updated_at) VALUES ($1,$2,$3,now())',
      [fRole, fDept, 'CA005 failure role'],
    );
    await client.query(
      "INSERT INTO role_grants(id,role_template_id,action,scope) VALUES ($1,$2,'case.complaint.mail','TEAM')",
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
      "CREATE FUNCTION fail_filing_grant() RETURNS trigger AS $$ BEGIN IF NEW.action = 'case.filing.submit' THEN RAISE EXCEPTION 'forced failure' USING ERRCODE='23514'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql",
    );
    await client.query(
      'CREATE TRIGGER fail_filing_grant BEFORE INSERT ON role_grants FOR EACH ROW EXECUTE FUNCTION fail_filing_grant()',
    );
    const grantsFailed = await sqlCode(
      await readFile(
        resolve(migrationRoot, targets[2], 'migration.sql'),
        'utf8',
      ),
    );
    const grantsNoPartial = await count(
      "SELECT COUNT(*) AS n FROM role_grants WHERE role_template_id=$1 AND action='case.filing.submit'",
      [fRole],
    );
    const revisionNoPartial = await count(
      'SELECT authorization_revision AS n FROM user_accounts WHERE id=$1',
      [fActor],
    );
    await client.query('DROP TRIGGER fail_filing_grant ON role_grants');
    await apply([targets[2]]);
    const recoveredGrant = await count(
      "SELECT COUNT(*) AS n FROM role_grants WHERE role_template_id=$1 AND action='case.filing.submit'",
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
