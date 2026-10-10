import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';

const requireBackend = createRequire(resolve(process.cwd(), 'backend/package.json'));
const { Client } = requireBackend('pg');
const { PrismaClient } = requireBackend('./dist/generated/prisma/client.js');
const { PrismaPg } = requireBackend('@prisma/adapter-pg');
const { AccessControlService } = requireBackend('./dist/access-control/access-control.service.js');
const { PrismaAccessControlStore } = requireBackend('./dist/access-control/prisma-access-control.store.js');
const { CaseJudgmentNextStepService } = requireBackend('./dist/modules/cases/case-judgment-next-step.service.js');
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
    const revoked = await service.revoke(actor, ids.case, { expectedVersion: 11,
      idempotencyKey: `revoke-${ids.case}`, choiceId: chosen.choiceId, reason: '人工误选' });
    if (revoked.stage !== 'WAITING_JUDGMENT' || revoked.version !== 12)
      throw new Error('Revocation did not restore waiting judgment');
    checks.push('internal revocation retains history');
    const revokedReplay = await service.revoke(actor, ids.case, { expectedVersion: 11,
      idempotencyKey: `revoke-${ids.case}`, choiceId: chosen.choiceId, reason: '人工误选' });
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
    checks.push('former lawyer inactive: replay denied but internal revocation succeeds');
    const final = await database.case.findUnique({ where: { id: ids.case },
      select: { currentJudgmentId: true, currentJudgmentNextStepId: true, stage: true, version: true } });
    if (final?.currentJudgmentId !== ids.judgment || final.currentJudgmentNextStepId !== null ||
        final.stage !== 'WAITING_JUDGMENT' || final.version !== 14) throw new Error('Final revocation pointer mismatch');
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
