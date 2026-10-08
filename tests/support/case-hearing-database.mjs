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

const coreHearingOwners = Object.freeze({
  '10000000-0000-4000-8000-000000000001': {
    userId: '20000000-0000-4000-8000-000000000001',
    roleId: '30000000-0000-4000-8000-000000000001',
  },
  '10000000-0000-4000-8000-000000000002': {
    userId: '20000000-0000-4000-8000-000000000002',
    roleId: '30000000-0000-4000-8000-000000000002',
  },
});

export async function seedCoreCaseHearingFixture(departmentId) {
  const owner = coreHearingOwners[departmentId];
  if (!owner)
    throw new Error(
      'Only fixed core-lead test departments may own this fixture',
    );
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const caseId = randomUUID(),
    acceptanceAuditId = randomUUID();
  try {
    const context = (
      await client.query(
        'SELECT current_database() AS db, current_schema() AS schema',
      )
    ).rows[0];
    if (context.db !== 'dev_cor_test' || context.schema !== 'public')
      throw new Error(
        'Hearing fixture requires the isolated public test schema',
      );
    await client.query(
      "INSERT INTO role_grants(id,role_template_id,action,scope) VALUES ($1,$2,'case.hearing.schedule','DEPARTMENT'),($3,$2,'case.hearing.correct','DEPARTMENT') ON CONFLICT (role_template_id,action,scope) DO NOTHING",
      [randomUUID(), owner.roleId, randomUUID()],
    );
    await client.query('BEGIN');
    try {
      await client.query('SET LOCAL session_replication_role = replica');
      await client.query(
        "INSERT INTO cases(id,business_no,department_id,source_lead_id,source_notary_matter_id,certificate_id,customer_id,rights_holder_id,responsible_user_id,stage,version,matched_at,complaint_amount_state,complaint_amount,complaint_submitted_at,complaint_submitted_by_user_id,court_case_no) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'WAITING_HEARING',7,now(),'KNOWN',123.45,now(),$9,'CA007-cleanup')",
        [
          caseId,
          `CA007-CLEAN-${caseId}`,
          departmentId,
          randomUUID(),
          randomUUID(),
          randomUUID(),
          randomUUID(),
          randomUUID(),
          owner.userId,
        ],
      );
      await client.query(
        "INSERT INTO audit_events(id,department_id,actor_user_id,internal_actor_user_id,resource_type,resource_id,action) VALUES ($1,$2,$3,$3,'CASE',$4,'case.acceptance.registered')",
        [acceptanceAuditId, departmentId, owner.userId, caseId],
      );
      await client.query(
        "INSERT INTO case_acceptances(id,department_id,case_id,accepted_at,court_case_no,recorded_by_user_id,audit_event_id) VALUES ($1,$2,$3,'2026-10-01','CA007-cleanup',$4,$5)",
        [randomUUID(), departmentId, caseId, owner.userId, acceptanceAuditId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
    if (
      (await client.query('SHOW session_replication_role')).rows[0]
        .session_replication_role !== 'origin'
    )
      throw new Error('Fixture trigger role was not restored');
  } finally {
    await client.end();
  }
  const database = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  try {
    const signal = new CaseHearingSignal();
    const clock = { now: () => new Date('2026-10-09T00:00:00.000Z') };
    const access = new AccessControlService(
      new PrismaAccessControlStore(database),
    );
    const hearing = new CaseHearingService(database, access, signal, clock);
    const actor = {
      userId: owner.userId,
      departmentId,
      authorizationRevision: 1,
    };
    await hearing.schedule(actor, caseId, {
      expectedVersion: 7,
      idempotencyKey: `cleanup-schedule-${caseId}`,
      hearingAt: '2026-10-08',
    });
    const advanced = await hearing.advanceDue(clock.now());
    if (advanced.advanced !== 1 || advanced.failed !== 0)
      throw new Error('Fixture hearing did not advance');
    await hearing.correct(actor, caseId, {
      expectedVersion: 9,
      idempotencyKey: `cleanup-correct-${caseId}`,
      hearingAt: '2026-10-02',
      reason: '清理测试保留历史',
    });
    return caseId;
  } finally {
    await database.$disconnect();
  }
}

export async function inspectCoreCaseHearingFixture(caseId) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const context = (
      await client.query(
        'SELECT current_database() AS db, current_schema() AS schema',
      )
    ).rows[0];
    if (context.db !== 'dev_cor_test' || context.schema !== 'public')
      throw new Error('Unexpected hearing fixture schema');
    const count = async (table) =>
      Number(
        (
          await client.query(
            `SELECT COUNT(*) AS n FROM "${table}" WHERE case_id=$1`,
            [caseId],
          )
        ).rows[0].n,
      );
    return {
      arrangements: await count('case_hearing_arrangements'),
      advances: await count('case_hearing_advances'),
      corrections: await count('case_hearing_corrections'),
    };
  } finally {
    await client.end();
  }
}

/** Remove only CA-007 facts owned by the two fixed core-lead test departments. */
export async function clearCoreCaseHearingFixture(departmentIds) {
  if (
    !Array.isArray(departmentIds) ||
    departmentIds.length < 1 ||
    new Set(departmentIds).size !== departmentIds.length ||
    departmentIds.some((id) => !Object.hasOwn(coreHearingOwners, id))
  )
    throw new Error('Unexpected hearing cleanup departments');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const triggerGuards = [
    ['case_hearing_receipts', 'case_hearing_receipts_immutable'],
    ['case_hearing_corrections', 'case_hearing_corrections_immutable'],
    ['case_hearing_advances', 'case_hearing_advances_immutable'],
    ['case_hearing_arrangements', 'case_hearing_arrangements_immutable'],
    ['audit_events', 'case_hearing_audit_immutable'],
  ];
  try {
    const context = (
      await client.query(
        'SELECT current_database() AS db, current_schema() AS schema',
      )
    ).rows[0];
    if (context.db !== 'dev_cor_test' || context.schema !== 'public')
      throw new Error(
        'Hearing cleanup requires the isolated public test schema',
      );
    const present = (
      await client.query(
        `SELECT EXISTS (
      SELECT 1 FROM case_hearing_arrangements WHERE department_id=ANY($1::uuid[])
      UNION ALL SELECT 1 FROM case_hearing_advances WHERE department_id=ANY($1::uuid[])
      UNION ALL SELECT 1 FROM case_hearing_corrections WHERE department_id=ANY($1::uuid[])
      UNION ALL SELECT 1 FROM case_hearing_receipts WHERE department_id=ANY($1::uuid[])
      UNION ALL SELECT 1 FROM audit_events WHERE department_id=ANY($1::uuid[])
        AND action IN ('case.hearing.scheduled','case.hearing.corrected','case.hearing.auto_advanced')
      UNION ALL SELECT 1 FROM cases WHERE department_id=ANY($1::uuid[])
        AND (current_hearing_arrangement_id IS NOT NULL OR current_hearing_advance_id IS NOT NULL)
    ) AS present`,
        [departmentIds],
      )
    ).rows[0].present;
    if (!present) return;
    await client.query('BEGIN');
    try {
      for (const [table, trigger] of triggerGuards) {
        const state = (
          await client.query(
            'SELECT tgenabled FROM pg_trigger WHERE tgrelid=$1::regclass AND tgname=$2',
            [table, trigger],
          )
        ).rows[0]?.tgenabled;
        if (state !== 'O')
          throw new Error(`Hearing cleanup guard unavailable: ${trigger}`);
      }
      await client.query(
        'UPDATE cases SET current_hearing_arrangement_id=NULL,current_hearing_advance_id=NULL WHERE department_id=ANY($1::uuid[]) AND (current_hearing_arrangement_id IS NOT NULL OR current_hearing_advance_id IS NOT NULL)',
        [departmentIds],
      );
      for (const [table, trigger] of triggerGuards)
        await client.query(
          `ALTER TABLE "${table}" DISABLE TRIGGER "${trigger}"`,
        );
      for (const table of [
        'case_hearing_receipts',
        'case_hearing_corrections',
        'case_hearing_advances',
        'case_hearing_arrangements',
      ])
        await client.query(
          `DELETE FROM "${table}" WHERE department_id=ANY($1::uuid[])`,
          [departmentIds],
        );
      await client.query(
        "DELETE FROM audit_events WHERE department_id=ANY($1::uuid[]) AND action IN ('case.hearing.scheduled','case.hearing.corrected','case.hearing.auto_advanced')",
        [departmentIds],
      );
      for (const [table, trigger] of [...triggerGuards].reverse())
        await client.query(
          `ALTER TABLE "${table}" ENABLE TRIGGER "${trigger}"`,
        );
      for (const [table, trigger] of triggerGuards) {
        const state = (
          await client.query(
            'SELECT tgenabled FROM pg_trigger WHERE tgrelid=$1::regclass AND tgname=$2',
            [table, trigger],
          )
        ).rows[0]?.tgenabled;
        if (state !== 'O')
          throw new Error(`Hearing cleanup guard not restored: ${trigger}`);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  } finally {
    await client.end();
  }
}

export async function inspectCoreCaseHearingGuards() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const context = (
      await client.query(
        'SELECT current_database() AS db, current_schema() AS schema',
      )
    ).rows[0];
    if (context.db !== 'dev_cor_test' || context.schema !== 'public')
      throw new Error('Unexpected hearing guard inspection target');
    const rows = await client.query(`SELECT tgname,tgenabled FROM pg_trigger
      WHERE tgname IN ('case_hearing_receipts_immutable','case_hearing_corrections_immutable',
        'case_hearing_advances_immutable','case_hearing_arrangements_immutable',
        'case_hearing_audit_immutable') ORDER BY tgname`);
    return rows.rows.map(({ tgname, tgenabled }) => ({
      name: tgname,
      enabled: tgenabled,
    }));
  } finally {
    await client.end();
  }
}

export async function withCoreCaseHearingCleanupFault(operation) {
  const client = new Client({ connectionString: databaseUrl });
  const suffix = randomUUID().replaceAll('-', '');
  const functionName = `ca007_cleanup_reject_${suffix}`;
  await client.connect();
  let functionCreated = false;
  let triggerCreated = false;
  try {
    const context = (
      await client.query(
        'SELECT current_database() AS db, current_schema() AS schema',
      )
    ).rows[0];
    if (context.db !== 'dev_cor_test' || context.schema !== 'public')
      throw new Error('Unexpected hearing cleanup fault target');
    await client.query(`CREATE FUNCTION "${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD."department_id" = '10000000-0000-4000-8000-000000000001'::uuid THEN
          RAISE EXCEPTION 'injected hearing cleanup failure' USING ERRCODE='P0001';
        END IF;
        RETURN OLD;
      END $$`);
    functionCreated = true;
    await client.query(`CREATE TRIGGER "${functionName}" BEFORE DELETE ON case_hearing_receipts
      FOR EACH ROW EXECUTE FUNCTION "${functionName}"()`);
    triggerCreated = true;
    return await operation();
  } finally {
    try {
      if (triggerCreated)
        await client.query(
          `DROP TRIGGER "${functionName}" ON case_hearing_receipts`,
        );
      if (functionCreated)
        await client.query(`DROP FUNCTION "${functionName}"()`);
    } finally {
      await client.end();
    }
  }
}

export async function verifyCaseHearingDatabase() {
  const schema = `ca007_db_${randomUUID().replaceAll('-', '')}`;
  const migrations = resolve(root, 'backend/prisma/migrations');
  const names = (await readdir(migrations))
    .filter((name) => /^\d{14}_/u.test(name))
    .sort();
  if (
    names.length !== 82 ||
    names.at(-1) !== '20261008015000_require_latest_case_hearing_chain'
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
    let clock1Time = new Date('2026-10-08T10:00:00.000Z');
    const clock1 = { now: () => clock1Time };
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
    clock1Time = new Date('2026-10-08T16:00:00.000Z');
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
    const againOverdue = await service2.correct(actor, caseId, {
      expectedVersion: 10,
      idempotencyKey: 'correct-overdue-again',
      hearingAt: '2026-10-03',
      reason: '法院再次核对旧日期',
    });
    const afterAgainOverdue = await database.case.findUnique({
      where: { id: caseId },
      select: { currentHearingAdvanceId: true },
    });
    const signal3 = new CaseHearingSignal();
    let clock3Time = new Date('2026-10-08T17:00:00.000Z');
    const clock3 = { now: () => clock3Time };
    const service3 = new CaseHearingService(database, access, signal3, clock3);
    const future = await service3.correct(actor, caseId, {
      expectedVersion: 11,
      idempotencyKey: 'correct-future',
      hearingAt: '2026-10-09',
      reason: '法院再次通知改期',
    });
    const afterFuture = await database.case.findUnique({
      where: { id: caseId },
      select: { currentHearingAdvanceId: true },
    });
    clock3Time = new Date('2026-10-09T16:00:00.000Z');
    const secondAdvanced = (await service3.advanceDue(clock3Time)).advanced;
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
      select: { version: true, currentHearingAdvanceId: true },
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
    const probeCorrection = async ({
      priorAdvanceId,
      fromVersion,
      hearingAt,
      resultStage,
      auditReason,
      factReason,
      priorArrangementId = future.arrangementId,
      auditOverrides = {},
    }) => {
      const auditId = randomUUID(),
        newArrangementId = randomUUID();
      const details = {
        arrangementId: newArrangementId,
        hearingAt,
        fromVersion,
        toVersion: fromVersion + 1,
        reason: auditReason,
        priorArrangementId,
        priorAdvanceId,
        resultStage,
        ...auditOverrides,
      };
      const steps = [
        [
          "INSERT INTO audit_events(id,department_id,actor_user_id,internal_actor_user_id,resource_type,resource_id,action,details) VALUES ($1,$2,$3,$3,'CASE',$4,'case.hearing.corrected',$5)",
          [auditId, departmentId, userId, caseId, details],
        ],
        [
          "INSERT INTO case_hearing_arrangements(id,department_id,case_id,hearing_at,source,recorded_at,recorded_by_user_id,from_version,to_version,audit_event_id) VALUES ($1,$2,$3,$4,'CORRECTION','2026-10-10T00:00:00Z',$5,$6,$7,$8)",
          [
            newArrangementId,
            departmentId,
            caseId,
            hearingAt,
            userId,
            fromVersion,
            fromVersion + 1,
            auditId,
          ],
        ],
        [
          "INSERT INTO case_hearing_corrections(id,department_id,case_id,prior_arrangement_id,prior_advance_id,new_arrangement_id,reason,recorded_at,recorded_by_user_id,from_version,to_version,result_stage,audit_event_id) VALUES ($1,$2,$3,$4,$5,$6,$7,'2026-10-10T00:00:00Z',$8,$9,$10,$11,$12)",
          [
            randomUUID(),
            departmentId,
            caseId,
            priorArrangementId,
            priorAdvanceId,
            newArrangementId,
            factReason,
            userId,
            fromVersion,
            fromVersion + 1,
            resultStage,
            auditId,
          ],
        ],
        [
          'UPDATE cases SET stage=$1,version=$2,current_hearing_arrangement_id=$3,current_hearing_advance_id=$4 WHERE id=$5',
          [
            resultStage,
            fromVersion + 1,
            newArrangementId,
            resultStage === 'WAITING_JUDGMENT' ? priorAdvanceId : null,
            caseId,
          ],
        ],
      ];
      try {
        await admin.query('BEGIN');
        for (const [sql, params] of steps) await admin.query(sql, params);
        await admin.query('SET CONSTRAINTS ALL IMMEDIATE');
        await admin.query('ROLLBACK');
        return null;
      } catch (error) {
        await admin.query('ROLLBACK').catch(() => undefined);
        return error.code ?? null;
      }
    };
    const auditReasonMismatch = await probeCorrection({
      priorAdvanceId: finalCase.currentHearingAdvanceId,
      fromVersion: finalCase.version,
      hearingAt: '2026-10-02',
      resultStage: 'WAITING_JUDGMENT',
      auditReason: '审计错记原因',
      factReason: '法院核实原因',
    });
    const auditPriorArrangementMismatch = await probeCorrection({
      priorAdvanceId: finalCase.currentHearingAdvanceId,
      fromVersion: finalCase.version,
      hearingAt: '2026-10-02',
      resultStage: 'WAITING_JUDGMENT',
      auditReason: '法院核实原因',
      factReason: '法院核实原因',
      auditOverrides: { priorArrangementId: randomUUID() },
    });
    const auditPriorAdvanceMismatch = await probeCorrection({
      priorAdvanceId: finalCase.currentHearingAdvanceId,
      fromVersion: finalCase.version,
      hearingAt: '2026-10-02',
      resultStage: 'WAITING_JUDGMENT',
      auditReason: '法院核实原因',
      factReason: '法院核实原因',
      auditOverrides: { priorAdvanceId: randomUUID() },
    });
    const auditResultStageMismatch = await probeCorrection({
      priorAdvanceId: finalCase.currentHearingAdvanceId,
      fromVersion: finalCase.version,
      hearingAt: '2026-10-02',
      resultStage: 'WAITING_JUDGMENT',
      auditReason: '法院核实原因',
      factReason: '法院核实原因',
      auditOverrides: { resultStage: 'WAITING_HEARING' },
    });
    const staleAdvanceChain = await probeCorrection({
      priorAdvanceId: afterStartup.currentHearingAdvanceId,
      fromVersion: finalCase.version - 1,
      hearingAt: null,
      resultStage: 'WAITING_HEARING',
      auditReason: '法院再次通知',
      factReason: '法院再次通知',
    });
    const staleJudgmentChain = await probeCorrection({
      priorArrangementId: againOverdue.arrangementId,
      priorAdvanceId: afterStartup.currentHearingAdvanceId,
      fromVersion: againOverdue.version,
      hearingAt: null,
      resultStage: 'WAITING_HEARING',
      auditReason: '伪造旧纠错链',
      factReason: '伪造旧纠错链',
    });
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
      againOverdueStage: againOverdue.stage,
      againAdvanceSame:
        afterAgainOverdue?.currentHearingAdvanceId ===
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
      auditReasonMismatch,
      auditPriorArrangementMismatch,
      auditPriorAdvanceMismatch,
      auditResultStageMismatch,
      staleAdvanceChain,
      staleJudgmentChain,
    };
  } finally {
    if (database) await database.$disconnect();
    await admin
      .query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      .catch(() => undefined);
    await admin.end();
  }
}
