import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';
import { verifyCaseJudgmentDatabase } from './case-judgment-database.mjs';

const requireBackend = createRequire(resolve(process.cwd(), 'backend/package.json'));
const { Client } = requireBackend('pg');
const { PrismaClient } = requireBackend('./dist/generated/prisma/client.js');
const { PrismaPg } = requireBackend('@prisma/adapter-pg');
const { AccessControlService } = requireBackend('./dist/access-control/access-control.service.js');
const { PrismaAccessControlStore } = requireBackend('./dist/access-control/prisma-access-control.store.js');
const { CaseJudgmentNextStepService } = requireBackend('./dist/modules/cases/case-judgment-next-step.service.js');
const { hashPassword } = requireBackend('./dist/auth/password.js');
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || process.env.NODE_ENV !== 'test') throw new Error('Isolated test database required');
validateIsolatedTestDatabaseUrl(databaseUrl, { allowRandomPort: true });

const fixtureOwners = Object.freeze({
  '10000000-0000-4000-8000-000000000001': [
    ['20000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001'],
    ['20000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002'],
    ['20000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000004'],
  ],
  '10000000-0000-4000-8000-000000000002': [
    ['20000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000003'],
  ],
});
const immutable = [
  ['case_judgment_next_step_receipts', 'case_judgment_next_step_receipts_immutable'],
  ['case_judgment_next_step_revocations', 'case_judgment_next_step_revocations_immutable'],
  ['case_judgment_appeal_defendants', 'case_judgment_appeal_defendants_immutable'],
  ['case_judgment_next_steps', 'case_judgment_next_steps_immutable'],
  ['audit_events', 'case_judgment_audit_immutable'],
];

async function attemptForgedPlaintiffSnapshot(client, ids) {
  const choiceId = randomUUID();
  const auditId = randomUUID();
  const recordedAt = new Date().toISOString();
  let code = null;
  await client.query('BEGIN');
  try {
    await client.query(`INSERT INTO audit_events(id,department_id,actor_user_id,internal_actor_user_id,
      resource_type,resource_id,action,details)
      VALUES ($1,$2,$3,$3,'CASE',$4,'case.judgment.next_step',$5::jsonb)`,
      [auditId, ids.department, ids.actor, ids.case, JSON.stringify({
        choiceId, judgmentId: ids.judgment, next: 'APPEAL', fromVersion: 10, toVersion: 11,
        plaintiffAppeals: true, defendantIds: [], executionReadinessConfirmed: false,
      })]);
    await client.query(`INSERT INTO case_judgment_next_steps(id,case_id,department_id,judgment_id,
      next,plaintiff_rights_holder_id,plaintiff_name,execution_readiness_confirmed,
      from_version,to_version,recorded_at,recorded_by_user_id,audit_event_id)
      VALUES ($1,$2,$3,$4,'APPEAL',$5,'伪造原告名',false,10,11,$6,$7,$8)`,
      [choiceId, ids.case, ids.department, ids.judgment, ids.holder, recordedAt, ids.actor, auditId]);
    await client.query(`UPDATE cases SET stage='SECOND_INSTANCE',version=11,
      current_judgment_next_step_id=$1 WHERE id=$2`, [choiceId, ids.case]);
    await client.query(`INSERT INTO case_judgment_next_step_receipts(department_id,actor_user_id,
      case_id,action,idempotency_key,request_fingerprint,result_snapshot)
      VALUES ($1,$2,$3,'CHOOSE',$4,$5,$6::jsonb)`,
      [ids.department, ids.actor, ids.case, `forged-${choiceId}`, 'a'.repeat(64), JSON.stringify({
        id: ids.case, stage: 'SECOND_INSTANCE', version: 11, choiceId,
        judgmentId: ids.judgment, recordedAt,
      })]);
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
  } catch (error) { code = error.code; }
  finally { await client.query('ROLLBACK'); }
  return code;
}

async function judgmentNextStepState(database, caseId) {
  const item = await database.case.findUnique({ where: { id: caseId },
    select: { stage: true, version: true, currentJudgmentId: true, currentJudgmentNextStepId: true } });
  return JSON.stringify({ item,
    choices: await database.caseJudgmentNextStep.count({ where: { caseId } }),
    parties: await database.caseJudgmentAppealDefendant.count({ where: { caseId } }),
    revocations: await database.caseJudgmentNextStepRevocation.count({ where: { caseId } }),
    receipts: await database.caseJudgmentNextStepReceipt.count({ where: { caseId } }),
    audits: await database.auditEvent.count({ where: { resourceId: caseId,
      action: { in: ['case.judgment.next_step', 'case.judgment.next_step.revoke'] } } }),
  });
}

async function assertInjectedChoiceRollback(client, database, service, actor, ids, table) {
  const fault = `ca009_fault_${randomUUID().replaceAll('-', '')}`;
  const allowed = ['audit_events', 'case_judgment_next_steps',
    'case_judgment_appeal_defendants', 'case_judgment_next_step_receipts'];
  if (!allowed.includes(table)) throw new Error('Unexpected CA-009 fault table');
  const before = await judgmentNextStepState(database, ids.case);
  await client.query(`CREATE FUNCTION "${fault}"() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION '${fault}'; END $$`);
  try {
    await client.query(`CREATE TRIGGER "${fault}" BEFORE INSERT ON "${table}"
      FOR EACH ROW EXECUTE FUNCTION "${fault}"()`);
    let injected = false;
    try { await service.choose(actor, ids.case, { expectedVersion: 14,
      idempotencyKey: `${table}-${ids.case}`, judgmentId: ids.judgment,
      next: 'APPEAL', plaintiffAppeals: true, defendantIds: [ids.defendantA] }); }
    catch (error) { injected = String(error.message).includes(fault); if (!injected) throw error; }
    if (!injected || await judgmentNextStepState(database, ids.case) !== before)
      throw new Error(`CA-009 ${table} fault did not roll back every write`);
  } finally {
    await client.query(`DROP TRIGGER IF EXISTS "${fault}" ON "${table}"`);
    await client.query(`DROP FUNCTION IF EXISTS "${fault}"()`);
  }
}

async function seedOtherCaseInTransaction(client, ids) {
  const otherCaseId = randomUUID();
  await client.query('SET LOCAL session_replication_role = replica');
  await client.query(`INSERT INTO cases(id,business_no,department_id,source_lead_id,source_notary_matter_id,
    certificate_id,customer_id,rights_holder_id,responsible_user_id,stage,version,matched_at,
    complaint_amount_state,complaint_amount,complaint_submitted_at,complaint_submitted_by_user_id,court_case_no)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'WAITING_JUDGMENT',10,now(),'KNOWN',100,now(),$9,'CA009-foreign')`,
    [otherCaseId, `CA009-foreign-${otherCaseId}`, ids.department, randomUUID(), randomUUID(),
      randomUUID(), ids.customer, ids.holder, ids.actor]);
  await client.query('SET LOCAL session_replication_role = origin');
  return otherCaseId;
}

async function attemptDirectChoice(client, database, ids, variant) {
  const before = await judgmentNextStepState(database, ids.case);
  const choiceId = randomUUID();
  const auditId = randomUUID();
  const recordedAt = new Date().toISOString();
  const isExecution = variant === 'executionParty';
  const plaintiff = variant !== 'noParty' && !isExecution;
  const next = isExecution ? 'EXECUTION' : 'APPEAL';
  const fromVersion = variant === 'wrongVersion' ? 15 : 14;
  const toVersion = fromVersion + 1;
  let defendantId = variant === 'noParty' ? null : ids.defendantA;
  let code = null;
  await client.query('BEGIN');
  try {
    if (variant === 'foreignDefendant') {
      const otherCaseId = await seedOtherCaseInTransaction(client, ids);
      defendantId = randomUUID();
      await client.query('SET LOCAL session_replication_role = replica');
      await client.query(`INSERT INTO case_defendants(id,case_id,department_id,kind,name)
        VALUES ($1,$2,$3,'ORGANIZATION','外案被告')`, [defendantId, otherCaseId, ids.department]);
      await client.query('SET LOCAL session_replication_role = origin');
    }
    await client.query(`INSERT INTO audit_events(id,department_id,actor_user_id,internal_actor_user_id,
      resource_type,resource_id,action,details)
      VALUES ($1,$2,$3,$3,'CASE',$4,'case.judgment.next_step',$5::jsonb)`,
      [auditId, ids.department, ids.actor, ids.case, JSON.stringify({
        choiceId, judgmentId: variant === 'wrongJudgment' ? randomUUID() : ids.judgment,
        next: variant === 'badAudit' ? 'EXECUTION' : next,
        fromVersion, toVersion, plaintiffAppeals: plaintiff,
        defendantIds: defendantId === null ? [] : [defendantId],
        executionReadinessConfirmed: isExecution,
      })]);
    await client.query(`INSERT INTO case_judgment_next_steps(id,case_id,department_id,judgment_id,next,
      plaintiff_rights_holder_id,plaintiff_name,execution_readiness_confirmed,from_version,to_version,
      recorded_at,recorded_by_user_id,audit_event_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [choiceId, ids.case, ids.department, variant === 'wrongJudgment' ? randomUUID() : ids.judgment,
        next, plaintiff ? ids.holder : null, plaintiff ? 'CA009 plaintiff' : null,
        isExecution, fromVersion, toVersion, recordedAt, ids.actor, auditId]);
    if (defendantId !== null)
      await client.query(`INSERT INTO case_judgment_appeal_defendants(choice_id,case_id,department_id,
        defendant_id,name_snapshot) VALUES ($1,$2,$3,$4,$5)`,
        [choiceId, ids.case, ids.department, defendantId,
          variant === 'foreignDefendant' ? '外案被告' : '同名被告']);
    await client.query(`UPDATE cases SET stage=$1,version=15,current_judgment_next_step_id=$2 WHERE id=$3`,
      [isExecution ? 'WAITING_EXECUTION_DOCUMENTS' : 'SECOND_INSTANCE', choiceId, ids.case]);
    await client.query(`INSERT INTO case_judgment_next_step_receipts(department_id,actor_user_id,
      case_id,action,idempotency_key,request_fingerprint,result_snapshot)
      VALUES ($1,$2,$3,'CHOOSE',$4,$5,$6::jsonb)`,
      [ids.department, ids.actor, ids.case, `direct-${variant}-${choiceId}`, 'b'.repeat(64), JSON.stringify({
        id: ids.case, stage: isExecution ? 'WAITING_EXECUTION_DOCUMENTS' : 'SECOND_INSTANCE',
        version: 15, choiceId, judgmentId: variant === 'badReceipt' ? randomUUID() : ids.judgment,
        recordedAt,
      })]);
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
  } catch (error) { code = error.code; }
  finally { await client.query('ROLLBACK'); }
  if (await judgmentNextStepState(database, ids.case) !== before)
    throw new Error(`Direct SQL ${variant} left residual state`);
  return code;
}

async function attemptCrossCaseChoicePointer(client, database, ids) {
  const before = await judgmentNextStepState(database, ids.case);
  let code = null;
  await client.query('BEGIN');
  try {
    const otherCaseId = await seedOtherCaseInTransaction(client, ids);
    const otherChoiceId = randomUUID();
    await client.query('SET LOCAL session_replication_role = replica');
    await client.query(`INSERT INTO case_judgment_next_steps(id,case_id,department_id,judgment_id,next,
      execution_readiness_confirmed,from_version,to_version,recorded_by_user_id,audit_event_id)
      VALUES ($1,$2,$3,$4,'EXECUTION',true,10,11,$5,$6)`,
      [otherChoiceId, otherCaseId, ids.department, ids.judgment, ids.actor, randomUUID()]);
    await client.query('SET LOCAL session_replication_role = origin');
    await client.query(`UPDATE cases SET stage='WAITING_EXECUTION_DOCUMENTS',version=15,
      current_judgment_next_step_id=$1 WHERE id=$2`, [otherChoiceId, ids.case]);
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
  } catch (error) { code = error.code; }
  finally { await client.query('ROLLBACK'); }
  if (await judgmentNextStepState(database, ids.case) !== before)
    throw new Error('Cross-case pointer left residual state');
  return code;
}

/** Clear only known core-lead fixture owners, preserving unknown cases and all real data. */
export async function clearCoreCaseJudgmentNextStepFixture(departmentIds) {
  if (!Array.isArray(departmentIds) || departmentIds.length < 1 ||
      new Set(departmentIds).size !== departmentIds.length ||
      departmentIds.some((id) => !Object.hasOwn(fixtureOwners, id)))
    throw new Error('Unexpected judgment next-step cleanup departments');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const context = (await client.query('SELECT current_database() AS db, current_schema() AS schema')).rows[0];
    if (context.db !== 'dev_cor_test' || context.schema !== 'public')
      throw new Error('Judgment next-step cleanup requires isolated public test schema');
    await client.query('BEGIN');
    try {
      const exists = (await client.query("SELECT to_regclass('case_judgment_next_steps') IS NOT NULL AS present")).rows[0].present;
      if (!exists) { await client.query('COMMIT'); return; }
      for (const [table, trigger] of immutable) {
        const rows = (await client.query(
          'SELECT tgenabled FROM pg_trigger WHERE tgrelid=$1::regclass AND tgname=$2 AND NOT tgisinternal',
          [table, trigger],
        )).rows;
        if (rows.length !== 1 || rows[0].tgenabled !== 'O') throw new Error(`Next-step cleanup guard unavailable: ${trigger}`);
      }
      const cases = (await client.query(`
        SELECT c.id,c.department_id,c.responsible_user_id,c.customer_id FROM cases c
        WHERE c.department_id=ANY($1::uuid[]) AND (
          c.current_judgment_next_step_id IS NOT NULL OR
          EXISTS (SELECT 1 FROM case_judgment_next_steps s WHERE s.case_id=c.id) OR
          EXISTS (SELECT 1 FROM case_judgment_next_step_revocations r WHERE r.case_id=c.id) OR
          EXISTS (SELECT 1 FROM case_judgment_next_step_receipts r WHERE r.case_id=c.id) OR
          EXISTS (SELECT 1 FROM audit_events a WHERE a.resource_type='CASE' AND a.resource_id=c.id
            AND a.action IN ('case.judgment.next_step','case.judgment.next_step.revoke')))
        ORDER BY c.id FOR UPDATE OF c`, [departmentIds])).rows;
      for (const row of cases) {
        if (!fixtureOwners[row.department_id].some(([owner, customer]) =>
          row.responsible_user_id === owner && row.customer_id === customer))
          throw new Error('Judgment next-step cleanup found a non-fixture case owner');
      }
      const ids = cases.map((row) => row.id);
      if (ids.length > 0) {
        const facts = (await client.query(`SELECT id,audit_event_id FROM case_judgment_next_steps
          WHERE case_id=ANY($1::uuid[]) UNION ALL SELECT id,audit_event_id FROM case_judgment_next_step_revocations
          WHERE case_id=ANY($1::uuid[])`, [ids])).rows;
        const auditIds = facts.map((row) => row.audit_event_id);
        const unbound = (await client.query(`SELECT EXISTS (
          SELECT 1 FROM audit_events a WHERE a.resource_type='CASE' AND a.resource_id=ANY($1::uuid[])
          AND a.action IN ('case.judgment.next_step','case.judgment.next_step.revoke')
          AND NOT (a.id=ANY($2::uuid[]))) AS present`, [ids, auditIds])).rows[0].present;
        if (unbound) throw new Error('Judgment next-step cleanup found an unbound audit');
        await client.query(`UPDATE cases c SET current_judgment_next_step_id=NULL,
          stage='WAITING_JUDGMENT', version=(SELECT f.to_version FROM case_judgment_facts f
            WHERE f.id=c.current_judgment_id)
          WHERE c.id=ANY($1::uuid[])`, [ids]);
        for (const [table, trigger] of immutable)
          await client.query(`ALTER TABLE "${table}" DISABLE TRIGGER "${trigger}"`);
        await client.query('DELETE FROM case_judgment_next_step_receipts WHERE case_id=ANY($1::uuid[])', [ids]);
        await client.query('DELETE FROM case_judgment_appeal_defendants WHERE case_id=ANY($1::uuid[])', [ids]);
        await client.query('DELETE FROM case_judgment_next_step_revocations WHERE case_id=ANY($1::uuid[])', [ids]);
        await client.query('DELETE FROM case_judgment_next_steps WHERE case_id=ANY($1::uuid[])', [ids]);
        await client.query('DELETE FROM audit_events WHERE id=ANY($1::uuid[])', [auditIds]);
        for (const [table, trigger] of [...immutable].reverse())
          await client.query(`ALTER TABLE "${table}" ENABLE TRIGGER "${trigger}"`);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  } finally { await client.end(); }
}

/** Prove a failed fixture cleanup restores both the rows and immutable triggers. */
export async function verifyCoreCaseJudgmentNextStepFixtureCleanup(coreLeadFixtures, resetCoreLeadE2eData) {
  const client = new Client({ connectionString: databaseUrl });
  const ids = Object.fromEntries(['case', 'judgment', 'judgmentAudit', 'choice', 'choiceAudit', 'receipt']
    .map((name) => [name, randomUUID()]));
  const fault = `ca009_cleanup_fault_${randomUUID().replaceAll('-', '')}`;
  let faultInstalled = false;
  await client.connect();
  const snapshot = async () => {
    const { rows } = await client.query(`SELECT
      (SELECT count(*)::int FROM cases WHERE id=$1 AND current_judgment_next_step_id=$2) AS pointer,
      (SELECT count(*)::int FROM case_judgment_next_steps WHERE id=$2) AS choices,
      (SELECT count(*)::int FROM case_judgment_next_step_receipts WHERE id=$3) AS receipts,
      (SELECT count(*)::int FROM audit_events WHERE id=$4) AS audits`,
    [ids.case, ids.choice, ids.receipt, ids.choiceAudit]);
    return rows[0];
  };
  const guardsEnabled = async () => {
    for (const [table, trigger] of immutable) {
      const { rows } = await client.query(
        'SELECT tgenabled FROM pg_trigger WHERE tgrelid=$1::regclass AND tgname=$2 AND NOT tgisinternal',
        [table, trigger]);
      if (rows.length !== 1 || rows[0].tgenabled !== 'O') return false;
    }
    return true;
  };
  try {
    const context = (await client.query('SELECT current_database() AS db,current_schema() AS schema')).rows[0];
    if (context.db !== 'dev_cor_test' || context.schema !== 'public')
      throw new Error('Cleanup test requires isolated public test schema');
    await resetCoreLeadE2eData();
    await client.query('BEGIN');
    try {
      await client.query('SET LOCAL session_replication_role = replica');
      await client.query(`INSERT INTO cases(id,business_no,department_id,source_lead_id,source_notary_matter_id,
        certificate_id,customer_id,rights_holder_id,responsible_user_id,stage,version,matched_at,
        complaint_amount_state,complaint_amount,complaint_submitted_at,complaint_submitted_by_user_id,
        court_case_no,current_judgment_id,current_judgment_next_step_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'WAITING_EXECUTION_DOCUMENTS',3,now(),
          'KNOWN',100,now(),$9,'CA009-cleanup',$10,$11)`,
      [ids.case, `CA009-cleanup-${ids.case}`, coreLeadFixtures.departmentA, randomUUID(), randomUUID(),
        randomUUID(), coreLeadFixtures.admittedCustomer, coreLeadFixtures.holder, coreLeadFixtures.userA,
        ids.judgment, ids.choice]);
      await client.query(`INSERT INTO audit_events(id,department_id,actor_user_id,internal_actor_user_id,
        resource_type,resource_id,action,details)
        VALUES ($1,$2,$3,$3,'CASE',$4,'case.judgment.registered','{}'::jsonb),
          ($5,$2,$3,$3,'CASE',$4,'case.judgment.next_step','{}'::jsonb)`,
      [ids.judgmentAudit, coreLeadFixtures.departmentA, coreLeadFixtures.userA, ids.case, ids.choiceAudit]);
      await client.query(`INSERT INTO case_judgment_facts(id,department_id,case_id,kind,judgment_received_at,
        judgment_amount_state,judgment_amount,paid_litigation_fee_state,recorded_by_user_id,
        from_version,to_version,audit_event_id)
        VALUES ($1,$2,$3,'REGISTER','2026-10-08','KNOWN',0,'PENDING',$4,1,2,$5)`,
      [ids.judgment, coreLeadFixtures.departmentA, ids.case, coreLeadFixtures.userA, ids.judgmentAudit]);
      await client.query(`INSERT INTO case_judgment_next_steps(id,case_id,department_id,judgment_id,next,
        execution_readiness_confirmed,from_version,to_version,recorded_by_user_id,audit_event_id)
        VALUES ($1,$2,$3,$4,'EXECUTION',true,2,3,$5,$6)`,
      [ids.choice, ids.case, coreLeadFixtures.departmentA, ids.judgment, coreLeadFixtures.userA, ids.choiceAudit]);
      await client.query(`INSERT INTO case_judgment_next_step_receipts(id,department_id,actor_user_id,
        case_id,action,idempotency_key,request_fingerprint,result_snapshot)
        VALUES ($1,$2,$3,$4,'CHOOSE',$5,$6,$7::jsonb)`,
      [ids.receipt, coreLeadFixtures.departmentA, coreLeadFixtures.userA, ids.case,
        `cleanup-${ids.case}`, 'a'.repeat(64), JSON.stringify({ choiceId: ids.choice })]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    const before = await snapshot();
    await client.query(`CREATE FUNCTION "${fault}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'cleanup injected fault' USING ERRCODE='23514'; END $$`);
    await client.query(`CREATE TRIGGER "${fault}" BEFORE DELETE ON case_judgment_next_step_receipts
      FOR EACH ROW EXECUTE FUNCTION "${fault}"()`);
    faultInstalled = true;
    let faultRejected = false;
    try { await clearCoreCaseJudgmentNextStepFixture([coreLeadFixtures.departmentA]); }
    catch (error) { faultRejected = error.code === '23514' && error.message.includes('cleanup injected fault'); }
    const rollbackPreserved = JSON.stringify(await snapshot()) === JSON.stringify(before);
    const guardsRestored = await guardsEnabled();
    await client.query(`DROP TRIGGER "${fault}" ON case_judgment_next_step_receipts`);
    await client.query(`DROP FUNCTION "${fault}"()`);
    faultInstalled = false;
    await clearCoreCaseJudgmentNextStepFixture([coreLeadFixtures.departmentA]);
    const after = await snapshot();
    return { faultRejected, rollbackPreserved, guardsRestored,
      targetRemoved: after.pointer === 0 && after.choices === 0 && after.receipts === 0 && after.audits === 0,
      guardsEnabledAfterSuccess: await guardsEnabled() };
  } finally {
    if (faultInstalled) {
      await client.query(`DROP TRIGGER IF EXISTS "${fault}" ON case_judgment_next_step_receipts`).catch(() => undefined);
      await client.query(`DROP FUNCTION IF EXISTS "${fault}"()`).catch(() => undefined);
    }
    await resetCoreLeadE2eData().catch(() => undefined);
    await client.end();
  }
}

/** Exercise the real CA-009 command and PostgreSQL guards on a private synthetic CA-008 head. */
export async function verifyCaseJudgmentNextStepDatabase() {
  const client = new Client({ connectionString: databaseUrl });
  const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const ids = Object.fromEntries(['department','actor','role','customer','holder','case','judgment','audit',
    'defendantA','defendantB','lawyer','lawyerProfile','lawyerBinding','assignment'].map((name) => [name, randomUUID()]));
  const actor = { userId: ids.actor, departmentId: ids.department, authorizationRevision: 1 };
  const lawyer = { userId: ids.lawyer, lawyerAccountId: ids.lawyer,
    departmentId: ids.department, authorizationRevision: 1 };
  const service = new CaseJudgmentNextStepService(database,
    new AccessControlService(new PrismaAccessControlStore(database)));
  const checks = [];
  await client.connect();
  try {
    const location = (await client.query('SELECT current_database() AS db,current_schema() AS schema')).rows[0];
    if (location.db !== 'dev_cor_test' || location.schema !== 'public')
      throw new Error('CA-009 database test requires isolated public schema');
    await client.query('INSERT INTO departments(id,name,updated_at) VALUES ($1,$2,now())', [ids.department, 'CA009 synthetic']);
    await client.query(`INSERT INTO user_accounts(id,external_subject,display_name,updated_at)
      VALUES ($1,$2,$3,now())`, [ids.actor, `ca009-${ids.actor}`, 'CA009 operator']);
    await client.query('INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES ($1,$2,$3,now())',
      [randomUUID(), ids.actor, ids.department]);
    await client.query('INSERT INTO customers(id,name,normalized_name,department_id,responsible_user_id,updated_at) VALUES ($1,$2,$3,$4,$5,now())',
      [ids.customer, 'CA009 customer', 'ca009 customer', ids.department, ids.actor]);
    await client.query('INSERT INTO rights_holders(id,name,department_id,updated_at) VALUES ($1,$2,$3,now())',
      [ids.holder, 'CA009 plaintiff', ids.department]);
    await client.query('INSERT INTO role_templates(id,department_id,name,updated_at) VALUES ($1,$2,$3,now())',
      [ids.role, ids.department, 'CA009 operator role']);
    for (const action of ['case.read','case.judgment.next_step','case.judgment.next_step.revoke'])
      await client.query('INSERT INTO role_grants(id,role_template_id,action,scope) VALUES ($1,$2,$3,$4)',
        [randomUUID(), ids.role, action, 'DEPARTMENT']);
    await client.query('INSERT INTO role_assignments(id,user_id,department_id,role_template_id,active,updated_at) VALUES ($1,$2,$3,$4,true,now())',
      [randomUUID(), ids.actor, ids.department, ids.role]);
    // Only prior-slice source facts are synthetic. New CA-009 writes run with all guards enabled.
    await client.query('BEGIN');
    await client.query('SET LOCAL session_replication_role = replica');
    await client.query(`INSERT INTO cases(id,business_no,department_id,source_lead_id,source_notary_matter_id,certificate_id,
      customer_id,rights_holder_id,responsible_user_id,stage,version,matched_at,complaint_amount_state,
      complaint_amount,complaint_submitted_at,complaint_submitted_by_user_id,court_case_no,current_judgment_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'WAITING_JUDGMENT',10,now(),'KNOWN',100,now(),$9,'CA009-test',$10)`,
      [ids.case, `CA009-${ids.case}`, ids.department, randomUUID(), randomUUID(), randomUUID(),
        ids.customer, ids.holder, ids.actor, ids.judgment]);
    await client.query(`INSERT INTO audit_events(id,department_id,actor_user_id,internal_actor_user_id,resource_type,resource_id,action,details)
      VALUES ($1,$2,$3,$3,'CASE',$4,'case.judgment.registered','{}'::jsonb)`,
      [ids.audit, ids.department, ids.actor, ids.case]);
    await client.query(`INSERT INTO case_judgment_facts(id,department_id,case_id,kind,judgment_received_at,
      judgment_amount_state,judgment_amount,paid_litigation_fee_state,recorded_by_user_id,
      from_version,to_version,audit_event_id)
      VALUES ($1,$2,$3,'REGISTER','2026-10-08','KNOWN',0,'PENDING',$4,9,10,$5)`,
      [ids.judgment, ids.department, ids.case, ids.actor, ids.audit]);
    await client.query(`INSERT INTO case_defendants(id,case_id,department_id,kind,name)
      VALUES ($1,$3,$4,'ORGANIZATION','同名被告'),($2,$3,$4,'ORGANIZATION','同名被告')`,
      [ids.defendantA, ids.defendantB, ids.case, ids.department]);
    await client.query('COMMIT');
    await client.query('BEGIN');
    await client.query('SET LOCAL session_replication_role = replica');
    await client.query(`INSERT INTO user_accounts(id,external_subject,display_name,account_type,updated_at)
      VALUES ($1,$2,$3,'LAWYER',now())`, [ids.lawyer, `ca009-${ids.lawyer}`, 'CA009 lawyer']);
    await client.query('INSERT INTO lawyer_profiles(id,department_id,bound_user_id,full_name) VALUES ($1,$2,$3,$4)',
      [ids.lawyerProfile, ids.department, ids.lawyer, 'CA009 lawyer']);
    await client.query('INSERT INTO lawyer_account_bindings(id,user_id,department_id,profile_id,active,version,updated_at) VALUES ($1,$2,$3,$4,true,1,now())',
      [ids.lawyerBinding, ids.lawyer, ids.department, ids.lawyerProfile]);
    await client.query("INSERT INTO case_lawyer_assignments(id,case_id,department_id,lawyer_id,role,started_at) VALUES ($1,$2,$3,$4,'PRIMARY',now())",
      [ids.assignment, ids.case, ids.department, ids.lawyerProfile]);
    await client.query('COMMIT');
    const appeal = { expectedVersion: 10, idempotencyKey: `appeal-${ids.case}`, judgmentId: ids.judgment,
      next: 'APPEAL', plaintiffAppeals: true, defendantIds: [ids.defendantA, ids.defendantB] };
    if (await attemptForgedPlaintiffSnapshot(client, ids) !== '23514')
      throw new Error('Forged plaintiff name was not rejected by PostgreSQL');
    checks.push('forged plaintiff name rejected without historical rewrite');
    const chosen = await service.choose(actor, ids.case, appeal);
    const stored = await database.caseJudgmentNextStep.findUnique({ where: { id: chosen.choiceId },
      include: { defendants: true } });
    if (chosen.stage !== 'SECOND_INSTANCE' || chosen.version !== 11 || stored?.defendants.length !== 2 ||
        stored?.plaintiffRightsHolderId !== ids.holder || stored.defendants.some((d) => d.nameSnapshot !== '同名被告'))
      throw new Error('CA-009 appeal identity or stage mismatch');
    checks.push('both parties and duplicate names retain distinct IDs');
    const replay = await service.choose(actor, ids.case, appeal);
    if (JSON.stringify(replay) !== JSON.stringify(chosen)) throw new Error('Original choice receipt changed');
    checks.push('original choice receipt replay');
    let conflict = null;
    try { await service.choose(actor, ids.case, { ...appeal, plaintiffAppeals: false }); }
    catch (error) { conflict = error.response?.code; }
    if (conflict !== 'IDEMPOTENCY_CONFLICT') throw new Error('Same-key different-body choice did not conflict');
    checks.push('same-key different-body denied');
    let directStage = null;
    await client.query('BEGIN');
    try {
      await client.query("UPDATE cases SET stage='WAITING_JUDGMENT' WHERE id=$1", [ids.case]);
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    } catch (error) { directStage = error.code; }
    finally { await client.query('ROLLBACK'); }
    if (directStage !== '23514') throw new Error('Direct stage change bypassed choice guard');
    checks.push('direct stage mutation rejected');
    await client.query('UPDATE rights_holders SET name=$1,updated_at=now() WHERE id=$2',
      ['CA009 plaintiff renamed', ids.holder]);
    const historicalName = await database.caseJudgmentNextStep.findUnique({ where: { id: chosen.choiceId },
      select: { plaintiffName: true } });
    if (historicalName?.plaintiffName !== 'CA009 plaintiff')
      throw new Error('Rights-holder rename rewrote historical plaintiff snapshot');
    const revocationInputs = ['A', 'B'].map((suffix) => ({ expectedVersion: 11,
      idempotencyKey: `revoke-${suffix}-${ids.case}`, choiceId: chosen.choiceId, reason: '人工误选' }));
    const revocationRace = await Promise.allSettled(revocationInputs.map((input) => service.revoke(actor, ids.case, input)));
    const winners = revocationRace.flatMap((result, index) => result.status === 'fulfilled'
      ? [{ result: result.value, input: revocationInputs[index] }] : []);
    const losers = revocationRace.filter((result) => result.status === 'rejected');
    if (winners.length !== 1 || losers.length !== 1 || losers[0].reason?.response?.code !== 'VERSION_CONFLICT')
      throw new Error('Different-key concurrent revocations did not serialize to one winner');
    const revoked = winners[0].result;
    if (revoked.stage !== 'WAITING_JUDGMENT' || revoked.version !== 12)
      throw new Error('Revocation did not restore waiting judgment');
    checks.push('rights-holder rename preserves historical choice and permits revocation');
    checks.push('internal revocation retains history');
    checks.push('different-key concurrent revocations allow one winner');
    const revokedReplay = await service.revoke(actor, ids.case, winners[0].input);
    const chosenReplay = await service.choose(actor, ids.case, appeal);
    if (JSON.stringify(revokedReplay) !== JSON.stringify(revoked) ||
        JSON.stringify(chosenReplay) !== JSON.stringify(chosen))
      throw new Error('Historical receipts changed after revocation');
    checks.push('historical choice and revocation receipts replay unchanged');
    const executionInput = { expectedVersion: 12,
      idempotencyKey: `lawyer-${ids.case}`, judgmentId: ids.judgment,
      next: 'EXECUTION', executionReadinessConfirmed: true };
    const [execution, concurrentReplay] = await Promise.all([
      service.choose(lawyer, ids.case, executionInput), service.choose(lawyer, ids.case, executionInput),
    ]);
    if (execution.stage !== 'WAITING_EXECUTION_DOCUMENTS' || execution.version !== 13 ||
        JSON.stringify(concurrentReplay) !== JSON.stringify(execution))
      throw new Error('Concurrent lawyer choice did not converge to one receipt');
    checks.push('lawyer audit before CAS and same-key lock competition');
    let staleCode = null;
    try { await service.choose(lawyer, ids.case, { ...executionInput, idempotencyKey: `stale-${ids.case}` }); }
    catch (error) { staleCode = error.response?.code; }
    if (staleCode !== 'VERSION_CONFLICT') throw new Error('Competing stale choice was not rejected');
    checks.push('stale competing choice rejected');
    await client.query('UPDATE lawyer_account_bindings SET active=false,version=version+1 WHERE id=$1', [ids.lawyerBinding]);
    await client.query('UPDATE user_accounts SET active=false WHERE id=$1', [ids.lawyer]);
    let formerLawyerCode = null;
    try { await service.choose(lawyer, ids.case, executionInput); }
    catch (error) { formerLawyerCode = error.response?.code; }
    if (formerLawyerCode !== 'ACTION_FORBIDDEN') throw new Error('Inactive former lawyer replayed old receipt');
    const laterRevocation = await service.revoke(actor, ids.case, { expectedVersion: 13,
      idempotencyKey: `former-lawyer-revoke-${ids.case}`, choiceId: execution.choiceId,
      reason: '原办理律师已停用后的人工更正' });
    if (laterRevocation.stage !== 'WAITING_JUDGMENT' || laterRevocation.version !== 14)
      throw new Error('Former lawyer account invalidated historical choice');
    await client.query('UPDATE rights_holders SET name=$1,updated_at=now() WHERE id=$2',
      ['CA009 plaintiff', ids.holder]);
    checks.push('former lawyer inactive: replay denied but internal revocation succeeds');
    const final = await database.case.findUnique({ where: { id: ids.case },
      select: { currentJudgmentId: true, currentJudgmentNextStepId: true, stage: true, version: true } });
    if (final?.currentJudgmentId !== ids.judgment || final.currentJudgmentNextStepId !== null ||
        final.stage !== 'WAITING_JUDGMENT' || final.version !== 14) throw new Error('Final revocation pointer mismatch');
    for (const [table, label] of [
      ['audit_events', 'audit insert failure rolls back whole choice'],
      ['case_judgment_next_steps', 'choice fact insert failure rolls back whole choice'],
      ['case_judgment_appeal_defendants', 'appeal party insert failure rolls back whole choice'],
      ['case_judgment_next_step_receipts', 'receipt insert failure rolls back whole choice'],
    ]) {
      await assertInjectedChoiceRollback(client, database, service, actor, ids, table);
      checks.push(label);
    }
    const directVariants = [
      ['baseline', null, 'direct SQL valid chain baseline accepted'],
      ['wrongJudgment', '23503', 'direct SQL wrong judgment anchor rejected'],
      ['wrongVersion', '23514', 'direct SQL wrong version chain rejected'],
      ['noParty', '23514', 'direct SQL no appeal party rejected'],
      ['executionParty', '23514', 'direct SQL execution with appeal party rejected'],
      ['badAudit', '23514', 'direct SQL mismatched audit rejected'],
      ['badReceipt', '23514', 'direct SQL mismatched receipt rejected'],
      ['foreignDefendant', '23514', 'direct SQL foreign-case defendant rejected'],
    ];
    for (const [variant, expectedCode, label] of directVariants) {
      const code = await attemptDirectChoice(client, database, ids, variant);
      if (code !== expectedCode) throw new Error(`Direct SQL ${variant}: expected ${expectedCode}, got ${code}`);
      checks.push(label);
    }
    if (await attemptCrossCaseChoicePointer(client, database, ids) !== '23503')
      throw new Error('Cross-case choice pointer was not rejected');
    checks.push('direct SQL cross-case choice pointer rejected');
    // Existing CA-008 frozen-file receipt checks are covered by their own suite;
    // isolate the upgraded case-chain guard for a corrected head after two choice/revocation gaps.
    const correctedId = randomUUID();
    const correctedAudit = randomUUID();
    await client.query('BEGIN');
    try {
      await client.query('SET LOCAL session_replication_role = replica');
      await client.query(`INSERT INTO audit_events(id,department_id,actor_user_id,internal_actor_user_id,
        resource_type,resource_id,action,details) VALUES ($1,$2,$3,$3,'CASE',$4,'case.judgment.corrected','{}'::jsonb)`,
        [correctedAudit, ids.department, ids.actor, ids.case]);
      await client.query(`INSERT INTO case_judgment_facts(id,department_id,case_id,kind,prior_fact_id,
        judgment_received_at,judgment_amount_state,judgment_amount,paid_litigation_fee_state,
        reason,recorded_by_user_id,from_version,to_version,audit_event_id)
        VALUES ($1,$2,$3,'CORRECT',$4,'2026-10-08','KNOWN',0,'PENDING',
          '跨选择撤销间隔更正',$5,14,15,$6)`,
        [correctedId, ids.department, ids.case, ids.judgment, ids.actor, correctedAudit]);
      await client.query('SET LOCAL session_replication_role = origin');
      await client.query('UPDATE cases SET current_judgment_id=$1,version=15 WHERE id=$2', [correctedId, ids.case]);
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      checks.push('case-chain guard accepts corrected head after revoked version gaps');
    } finally { await client.query('ROLLBACK'); }
    return { checks, stage: final.stage, version: final.version };
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.query('BEGIN').catch(() => undefined);
    try {
      await client.query('SET LOCAL session_replication_role = replica');
      for (const table of ['case_judgment_next_step_receipts','case_judgment_appeal_defendants',
        'case_judgment_next_step_revocations','case_judgment_next_steps','case_judgment_facts','case_defendants',
        'case_lawyer_assignments'])
        await client.query(`DELETE FROM "${table}" WHERE case_id=$1`, [ids.case]);
      await client.query('UPDATE cases SET current_judgment_next_step_id=NULL,current_judgment_id=NULL WHERE id=$1', [ids.case]);
      await client.query('DELETE FROM audit_events WHERE department_id=$1', [ids.department]);
      await client.query('DELETE FROM cases WHERE id=$1', [ids.case]);
      await client.query('DELETE FROM lawyer_account_bindings WHERE id=$1', [ids.lawyerBinding]);
      await client.query('DELETE FROM lawyer_profiles WHERE id=$1', [ids.lawyerProfile]);
      await client.query('DELETE FROM role_assignments WHERE role_template_id=$1', [ids.role]);
      await client.query('DELETE FROM role_grants WHERE role_template_id=$1', [ids.role]);
      await client.query('DELETE FROM role_templates WHERE id=$1', [ids.role]);
      await client.query('DELETE FROM rights_holders WHERE id=$1', [ids.holder]);
      await client.query('DELETE FROM customers WHERE id=$1', [ids.customer]);
      await client.query('DELETE FROM department_memberships WHERE user_id=$1', [ids.actor]);
      await client.query('DELETE FROM user_accounts WHERE id=ANY($1::uuid[])', [[ids.actor,ids.lawyer]]);
      await client.query('DELETE FROM departments WHERE id=$1', [ids.department]);
      await client.query('COMMIT');
    } finally { await database.$disconnect(); await client.end(); }
  }
}

export async function verifyCaseJudgmentNextStepWithRealJudgment(request) {
  return verifyCaseJudgmentDatabase({ afterRegistration: async ({ actor, roleId, caseId, judgmentId,
    client, registeredFiles, registrationInput }) => {
    for (const action of ['case.judgment.next_step', 'case.judgment.next_step.revoke'])
      await client.query(`INSERT INTO role_grants(id,role_template_id,action,scope)
        VALUES ($1,$2,$3,'DEPARTMENT') ON CONFLICT DO NOTHING`, [randomUUID(), roleId, action]);
    const username = `ca009-${actor.userId}`;
    const password = 'CA009 isolated test password 2026';
    await client.query(`INSERT INTO local_credentials(id,user_id,username,password_hash,updated_at)
      VALUES ($1,$2,$3,$4,now())`, [randomUUID(), actor.userId, username, await hashPassword(password)]);
    const login = await request.post('/api/v1/auth/login', { data: { username, password } });
    if (login.status() !== 200) throw new Error(`Real judgment HTTP login failed: ${login.status()}`);
    const csrfToken = (await login.json()).csrfToken;
    const headers = { 'X-CSRF-Token': csrfToken };
    const choiceInput = { expectedVersion: 10, idempotencyKey: `real-appeal-${caseId}`,
      judgmentId, next: 'APPEAL', plaintiffAppeals: true, defendantIds: [] };
    const chooseUrl = `/api/v1/cases/${caseId}/judgment-next-step`;
    const revokeUrl = `/api/v1/cases/${caseId}/judgment-next-step-revoke`;
    const correctUrl = `/api/v1/cases/${caseId}/judgment-correct`;
    const registerUrl = `/api/v1/cases/${caseId}/judgment-register`;
    const chooseResponse = await request.post(chooseUrl, { headers, data: choiceInput });
    if (chooseResponse.status() !== 201) throw new Error(`Real HTTP choice failed: ${chooseResponse.status()} ${await chooseResponse.text()}`);
    const chosen = await chooseResponse.json();
    if (chosen.stage !== 'SECOND_INSTANCE' || chosen.version !== 11)
      throw new Error('Real frozen judgment did not advance to appeal');
    const activeCorrection = await request.post(correctUrl, { headers, data: { ...registrationInput,
      expectedVersion: 11, idempotencyKey: `active-choice-correct-${caseId}`,
      reason: '选择仍有效时尝试更正' } });
    if (activeCorrection.status() !== 409 || (await activeCorrection.json()).code !== 'INVALID_STATE')
      throw new Error('Active choice did not block HTTP judgment correction');
    const revokeResponse = await request.post(revokeUrl, { headers, data: { expectedVersion: 11,
      idempotencyKey: `real-revoke-${caseId}`, choiceId: chosen.choiceId, reason: '误选上诉' } });
    if (revokeResponse.status() !== 201) throw new Error(`Real HTTP revocation failed: ${revokeResponse.status()} ${await revokeResponse.text()}`);
    const revoked = await revokeResponse.json();
    if (revoked.stage !== 'WAITING_JUDGMENT' || revoked.version !== 12)
      throw new Error('Real judgment choice did not revoke');
    const correctResponse = await request.post(correctUrl, { headers, data: { ...registrationInput,
      expectedVersion: 12, idempotencyKey: `post-revoke-correct-${caseId}`,
      reason: '撤销误选后更正判决' } });
    if (correctResponse.status() !== 201) throw new Error(`Real HTTP correction failed: ${correctResponse.status()} ${await correctResponse.text()}`);
    const corrected = await correctResponse.json();
    if (corrected.version !== 13 || corrected.judgmentId === judgmentId)
      throw new Error('Real frozen judgment correction after revoke failed');
    const oldReceipt = await request.post(registerUrl, { headers, data: registrationInput });
    const choiceReceipt = await request.post(chooseUrl, { headers, data: choiceInput });
    if (oldReceipt.status() !== 201 || (await oldReceipt.json()).judgmentId !== judgmentId ||
        choiceReceipt.status() !== 201 || JSON.stringify(await choiceReceipt.json()) !== JSON.stringify(chosen))
      throw new Error('Original receipts changed after correction');
    let bytesPreserved = true;
    for (const file of registeredFiles) {
      const download = await request.get(`/api/v1/materials/${file.materialId}/versions/${file.contentVersionId}/content`);
      if (download.status() !== 200) throw new Error(`Frozen judgment download failed: ${download.status()}`);
      const downloaded = await download.body();
      if (!downloaded.equals(file.bytes)) bytesPreserved = false;
    }
    const reselectResponse = await request.post(chooseUrl, { headers, data: { expectedVersion: 13,
      idempotencyKey: `post-correct-execution-${caseId}`, judgmentId: corrected.judgmentId,
      next: 'EXECUTION', executionReadinessConfirmed: true } });
    if (reselectResponse.status() !== 201) throw new Error(`Real HTTP reselection failed: ${reselectResponse.status()} ${await reselectResponse.text()}`);
    const reselected = await reselectResponse.json();
    if (reselected.stage !== 'WAITING_EXECUTION_DOCUMENTS' || reselected.version !== 14)
      throw new Error('Reselection after correction failed');
    return { choiceStage: chosen.stage, revokedStage: revoked.stage,
      correctedVersion: corrected.version, bytesPreserved };
  } });
}

export async function verifyJudgmentChoiceCorrectionRace() {
  return verifyCaseJudgmentDatabase({ afterRegistration: async ({ actor, roleId, caseId, judgmentId,
    judgment, database, client, registrationInput }) => {
    await client.query(`INSERT INTO role_grants(id,role_template_id,action,scope)
      VALUES ($1,$2,'case.judgment.next_step','DEPARTMENT')`, [randomUUID(), roleId]);
    const account = await database.userAccount.findUnique({ where: { id: actor.userId },
      select: { authorizationRevision: true } });
    const currentActor = { ...actor, authorizationRevision: account.authorizationRevision };
    const nextStep = new CaseJudgmentNextStepService(database,
      new AccessControlService(new PrismaAccessControlStore(database)));
    const outcomes = await Promise.allSettled([
      nextStep.choose(currentActor, caseId, { expectedVersion: 10,
        idempotencyKey: `race-choice-${caseId}`, judgmentId,
        next: 'APPEAL', plaintiffAppeals: true, defendantIds: [] }),
      judgment.correct(currentActor, caseId, { ...registrationInput, expectedVersion: 10,
        idempotencyKey: `race-correct-${caseId}`, reason: '与上诉选择竞争的判决更正' }),
    ]);
    const winnerIndex = outcomes.findIndex((result) => result.status === 'fulfilled');
    const oneWinner = outcomes.filter((result) => result.status === 'fulfilled').length === 1;
    const loser = outcomes.find((result) => result.status === 'rejected');
    const loserCode = loser?.reason?.response?.code ?? null;
    const record = await database.case.findUnique({ where: { id: caseId },
      select: { stage: true, version: true, currentJudgmentId: true, currentJudgmentNextStepId: true } });
    const facts = await database.caseJudgmentFact.count({ where: { caseId } });
    const choices = await database.caseJudgmentNextStep.count({ where: { caseId } });
    const choiceReceipts = await database.caseJudgmentNextStepReceipt.count({ where: { caseId } });
    const correctionReceipts = await database.caseJudgmentReceipt.count({ where: { caseId, action: 'CORRECT' } });
    const choiceAudits = await database.auditEvent.count({ where: { resourceId: caseId,
      action: 'case.judgment.next_step' } });
    const correctionAudits = await database.auditEvent.count({ where: { resourceId: caseId,
      action: 'case.judgment.corrected' } });
    const atomic = record?.version === 11 && (winnerIndex === 0
      ? record.stage === 'SECOND_INSTANCE' && record.currentJudgmentId === judgmentId &&
        record.currentJudgmentNextStepId === outcomes[0].value.choiceId &&
        facts === 1 && choices === 1 && choiceReceipts === 1 && correctionReceipts === 0 &&
        choiceAudits === 1 && correctionAudits === 0
      : record.stage === 'WAITING_JUDGMENT' && record.currentJudgmentId === outcomes[1]?.value?.judgmentId &&
        record.currentJudgmentNextStepId === null &&
        facts === 2 && choices === 0 && choiceReceipts === 0 && correctionReceipts === 1 &&
        choiceAudits === 0 && correctionAudits === 1);
    return { oneWinner, atomic, loserCode };
  } });
}

