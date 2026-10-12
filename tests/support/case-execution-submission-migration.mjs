import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';

const root = process.cwd();
const requireBackend = createRequire(resolve(root, 'backend/package.json'));
const { Client } = requireBackend('pg');
const directory = resolve(root, 'backend/prisma/migrations');
const allNames = readdirSync(directory)
  .filter((name) => /^\d{14}_/u.test(name))
  .sort();
// Keep the CA-011 historical probe on its original 134-migration support
// window. CA-012's own migration probe applies and verifies the full chain.
const names = allNames.slice(0, 134);
const additions = [
  '20261011030000_add_case_execution_submission_enums',
  '20261011031000_add_case_execution_submission_facts',
  '20261011032000_guard_case_execution_submission',
  '20261012010000_fix_lawyer_execution_upload_stage',
];
const confirmationMigrations = [
  '20261012020000_add_case_execution_confirmation_enums',
  '20261012021000_guard_case_execution_confirmation',
];
const sql = (name) =>
  readFileSync(resolve(directory, name, 'migration.sql'), 'utf8');

async function replay(client, migrations) {
  for (const name of migrations) {
    try {
      await client.query(sql(name));
    } catch (error) {
      throw new Error(`Migration ${name}: ${error.message}`, { cause: error });
    }
  }
}

async function seedOldDirectChain(client) {
  const ids = Object.fromEntries(
    [
      'department',
      'actor',
      'customer',
      'holder',
      'case',
      'round',
      'acceptance',
      'judgment',
      'choice',
      'materialA',
      'materialB',
      'versionA',
      'versionB',
    ].map((name) => [name, randomUUID()]),
  );
  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL session_replication_role = replica');
    await client.query(
      'INSERT INTO departments(id,name,updated_at) VALUES ($1,$2,now())',
      [ids.department, 'CA011 migration fixture'],
    );
    await client.query(
      'INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES ($1,$2,$3,now())',
      [ids.actor, `ca011-${ids.actor}`, 'CA011 fixture actor'],
    );
    await client.query(
      'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES ($1,$2,$3,now())',
      [randomUUID(), ids.actor, ids.department],
    );
    await client.query(
      'INSERT INTO customers(id,name,normalized_name,department_id,responsible_user_id,updated_at) VALUES ($1,$2,$3,$4,$5,now())',
      [
        ids.customer,
        'CA011 fixture customer',
        'ca011 fixture customer',
        ids.department,
        ids.actor,
      ],
    );
    await client.query(
      'INSERT INTO rights_holders(id,name,department_id,updated_at) VALUES ($1,$2,$3,now())',
      [ids.holder, 'CA011 fixture holder', ids.department],
    );
    await client.query(
      `INSERT INTO cases(id,business_no,department_id,source_lead_id,source_notary_matter_id,certificate_id,
      customer_id,rights_holder_id,responsible_user_id,stage,version,matched_at,complaint_amount_state,complaint_amount,
      complaint_submitted_at,complaint_submitted_by_user_id,court_case_no,current_trial_round_id,current_acceptance_id,
      current_judgment_id,current_judgment_next_step_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'WAITING_EXECUTION_DOCUMENTS',11,now(),'KNOWN',100,
        now(),$9,'CA011-old',$10,$11,$12,$13)`,
      [
        ids.case,
        `CA011-${ids.case}`,
        ids.department,
        randomUUID(),
        randomUUID(),
        randomUUID(),
        ids.customer,
        ids.holder,
        ids.actor,
        ids.round,
        ids.acceptance,
        ids.judgment,
        ids.choice,
      ],
    );
    await client.query(
      'INSERT INTO case_trial_rounds(id,case_id,department_id,sequence) VALUES ($1,$2,$3,1)',
      [ids.round, ids.case, ids.department],
    );
    await client.query(
      `INSERT INTO case_acceptances(id,department_id,case_id,trial_round_id,accepted_at,court_case_no,
      recorded_by_user_id,audit_event_id) VALUES ($1,$2,$3,$4,'2026-10-01','CA011-old',$5,$6)`,
      [
        ids.acceptance,
        ids.department,
        ids.case,
        ids.round,
        ids.actor,
        randomUUID(),
      ],
    );
    await client.query(
      `INSERT INTO case_judgment_facts(id,department_id,case_id,trial_round_id,kind,
      judgment_received_at,judgment_amount_state,judgment_amount,paid_litigation_fee_state,
      recorded_by_user_id,from_version,to_version,audit_event_id)
      VALUES ($1,$2,$3,$4,'REGISTER','2026-10-05','KNOWN',100,'PENDING',$5,9,10,$6)`,
      [
        ids.judgment,
        ids.department,
        ids.case,
        ids.round,
        ids.actor,
        randomUUID(),
      ],
    );
    await client.query(
      `INSERT INTO case_judgment_next_steps(id,department_id,case_id,trial_round_id,judgment_id,
      next,execution_readiness_confirmed,from_version,to_version,recorded_by_user_id,audit_event_id)
      VALUES ($1,$2,$3,$4,$5,'EXECUTION',true,10,11,$6,$7)`,
      [
        ids.choice,
        ids.department,
        ids.case,
        ids.round,
        ids.judgment,
        ids.actor,
        randomUUID(),
      ],
    );
    for (const [materialId, versionId, suffix] of [
      [ids.materialA, ids.versionA, 'a'],
      [ids.materialB, ids.versionB, 'b'],
    ]) {
      await client.query(
        `INSERT INTO materials(id,department_id,owner_type,owner_id,category,purpose,
        current_version_id,updated_at) VALUES ($1,$2,'CASE',$3,'EXECUTION_APPLICATION',
        'EXECUTION_APPLICATION',$4,now())`,
        [materialId, ids.department, ids.case, versionId],
      );
      await client.query(
        `INSERT INTO content_versions(id,material_id,storage_key,original_filename,mime_type,
        size_bytes,sha256,uploaded_by) VALUES ($1,$2,$3,$4,'application/pdf',32,$5,$6)`,
        [
          versionId,
          materialId,
          `ca011-${versionId}`,
          `execution-${suffix}.pdf`,
          'a'.repeat(64),
          ids.actor,
        ],
      );
    }
    await client.query('COMMIT');
    return ids;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function seedCurrentLawyer(client, ids) {
  const lawyer = {
    userId: randomUUID(),
    profileId: randomUUID(),
    bindingId: randomUUID(),
  };
  await client.query('BEGIN');
  await client.query('SET LOCAL session_replication_role = replica');
  try {
    await client.query(
      `INSERT INTO user_accounts(id,external_subject,display_name,account_type,updated_at)
    VALUES ($1,$2,'CA011 migration lawyer','LAWYER',now())`,
      [lawyer.userId, `ca011-lawyer-${lawyer.userId}`],
    );
    await client.query(
      `INSERT INTO lawyer_profiles(id,department_id,bound_user_id,full_name)
    VALUES ($1,$2,$3,'CA011 migration lawyer')`,
      [lawyer.profileId, ids.department, lawyer.userId],
    );
    await client.query(
      `INSERT INTO lawyer_account_bindings(id,user_id,department_id,profile_id,updated_at)
    VALUES ($1,$2,$3,$4,now())`,
      [lawyer.bindingId, lawyer.userId, ids.department, lawyer.profileId],
    );
    await client.query(
      `INSERT INTO case_lawyer_assignments(id,case_id,department_id,lawyer_id,role,started_at)
    VALUES ($1,$2,$3,$4,'PRIMARY',now())`,
      [randomUUID(), ids.case, ids.department, lawyer.profileId],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
  return lawyer;
}

async function tryLawyerExecutionDraft(client, ids, lawyer) {
  try {
    await client.query(
      `INSERT INTO upload_drafts(id,department_id,actor_user_id,lawyer_account_binding_id,
      owner_type,owner_id,category,purpose,original_filename,declared_mime_type,expires_at,updated_at)
      VALUES ($1,$2,$3,$4,'CASE',$5,'EXECUTION_APPLICATION','EXECUTION_APPLICATION',
        'ca011-lawyer-application.pdf','application/pdf',now()+interval '1 day',now())`,
      [randomUUID(), ids.department, lawyer.userId, lawyer.bindingId, ids.case],
    );
    return { accepted: true, rejectedCode: null };
  } catch (error) {
    return { accepted: false, rejectedCode: error.code ?? null };
  }
}

async function submitSql(
  client,
  ids,
  {
    priorId = null,
    priorVersion = 11,
    versionId = ids.versionA,
    reason = null,
  } = {},
) {
  const submissionId = randomUUID();
  const auditId = randomUUID();
  const time = new Date().toISOString();
  const toVersion = priorVersion + 1;
  const details = {
    submissionId,
    trialRoundId: ids.round,
    judgmentNextStepId: ids.choice,
    secondInstanceResultId: null,
    priorSubmissionId: priorId,
    changeReason: reason,
    fromVersion: priorVersion,
    toVersion,
    executionApplicationContentVersionIds: [versionId],
  };
  const snapshot = {
    id: ids.case,
    submissionId,
    stage: 'WAITING_EXECUTION_CONFIRMATION',
    version: toVersion,
    submittedAt: time,
  };
  const materialId = versionId === ids.versionA ? ids.materialA : ids.materialB;
  await client.query('BEGIN');
  try {
    await client.query(
      `INSERT INTO audit_events(id,department_id,actor_user_id,internal_actor_user_id,
      resource_type,resource_id,action,details) VALUES ($1,$2,$3,$3,'CASE',$4,'case.execution.submitted',$5::jsonb)`,
      [auditId, ids.department, ids.actor, ids.case, JSON.stringify(details)],
    );
    await client.query(
      `INSERT INTO case_execution_submissions(id,case_id,department_id,trial_round_id,
      judgment_next_step_id,second_instance_result_id,prior_submission_id,change_reason,from_version,
      to_version,submitted_at,submitted_by_user_id,audit_event_id)
      VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,$9,$10,$11,$12)`,
      [
        submissionId,
        ids.case,
        ids.department,
        ids.round,
        ids.choice,
        priorId,
        reason,
        priorVersion,
        toVersion,
        time,
        ids.actor,
        auditId,
      ],
    );
    await client.query(
      `UPDATE cases SET stage='WAITING_EXECUTION_CONFIRMATION',version=$2,
      current_execution_submission_id=$3 WHERE id=$1`,
      [ids.case, toVersion, submissionId],
    );
    await client.query(
      `INSERT INTO case_execution_submission_versions(submission_id,case_id,department_id,
      material_id,content_version_id) VALUES ($1,$2,$3,$4,$5)`,
      [submissionId, ids.case, ids.department, materialId, versionId],
    );
    await client.query(
      `INSERT INTO material_references(id,department_id,resource_type,resource_id,purpose,
      material_id,content_version_id,action_event_id) VALUES ($1,$2,'case',$3,'EXECUTION_APPLICATION',$4,$5,$6)`,
      [randomUUID(), ids.department, ids.case, materialId, versionId, auditId],
    );
    await client.query(
      `INSERT INTO case_execution_submission_receipts(id,department_id,actor_user_id,case_id,
      idempotency_key,request_fingerprint,result_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [
        randomUUID(),
        ids.department,
        ids.actor,
        ids.case,
        `migration-${submissionId}`,
        'a'.repeat(64),
        JSON.stringify(snapshot),
      ],
    );
    await client.query('COMMIT');
    return { submissionId, auditId, snapshot };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

export async function verifyCaseExecutionSubmissionMigration() {
  if (process.env.NODE_ENV !== 'test')
    throw new Error('Isolated test database required');
  validateIsolatedTestDatabaseUrl(process.env.DATABASE_URL, {
    allowRandomPort: true,
  });
  if (
    names.length !== 134 ||
    additions.some((name, index) => names[130 + index] !== name) ||
    confirmationMigrations.some((name, index) => allNames[134 + index] !== name)
  )
    throw new Error('Unexpected CA-011 migration suffix');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  const schemas = ['upgrade', 'retry', 'empty'].map(
    (part) => `ca011_${part}_${randomUUID().replaceAll('-', '')}`,
  );
  try {
    await client.connect();
    const location = (
      await client.query(
        'SELECT current_database() AS db, current_schema() AS schema',
      )
    ).rows[0];
    if (location.db !== 'dev_cor_test' || location.schema !== 'public')
      throw new Error('Isolated public test database required');
    for (const schema of schemas)
      await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schemas[0]}"`);
    await replay(client, names.slice(0, 130));
    // Existing case and its old trial facts are never recreated by CA-011.
    await replay(client, additions.slice(0, 1));
    const ids = await seedOldDirectChain(client);
    await replay(client, additions.slice(1, 3));
    const lawyer = await seedCurrentLawyer(client, ids);
    const lawyerDraftBefore = await tryLawyerExecutionDraft(
      client,
      ids,
      lawyer,
    );
    await replay(client, additions.slice(3));
    const lawyerDraft = await tryLawyerExecutionDraft(client, ids, lawyer);
    const before = (
      await client.query(
        'SELECT stage,version,current_judgment_next_step_id FROM cases WHERE id=$1',
        [ids.case],
      )
    ).rows[0];
    const first = await submitSql(client, ids);
    const second = await submitSql(client, ids, {
      priorId: first.submissionId,
      priorVersion: 12,
      versionId: ids.versionB,
      reason: '补充更新执行材料',
    });
    const lawyerDraftAfterSubmit = await tryLawyerExecutionDraft(
      client,
      ids,
      lawyer,
    );
    const after = (
      await client.query(
        `SELECT c.stage,c.version,c.current_execution_submission_id,
      (SELECT count(*)::int FROM case_execution_submissions s WHERE s.case_id=c.id) AS submissions,
      (SELECT count(*)::int FROM case_execution_submission_versions v WHERE v.case_id=c.id) AS versions,
      (SELECT count(*)::int FROM material_references r WHERE r.resource_id=c.id AND r.purpose='EXECUTION_APPLICATION') AS refs
      FROM cases c WHERE c.id=$1`,
        [ids.case],
      )
    ).rows[0];
    await client.query(`SET search_path TO "${schemas[1]}"`);
    await replay(client, names.slice(0, 132));
    const badId = randomUUID();
    await client.query('BEGIN');
    await client.query('SET LOCAL session_replication_role = replica');
    await client.query(
      `INSERT INTO material_references(id,department_id,resource_type,resource_id,purpose,
      material_id,content_version_id) VALUES ($1,$2,'case',$3,'EXECUTION_APPLICATION',$4,$5)`,
      [badId, randomUUID(), randomUUID(), randomUUID(), randomUUID()],
    );
    await client.query('COMMIT');
    let invalidRejected = false;
    try {
      await client.query(sql(additions[2]));
    } catch (error) {
      invalidRejected = error.code === '23514';
      await client.query('ROLLBACK');
    }
    const atomic = (
      await client.query(
        `SELECT to_regprocedure('check_case_execution_submission_final()') IS NULL AS clean`,
      )
    ).rows[0].clean;
    await client.query('DELETE FROM material_references WHERE id=$1', [badId]);
    await replay(client, [additions[2]]);
    const retry = (
      await client.query(
        `SELECT to_regprocedure('check_case_execution_submission_final()') IS NOT NULL AS ready`,
      )
    ).rows[0].ready;
    const beforeActorFix = (
      await client.query(
        `SELECT pg_get_functiondef(p.oid) AS definition FROM pg_proc p
          JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname=current_schema() AND p.proname='enforce_case_client_mailing_actor_path' AND p.pronargs=0`,
      )
    ).rows[0].definition;
    const actorArm = `WHEN NEW."category" IN ('SECOND_INSTANCE_DOCUMENT', 'SECOND_INSTANCE_SERVICE', 'SECOND_INSTANCE_JUDGMENT', 'EXECUTION_APPLICATION') THEN 'SECOND_INSTANCE'`;
    if (!beforeActorFix.includes(actorArm))
      throw new Error('Expected pre-134 lawyer actor path unavailable');
    const unknownActorPath = beforeActorFix.replace(
      actorArm,
      actorArm.replace("THEN 'SECOND_INSTANCE'", "THEN 'UNKNOWN_STAGE'"),
    );
    await client.query(unknownActorPath);
    let actorInvalidRejected = false;
    try {
      await client.query(sql(additions[3]));
    } catch (error) {
      actorInvalidRejected = error.code === '23514';
      await client.query('ROLLBACK');
    }
    const actorAtomic =
      (
        await client.query(
          `SELECT pg_get_functiondef(p.oid) AS definition FROM pg_proc p
            JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname=current_schema() AND p.proname='enforce_case_client_mailing_actor_path' AND p.pronargs=0`,
        )
      ).rows[0].definition === unknownActorPath;
    await client.query(beforeActorFix);
    await replay(client, [additions[3]]);
    const actorRetry = (
      await client.query(
        `SELECT pg_get_functiondef(p.oid) LIKE '%WHEN NEW."category" = ''EXECUTION_APPLICATION'' THEN ''WAITING_EXECUTION_DOCUMENTS,WAITING_EXECUTION_CONFIRMATION''%' AS ready
          FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname=current_schema() AND p.proname='enforce_case_client_mailing_actor_path' AND p.pronargs=0`,
      )
    ).rows[0].ready;
    await client.query(`SET search_path TO "${schemas[2]}"`);
    await replay(client, names);
    const emptyChain = (
      await client.query(
        `SELECT pg_get_functiondef(p.oid) LIKE '%WHEN NEW."category" = ''EXECUTION_APPLICATION'' THEN ''WAITING_EXECUTION_DOCUMENTS,WAITING_EXECUTION_CONFIRMATION''%' AS ready
          FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname=current_schema() AND p.proname='enforce_case_client_mailing_actor_path' AND p.pronargs=0`,
      )
    ).rows[0].ready;
    return {
      migrationCount: names.length,
      oldChainPreserved:
        before.stage === 'WAITING_EXECUTION_DOCUMENTS' &&
        before.version === 11 &&
        before.current_judgment_next_step_id === ids.choice,
      first: first.snapshot.version === 12,
      resubmitted:
        second.snapshot.version === 13 &&
        after.stage === 'WAITING_EXECUTION_CONFIRMATION' &&
        after.version === 13 &&
        after.current_execution_submission_id === second.submissionId,
      history:
        after.submissions === 2 && after.versions === 2 && after.refs === 2,
      invalidRejected,
      atomic,
      retry,
      lawyerDraftBefore,
      lawyerDraft,
      lawyerDraftAfterSubmit,
      actorInvalidRejected,
      actorAtomic,
      actorRetry,
      emptyChain,
    };
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.query('SET search_path TO public').catch(() => undefined);
    for (const schema of schemas)
      await client
        .query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        .catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

export async function verifyCaseExecutionConfirmationMigration() {
  if (process.env.NODE_ENV !== 'test')
    throw new Error('Isolated test database required');
  validateIsolatedTestDatabaseUrl(process.env.DATABASE_URL, {
    allowRandomPort: true,
  });
  if (
    allNames.length !== 136 ||
    confirmationMigrations.some((name, index) => allNames[134 + index] !== name)
  )
    throw new Error('Unexpected CA-012 migration suffix');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  const schemas = Object.fromEntries(
    ['empty', 'upgrade', 'enum_failure', 'guard_retry'].map((part) => [
      part,
      `ca012_${part}_${randomUUID().replaceAll('-', '')}`,
    ]),
  );
  const use = (schema) => client.query(`SET search_path TO "${schema}"`);
  const count = async (statement, values = []) =>
    Number((await client.query(statement, values)).rows[0].n);
  const sqlCode = async (targetClient, statement, values = []) => {
    await targetClient.query('BEGIN');
    try {
      await targetClient.query(statement, values);
      await targetClient.query('SET CONSTRAINTS ALL IMMEDIATE');
      return null;
    } catch (error) {
      await targetClient.query('ROLLBACK').catch(() => undefined);
      return error.code ?? null;
    } finally {
      await targetClient.query('ROLLBACK').catch(() => undefined);
    }
  };
  try {
    await client.connect();
    const location = (
      await client.query(
        'SELECT current_database() AS db,current_schema() AS schema',
      )
    ).rows[0];
    if (location.db !== 'dev_cor_test' || location.schema !== 'public')
      throw new Error('Isolated public test database required');
    for (const schema of Object.values(schemas))
      await client.query(`CREATE SCHEMA "${schema}"`);

    await use(schemas.empty);
    await replay(client, allNames);
    const emptyChain =
      (await count(
        'SELECT count(*) AS n FROM information_schema.tables WHERE table_schema=$1 AND table_name IN ($2,$3)',
        [
          schemas.empty,
          'case_execution_confirmations',
          'case_execution_confirmation_receipts',
        ],
      )) === 2 &&
      (await count(
        `SELECT count(*) AS n FROM pg_trigger t
          WHERE t.tgrelid IN ('case_execution_confirmations'::regclass,
            'case_execution_confirmation_receipts'::regclass)
            AND NOT t.tgisinternal`,
      )) >= 3;

    await use(schemas.upgrade);
    await replay(client, names);
    const ids = await seedOldDirectChain(client);
    const first = await submitSql(client, ids);
    const second = await submitSql(client, ids, {
      priorId: first.submissionId,
      priorVersion: 12,
      versionId: ids.versionB,
      reason: 'CA-012 migration history bundle',
    });
    const roleId = randomUUID();
    await client.query(
      'INSERT INTO role_templates(id,department_id,name,updated_at) VALUES ($1,$2,$3,now())',
      [roleId, ids.department, `CA012 ${roleId}`],
    );
    await client.query(
      "INSERT INTO role_grants(id,role_template_id,action,scope) VALUES ($1,$2,'case.execution.submit','TEAM')",
      [randomUUID(), roleId],
    );
    await client.query(
      'INSERT INTO role_assignments(id,user_id,department_id,role_template_id,active,updated_at) VALUES ($1,$2,$3,$4,true,now())',
      [randomUUID(), ids.actor, ids.department, roleId],
    );
    const permissionBefore = (
      await client.query(
        `SELECT t.version AS role_version,u.authorization_revision
          FROM role_templates t JOIN user_accounts u ON u.id=$2 WHERE t.id=$1`,
        [roleId, ids.actor],
      )
    ).rows[0];
    await replay(client, confirmationMigrations);
    const permissionAfter = (
      await client.query(
        `SELECT g.scope,t.version AS role_version,u.authorization_revision
          FROM role_templates t JOIN role_grants g ON g.role_template_id=t.id
            AND g.action='case.execution.confirm'
          JOIN user_accounts u ON u.id=$2 WHERE t.id=$1`,
        [roleId, ids.actor],
      )
    ).rows[0];
    const sameScopePermission =
      permissionAfter?.scope === 'TEAM' &&
      permissionAfter.role_version === permissionBefore.role_version + 1 &&
      permissionAfter.authorization_revision ===
        permissionBefore.authorization_revision + 1;
    const historicalBefore = (
      await client.query(
        `SELECT count(*)::int AS submissions,
          (SELECT count(*)::int FROM case_execution_submission_versions WHERE case_id=$1) AS versions,
          stage,version,current_execution_submission_id
         FROM cases c LEFT JOIN case_execution_submissions s ON s.case_id=c.id
         WHERE c.id=$1 GROUP BY c.stage,c.version,c.current_execution_submission_id`,
        [ids.case],
      )
    ).rows[0];
    const invalidStage = await sqlCode(
      client,
      `UPDATE cases SET stage='WAITING_EXECUTION_STAMP',version=version+1 WHERE id=$1`,
      [ids.case],
    );
    const confirmedAt = new Date().toISOString();
    const confirmationId = randomUUID();
    const auditId = randomUUID();
    const result = {
      id: ids.case,
      confirmationId,
      submissionId: second.submissionId,
      stage: 'WAITING_EXECUTION_STAMP',
      version: 14,
      confirmedAt,
    };
    await client.query('BEGIN');
    try {
      await client.query(
        `INSERT INTO audit_events(id,department_id,actor_user_id,internal_actor_user_id,
          resource_type,resource_id,action,details)
         VALUES ($1,$2,$3,$3,'CASE',$4,'case.execution.confirmed',$5::jsonb)`,
        [
          auditId,
          ids.department,
          ids.actor,
          ids.case,
          JSON.stringify({
            confirmationId,
            submissionId: second.submissionId,
            fromVersion: 13,
            toVersion: 14,
          }),
        ],
      );
      await client.query(
        `INSERT INTO case_execution_confirmations(id,case_id,department_id,submission_id,
          from_version,to_version,confirmed_at,confirmed_by_user_id,audit_event_id)
         VALUES ($1,$2,$3,$4,13,14,$5,$6,$7)`,
        [
          confirmationId,
          ids.case,
          ids.department,
          second.submissionId,
          confirmedAt,
          ids.actor,
          auditId,
        ],
      );
      await client.query(
        `UPDATE cases SET stage='WAITING_EXECUTION_STAMP',version=14 WHERE id=$1`,
        [ids.case],
      );
      await client.query(
        `INSERT INTO case_execution_confirmation_receipts(id,department_id,actor_user_id,
          case_id,idempotency_key,request_fingerprint,result_snapshot)
         VALUES ($1,$2,$3,$4,'ca012-migration-confirm',$5,$6::jsonb)`,
        [
          randomUUID(),
          ids.department,
          ids.actor,
          ids.case,
          'b'.repeat(64),
          JSON.stringify(result),
        ],
      );
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
    const confirmed = (
      await client.query(
        `SELECT c.stage,c.version,c.current_execution_submission_id,
          f.submission_id,f.from_version,f.to_version,
          (SELECT count(*)::int FROM case_execution_submissions WHERE case_id=c.id) AS submissions,
          (SELECT count(*)::int FROM case_execution_submission_versions WHERE case_id=c.id) AS versions,
          (SELECT count(*)::int FROM case_execution_confirmations WHERE case_id=c.id) AS confirmations
         FROM cases c JOIN case_execution_confirmations f ON f.case_id=c.id WHERE c.id=$1`,
        [ids.case],
      )
    ).rows[0];
    const oldHistoryPreserved =
      historicalBefore.submissions === 2 &&
      historicalBefore.versions === 2 &&
      historicalBefore.stage === 'WAITING_EXECUTION_CONFIRMATION' &&
      historicalBefore.version === 13 &&
      historicalBefore.current_execution_submission_id ===
        second.submissionId &&
      confirmed.submissions === 2 &&
      confirmed.versions === 2 &&
      confirmed.confirmations === 1 &&
      confirmed.submission_id === second.submissionId &&
      confirmed.from_version === 13 &&
      confirmed.to_version === 14 &&
      confirmed.current_execution_submission_id === second.submissionId &&
      confirmed.stage === 'WAITING_EXECUTION_STAMP' &&
      confirmed.version === 14;
    const directResubmit = await sqlCode(
      client,
      `UPDATE cases SET stage='WAITING_EXECUTION_CONFIRMATION',version=version+1 WHERE id=$1`,
      [ids.case],
    );
    await client.query('BEGIN');
    let directSubmissionInsert = null;
    try {
      const directAuditId = randomUUID();
      await client.query(
        `INSERT INTO audit_events(id,department_id,actor_user_id,internal_actor_user_id,
          resource_type,resource_id,action,details)
         VALUES ($1,$2,$3,$3,'CASE',$4,'case.execution.submitted','{}'::jsonb)`,
        [directAuditId, ids.department, ids.actor, ids.case],
      );
      await client.query(
        `INSERT INTO case_execution_submissions(id,case_id,department_id,trial_round_id,
          judgment_next_step_id,second_instance_result_id,prior_submission_id,change_reason,
          from_version,to_version,submitted_by_user_id,audit_event_id)
         VALUES ($1,$2,$3,$4,$5,NULL,$6,'direct SQL after confirmation',14,15,$7,$8)`,
        [
          randomUUID(),
          ids.case,
          ids.department,
          ids.round,
          ids.choice,
          second.submissionId,
          ids.actor,
          directAuditId,
        ],
      );
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    } catch (error) {
      directSubmissionInsert = error.code ?? null;
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
    }

    await use(schemas.enum_failure);
    await replay(client, names);
    await client.query(
      'ALTER TYPE "permission_action" ADD VALUE \'case.execution.confirm\'',
    );
    let enumFailureCode = null;
    try {
      await client.query(sql(confirmationMigrations[0]));
    } catch (error) {
      enumFailureCode = error.code ?? null;
      await client.query('ROLLBACK').catch(() => undefined);
    }
    const enumFailureAtomic =
      enumFailureCode !== null &&
      (await count(
        `SELECT count(*) AS n FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
          JOIN pg_namespace n ON n.oid=t.typnamespace
          WHERE n.nspname=$1 AND t.typname='case_stage' AND e.enumlabel='WAITING_EXECUTION_STAMP'`,
        [schemas.enum_failure],
      )) === 0;

    await use(schemas.guard_retry);
    await replay(client, names);
    await replay(client, [confirmationMigrations[0]]);
    const beforeGuard = (
      await client.query(
        `SELECT pg_get_functiondef(p.oid) AS definition FROM pg_proc p
          JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname=current_schema() AND p.proname='check_case_execution_submission_final' AND p.pronargs=0`,
      )
    ).rows[0].definition;
    const needle = `c."stage" <> 'WAITING_EXECUTION_CONFIRMATION' OR c."version" <> e."to_version"`;
    if (!beforeGuard.includes(needle))
      throw new Error('Expected CA-011 submission guard unavailable');
    const changedGuard = beforeGuard.replace(
      needle,
      `c."stage" <> 'CA012_UNKNOWN_STAGE' OR c."version" <> e."to_version"`,
    );
    await client.query(changedGuard);
    let guardFailureCode = null;
    try {
      await client.query(sql(confirmationMigrations[1]));
    } catch (error) {
      guardFailureCode = error.code ?? null;
      await client.query('ROLLBACK').catch(() => undefined);
    }
    const guardFailureAtomic =
      guardFailureCode === '23514' &&
      (await count(
        `SELECT count(*) AS n FROM information_schema.tables WHERE table_schema=$1
          AND table_name IN ('case_execution_confirmations','case_execution_confirmation_receipts')`,
        [schemas.guard_retry],
      )) === 0 &&
      (
        await client.query(
          `SELECT pg_get_functiondef(p.oid) AS definition FROM pg_proc p
          JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname=current_schema() AND p.proname='check_case_execution_submission_final' AND p.pronargs=0`,
        )
      ).rows[0].definition === changedGuard;
    await client.query(beforeGuard);
    await replay(client, [confirmationMigrations[1]]);
    const guardRetry =
      (await count(
        `SELECT count(*) AS n FROM information_schema.tables WHERE table_schema=$1
          AND table_name IN ('case_execution_confirmations','case_execution_confirmation_receipts')`,
        [schemas.guard_retry],
      )) === 2 &&
      (
        await client.query(
          `SELECT to_regprocedure('check_case_execution_confirmation_final()') IS NOT NULL AS ready`,
        )
      ).rows[0].ready;

    return {
      migrationCount: allNames.length,
      emptyChain,
      sameScopePermission,
      invalidStage,
      oldHistoryPreserved,
      directResubmit,
      directSubmissionInsert,
      enumFailureAtomic,
      guardFailureAtomic,
      guardRetry,
    };
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.query('SET search_path TO public').catch(() => undefined);
    for (const schema of Object.values(schemas))
      await client
        .query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        .catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}
