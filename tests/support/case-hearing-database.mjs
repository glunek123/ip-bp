import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';

const root = process.cwd();
const requireBackend = createRequire(resolve(root, 'backend/package.json'));
const { Client } = requireBackend('pg');
const { PrismaClient } = requireBackend('./dist/generated/prisma/client.js');
const { PrismaPg } = requireBackend('@prisma/adapter-pg');
const { AccessControlService } = requireBackend(
  './dist/access-control/access-control.service.js',
);
const { PrismaAccessControlStore } = requireBackend(
  './dist/access-control/prisma-access-control.store.js',
);
const { CaseHearingService } = requireBackend(
  './dist/modules/cases/case-hearing.service.js',
);
const { CaseHearingSchedulerService } = requireBackend(
  './dist/modules/cases/case-hearing-scheduler.service.js',
);
const { CaseHearingSignal } = requireBackend(
  './dist/modules/cases/case-hearing-signal.js',
);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || process.env.NODE_ENV !== 'test')
  throw new Error('Isolated test database required');
validateIsolatedTestDatabaseUrl(databaseUrl, { allowRandomPort: true });

export async function verifyCaseHearingDatabase() {
  const schema = `ca007_db_${randomUUID().replaceAll('-', '')}`;
  const migrations = resolve(root, 'backend/prisma/migrations');
  const names = (await readdir(migrations))
    .filter((name) => /^\d{14}_/u.test(name))
    .sort();
  if (
    names.length !== 80 ||
    names.at(-1) !== '20261008013000_allow_lawyer_hearing_schedule_audit'
  )
    throw new Error('Unexpected migration chain');
  const admin = new Client({ connectionString: databaseUrl });
  await admin.connect();
  let database;
  try {
    if (
      (await admin.query('SELECT current_database() AS name')).rows[0].name !==
      'dev_cor_test'
    )
      throw new Error('Unexpected database');
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET search_path TO "${schema}"`);
    for (const name of names)
      await admin.query(
        await readFile(resolve(migrations, name, 'migration.sql'), 'utf8'),
      );
    const departmentId = randomUUID(),
      userId = randomUUID(),
      caseId = randomUUID();
    const lawyerId = randomUUID(),
      lawyerCaseId = randomUUID(),
      profileId = randomUUID(),
      bindingId = randomUUID();
    const roleId = randomUUID(),
      acceptanceAuditId = randomUUID();
    await admin.query(
      'INSERT INTO departments(id,name,updated_at) VALUES ($1,$2,now())',
      [departmentId, 'CA007 DB'],
    );
    await admin.query(
      'INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES ($1,$2,$3,now())',
      [userId, `ca007-db-${userId}`, 'CA007 DB actor'],
    );
    await admin.query(
      'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES ($1,$2,$3,now())',
      [randomUUID(), userId, departmentId],
    );
    await admin.query(
      'INSERT INTO role_templates(id,department_id,name,updated_at) VALUES ($1,$2,$3,now())',
      [roleId, departmentId, 'CA007 DB role'],
    );
    await admin.query(
      "INSERT INTO role_grants(id,role_template_id,action,scope) VALUES ($1,$2,'case.hearing.schedule','DEPARTMENT'),($3,$2,'case.hearing.correct','DEPARTMENT')",
      [randomUUID(), roleId, randomUUID()],
    );
    await admin.query(
      'INSERT INTO role_assignments(id,user_id,department_id,role_template_id,active,updated_at) VALUES ($1,$2,$3,$4,true,now())',
      [randomUUID(), userId, departmentId, roleId],
    );
    await admin.query('SET session_replication_role = replica');
    try {
      await admin.query(
        "INSERT INTO user_accounts(id,external_subject,display_name,account_type,updated_at) VALUES ($1,$2,$3,'LAWYER',now())",
        [lawyerId, `ca007-lawyer-${lawyerId}`, 'CA007 lawyer'],
      );
      await admin.query(
        'INSERT INTO lawyer_profiles(id,department_id,bound_user_id,full_name) VALUES ($1,$2,$3,$4)',
        [profileId, departmentId, lawyerId, 'CA007 lawyer'],
      );
      await admin.query(
        'INSERT INTO lawyer_account_bindings(id,user_id,department_id,profile_id,updated_at) VALUES ($1,$2,$3,$4,now())',
        [bindingId, lawyerId, departmentId, profileId],
      );
      await admin.query(
        "INSERT INTO cases(id,business_no,department_id,source_lead_id,source_notary_matter_id,certificate_id,customer_id,rights_holder_id,responsible_user_id,stage,version,matched_at,complaint_amount_state,complaint_amount,complaint_submitted_at,complaint_submitted_by_user_id,court_case_no) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'WAITING_HEARING',7,now(),'KNOWN',123.45,now(),$9,'CA007-No')",
        [
          caseId,
          `CA007-${schema}`,
          departmentId,
          randomUUID(),
          randomUUID(),
          randomUUID(),
          randomUUID(),
          randomUUID(),
          userId,
        ],
      );
      await admin.query(
        "INSERT INTO cases(id,business_no,department_id,source_lead_id,source_notary_matter_id,certificate_id,customer_id,rights_holder_id,responsible_user_id,stage,version,matched_at,complaint_amount_state,complaint_amount,complaint_submitted_at,complaint_submitted_by_user_id,court_case_no) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'WAITING_HEARING',7,now(),'KNOWN',123.45,now(),$9,'CA007-Lawyer')",
        [
          lawyerCaseId,
          `CA007-L-${schema}`,
          departmentId,
          randomUUID(),
          randomUUID(),
          randomUUID(),
          randomUUID(),
          randomUUID(),
          userId,
        ],
      );
      await admin.query(
        "INSERT INTO audit_events(id,department_id,actor_user_id,internal_actor_user_id,resource_type,resource_id,action) VALUES ($1,$2,$3,$3,'CASE',$4,'case.acceptance.registered')",
        [acceptanceAuditId, departmentId, userId, caseId],
      );
      await admin.query(
        "INSERT INTO case_acceptances(id,department_id,case_id,accepted_at,court_case_no,recorded_by_user_id,audit_event_id) VALUES ($1,$2,$3,'2026-10-01','CA007-No',$4,$5)",
        [randomUUID(), departmentId, caseId, userId, acceptanceAuditId],
      );
      const lawyerAcceptanceAuditId = randomUUID();
      await admin.query(
        "INSERT INTO audit_events(id,department_id,actor_user_id,internal_actor_user_id,resource_type,resource_id,action) VALUES ($1,$2,$3,$3,'CASE',$4,'case.acceptance.registered')",
        [lawyerAcceptanceAuditId, departmentId, userId, lawyerCaseId],
      );
      await admin.query(
        "INSERT INTO case_acceptances(id,department_id,case_id,accepted_at,court_case_no,recorded_by_user_id,audit_event_id) VALUES ($1,$2,$3,'2026-10-01','CA007-Lawyer',$4,$5)",
        [
          randomUUID(),
          departmentId,
          lawyerCaseId,
          userId,
          lawyerAcceptanceAuditId,
        ],
      );
    } finally {
      await admin.query('SET session_replication_role = origin');
    }
    await admin.query(
      "INSERT INTO case_lawyer_assignments(id,case_id,department_id,lawyer_id,role,started_at) VALUES ($1,$2,$3,$4,'PRIMARY',now())",
      [randomUUID(), lawyerCaseId, departmentId, profileId],
    );

    const scopedUrl = new URL(databaseUrl);
    scopedUrl.searchParams.set('options', `-c search_path=${schema}`);
    database = new PrismaClient({
      adapter: new PrismaPg(
        { connectionString: scopedUrl.toString() },
        { schema },
      ),
    });
    const seededCase = await database.case.findUnique({
      where: { id: caseId },
      select: { id: true },
    });
    if (seededCase?.id !== caseId)
      throw new Error('Prisma isolated schema selection failed');
    const access = new AccessControlService(
      new PrismaAccessControlStore(database),
    );
    const inject = async (table, condition) => {
      await admin.query(
        "CREATE FUNCTION ca007_reject_write() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected hearing failure' USING ERRCODE='P0001'; END; $$ LANGUAGE plpgsql",
      );
      await admin.query(
        `CREATE TRIGGER ca007_reject_write BEFORE INSERT ON "${table}" FOR EACH ROW WHEN (${condition}) EXECUTE FUNCTION ca007_reject_write()`,
      );
    };
    const clearInjection = async (table) => {
      await admin.query(`DROP TRIGGER ca007_reject_write ON "${table}"`);
      await admin.query('DROP FUNCTION ca007_reject_write()');
    };
    const signal1 = new CaseHearingSignal();
    const clock1 = { now: () => new Date('2026-10-08T10:00:00.000Z') };
    const service1 = new CaseHearingService(database, access, signal1, clock1);
    const scheduler1 = new CaseHearingSchedulerService(
      service1,
      signal1,
      clock1,
    );
    const actor = { userId, departmentId, authorizationRevision: 1 };
    const lawyerActor = {
      userId: lawyerId,
      departmentId,
      lawyerAccountId: lawyerId,
      authorizationRevision: 1,
    };
    const lawyerSaved = await service1.schedule(lawyerActor, lawyerCaseId, {
      expectedVersion: 7,
      idempotencyKey: 'lawyer-schedule',
      hearingAt: null,
    });
    const lawyerScheduled =
      lawyerSaved.version === 8 &&
      (await database.auditEvent.count({
        where: {
          resourceId: lawyerCaseId,
          action: 'case.hearing.scheduled',
          lawyerAccountBindingId: bindingId,
        },
      })) === 1;
    await scheduler1.onModuleInit();
    await inject('case_hearing_arrangements', 'true');
    let failedSave = false;
    try {
      await service1.schedule(actor, caseId, {
        expectedVersion: 7,
        idempotencyKey: 'failed-schedule',
        hearingAt: '2026-10-08',
      });
    } catch {
      failedSave = true;
    }
    await clearInjection('case_hearing_arrangements');
    const afterFailedSave = await database.case.findUnique({
      where: { id: caseId },
      select: { version: true },
    });
    const rollbackSaveClean =
      failedSave &&
      afterFailedSave?.version === 7 &&
      (await database.caseHearingArrangement.count({ where: { caseId } })) ===
        0 &&
      (await database.caseHearingReceipt.count({ where: { caseId } })) === 0 &&
      (await database.auditEvent.count({
        where: { resourceId: caseId, action: 'case.hearing.scheduled' },
      })) === 0;
    const saved = await service1.schedule(actor, caseId, {
      expectedVersion: 7,
      idempotencyKey: 'schedule-1',
      hearingAt: '2026-10-08',
    });
    const replay = await service1.schedule(actor, caseId, {
      expectedVersion: 7,
      idempotencyKey: 'schedule-1',
      hearingAt: '2026-10-08',
    });
    await admin.query(
      "DELETE FROM role_grants WHERE role_template_id=$1 AND action='case.hearing.schedule'",
      [roleId],
    );
    await admin.query(
      'UPDATE user_accounts SET authorization_revision=authorization_revision+1 WHERE id=$1',
      [userId],
    );
    let revokedReplayDenied = false;
    try {
      await service1.schedule(actor, caseId, {
        expectedVersion: 7,
        idempotencyKey: 'schedule-1',
        hearingAt: '2026-10-08',
      });
    } catch (error) {
      revokedReplayDenied = error?.response?.code === 'ACTION_FORBIDDEN';
    }
    await admin.query(
      "INSERT INTO role_grants(id,role_template_id,action,scope) VALUES ($1,$2,'case.hearing.schedule','DEPARTMENT')",
      [randomUUID(), roleId],
    );
    await admin.query(
      'UPDATE user_accounts SET authorization_revision=authorization_revision+1 WHERE id=$1',
      [userId],
    );
    actor.authorizationRevision = 3;
    const beforeDue = (
      await service1.advanceDue(new Date('2026-10-08T15:59:59.999Z'))
    ).advanced;
    await inject('audit_events', "NEW.action = 'case.hearing.auto_advanced'");
    const failedAdvance = await service1.advanceDue(
      new Date('2026-10-08T16:00:00.000Z'),
    );
    await clearInjection('audit_events');
    const afterFailedAdvance = await database.case.findUnique({
      where: { id: caseId },
      select: { stage: true, version: true },
    });
    const rollbackAdvanceClean =
      afterFailedAdvance?.stage === 'WAITING_HEARING' &&
      afterFailedAdvance.version === 8 &&
      (await database.caseHearingAdvance.count({ where: { caseId } })) === 0 &&
      (await database.auditEvent.count({
        where: { resourceId: caseId, action: 'case.hearing.auto_advanced' },
      })) === 0;
    scheduler1.onModuleDestroy();
    const signal2 = new CaseHearingSignal();
    const clock2 = { now: () => new Date('2026-10-08T16:00:00.000Z') };
    const service2 = new CaseHearingService(database, access, signal2, clock2);
    const scheduler2 = new CaseHearingSchedulerService(
      service2,
      signal2,
      clock2,
    );
    const signalPeer = new CaseHearingSignal();
    const servicePeer = new CaseHearingService(
      database,
      access,
      signalPeer,
      clock2,
    );
    const schedulerPeer = new CaseHearingSchedulerService(
      servicePeer,
      signalPeer,
      clock2,
    );
    await Promise.all([
      scheduler2.onModuleInit(),
      schedulerPeer.onModuleInit(),
    ]);
    scheduler2.onModuleDestroy();
    schedulerPeer.onModuleDestroy();
    const afterStartup = await database.case.findUnique({
      where: { id: caseId },
      select: { version: true, currentHearingAdvanceId: true },
    });
    const startupAdvanced = afterStartup?.version === 9 ? 1 : 0;
    const secondStartupAdvanced = (await service2.advanceDue(clock2.now()))
      .advanced;
    const firstAdvanceCount = await database.caseHearingAdvance.count({
      where: { caseId },
    });
    const firstAudits = await database.auditEvent.findMany({
      where: { resourceId: caseId, action: 'case.hearing.auto_advanced' },
      select: { actorUserId: true, actorKind: true },
    });
    await inject('case_hearing_receipts', "NEW.action = 'CORRECT'");
    let failedCorrection = false;
    try {
      await service2.correct(actor, caseId, {
        expectedVersion: 9,
        idempotencyKey: 'failed-correction',
        hearingAt: '2026-10-02',
        reason: '法院通知日期登记有误',
      });
    } catch {
      failedCorrection = true;
    }
    await clearInjection('case_hearing_receipts');
    const afterFailedCorrection = await database.case.findUnique({
      where: { id: caseId },
      select: { stage: true, version: true, currentHearingAdvanceId: true },
    });
    const rollbackCorrectionClean =
      failedCorrection &&
      afterFailedCorrection?.stage === 'WAITING_JUDGMENT' &&
      afterFailedCorrection.version === 9 &&
      afterFailedCorrection.currentHearingAdvanceId ===
        afterStartup?.currentHearingAdvanceId &&
      (await database.caseHearingCorrection.count({ where: { caseId } })) ===
        0 &&
      (await database.caseHearingArrangement.count({ where: { caseId } })) ===
        1;
    const overdue = await service2.correct(actor, caseId, {
      expectedVersion: 9,
      idempotencyKey: 'correct-overdue',
      hearingAt: '2026-10-02',
      reason: '法院通知日期登记有误',
    });
    const afterOverdue = await database.case.findUnique({
      where: { id: caseId },
      select: { currentHearingAdvanceId: true },
    });
    const signal3 = new CaseHearingSignal();
    const clock3 = { now: () => new Date('2026-10-08T17:00:00.000Z') };
    const service3 = new CaseHearingService(database, access, signal3, clock3);
    const future = await service3.correct(actor, caseId, {
      expectedVersion: 10,
      idempotencyKey: 'correct-future',
      hearingAt: '2026-10-09',
      reason: '法院再次通知改期',
    });
    const afterFuture = await database.case.findUnique({
      where: { id: caseId },
      select: { currentHearingAdvanceId: true },
    });
    const secondAdvanced = (
      await service3.advanceDue(new Date('2026-10-09T16:00:00.000Z'))
    ).advanced;
    const finalAdvanceCount = await database.caseHearingAdvance.count({
      where: { caseId },
    });
    const finalSystemAuditCount = await database.auditEvent.count({
      where: { resourceId: caseId, action: 'case.hearing.auto_advanced' },
    });
    const historyArrangementCount = await database.caseHearingArrangement.count(
      { where: { caseId } },
    );
    const correctionCount = await database.caseHearingCorrection.count({
      where: { caseId },
    });
    const sqlCode = async (statements) => {
      try {
        await admin.query('BEGIN');
        for (const [sql, params] of statements) await admin.query(sql, params);
        await admin.query('COMMIT');
        return null;
      } catch (error) {
        await admin.query('ROLLBACK').catch(() => undefined);
        return error.code ?? null;
      }
    };
    const immutableArrangement = await sqlCode([
      [
        'UPDATE case_hearing_arrangements SET hearing_at=hearing_at WHERE id=$1',
        [saved.arrangementId],
      ],
    ]);
    const immutableAdvance = await sqlCode([
      ['DELETE FROM case_hearing_advances WHERE case_id=$1', [caseId]],
    ]);
    const systemAuditId = (
      await admin.query(
        "SELECT id FROM audit_events WHERE resource_id=$1 AND action='case.hearing.auto_advanced' LIMIT 1",
        [caseId],
      )
    ).rows[0].id;
    const immutableAudit = await sqlCode([
      ['UPDATE audit_events SET details=details WHERE id=$1', [systemAuditId]],
    ]);
    const finalCase = await database.case.findUnique({
      where: { id: caseId },
      select: { version: true },
    });
    const directArrangement = async (hearingAt, auditAction) => {
      const auditId = randomUUID(),
        arrangementId = randomUUID();
      return sqlCode([
        [
          "INSERT INTO audit_events(id,department_id,actor_user_id,internal_actor_user_id,resource_type,resource_id,action,details) VALUES ($1,$2,$3,$3,'CASE',$4,$5,$6)",
          [
            auditId,
            departmentId,
            userId,
            caseId,
            auditAction,
            {
              arrangementId,
              hearingAt,
              fromVersion: finalCase.version,
              toVersion: finalCase.version + 1,
            },
          ],
        ],
        [
          "INSERT INTO case_hearing_arrangements(id,department_id,case_id,hearing_at,source,recorded_by_user_id,from_version,to_version,audit_event_id) VALUES ($1,$2,$3,$4,'SCHEDULE',$5,$6,$7,$8)",
          [
            arrangementId,
            departmentId,
            caseId,
            hearingAt,
            userId,
            finalCase.version,
            finalCase.version + 1,
            auditId,
          ],
        ],
        [
          'UPDATE cases SET current_hearing_arrangement_id=$1,version=version+1 WHERE id=$2',
          [arrangementId, caseId],
        ],
      ]);
    };
    const earlyDateSQL = await directArrangement(
      '2026-09-30',
      'case.hearing.scheduled',
    );
    const mismatchAuditSQL = await directArrangement(
      '2026-10-10',
      'case.hearing.corrected',
    );
    const duplicateAdvance = await sqlCode([
      [
        "INSERT INTO case_hearing_advances(id,department_id,case_id,arrangement_id,due_at,executed_at,from_version,to_version,audit_event_id) VALUES ($1,$2,$3,$4,'2026-10-08T16:00:00Z','2026-10-09T16:00:00Z',8,9,$5)",
        [randomUUID(), departmentId, caseId, saved.arrangementId, randomUUID()],
      ],
    ]);
    return {
      initialVersion: saved.version,
      lawyerScheduled,
      replaySame: JSON.stringify(replay) === JSON.stringify(saved),
      revokedReplayDenied,
      rollbackSaveClean,
      beforeDue,
      failedAdvanceCount: failedAdvance.failed,
      rollbackAdvanceClean,
      startupAdvanced,
      secondStartupAdvanced,
      firstAdvanceCount,
      firstSystemAuditCount: firstAudits.length,
      firstSystemActorNull: firstAudits.every(
        (audit) => audit.actorKind === 'SYSTEM' && audit.actorUserId === null,
      ),
      rollbackCorrectionClean,
      overdueStage: overdue.stage,
      overdueAdvanceSame:
        afterOverdue?.currentHearingAdvanceId ===
        afterStartup?.currentHearingAdvanceId,
      futureStage: future.stage,
      futureAdvanceNull: afterFuture?.currentHearingAdvanceId === null,
      secondAdvanced,
      finalAdvanceCount,
      finalSystemAuditCount,
      historyArrangementCount,
      correctionCount,
      immutableArrangement,
      immutableAdvance,
      immutableAudit,
      earlyDateSQL,
      mismatchAuditSQL,
      duplicateAdvance,
    };
  } finally {
    if (database) await database.$disconnect();
    await admin
      .query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      .catch(() => undefined);
    await admin.end();
  }
}
