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
    '20261006013000_seal_case_acceptance_versions',
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
    await apply(targets.slice(0, 3));
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
    const selectedMaterialId = randomUUID();
    const selectedVersionId = randomUUID();
    const laterMaterialId = randomUUID();
    const laterVersionId = randomUUID();
    const seedNotice = async (materialId, versionId) => {
      await client.query(
        "INSERT INTO materials(id,department_id,owner_type,owner_id,category,purpose,updated_at) VALUES ($1,$2,'CASE',$3,'ACCEPTANCE_NOTICE','ACCEPTANCE_NOTICE',now())",
        [materialId, departmentId, caseId],
      );
      await client.query(
        "INSERT INTO content_versions(id,material_id,storage_key,original_filename,mime_type,size_bytes,sha256,uploaded_by) VALUES ($1,$2,$3,'受理通知.pdf','application/pdf',4,$4,$5)",
        [versionId, materialId, `ca006/${versionId}`, 'a'.repeat(64), actorId],
      );
      await client.query(
        'UPDATE materials SET current_version_id=$1 WHERE id=$2',
        [versionId, materialId],
      );
    };
    await seedNotice(selectedMaterialId, selectedVersionId);
    await client.query(
      "INSERT INTO audit_events(id,department_id,actor_user_id,internal_actor_user_id,resource_type,resource_id,action,details) VALUES ($1,$2,$3,$3,'CASE',$4,'case.acceptance.registered',$5::jsonb)",
      [
        auditId,
        departmentId,
        actorId,
        caseId,
        JSON.stringify({
          acceptanceNoticeContentVersionIds: [selectedVersionId],
          paymentListContentVersionIds: [],
          serviceDocumentContentVersionIds: [],
        }),
      ],
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
    await client.query(
      "INSERT INTO case_acceptance_versions(acceptance_id,case_id,department_id,material_id,content_version_id,category) VALUES ($1,$2,$3,$4,$5,'ACCEPTANCE_NOTICE')",
      [params[0], caseId, departmentId, selectedMaterialId, selectedVersionId],
    );
    await client.query(
      "INSERT INTO material_references(id,department_id,resource_type,resource_id,purpose,material_id,content_version_id,action_event_id) VALUES ($1,$2,'case',$3,'ACCEPTANCE_NOTICE',$4,$5,$6)",
      [
        randomUUID(),
        departmentId,
        caseId,
        selectedMaterialId,
        selectedVersionId,
        auditId,
      ],
    );
    const oldAcceptanceReceiptId = randomUUID();
    await client.query(
      'INSERT INTO case_acceptance_receipts(id,department_id,actor_user_id,case_id,idempotency_key,request_fingerprint,result_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)',
      [
        oldAcceptanceReceiptId,
        departmentId,
        actorId,
        caseId,
        'accepted-before-guard',
        'b'.repeat(64),
        JSON.stringify({ id: caseId, courtCaseNo: 'CA006-Court-No' }),
      ],
    );
    await seedNotice(laterMaterialId, laterVersionId);
    await apply(targets.slice(3));
    Object.assign(upgrade, {
      oldAcceptanceFact: await count(
        'SELECT COUNT(*) AS n FROM case_acceptances WHERE id=$1 AND court_case_no=$2',
        [params[0], 'CA006-Court-No'],
      ),
      oldAcceptanceReceipt: await count(
        "SELECT COUNT(*) AS n FROM case_acceptance_receipts WHERE id=$1 AND result_snapshot->>'courtCaseNo'=$2",
        [oldAcceptanceReceiptId, 'CA006-Court-No'],
      ),
      oldAcceptanceFrozen: await count(
        'SELECT COUNT(*) AS n FROM case_acceptance_versions WHERE acceptance_id=$1 AND content_version_id=$2',
        [params[0], selectedVersionId],
      ),
      oldAcceptanceAudit: await count(
        "SELECT COUNT(*) AS n FROM audit_events WHERE id=$1 AND details->'acceptanceNoticeContentVersionIds' ? $2",
        [auditId, selectedVersionId],
      ),
    });
    const postRegistrationAppend = await sqlCode(
      "INSERT INTO case_acceptance_versions(acceptance_id,case_id,department_id,material_id,content_version_id,category) VALUES ($1,$2,$3,$4,$5,'ACCEPTANCE_NOTICE')",
      [params[0], caseId, departmentId, laterMaterialId, laterVersionId],
    );
    const parallelVersionIds = [randomUUID(), randomUUID()];
    const parallelMaterialIds = [randomUUID(), randomUUID()];
    for (let index = 0; index < 2; index++)
      await seedNotice(parallelMaterialIds[index], parallelVersionIds[index]);
    const secondClient = new Client({ connectionString: databaseUrl });
    await secondClient.connect();
    let parallelPostRegistrationAppends;
    try {
      await secondClient.query(`SET search_path TO "${schemas.upgrade}"`);
      const insertion =
        "INSERT INTO case_acceptance_versions(acceptance_id,case_id,department_id,material_id,content_version_id,category) VALUES ($1,$2,$3,$4,$5,'ACCEPTANCE_NOTICE')";
      parallelPostRegistrationAppends = await Promise.all([
        sqlCode(insertion, [
          params[0],
          caseId,
          departmentId,
          parallelMaterialIds[0],
          parallelVersionIds[0],
        ]),
        secondClient
          .query(insertion, [
            params[0],
            caseId,
            departmentId,
            parallelMaterialIds[1],
            parallelVersionIds[1],
          ])
          .then(
            () => null,
            (error) => error.code ?? null,
          ),
      ]);
    } finally {
      await secondClient.end();
    }
    const frozenAfterRejected = await count(
      'SELECT COUNT(*) AS n FROM case_acceptance_versions WHERE acceptance_id=$1',
      [params[0]],
    );
    const originalFactReceiptAfterRejected = await count(
      "SELECT COUNT(*) AS n FROM case_acceptances ca JOIN case_acceptance_receipts r ON r.case_id=ca.case_id AND r.department_id=ca.department_id JOIN audit_events a ON a.id=ca.audit_event_id WHERE ca.id=$1 AND r.id=$2 AND a.id=$3 AND ca.court_case_no='CA006-Court-No' AND r.result_snapshot->>'courtCaseNo'='CA006-Court-No' AND a.details->'acceptanceNoticeContentVersionIds' ? $4",
      [params[0], oldAcceptanceReceiptId, auditId, selectedVersionId],
    );
    const badVersion = await sqlCode(
      "INSERT INTO case_acceptance_versions(acceptance_id,case_id,department_id,material_id,content_version_id,category) VALUES ($1,$2,$3,$4,$5,'ACCEPTANCE_NOTICE')",
      [params[0], caseId, departmentId, randomUUID(), randomUUID()],
    );
    const immutableFact = await sqlCode(
      'UPDATE case_acceptances SET accepted_at=accepted_at WHERE id=$1',
      [params[0]],
    );
    const immutableAuditUpdate = await sqlCode(
      'UPDATE audit_events SET details=details WHERE id=$1',
      [auditId],
    );
    const immutableAuditDelete = await sqlCode(
      'DELETE FROM audit_events WHERE id=$1',
      [auditId],
    );
    const oldInternalAuditId = randomUUID();
    await client.query(
      "INSERT INTO audit_events(id,department_id,actor_user_id,internal_actor_user_id,resource_type,resource_id,action) VALUES ($1,$2,$3,$3,'CASE',$4,'case.filing.submitted')",
      [oldInternalAuditId, departmentId, actorId, caseId],
    );
    const relabelOldAuditToAcceptance = await sqlCode(
      "UPDATE audit_events SET action='case.acceptance.registered' WHERE id=$1",
      [oldInternalAuditId],
    );
    await client.query('DELETE FROM audit_events WHERE id=$1', [
      oldInternalAuditId,
    ]);
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
    const oldActionAuditId = randomUUID();
    await client.query(
      "INSERT INTO audit_events(id,department_id,actor_user_id,lawyer_account_binding_id,resource_type,resource_id,action) VALUES ($1,$2,$3,$4,'CASE',$5,'case.filing.submitted')",
      [oldActionAuditId, departmentId, lawyerId, bindingId, oldCaseId],
    );
    const lawyerOldAction = await count(
      "SELECT COUNT(*) AS n FROM audit_events WHERE actor_user_id=$1 AND resource_id=$2 AND action='case.filing.submitted'",
      [lawyerId, oldCaseId],
    );
    const oldAuditUpdate = await sqlCode(
      'UPDATE audit_events SET details=details WHERE id=$1',
      [oldActionAuditId],
    );
    const oldAuditDelete = await sqlCode(
      'DELETE FROM audit_events WHERE id=$1',
      [oldActionAuditId],
    );
    await client.query('SET session_replication_role = replica');
    try {
      await client.query(
        'INSERT INTO case_filing_submissions(id,department_id,case_id,court_id,court_name,submitted_at,recorded_by_user_id,audit_event_id) VALUES ($1,$2,$3,$4,$5,current_date,$6,$7)',
        [
          randomUUID(),
          departmentId,
          oldCaseId,
          randomUUID(),
          'Second court',
          actorId,
          randomUUID(),
        ],
      );
    } finally {
      await client.query('SET session_replication_role = origin');
    }
    await client.query(
      "UPDATE cases SET stage='WAITING_HEARING',court_case_no='CA006-Second' WHERE id=$1",
      [oldCaseId],
    );
    const incompleteAuditId = randomUUID();
    await client.query(
      "INSERT INTO audit_events(id,department_id,actor_user_id,internal_actor_user_id,resource_type,resource_id,action,details) VALUES ($1,$2,$3,$3,'CASE',$4,'case.acceptance.registered',$5::jsonb)",
      [
        incompleteAuditId,
        departmentId,
        actorId,
        oldCaseId,
        JSON.stringify({
          acceptanceNoticeContentVersionIds: [randomUUID()],
          paymentListContentVersionIds: [],
          serviceDocumentContentVersionIds: [],
        }),
      ],
    );
    await client.query(
      "INSERT INTO case_acceptances(id,department_id,case_id,accepted_at,court_case_no,recorded_by_user_id,audit_event_id) VALUES ($1,$2,$3,current_date,'CA006-Second',$4,$5)",
      [randomUUID(), departmentId, oldCaseId, actorId, incompleteAuditId],
    );
    const incompleteReceipt = await sqlCode(
      'INSERT INTO case_acceptance_receipts(id,department_id,actor_user_id,case_id,idempotency_key,request_fingerprint,result_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)',
      [
        randomUUID(),
        departmentId,
        actorId,
        oldCaseId,
        'missing-selected',
        'c'.repeat(64),
        JSON.stringify({ id: oldCaseId }),
      ],
    );
    const constraints = {
      earlyDate,
      futureDate,
      wrongAudit,
      badVersion,
      postRegistrationAppend,
      parallelPostRegistrationAppends,
      frozenAfterRejected,
      originalFactReceiptAfterRejected,
      immutableFact,
      immutableAuditUpdate,
      immutableAuditDelete,
      relabelOldAuditToAcceptance,
      lawyerNewAction,
      lawyerWrongStage,
      lawyerOldAction,
      oldAuditUpdate,
      oldAuditDelete,
      incompleteReceipt,
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
    const oldVersionGuard = (
      await client.query(
        "SELECT prosrc FROM pg_proc WHERE proname='check_case_acceptance_version' AND pronamespace=current_schema()::regnamespace",
      )
    ).rows[0].prosrc;
    await client.query(
      'CREATE FUNCTION check_case_acceptance_receipt() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql',
    );
    const sealFailed = await sqlCode(
      await readFile(
        resolve(migrationRoot, targets[3], 'migration.sql'),
        'utf8',
      ),
    );
    const sealNoPartial = await count(
      "SELECT COUNT(*) AS n FROM pg_trigger WHERE tgrelid='audit_events'::regclass AND tgname='case_acceptance_audit_immutable'",
    );
    const sealGuardUnchanged = Number(
      (
        await client.query(
          "SELECT prosrc FROM pg_proc WHERE proname='check_case_acceptance_version' AND pronamespace=current_schema()::regnamespace",
        )
      ).rows[0].prosrc === oldVersionGuard,
    );
    await client.query('DROP FUNCTION check_case_acceptance_receipt()');
    await apply([targets[3]]);
    const sealRecovered = await count(
      "SELECT COUNT(*) AS n FROM pg_trigger WHERE tgrelid='audit_events'::regclass AND tgname='case_acceptance_audit_immutable'",
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
      sealFailed,
      sealNoPartial,
      sealGuardUnchanged,
      sealRecovered,
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
