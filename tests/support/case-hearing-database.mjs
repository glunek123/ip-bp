import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { clearTimeout, setTimeout } from 'node:timers';
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
const { CaseReadService } = requireBackend(
  './dist/modules/cases/case-read.service.js',
);
const { hashPassword } = requireBackend('./dist/auth/password.js');
const { internalAssignablePermissionActions } = requireBackend(
  './dist/access-control/permission-catalog.js',
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

const coreHearingAdmin = Object.freeze({
  departmentId: '10000000-0000-4000-8000-000000000001',
  teamId: '40000000-0000-4000-8000-000000000001',
  operatorUserId: '20000000-0000-4000-8000-000000000001',
  operatorRoleId: '30000000-0000-4000-8000-000000000001',
  userId: 'a0070000-0000-4000-8000-000000000001',
  roleId: 'a0070000-0000-4000-8000-000000000002',
  membershipId: 'a0070000-0000-4000-8000-000000000003',
  assignmentId: 'a0070000-0000-4000-8000-000000000004',
  username: 'ca007.hearing.admin',
  roleName: 'CA007 TEST ROLE ADMIN',
  externalSubject: 'local:ca007-hearing-test-admin',
});

async function withCoreHearingAdminDatabase(operation) {
  validateIsolatedTestDatabaseUrl(databaseUrl);
  const database = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  try {
    const rows = await database.$queryRawUnsafe(
      'SELECT current_database() AS db,current_schema() AS schema',
    );
    if (
      process.env.NODE_ENV !== 'test' ||
      rows[0]?.db !== 'dev_cor_test' ||
      rows[0]?.schema !== 'public'
    )
      throw new Error('Hearing admin requires the isolated public test schema');
    return await operation(database);
  } finally {
    await database.$disconnect();
  }
}

/** Isolated login identity for exercising the real department-A RoleEditor. */
export async function prepareCoreCaseHearingAdmin() {
  const password = randomBytes(24).toString('base64url');
  const passwordHash = await hashPassword(password);
  const fixture = coreHearingAdmin;
  await withCoreHearingAdminDatabase(async (database) => {
    await database.$transaction(
      async (transaction) => {
        const department = await transaction.department.findUnique({
          where: { id: fixture.departmentId },
        });
        const team = await transaction.team.findUnique({
          where: { id: fixture.teamId },
        });
        const operator = await transaction.userAccount.findUnique({
          where: { id: fixture.operatorUserId },
        });
        const operatorRole = await transaction.roleTemplate.findUnique({
          where: { id: fixture.operatorRoleId },
        });
        if (
          !department ||
          !team ||
          team.departmentId !== department.id ||
          !operator ||
          !operatorRole ||
          operatorRole.departmentId !== department.id
        )
          throw new Error('Fixed core-lead A fixture is unavailable');

        const user = await transaction.userAccount.findUnique({
          where: { id: fixture.userId },
        });
        const subjectUser = await transaction.userAccount.findUnique({
          where: { externalSubject: fixture.externalSubject },
        });
        const usernameCredential = await transaction.localCredential.findUnique(
          {
            where: { username: fixture.username },
          },
        );
        const userCredential = await transaction.localCredential.findUnique({
          where: { userId: fixture.userId },
        });
        const role = await transaction.roleTemplate.findUnique({
          where: { id: fixture.roleId },
        });
        if (
          (user &&
            (user.externalSubject !== fixture.externalSubject ||
              user.accountType !== 'INTERNAL')) ||
          (subjectUser && subjectUser.id !== fixture.userId) ||
          (usernameCredential &&
            usernameCredential.userId !== fixture.userId) ||
          (userCredential && userCredential.username !== fixture.username) ||
          (role &&
            (role.departmentId !== fixture.departmentId ||
              role.name !== fixture.roleName))
        )
          throw new Error('Hearing admin identity collision');

        if (!user)
          await transaction.userAccount.create({
            data: {
              id: fixture.userId,
              externalSubject: fixture.externalSubject,
              displayName: 'CA007 测试授权管理员',
            },
          });
        else if (!user.active)
          await transaction.userAccount.update({
            where: { id: fixture.userId },
            data: { active: true },
          });
        if (!role)
          await transaction.roleTemplate.create({
            data: {
              id: fixture.roleId,
              departmentId: fixture.departmentId,
              name: fixture.roleName,
            },
          });
        else if (!role.active)
          throw new Error('Hearing admin role is inactive');

        const memberships = await transaction.departmentMembership.findMany({
          where: { userId: fixture.userId },
        });
        if (
          memberships.length > 1 ||
          (memberships.length === 1 &&
            (memberships[0].id !== fixture.membershipId ||
              memberships[0].departmentId !== fixture.departmentId ||
              memberships[0].teamId !== fixture.teamId))
        )
          throw new Error('Hearing admin membership collision');
        if (memberships.length === 0)
          await transaction.departmentMembership.create({
            data: {
              id: fixture.membershipId,
              userId: fixture.userId,
              departmentId: fixture.departmentId,
              teamId: fixture.teamId,
            },
          });
        else if (!memberships[0].active)
          await transaction.departmentMembership.update({
            where: { id: fixture.membershipId },
            data: { active: true },
          });

        const allowedActions = new Set(internalAssignablePermissionActions);
        const grants = await transaction.roleGrant.findMany({
          where: { roleTemplateId: fixture.roleId },
        });
        if (
          grants.some(
            ({ action, scope }) =>
              !allowedActions.has(action) || scope !== 'DEPARTMENT',
          )
        )
          throw new Error('Hearing admin grant collision');
        const grantedActions = new Set(grants.map(({ action }) => action));
        await transaction.roleGrant.createMany({
          data: internalAssignablePermissionActions
            .filter((action) => !grantedActions.has(action))
            .map((action) => ({
              roleTemplateId: fixture.roleId,
              action,
              scope: 'DEPARTMENT',
            })),
        });

        const assignments = await transaction.roleAssignment.findMany({
          where: { userId: fixture.userId },
        });
        if (
          assignments.length > 1 ||
          (assignments.length === 1 &&
            (assignments[0].id !== fixture.assignmentId ||
              assignments[0].departmentId !== fixture.departmentId ||
              assignments[0].roleTemplateId !== fixture.roleId ||
              assignments[0].teamId !== null ||
              !assignments[0].active))
        )
          throw new Error('Hearing admin assignment collision');
        if (assignments.length === 0)
          await transaction.roleAssignment.create({
            data: {
              id: fixture.assignmentId,
              userId: fixture.userId,
              departmentId: fixture.departmentId,
              roleTemplateId: fixture.roleId,
            },
          });
        const roleAssignments = await transaction.roleAssignment.count({
          where: { roleTemplateId: fixture.roleId },
        });
        if (roleAssignments !== 1)
          throw new Error('Hearing admin role assignment collision');

        await transaction.authSession.deleteMany({
          where: { userId: fixture.userId },
        });
        if (userCredential)
          await transaction.localCredential.update({
            where: { userId: fixture.userId },
            data: { passwordHash, passwordChangedAt: new Date() },
          });
        else
          await transaction.localCredential.create({
            data: {
              userId: fixture.userId,
              username: fixture.username,
              passwordHash,
            },
          });
      },
      { isolationLevel: 'Serializable' },
    );
  });
  return { username: fixture.username, password };
}

/** Call after the existing core-lead business/audit cleanup, never to erase history. */
export async function clearCoreCaseHearingAdmin() {
  const fixture = coreHearingAdmin;
  await withCoreHearingAdminDatabase(async (database) => {
    await database.$transaction(
      async (transaction) => {
        const user = await transaction.userAccount.findUnique({
          where: { id: fixture.userId },
        });
        const role = await transaction.roleTemplate.findUnique({
          where: { id: fixture.roleId },
        });
        const credential = await transaction.localCredential.findUnique({
          where: { username: fixture.username },
        });
        const auditCount = await transaction.auditEvent.count({
          where: {
            OR: [
              { actorUserId: fixture.userId },
              { internalActorUserId: fixture.userId },
            ],
          },
        });
        if (
          (user && user.externalSubject !== fixture.externalSubject) ||
          (role &&
            (role.departmentId !== fixture.departmentId ||
              role.name !== fixture.roleName)) ||
          (credential && credential.userId !== fixture.userId)
        )
          throw new Error('Hearing admin cleanup identity collision');
        if (auditCount > 0)
          throw new Error(
            'Hearing admin audit history must be cleared by existing fixture cleanup first',
          );
        const foreignRoleAssignments = await transaction.roleAssignment.count({
          where: {
            roleTemplateId: fixture.roleId,
            NOT: { id: fixture.assignmentId },
          },
        });
        if (foreignRoleAssignments > 0)
          throw new Error('Hearing admin role has another assignment');
        await transaction.authSession.deleteMany({
          where: { userId: fixture.userId },
        });
        await transaction.authThrottle.deleteMany({
          where: {
            kind: 'USERNAME',
            identifierDigest: createHash('sha256')
              .update(fixture.username, 'utf8')
              .digest('hex'),
          },
        });
        await transaction.localCredential.deleteMany({
          where: { userId: fixture.userId, username: fixture.username },
        });
        await transaction.roleAssignment.deleteMany({
          where: {
            id: fixture.assignmentId,
            userId: fixture.userId,
            departmentId: fixture.departmentId,
            roleTemplateId: fixture.roleId,
          },
        });
        await transaction.roleGrant.deleteMany({
          where: { roleTemplateId: fixture.roleId },
        });
        await transaction.roleTemplate.deleteMany({
          where: {
            id: fixture.roleId,
            departmentId: fixture.departmentId,
            name: fixture.roleName,
          },
        });
        await transaction.departmentMembership.deleteMany({
          where: {
            id: fixture.membershipId,
            userId: fixture.userId,
            departmentId: fixture.departmentId,
          },
        });
        await transaction.userAccount.deleteMany({
          where: {
            id: fixture.userId,
            externalSubject: fixture.externalSubject,
          },
        });
      },
      { isolationLevel: 'Serializable' },
    );
  });
}

/** Remove only this test admin's sessions before the core-lead department reset. */
export async function clearCoreCaseHearingAdminSessions() {
  const fixture = coreHearingAdmin;
  await withCoreHearingAdminDatabase(async (database) => {
    await database.$transaction(async (transaction) => {
      const user = await transaction.userAccount.findUnique({
        where: { id: fixture.userId },
      });
      if (user && user.externalSubject !== fixture.externalSubject)
        throw new Error('Hearing admin session cleanup identity collision');
      await transaction.authSession.deleteMany({
        where: { userId: fixture.userId },
      });
    });
  });
}

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

/** Reproduce a case-detail relation query racing a committed auto-advance. */
export async function verifyCaseHearingDetailSnapshot() {
  const schema = `ca007_detail_snapshot_${randomUUID().replaceAll('-', '')}`;
  const migrations = resolve(root, 'backend/prisma/migrations');
  const names = (await readdir(migrations))
    .filter(
      (name) =>
        /^\d{14}_/u.test(name) &&
        name <= '20261008028000_guard_case_judgment_reference_inserts',
    )
    .sort();
  if (
    names.length !== 91 ||
    names.at(-1) !== '20261008028000_guard_case_judgment_reference_inserts'
  )
    throw new Error('Unexpected hearing migration chain');
  const admin = new Client({ connectionString: databaseUrl });
  await admin.connect();
  let schemaCreated = false;
  let writer;
  let reader;
  let releaseRelation = () => undefined;
  try {
    const context = (
      await admin.query(
        'SELECT current_database() AS db,current_schema() AS schema',
      )
    ).rows[0];
    if (context.db !== 'dev_cor_test' || context.schema !== 'public')
      throw new Error('Unexpected hearing snapshot database');
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    await admin.query(`SET search_path TO "${schema}"`);
    for (const name of names)
      await admin.query(
        await readFile(resolve(migrations, name, 'migration.sql'), 'utf8'),
      );
    const departmentId = randomUUID();
    const userId = randomUUID();
    const caseId = randomUUID();
    const roleId = randomUUID();
    const acceptanceAuditId = randomUUID();
    await admin.query(
      'INSERT INTO departments(id,name,updated_at) VALUES ($1,$2,now())',
      [departmentId, 'CA007 detail snapshot'],
    );
    await admin.query(
      'INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES ($1,$2,$3,now())',
      [userId, `ca007-snapshot-${userId}`, 'CA007 snapshot actor'],
    );
    await admin.query(
      'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES ($1,$2,$3,now())',
      [randomUUID(), userId, departmentId],
    );
    await admin.query(
      'INSERT INTO role_templates(id,department_id,name,updated_at) VALUES ($1,$2,$3,now())',
      [roleId, departmentId, 'CA007 snapshot role'],
    );
    await admin.query(
      "INSERT INTO role_grants(id,role_template_id,action,scope) VALUES ($1,$2,'case.hearing.schedule','DEPARTMENT')",
      [randomUUID(), roleId],
    );
    await admin.query(
      'INSERT INTO role_assignments(id,user_id,department_id,role_template_id,active,updated_at) VALUES ($1,$2,$3,$4,true,now())',
      [randomUUID(), userId, departmentId, roleId],
    );
    await admin.query('SET session_replication_role = replica');
    try {
      await admin.query(
        "INSERT INTO cases(id,business_no,department_id,source_lead_id,source_notary_matter_id,certificate_id,customer_id,rights_holder_id,responsible_user_id,stage,version,matched_at,complaint_amount_state,complaint_amount,complaint_submitted_at,complaint_submitted_by_user_id,court_case_no) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'WAITING_HEARING',7,now(),'KNOWN',123.45,now(),$9,'CA007-snapshot')",
        [
          caseId,
          `CA007-SNAPSHOT-${caseId}`,
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
        "INSERT INTO case_acceptances(id,department_id,case_id,accepted_at,court_case_no,recorded_by_user_id,audit_event_id) VALUES ($1,$2,$3,'2026-10-01','CA007-snapshot',$4,$5)",
        [randomUUID(), departmentId, caseId, userId, acceptanceAuditId],
      );
    } finally {
      await admin.query('SET session_replication_role = origin');
    }

    const scopedUrl = new URL(databaseUrl);
    scopedUrl.searchParams.set('options', `-c search_path=${schema}`);
    const adapterOptions = { schema };
    writer = new PrismaClient({
      adapter: new PrismaPg(
        { connectionString: scopedUrl.toString() },
        adapterOptions,
      ),
    });
    const clock = { now: () => new Date('2026-10-09T10:00:00.000Z') };
    const hearing = new CaseHearingService(
      writer,
      new AccessControlService(new PrismaAccessControlStore(writer)),
      new CaseHearingSignal(),
      clock,
    );
    const actor = { userId, departmentId, authorizationRevision: 1 };
    const scheduled = await hearing.schedule(actor, caseId, {
      expectedVersion: 7,
      idempotencyKey: 'detail-snapshot-schedule',
      hearingAt: '2026-10-08',
    });
    if (scheduled.stage !== 'WAITING_HEARING' || scheduled.version !== 8)
      throw new Error('Snapshot fixture did not schedule');

    let relationReached;
    const atRelation = new Promise((resolveReached) => {
      relationReached = resolveReached;
    });
    const relationReleased = new Promise((resolveReleased) => {
      releaseRelation = resolveReleased;
    });
    let sawBaseCase = false;
    let paused = false;
    const wrapDriver = (driver) =>
      new Proxy(driver, {
        get(target, property) {
          if (property === 'queryRaw')
            return async (query) => {
              const sql = query.sql ?? query.text ?? '';
              if (sql.includes('"cases"')) sawBaseCase = true;
              if (sawBaseCase && sql.includes('case_hearing_')) {
                if (!paused) {
                  paused = true;
                  relationReached();
                }
                await relationReleased;
              }
              return target.queryRaw(query);
            };
          if (property === 'startTransaction')
            return async (...args) =>
              wrapDriver(await target.startTransaction(...args));
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    const factory = new PrismaPg(
      { connectionString: scopedUrl.toString() },
      adapterOptions,
    );
    const hookedFactory = new Proxy(factory, {
      get(target, property) {
        if (property === 'connect')
          return async () => wrapDriver(await target.connect());
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    reader = new PrismaClient({ adapter: hookedFactory });
    const hearingSelect = {
      id: true,
      businessNo: true,
      stage: true,
      version: true,
      createdAt: true,
      currentHearingAdvanceId: true,
      currentHearingArrangement: {
        select: {
          id: true,
          hearingAt: true,
          source: true,
          recordedAt: true,
          recordedByUserId: true,
        },
      },
      currentHearingAdvance: {
        select: {
          id: true,
          arrangementId: true,
          dueAt: true,
          executedAt: true,
        },
      },
      hearingArrangements: {
        select: {
          id: true,
          hearingAt: true,
          source: true,
          recordedAt: true,
          recordedByUserId: true,
        },
      },
      hearingAdvances: {
        select: {
          id: true,
          arrangementId: true,
          dueAt: true,
          executedAt: true,
        },
      },
      hearingCorrections: {
        select: {
          id: true,
          priorArrangementId: true,
          priorAdvanceId: true,
          newArrangementId: true,
          resultStage: true,
          recordedAt: true,
          recordedByUserId: true,
          reason: true,
        },
      },
    };
    const decorate = (record) =>
      record === null
        ? null
        : {
            ...record,
            matchedAt: null,
            matchedOn: null,
            complaintAmountState: 'KNOWN',
            complaintAmount: null,
            complaintPendingReason: null,
            complaintSubmittedAt: null,
            complaintSubmittedByUserId: null,
            complaintConfirmation: null,
            complaintMailing: null,
            filingSubmission: null,
            acceptance: null,
            judgmentFacts: [],
            currentJudgmentId: null,
            responsibleUserId: userId,
            responsibleMembership: { teamId: null },
            defendants: [],
            lawyers: [],
            courtCaseNo: null,
            owner: { id: userId, displayName: 'CA007 snapshot actor' },
            department: { id: departmentId, name: 'CA007 detail snapshot' },
            customer: { id: randomUUID(), name: 'snapshot customer' },
            rightsHolder: { id: randomUUID(), name: 'snapshot holder' },
            sourceLead: { id: randomUUID(), businessNo: 'SNAPSHOT-LEAD' },
            sourceNotaryMatter: {
              id: randomUUID(),
              businessNo: 'SNAPSHOT-NOTARY',
              evidence: null,
            },
            certificate: {
              id: randomUUID(),
              certificateNo: 'SNAPSHOT',
              certificateDate: new Date('2026-10-01T00:00:00.000Z'),
              issuedAt: new Date('2026-10-01T00:00:00.000Z'),
              needDisclose: false,
              fees: [],
            },
          };
    const readCase = async (client, input) =>
      decorate(
        await client.case.findFirst({
          where: input.where,
          select: hearingSelect,
        }),
      );
    const readDatabase = {
      userAccount: {
        findUnique: async () => ({ accountType: 'INTERNAL', active: true }),
      },
      case: { findFirst: (input) => readCase(reader, input) },
      $transaction: (operation, options) =>
        reader.$transaction(
          (transaction) =>
            operation({
              case: { findFirst: (input) => readCase(transaction, input) },
              material: {
                findMany: (input) => transaction.material.findMany(input),
              },
            }),
          options,
        ),
    };
    const materials = new Proxy(
      {},
      {
        get(_target, name) {
          if (name === 'listOwnerMaterials') return async () => ({ items: [] });
          return async () => [];
        },
      },
    );
    const reads = new CaseReadService(
      readDatabase,
      {
        authorizeDepartmentAction: async () => undefined,
        canAuthorizeCase: async () => true,
      },
      materials,
    );
    const firstRead = reads.get(actor, caseId);
    let timeoutId;
    try {
      await Promise.race([
        atRelation,
        new Promise((_resolve, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error('Relation barrier not reached')),
            15_000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timeoutId);
    }
    const advancement = await hearing.advanceDue(clock.now());
    if (advancement.advanced !== 1 || advancement.failed !== 0)
      throw new Error('Snapshot fixture did not advance');
    releaseRelation();
    const raced = await firstRead;
    const next = await reads.get(actor, caseId);
    return {
      racedStage: raced.stage,
      racedVersion: raced.version,
      racedCurrentAdvance: raced.hearing.currentAdvance?.id ?? null,
      racedAdvanceCount: raced.hearing.advances.length,
      nextStage: next.stage,
      nextVersion: next.version,
      nextAdvanceCount: next.hearing.advances.length,
      nextCurrentAdvanceMatches:
        next.hearing.currentAdvance?.id === next.hearing.advances[0]?.id,
    };
  } finally {
    releaseRelation();
    await reader?.$disconnect();
    await writer?.$disconnect();
    if (schemaCreated && /^ca007_detail_snapshot_[0-9a-f]{32}$/u.test(schema))
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
}

export async function verifyCaseHearingDatabase() {
  const schema = `ca007_db_${randomUUID().replaceAll('-', '')}`;
  const migrations = resolve(root, 'backend/prisma/migrations');
  const names = (await readdir(migrations))
    .filter(
      (name) =>
        /^\d{14}_/u.test(name) &&
        name <= '20261008028000_guard_case_judgment_reference_inserts',
    )
    .sort();
  if (
    names.length !== 91 ||
    names.at(-1) !== '20261008028000_guard_case_judgment_reference_inserts'
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
