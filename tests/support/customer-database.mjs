import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const requireFromBackend = createRequire(
  resolve(process.cwd(), 'backend/package.json'),
);
const { PrismaPg } = requireFromBackend('@prisma/adapter-pg');
const { ForbiddenException } = requireFromBackend('@nestjs/common');
const { Client } = requireFromBackend('pg');
const { PrismaClient } = requireFromBackend(
  './dist/generated/prisma/client.js',
);
const { hashPassword } = requireFromBackend('./dist/auth/password.js');
const { OrganizationService } = requireFromBackend(
  './dist/access-control/organization.service.js',
);
const { CustomerService } = requireFromBackend(
  './dist/modules/customers/customer.service.js',
);

const e2eFixtures = {
  departmentA: '10000000-0000-4000-8000-000000000001',
  departmentB: '10000000-0000-4000-8000-000000000002',
  userA: '20000000-0000-4000-8000-000000000001',
  userB: '20000000-0000-4000-8000-000000000002',
  userSelf: '20000000-0000-4000-8000-000000000003',
  roleA: '30000000-0000-4000-8000-000000000001',
  roleB: '30000000-0000-4000-8000-000000000002',
  roleSelf: '30000000-0000-4000-8000-000000000003',
  teamA: '40000000-0000-4000-8000-000000000001',
  teamB: '40000000-0000-4000-8000-000000000003',
  teamSelf: '40000000-0000-4000-8000-000000000002',
  tokenA: 'e2e-department-a',
  tokenB: 'e2e-department-b',
  tokenSelf: 'e2e-department-a-self',
};

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined) {
  throw new Error('DATABASE_URL is required for customer E2E setup');
}
const testTarget = new URL(databaseUrl);
if (
  process.env.NODE_ENV !== 'test' ||
  testTarget.hostname !== '127.0.0.1' ||
  testTarget.port !== '55433' ||
  testTarget.pathname !== '/dev_cor_test'
) {
  throw new Error(
    'Customer fixtures require the fixed isolated E2E database environment',
  );
}

const database = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl, max: 2 }),
});

async function resetLocalAuthE2eData() {
  const departmentId = '10000000-0000-4000-8000-000000000010';
  const userId = '20000000-0000-4000-8000-000000000010';
  const roleId = '30000000-0000-4000-8000-000000000010';
  const password = 'Browser-test-passphrase-2026';
  const passwordHash = await hashPassword(password);
  await database.$transaction(async (transaction) => {
    await transaction.authSession.deleteMany({});
    await transaction.authThrottle.deleteMany({});
    await transaction.localCredential.deleteMany({});
    await transaction.auditEvent.deleteMany({ where: { departmentId } });
    await transaction.customer.deleteMany({ where: { departmentId } });
    await transaction.roleAssignment.deleteMany({ where: { userId } });
    await transaction.roleGrant.deleteMany({
      where: { roleTemplateId: roleId },
    });
    await transaction.roleTemplate.deleteMany({ where: { id: roleId } });
    await transaction.departmentMembership.deleteMany({ where: { userId } });
    await transaction.userAccount.deleteMany({ where: { id: userId } });
    await transaction.department.deleteMany({ where: { id: departmentId } });
    await transaction.department.create({
      data: { id: departmentId, name: 'E2E 认证部' },
    });
    await transaction.userAccount.create({
      data: {
        id: userId,
        externalSubject: 'local:e2e-auth-user',
        displayName: 'E2E 本地管理员',
      },
    });
    await transaction.localCredential.create({
      data: { userId, username: 'e2e.local.admin', passwordHash },
    });
    await transaction.departmentMembership.create({
      data: { userId, departmentId },
    });
    await transaction.roleTemplate.create({
      data: { id: roleId, departmentId, name: 'E2E 本地管理员模板' },
    });
    await transaction.roleGrant.createMany({
      data: [
        'CUSTOMER_READ',
        'CUSTOMER_CREATE_DRAFT',
        'CUSTOMER_EDIT_ROUTINE',
      ].map((action) => ({
        roleTemplateId: roleId,
        action,
        scope: 'DEPARTMENT',
      })),
    });
    await transaction.roleAssignment.create({
      data: { userId, departmentId, roleTemplateId: roleId },
    });
  });
  return { username: 'e2e.local.admin', password };
}

async function verifyLocalAuthMigration() {
  const client = new Client({ connectionString: databaseUrl });
  const migrationRoot = resolve(process.cwd(), 'backend/prisma/migrations');
  const previous = '20260917080000_enforce_rights_holder_name_whitespace';
  const target = '20260917150000_add_local_authentication';
  const whitespaceTarget =
    '20260918010000_enforce_user_display_name_whitespace';
  const migrations = (await readdir(migrationRoot))
    .filter((name) => /^\d{14}_/.test(name))
    .sort();
  const previousMigrations = migrations.filter((name) => name <= previous);
  const migrationSql = await readFile(
    resolve(migrationRoot, target, 'migration.sql'),
    'utf8',
  );
  const whitespaceMigrationSql = await readFile(
    resolve(migrationRoot, whitespaceTarget, 'migration.sql'),
    'utf8',
  );
  const schema = `auth_probe_${randomUUID().replaceAll('-', '')}`;
  const failedSchema = `${schema}_failed`;
  const whitespaceFailedSchema = `${schema}_whitespace_failed`;
  await client.connect();
  try {
    const actual = await client.query('SELECT current_database() AS database');
    if (actual.rows[0].database !== 'dev_cor_test')
      throw new Error('Unexpected migration database');
    for (const namespace of [schema, failedSchema, whitespaceFailedSchema]) {
      await client.query(`CREATE SCHEMA "${namespace}"`);
      await client.query(`SET search_path TO "${namespace}"`);
      for (const migration of previousMigrations) {
        await client.query(
          await readFile(
            resolve(migrationRoot, migration, 'migration.sql'),
            'utf8',
          ),
        );
      }
    }

    const userId = randomUUID();
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(
      "INSERT INTO user_accounts(id,external_subject,updated_at) VALUES ($1,'legacy-user',NOW())",
      [userId],
    );
    await client.query(migrationSql);
    await client.query(whitespaceMigrationSql);
    const upgraded = (
      await client.query(
        'SELECT external_subject,display_name FROM user_accounts WHERE id=$1',
        [userId],
      )
    ).rows[0];
    const authTables = (
      await client.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_name IN ('local_credentials','auth_sessions','auth_throttles') ORDER BY table_name",
        [schema],
      )
    ).rows.map((row) => row.table_name);
    let invalidUsernameConstraint = null;
    await client.query('BEGIN');
    try {
      await client.query(
        "INSERT INTO local_credentials(id,user_id,username,password_hash,updated_at) VALUES ($1,$2,'Invalid User','hash',NOW())",
        [randomUUID(), userId],
      );
    } catch (error) {
      invalidUsernameConstraint = error.constraint ?? error.code ?? null;
    } finally {
      await client.query('ROLLBACK');
    }

    await client.query(`SET search_path TO "${failedSchema}"`);
    await client.query(
      "INSERT INTO user_accounts(id,external_subject,updated_at) VALUES ($1,'   ',NOW())",
      [randomUUID()],
    );
    let failedMigrationCode = null;
    try {
      await client.query(migrationSql);
    } catch (error) {
      failedMigrationCode = error.code ?? null;
      await client.query('ROLLBACK');
    }
    const failedColumns = Number(
      (
        await client.query(
          "SELECT count(*) FROM information_schema.columns WHERE table_schema=$1 AND table_name='user_accounts' AND column_name='display_name'",
          [failedSchema],
        )
      ).rows[0].count,
    );
    const failedTables = Number(
      (
        await client.query(
          "SELECT count(*) FROM information_schema.tables WHERE table_schema=$1 AND table_name IN ('local_credentials','auth_sessions','auth_throttles')",
          [failedSchema],
        )
      ).rows[0].count,
    );
    await client.query(`SET search_path TO "${whitespaceFailedSchema}"`);
    const whitespaceUserId = randomUUID();
    await client.query(
      "INSERT INTO user_accounts(id,external_subject,updated_at) VALUES ($1,'legacy-whitespace',NOW())",
      [whitespaceUserId],
    );
    await client.query(migrationSql);
    await client.query('UPDATE user_accounts SET display_name=$2 WHERE id=$1', [
      whitespaceUserId,
      '\u00a0',
    ]);
    let whitespaceMigrationCode = null;
    try {
      await client.query(whitespaceMigrationSql);
    } catch (error) {
      whitespaceMigrationCode = error.code ?? null;
      await client.query('ROLLBACK');
    }
    const whitespaceValue = (
      await client.query('SELECT display_name FROM user_accounts WHERE id=$1', [
        whitespaceUserId,
      ])
    ).rows[0]?.display_name;
    return {
      previousMigrations: previousMigrations.length,
      displayName: upgraded?.display_name ?? null,
      externalSubject: upgraded?.external_subject ?? null,
      authTables,
      invalidUsernameConstraint,
      failedMigrationCode,
      failedColumns,
      failedTables,
      whitespaceMigrationCode,
      whitespaceRollbackPreserved: whitespaceValue === '\u00a0',
    };
  } finally {
    await client.query('ROLLBACK');
    await client.query('RESET search_path');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.query(`DROP SCHEMA IF EXISTS "${failedSchema}" CASCADE`);
    await client.query(
      `DROP SCHEMA IF EXISTS "${whitespaceFailedSchema}" CASCADE`,
    );
    await client.end();
  }
}

async function resetCustomerE2eData() {
  const departmentIds = [e2eFixtures.departmentA, e2eFixtures.departmentB];
  const userIds = [e2eFixtures.userA, e2eFixtures.userB, e2eFixtures.userSelf];

  await database.$transaction([
    database.auditEvent.deleteMany({
      where: { departmentId: { in: departmentIds } },
    }),
    database.rightsHolderCommandReceipt.deleteMany({
      where: { departmentId: { in: departmentIds } },
    }),
    database.customerRightsHolderLink.deleteMany({
      where: { departmentId: { in: departmentIds } },
    }),
    database.rightsHolder.deleteMany({
      where: { departmentId: { in: departmentIds } },
    }),
    database.customer.deleteMany({
      where: { departmentId: { in: departmentIds } },
    }),
    database.roleAssignment.deleteMany({
      where: { departmentId: { in: departmentIds } },
    }),
    database.roleGrant.deleteMany({
      where: {
        roleTemplateId: {
          in: [e2eFixtures.roleA, e2eFixtures.roleB, e2eFixtures.roleSelf],
        },
      },
    }),
    database.roleTemplate.deleteMany({
      where: { departmentId: { in: departmentIds } },
    }),
    database.departmentMembership.deleteMany({
      where: { departmentId: { in: departmentIds } },
    }),
    database.team.deleteMany({
      where: { departmentId: { in: departmentIds } },
    }),
    database.userAccount.deleteMany({
      where: { id: { in: userIds } },
    }),
    database.department.deleteMany({
      where: { id: { in: departmentIds } },
    }),
  ]);

  await database.department.createMany({
    data: [
      { id: e2eFixtures.departmentA, name: 'E2E 知产部' },
      { id: e2eFixtures.departmentB, name: 'E2E 品维部' },
    ],
  });
  await database.userAccount.createMany({
    data: [
      {
        id: e2eFixtures.userA,
        externalSubject: 'e2e-user-a',
        displayName: '测试用户甲',
      },
      {
        id: e2eFixtures.userB,
        externalSubject: 'e2e-user-b',
        displayName: '测试用户乙',
      },
      {
        id: e2eFixtures.userSelf,
        externalSubject: 'e2e-user-self',
        displayName: '测试用户本人',
      },
    ],
  });
  await database.team.createMany({
    data: [
      {
        id: e2eFixtures.teamA,
        departmentId: e2eFixtures.departmentA,
        name: 'E2E 团队甲',
      },
      {
        id: e2eFixtures.teamSelf,
        departmentId: e2eFixtures.departmentA,
        name: 'E2E 团队本人',
      },
      {
        id: e2eFixtures.teamB,
        departmentId: e2eFixtures.departmentB,
        name: 'E2E 团队乙',
      },
    ],
  });
  await database.departmentMembership.createMany({
    data: [
      {
        userId: e2eFixtures.userA,
        departmentId: e2eFixtures.departmentA,
        teamId: e2eFixtures.teamA,
      },
      { userId: e2eFixtures.userB, departmentId: e2eFixtures.departmentB },
      {
        userId: e2eFixtures.userSelf,
        departmentId: e2eFixtures.departmentA,
        teamId: e2eFixtures.teamSelf,
      },
    ],
  });
  await database.roleTemplate.createMany({
    data: [
      {
        id: e2eFixtures.roleA,
        departmentId: e2eFixtures.departmentA,
        name: 'E2E 运营模板 A',
      },
      {
        id: e2eFixtures.roleB,
        departmentId: e2eFixtures.departmentB,
        name: 'E2E 运营模板 B',
      },
      {
        id: e2eFixtures.roleSelf,
        departmentId: e2eFixtures.departmentA,
        name: 'E2E 本人范围模板',
      },
    ],
  });
  await database.roleGrant.createMany({
    data: [
      {
        roleTemplateId: e2eFixtures.roleA,
        action: 'CUSTOMER_READ',
        scope: 'TEAM',
      },
      {
        roleTemplateId: e2eFixtures.roleA,
        action: 'CUSTOMER_CREATE_DRAFT',
        scope: 'TEAM',
      },
      {
        roleTemplateId: e2eFixtures.roleA,
        action: 'CUSTOMER_EDIT_ROUTINE',
        scope: 'TEAM',
      },
      {
        roleTemplateId: e2eFixtures.roleB,
        action: 'CUSTOMER_READ',
        scope: 'DEPARTMENT',
      },
      {
        roleTemplateId: e2eFixtures.roleB,
        action: 'CUSTOMER_CREATE_DRAFT',
        scope: 'DEPARTMENT',
      },
      {
        roleTemplateId: e2eFixtures.roleB,
        action: 'CUSTOMER_EDIT_ROUTINE',
        scope: 'DEPARTMENT',
      },
      {
        roleTemplateId: e2eFixtures.roleSelf,
        action: 'CUSTOMER_READ',
        scope: 'SELF',
      },
      {
        roleTemplateId: e2eFixtures.roleSelf,
        action: 'CUSTOMER_CREATE_DRAFT',
        scope: 'SELF',
      },
      {
        roleTemplateId: e2eFixtures.roleSelf,
        action: 'CUSTOMER_EDIT_ROUTINE',
        scope: 'SELF',
      },
    ],
  });
  await database.roleAssignment.createMany({
    data: [
      {
        userId: e2eFixtures.userA,
        departmentId: e2eFixtures.departmentA,
        roleTemplateId: e2eFixtures.roleA,
        teamId: e2eFixtures.teamA,
      },
      {
        userId: e2eFixtures.userB,
        departmentId: e2eFixtures.departmentB,
        roleTemplateId: e2eFixtures.roleB,
      },
      {
        userId: e2eFixtures.userSelf,
        departmentId: e2eFixtures.departmentA,
        roleTemplateId: e2eFixtures.roleSelf,
      },
    ],
  });
}

async function findCustomerId(departmentId, name) {
  const customer = await database.customer.findFirstOrThrow({
    where: { departmentId, name },
    select: { id: true },
  });
  return customer.id;
}

function countCustomers(departmentId, name) {
  return database.customer.count({ where: { departmentId, name } });
}

function countCustomerDraftAuditEvents(departmentId) {
  return database.auditEvent.count({
    where: { departmentId, action: 'customer.draft-created' },
  });
}

function countCustomerAuditEvents(departmentId, action) {
  return database.auditEvent.count({ where: { departmentId, action } });
}

function countCustomerResourceAuditEvents(resourceId, action) {
  return database.auditEvent.count({ where: { resourceId, action } });
}

function countCustomersByNormalizedIdentity(departmentId, identityType, value) {
  return database.customer.count({
    where: {
      departmentId,
      identityType,
      normalizedIdentityNumber: value,
    },
  });
}

function getCustomer(departmentId, name) {
  return database.customer.findFirstOrThrow({ where: { departmentId, name } });
}

function getCustomerById(id) {
  return database.customer.findUniqueOrThrow({ where: { id } });
}

function getLatestCustomerAudit(resourceId, action = 'customer.updated') {
  return database.auditEvent.findFirstOrThrow({
    where: { resourceId, action },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
}

function getCustomerAuditEvents(resourceId, action = 'customer.updated') {
  return database.auditEvent.findMany({
    where: { resourceId, action },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

async function verifyRoleAssignmentMigrationRollback() {
  const client = new Client({ connectionString: databaseUrl });
  const schema = `migration_probe_${Date.now()}`;
  const accessMigration = await readFile(
    resolve(
      process.cwd(),
      'backend/prisma/migrations/20260916120000_add_access_control/migration.sql',
    ),
    'utf8',
  );
  const hardeningMigration = await readFile(
    resolve(
      process.cwd(),
      'backend/prisma/migrations/20260917020000_enforce_role_assignment_department/migration.sql',
    ),
    'utf8',
  );
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(accessMigration);
    await client.query(
      `INSERT INTO departments(id, name, updated_at) VALUES
       ('10000000-0000-4000-8000-000000000091', 'A', NOW()),
       ('10000000-0000-4000-8000-000000000092', 'B', NOW());
       INSERT INTO user_accounts(id, external_subject, updated_at) VALUES
       ('20000000-0000-4000-8000-000000000091', 'probe', NOW());
       INSERT INTO role_templates(id, department_id, name, updated_at) VALUES
       ('30000000-0000-4000-8000-000000000091', '10000000-0000-4000-8000-000000000092', 'B role', NOW());
       INSERT INTO role_assignments(id, user_id, department_id, role_template_id, updated_at)
       VALUES ('50000000-0000-4000-8000-000000000091', '20000000-0000-4000-8000-000000000091', '10000000-0000-4000-8000-000000000091', '30000000-0000-4000-8000-000000000091', NOW());`,
    );
    let rejected = false;
    try {
      await client.query(hardeningMigration);
    } catch {
      rejected = true;
      await client.query('ROLLBACK');
    }
    const constraints = await client.query(
      `SELECT conname FROM pg_constraint
       WHERE conrelid = 'role_assignments'::regclass`,
    );
    return {
      rejected,
      constraintNames: constraints.rows.map((row) => row.conname),
    };
  } finally {
    await client.query('RESET search_path');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
}

async function getTeamArchitectureSnapshot() {
  const [actions, teamTable, constraints] = await Promise.all([
    database.$queryRawUnsafe(
      `SELECT enumlabel FROM pg_enum
       WHERE enumtypid = 'permission_action'::regtype
       ORDER BY enumsortorder`,
    ),
    database.$queryRawUnsafe(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_name = 'teams'`,
    ),
    database.$queryRawUnsafe(
      `SELECT conname FROM pg_constraint
       WHERE conname IN (
         'department_memberships_team_department_fkey',
         'role_assignments_team_department_fkey',
         'customers_team_department_fkey'
       ) ORDER BY conname`,
    ),
  ]);
  return {
    actions: actions.map((row) => row.enumlabel),
    hasTeamTable: teamTable.length === 1,
    constraints: constraints.map((row) => row.conname),
  };
}

function assignMissingTeamToMembership() {
  return database.departmentMembership.update({
    where: {
      userId_departmentId: {
        userId: e2eFixtures.userA,
        departmentId: e2eFixtures.departmentA,
      },
    },
    data: { teamId: '40000000-0000-4000-8000-000000000099' },
  });
}

function createTeamForMissingDepartment() {
  return database.team.create({
    data: {
      departmentId: '10000000-0000-4000-8000-000000000099',
      name: '不存在部门的团队',
    },
  });
}

function assignMissingTeamToRoleAssignment() {
  return database.roleAssignment.updateMany({
    where: {
      userId: e2eFixtures.userA,
      departmentId: e2eFixtures.departmentA,
      roleTemplateId: e2eFixtures.roleA,
    },
    data: { teamId: '40000000-0000-4000-8000-000000000099' },
  });
}

function assignCrossDepartmentTeamToMembership() {
  return database.departmentMembership.update({
    where: {
      userId_departmentId: {
        userId: e2eFixtures.userA,
        departmentId: e2eFixtures.departmentA,
      },
    },
    data: { teamId: e2eFixtures.teamB },
  });
}

function assignCrossDepartmentTeamToCustomer() {
  return database.customer.create({
    data: {
      name: '跨部门团队客户必须失败',
      normalizedName: '跨部门团队客户必须失败',
      departmentId: e2eFixtures.departmentA,
      responsibleUserId: e2eFixtures.userA,
      teamId: e2eFixtures.teamB,
    },
  });
}

function setTeamStatus(teamId, status) {
  return database.team.update({ where: { id: teamId }, data: { status } });
}

function moveTeamToDepartment(teamId, departmentId) {
  return database.team.update({
    where: { id: teamId },
    data: { departmentId },
  });
}

async function getTeamReferenceCounts(teamId) {
  const [memberships, roleAssignments, customers] = await Promise.all([
    database.departmentMembership.count({ where: { teamId } }),
    database.roleAssignment.count({ where: { teamId } }),
    database.customer.count({ where: { teamId } }),
  ]);
  return { memberships, roleAssignments, customers };
}

async function verifyTeamArchitectureMigration() {
  const client = new Client({ connectionString: databaseUrl });
  const migrationRoot = resolve(process.cwd(), 'backend/prisma/migrations');
  const actionMigrationName =
    '20260920010000_add_management_permission_actions';
  const teamMigrationName = '20260920020000_add_team_master_data';
  const migrations = (await readdir(migrationRoot))
    .filter((name) => /^\d{14}_/.test(name))
    .sort();
  const previousMigrations = migrations.filter(
    (name) => name < actionMigrationName,
  );
  const actionMigration = await readFile(
    resolve(migrationRoot, actionMigrationName, 'migration.sql'),
    'utf8',
  );
  const teamMigration = await readFile(
    resolve(migrationRoot, teamMigrationName, 'migration.sql'),
    'utf8',
  );
  const upgradedSchema = `team_upgrade_${randomUUID().replaceAll('-', '')}`;
  const failedSchema = `${upgradedSchema}_failed`;
  const sharedRoleSchema = `${upgradedSchema}_shared_role`;
  const departmentA = '10000000-0000-4000-8000-000000000091';
  const departmentB = '10000000-0000-4000-8000-000000000092';
  const userA = '20000000-0000-4000-8000-000000000091';
  const userB = '20000000-0000-4000-8000-000000000092';
  const userC = '20000000-0000-4000-8000-000000000093';
  const userD = '20000000-0000-4000-8000-000000000094';
  const roleA = '30000000-0000-4000-8000-000000000091';
  const roleB = '30000000-0000-4000-8000-000000000092';
  const sharedTeam = '40000000-0000-4000-8000-000000000091';

  async function prepareSchema(schema) {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    for (const migration of previousMigrations) {
      await client.query(
        await readFile(
          resolve(migrationRoot, migration, 'migration.sql'),
          'utf8',
        ),
      );
    }
    await client.query(actionMigration);
  }

  const seedSql = (collidingGrantId = null) => `
    INSERT INTO departments(id,name,updated_at) VALUES
      ('${departmentA}','A',NOW()),('${departmentB}','B',NOW());
    INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES
      ('${userA}','local:team-probe-a','Probe A',NOW()),
      ('${userB}','external:team-probe-b','Probe B',NOW()),
      ('${userD}','external:team-probe-null','Probe Null',NOW());
    INSERT INTO local_credentials(id,user_id,username,password_hash,updated_at) VALUES
      ('80000000-0000-4000-8000-000000000091','${userA}','team.probe.a','hash',NOW());
    INSERT INTO department_memberships(id,user_id,department_id,team_id,updated_at) VALUES
      ('60000000-0000-4000-8000-000000000091','${userA}','${departmentA}','${sharedTeam}',NOW()),
      ('60000000-0000-4000-8000-000000000092','${userB}','${departmentB}','${sharedTeam}',NOW()),
      ('60000000-0000-4000-8000-000000000094','${userD}','${departmentA}',NULL,NOW());
    INSERT INTO role_templates(id,department_id,name,updated_at) VALUES
      ('${roleA}','${departmentA}','系统管理员',NOW()),
      ('${roleB}','${departmentB}','系统管理员',NOW());
    INSERT INTO role_grants(id,role_template_id,action,scope) VALUES
      ('90000000-0000-4000-8000-000000000091','${roleA}','customer.read','DEPARTMENT'),
      (${collidingGrantId === null ? "'90000000-0000-4000-8000-000000000092'" : collidingGrantId},'${roleA}','customer.create-draft','DEPARTMENT'),
      ('90000000-0000-4000-8000-000000000093','${roleA}','customer.edit-routine','DEPARTMENT'),
      ('90000000-0000-4000-8000-000000000094','${roleB}','customer.read','DEPARTMENT'),
      ('90000000-0000-4000-8000-000000000095','${roleB}','customer.create-draft','DEPARTMENT'),
      ('90000000-0000-4000-8000-000000000096','${roleB}','customer.edit-routine','DEPARTMENT');
    INSERT INTO role_assignments(id,user_id,department_id,role_template_id,team_id,updated_at) VALUES
      ('50000000-0000-4000-8000-000000000091','${userA}','${departmentA}','${roleA}',NULL,NOW()),
      ('50000000-0000-4000-8000-000000000092','${userB}','${departmentB}','${roleB}','${sharedTeam}',NOW());
    INSERT INTO customers(id,name,normalized_name,department_id,responsible_user_id,team_id,updated_at) VALUES
      ('70000000-0000-4000-8000-000000000091','A Customer','a customer','${departmentA}','${userA}','${sharedTeam}',NOW()),
      ('70000000-0000-4000-8000-000000000092','B Customer','b customer','${departmentB}','${userB}','${sharedTeam}',NOW()),
      ('70000000-0000-4000-8000-000000000094','Null Customer','null customer','${departmentA}','${userD}',NULL,NOW());`;

  await client.connect();
  try {
    await prepareSchema(upgradedSchema);
    await client.query(seedSql());
    await client.query(teamMigration);
    const upgradedRows = (
      await client.query(
        `SELECT m.department_id, m.team_id AS membership_team_id,
                c.team_id AS customer_team_id,
                a.team_id AS assignment_team_id
         FROM department_memberships m
         JOIN customers c ON c.department_id=m.department_id
         JOIN role_assignments a ON a.department_id=m.department_id
         WHERE m.team_id IS NOT NULL AND c.team_id IS NOT NULL
         ORDER BY m.department_id`,
      )
    ).rows;
    const managementGrantCount = Number(
      (
        await client.query(
          `SELECT COUNT(*) AS count FROM role_grants
           WHERE role_template_id=$1 AND action::text IN
             ('user.read','user.manage','team.read','team.manage','role.read','role.assign')`,
          [roleA],
        )
      ).rows[0].count,
    );
    const unrelatedManagementGrantCount = Number(
      (
        await client.query(
          `SELECT COUNT(*) AS count FROM role_grants
           WHERE role_template_id=$1 AND action::text IN
             ('user.read','user.manage','team.read','team.manage','role.read','role.assign')`,
          [roleB],
        )
      ).rows[0].count,
    );
    const upgradedAuthorizationRevision = Number(
      (
        await client.query(
          'SELECT authorization_revision FROM user_accounts WHERE id=$1',
          [userA],
        )
      ).rows[0].authorization_revision,
    );
    const distinctTeams = Number(
      (await client.query('SELECT COUNT(*) AS count FROM teams')).rows[0].count,
    );

    await prepareSchema(sharedRoleSchema);
    await client.query(seedSql());
    await client.query(
      `INSERT INTO user_accounts(id,external_subject,display_name,updated_at)
       VALUES ($1,'external:shared-role-probe','Shared role probe',NOW())`,
      [userC],
    );
    await client.query(
      `INSERT INTO department_memberships(id,user_id,department_id,updated_at)
       VALUES ('60000000-0000-4000-8000-000000000093',$1,$2,NOW())`,
      [userC, departmentA],
    );
    await client.query(
      `INSERT INTO role_assignments(id,user_id,department_id,role_template_id,updated_at)
       VALUES ('50000000-0000-4000-8000-000000000093',$1,$2,$3,NOW())`,
      [userC, departmentA, roleA],
    );
    await client.query(teamMigration);
    const sharedRoleManagementGrantCount = Number(
      (
        await client.query(
          `SELECT COUNT(*) AS count FROM role_grants
           WHERE role_template_id=$1 AND action::text IN
             ('user.read','user.manage','team.read','team.manage','role.read','role.assign')`,
          [roleA],
        )
      ).rows[0].count,
    );
    const nullReferenceRow = (
      await client.query(
        `SELECT
           (SELECT team_id IS NULL FROM department_memberships WHERE user_id=$1) AS membership_null,
           (SELECT team_id IS NULL FROM role_assignments WHERE user_id=$2) AS assignment_null,
           (SELECT team_id IS NULL FROM customers WHERE responsible_user_id=$1) AS customer_null`,
        [userD, userA],
      )
    ).rows[0];
    const nullReferencesPreserved =
      nullReferenceRow.membership_null === true &&
      nullReferenceRow.assignment_null === true &&
      nullReferenceRow.customer_null === true;
    const sharedRoleRevisionChanges = Number(
      (
        await client.query(
          `SELECT COUNT(*) AS count FROM user_accounts
           WHERE id = ANY($1::uuid[]) AND authorization_revision <> 1`,
          [[userA, userC]],
        )
      ).rows[0].count,
    );

    await prepareSchema(failedSchema);
    const collidingId = `(
      SUBSTR(MD5('${roleA}:user.read'),1,8) || '-' ||
      SUBSTR(MD5('${roleA}:user.read'),9,4) || '-4' ||
      SUBSTR(MD5('${roleA}:user.read'),14,3) || '-8' ||
      SUBSTR(MD5('${roleA}:user.read'),18,3) || '-' ||
      SUBSTR(MD5('${roleA}:user.read'),21,12)
    )::uuid`;
    await client.query(seedSql(collidingId));
    let rejected = false;
    try {
      await client.query(teamMigration);
    } catch {
      rejected = true;
      await client.query('ROLLBACK');
    }
    const teamTableExists =
      (
        await client.query(
          `SELECT 1 FROM information_schema.tables
           WHERE table_schema=$1 AND table_name='teams'`,
          [failedSchema],
        )
      ).rowCount === 1;
    const originalTeamIdPreserved =
      (
        await client.query(
          'SELECT team_id FROM department_memberships WHERE user_id=$1',
          [userA],
        )
      ).rows[0].team_id === sharedTeam;

    return {
      upgraded: {
        distinctTeams,
        preservedReferences:
          upgradedRows.length === 2 &&
          upgradedRows.every(
            (row) => row.membership_team_id === row.customer_team_id,
          ) &&
          upgradedRows[0].membership_team_id === sharedTeam &&
          upgradedRows[0].assignment_team_id === null &&
          upgradedRows[1].membership_team_id !== sharedTeam &&
          upgradedRows[1].assignment_team_id ===
            upgradedRows[1].membership_team_id,
        managementGrantCount,
        unrelatedManagementGrantCount,
        upgradedAuthorizationRevision,
        nullReferencesPreserved,
        sharedRoleManagementGrantCount,
        sharedRoleRevisionChanges,
      },
      failed: { rejected, teamTableExists, originalTeamIdPreserved },
    };
  } finally {
    await client.query('RESET search_path');
    await client.query(`DROP SCHEMA IF EXISTS "${upgradedSchema}" CASCADE`);
    await client.query(`DROP SCHEMA IF EXISTS "${failedSchema}" CASCADE`);
    await client.query(`DROP SCHEMA IF EXISTS "${sharedRoleSchema}" CASCADE`);
    await client.end();
  }
}

async function exerciseRoleAssignmentBoundary() {
  const service = new OrganizationService(database);
  const actor = {
    userId: e2eFixtures.userA,
    departmentId: e2eFixtures.departmentA,
    authorizationRevision: 1,
  };
  const roleIds = {
    authorized: '30000000-0000-4000-8000-000000000011',
    unauthorized: '30000000-0000-4000-8000-000000000012',
    crossTeam: '30000000-0000-4000-8000-000000000013',
    higherScope: '30000000-0000-4000-8000-000000000014',
    auditFailure: '30000000-0000-4000-8000-000000000015',
  };
  await database.roleTemplate.createMany({
    data: Object.entries(roleIds).map(([name, id]) => ({
      id,
      departmentId: e2eFixtures.departmentA,
      name: `E2E Boundary ${name}`,
    })),
  });
  await database.roleGrant.createMany({
    data: [
      {
        roleTemplateId: roleIds.authorized,
        action: 'CUSTOMER_READ',
        scope: 'SELF',
      },
      {
        roleTemplateId: roleIds.unauthorized,
        action: 'CUSTOMER_READ',
        scope: 'SELF',
      },
      {
        roleTemplateId: roleIds.crossTeam,
        action: 'CUSTOMER_READ',
        scope: 'TEAM',
      },
      {
        roleTemplateId: roleIds.higherScope,
        action: 'CUSTOMER_READ',
        scope: 'DEPARTMENT',
      },
      {
        roleTemplateId: roleIds.auditFailure,
        action: 'CUSTOMER_READ',
        scope: 'SELF',
      },
      {
        roleTemplateId: e2eFixtures.roleA,
        action: 'ROLE_ASSIGN',
        scope: 'DEPARTMENT',
      },
      {
        roleTemplateId: e2eFixtures.roleA,
        action: 'CUSTOMER_READ',
        scope: 'DEPARTMENT',
      },
    ],
  });

  await service.assignRole(actor, {
    targetUserId: e2eFixtures.userSelf,
    roleTemplateId: roleIds.authorized,
    teamId: null,
  });
  const authorizedAssignmentCommitted =
    (await database.roleAssignment.count({
      where: {
        userId: e2eFixtures.userSelf,
        roleTemplateId: roleIds.authorized,
        active: true,
      },
    })) === 1;
  const denialState = async (roleTemplateId) => ({
    assignments: await database.roleAssignment.count({
      where: {
        userId: e2eFixtures.userSelf,
        roleTemplateId,
      },
    }),
    audits: await database.auditEvent.count({
      where: {
        action: {
          in: [
            'role-assignment.created',
            'role-assignment.restored-or-rebound',
          ],
        },
      },
    }),
    revision: (
      await database.userAccount.findUniqueOrThrow({
        where: { id: e2eFixtures.userSelf },
        select: { authorizationRevision: true },
      })
    ).authorizationRevision,
  });

  await database.roleGrant.deleteMany({
    where: {
      roleTemplateId: e2eFixtures.roleA,
      action: 'ROLE_ASSIGN',
      scope: 'DEPARTMENT',
    },
  });
  const unauthorizedBefore = await denialState(roleIds.unauthorized);
  let unauthorizedDenied = false;
  try {
    await service.assignRole(actor, {
      targetUserId: e2eFixtures.userSelf,
      roleTemplateId: roleIds.unauthorized,
      teamId: null,
    });
  } catch (error) {
    unauthorizedDenied =
      error instanceof ForbiddenException &&
      error.getResponse()?.code === 'MANAGEMENT_ACTION_FORBIDDEN';
  }
  unauthorizedDenied &&=
    JSON.stringify(await denialState(roleIds.unauthorized)) ===
    JSON.stringify(unauthorizedBefore);

  await database.roleGrant.create({
    data: {
      roleTemplateId: e2eFixtures.roleA,
      action: 'ROLE_ASSIGN',
      scope: 'TEAM',
    },
  });
  const crossTeamBefore = await denialState(roleIds.crossTeam);
  let crossTeamDenied = false;
  try {
    await service.assignRole(actor, {
      targetUserId: e2eFixtures.userSelf,
      roleTemplateId: roleIds.crossTeam,
      teamId: e2eFixtures.teamSelf,
    });
  } catch (error) {
    crossTeamDenied =
      error instanceof ForbiddenException &&
      error.getResponse()?.code === 'MANAGEMENT_ACTION_FORBIDDEN';
  }
  crossTeamDenied &&=
    JSON.stringify(await denialState(roleIds.crossTeam)) ===
    JSON.stringify(crossTeamBefore);

  await database.roleGrant.deleteMany({
    where: {
      roleTemplateId: e2eFixtures.roleA,
      action: 'ROLE_ASSIGN',
      scope: 'TEAM',
    },
  });
  await database.roleGrant.create({
    data: {
      roleTemplateId: e2eFixtures.roleA,
      action: 'ROLE_ASSIGN',
      scope: 'DEPARTMENT',
    },
  });
  await database.roleGrant.deleteMany({
    where: {
      roleTemplateId: e2eFixtures.roleA,
      action: 'CUSTOMER_READ',
      scope: 'DEPARTMENT',
    },
  });
  const higherScopeBefore = await denialState(roleIds.higherScope);
  let higherScopeDenied = false;
  try {
    await service.assignRole(actor, {
      targetUserId: e2eFixtures.userSelf,
      roleTemplateId: roleIds.higherScope,
      teamId: null,
    });
  } catch (error) {
    higherScopeDenied =
      error instanceof ForbiddenException &&
      error.getResponse()?.code === 'MANAGEMENT_ACTION_FORBIDDEN';
  }
  higherScopeDenied &&=
    JSON.stringify(await denialState(roleIds.higherScope)) ===
    JSON.stringify(higherScopeBefore);

  await database.roleGrant.create({
    data: {
      roleTemplateId: e2eFixtures.roleA,
      action: 'CUSTOMER_READ',
      scope: 'DEPARTMENT',
    },
  });
  const revisionBeforeAuditFailure = (
    await database.userAccount.findUniqueOrThrow({
      where: { id: e2eFixtures.userSelf },
      select: { authorizationRevision: true },
    })
  ).authorizationRevision;
  await database.$executeRawUnsafe(
    `ALTER TABLE "audit_events" ADD CONSTRAINT "e2e_reject_role_assignment_audit"
     CHECK ("action" <> 'role-assignment.created') NOT VALID`,
  );
  let auditRejected = false;
  try {
    await service.assignRole(actor, {
      targetUserId: e2eFixtures.userSelf,
      roleTemplateId: roleIds.auditFailure,
      teamId: null,
    });
  } catch {
    auditRejected = true;
  } finally {
    await database.$executeRawUnsafe(
      'ALTER TABLE "audit_events" DROP CONSTRAINT IF EXISTS "e2e_reject_role_assignment_audit"',
    );
  }
  const revisionAfterAuditFailure = (
    await database.userAccount.findUniqueOrThrow({
      where: { id: e2eFixtures.userSelf },
      select: { authorizationRevision: true },
    })
  ).authorizationRevision;
  const auditFailureRolledBack =
    auditRejected &&
    revisionBeforeAuditFailure === revisionAfterAuditFailure &&
    (await database.roleAssignment.count({
      where: { roleTemplateId: roleIds.auditFailure },
    })) === 0;

  return {
    authorizedAssignmentCommitted,
    unauthorizedDenied,
    crossTeamDenied,
    higherScopeDenied,
    auditFailureRolledBack,
  };
}

async function waitForBlockedBy(client, blockerPid) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await client.query(
      `SELECT 1 FROM pg_stat_activity
       WHERE datname = current_database()
         AND pid <> pg_backend_pid()
         AND wait_event_type = 'Lock'
         AND $1::integer = ANY(pg_blocking_pids(pid))
       LIMIT 1`,
      [blockerPid],
    );
    if (result.rowCount === 1) return true;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  return false;
}

async function exerciseAuthorizationLockConcurrency() {
  const customerBlocker = new Client({ connectionString: databaseUrl });
  const roleBlocker = new Client({ connectionString: databaseUrl });
  let customerBlockerConnected = false;
  let roleBlockerConnected = false;
  let customerAttempt = null;
  let assignmentAttempt = null;
  let targetRevisionBaseline = null;
  let actorGrantBaseline = null;
  const customerName = `并发停用团队客户-${randomUUID()}`;
  const concurrentRoleId = '30000000-0000-4000-8000-000000000016';
  const organizationService = new OrganizationService(database);
  const actor = {
    userId: e2eFixtures.userA,
    departmentId: e2eFixtures.departmentA,
    authorizationRevision: 1,
  };
  const accessControl = {
    authorizeNewCustomer: async () => ({
      departmentId: e2eFixtures.departmentA,
      responsibleUserId: e2eFixtures.userA,
      teamId: e2eFixtures.teamA,
    }),
    tryBuildCustomerScope: async () => null,
  };
  const customerService = new CustomerService(database, accessControl);

  try {
    await customerBlocker.connect();
    customerBlockerConnected = true;
    await roleBlocker.connect();
    roleBlockerConnected = true;
    const customerBlockerPid = Number(
      (await customerBlocker.query('SELECT pg_backend_pid() AS pid')).rows[0]
        .pid,
    );
    const roleBlockerPid = Number(
      (await roleBlocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,
    );
    await database.team.update({
      where: { id: e2eFixtures.teamA },
      data: { status: 'ACTIVE' },
    });
    await customerBlocker.query('BEGIN');
    await customerBlocker.query(
      "UPDATE teams SET status = 'INACTIVE' WHERE id = $1",
      [e2eFixtures.teamA],
    );
    let customerSettled = false;
    customerAttempt = customerService
      .createDraft(actor, { name: customerName })
      .then(
        () => ({ allowed: true, error: null }),
        (error) => ({ allowed: false, error }),
      )
      .finally(() => {
        customerSettled = true;
      });
    const customerWaitedForTeamLock = await waitForBlockedBy(
      customerBlocker,
      customerBlockerPid,
    );
    if (!customerWaitedForTeamLock || customerSettled) {
      throw new Error('Customer create did not reach the expected Team lock');
    }
    await customerBlocker.query('COMMIT');
    const customerResult = await customerAttempt;
    const inactiveTeamCreationDenied =
      customerWaitedForTeamLock &&
      !customerResult.allowed &&
      customerResult.error instanceof ForbiddenException &&
      customerResult.error.getResponse()?.code ===
        'CUSTOMER_ACTION_FORBIDDEN' &&
      (await database.customer.count({ where: { name: customerName } })) === 0;

    await database.roleTemplate.upsert({
      where: {
        id_departmentId: {
          id: concurrentRoleId,
          departmentId: e2eFixtures.departmentA,
        },
      },
      update: { active: true },
      create: {
        id: concurrentRoleId,
        departmentId: e2eFixtures.departmentA,
        name: 'E2E concurrent authorization role',
      },
    });
    actorGrantBaseline = await database.roleGrant.findMany({
      where: {
        roleTemplateId: e2eFixtures.roleA,
        scope: 'DEPARTMENT',
        action: { in: ['ROLE_ASSIGN', 'CUSTOMER_READ'] },
      },
      select: { action: true, scope: true },
    });
    await database.roleGrant.createMany({
      data: [
        {
          roleTemplateId: concurrentRoleId,
          action: 'CUSTOMER_READ',
          scope: 'SELF',
        },
        {
          roleTemplateId: e2eFixtures.roleA,
          action: 'ROLE_ASSIGN',
          scope: 'DEPARTMENT',
        },
        {
          roleTemplateId: e2eFixtures.roleA,
          action: 'CUSTOMER_READ',
          scope: 'DEPARTMENT',
        },
      ],
      skipDuplicates: true,
    });
    await database.roleAssignment.deleteMany({
      where: {
        userId: e2eFixtures.userSelf,
        departmentId: e2eFixtures.departmentA,
        roleTemplateId: concurrentRoleId,
      },
    });
    const revisionBefore = (
      await database.userAccount.findUniqueOrThrow({
        where: { id: e2eFixtures.userSelf },
        select: { authorizationRevision: true },
      })
    ).authorizationRevision;
    targetRevisionBaseline = revisionBefore;
    const auditBefore = await database.auditEvent.count({
      where: { action: 'role-assignment.created' },
    });

    await roleBlocker.query('BEGIN');
    await roleBlocker.query(
      `DELETE FROM role_grants
       WHERE role_template_id = $1 AND action = 'role.assign' AND scope = 'DEPARTMENT'`,
      [e2eFixtures.roleA],
    );
    let assignmentSettled = false;
    assignmentAttempt = organizationService
      .assignRole(actor, {
        targetUserId: e2eFixtures.userSelf,
        roleTemplateId: concurrentRoleId,
        teamId: null,
      })
      .then(
        () => ({ allowed: true, error: null }),
        (error) => ({ allowed: false, error }),
      )
      .finally(() => {
        assignmentSettled = true;
      });
    const assignmentWaitedForGrantLock = await waitForBlockedBy(
      roleBlocker,
      roleBlockerPid,
    );
    if (!assignmentWaitedForGrantLock || assignmentSettled) {
      throw new Error(
        'Role assignment did not reach the expected RoleGrant lock',
      );
    }
    await roleBlocker.query('COMMIT');
    const assignmentResult = await assignmentAttempt;
    const assignmentCountAfter = await database.roleAssignment.count({
      where: {
        userId: e2eFixtures.userSelf,
        roleTemplateId: concurrentRoleId,
      },
    });
    const auditAfter = await database.auditEvent.count({
      where: { action: 'role-assignment.created' },
    });
    const revisionAfter = (
      await database.userAccount.findUniqueOrThrow({
        where: { id: e2eFixtures.userSelf },
        select: { authorizationRevision: true },
      })
    ).authorizationRevision;
    const assignmentForbidden =
      assignmentResult.error instanceof ForbiddenException &&
      assignmentResult.error.getResponse()?.code ===
        'MANAGEMENT_ACTION_FORBIDDEN';
    const assignmentDatabaseCause =
      assignmentResult.error?.meta?.driverAdapterError?.cause;
    const assignmentSerializationConflict =
      assignmentDatabaseCause?.originalCode === '40001' ||
      assignmentDatabaseCause?.sqlState === '40001';
    const concurrentRevocationDenied =
      assignmentWaitedForGrantLock &&
      !assignmentResult.allowed &&
      (assignmentForbidden || assignmentSerializationConflict) &&
      assignmentCountAfter === 0 &&
      auditAfter === auditBefore &&
      revisionAfter === revisionBefore;
    if (!concurrentRevocationDenied) {
      throw new Error(
        `Concurrent revocation assertion failed: ${JSON.stringify({
          allowed: assignmentResult.allowed,
          errorName: assignmentResult.error?.constructor?.name,
          errorCode: assignmentResult.error?.code,
          errorMeta: assignmentResult.error?.meta,
          errorResponse: assignmentResult.error?.getResponse?.(),
          assignmentCountAfter,
          auditBefore,
          auditAfter,
          revisionBefore,
          revisionAfter,
        })}`,
      );
    }

    return {
      customerWaitedForTeamLock,
      inactiveTeamCreationDenied,
      assignmentWaitedForGrantLock,
      concurrentRevocationDenied,
    };
  } finally {
    if (customerBlockerConnected) {
      await customerBlocker.query('ROLLBACK').catch(() => undefined);
    }
    if (roleBlockerConnected) {
      await roleBlocker.query('ROLLBACK').catch(() => undefined);
    }
    await Promise.allSettled(
      [customerAttempt, assignmentAttempt].filter(
        (attempt) => attempt !== null,
      ),
    );
    try {
      const residualCustomers = await database.customer.findMany({
        where: { name: customerName },
        select: { id: true },
      });
      if (residualCustomers.length > 0) {
        await database.auditEvent.deleteMany({
          where: {
            resourceType: 'customer',
            resourceId: { in: residualCustomers.map(({ id }) => id) },
          },
        });
        await database.customer.deleteMany({
          where: { id: { in: residualCustomers.map(({ id }) => id) } },
        });
      }
      const residualAssignments = await database.roleAssignment.findMany({
        where: {
          userId: e2eFixtures.userSelf,
          roleTemplateId: concurrentRoleId,
        },
        select: { id: true },
      });
      if (residualAssignments.length > 0) {
        await database.auditEvent.deleteMany({
          where: {
            resourceType: 'role-assignment',
            resourceId: { in: residualAssignments.map(({ id }) => id) },
          },
        });
        await database.roleAssignment.deleteMany({
          where: { id: { in: residualAssignments.map(({ id }) => id) } },
        });
      }
      if (targetRevisionBaseline !== null) {
        await database.userAccount.update({
          where: { id: e2eFixtures.userSelf },
          data: { authorizationRevision: targetRevisionBaseline },
        });
      }
      await database.team.update({
        where: { id: e2eFixtures.teamA },
        data: { status: 'ACTIVE' },
      });
      await database.roleGrant.deleteMany({
        where: {
          roleTemplateId: e2eFixtures.roleA,
          scope: 'DEPARTMENT',
          action: { in: ['ROLE_ASSIGN', 'CUSTOMER_READ'] },
        },
      });
      if (actorGrantBaseline !== null && actorGrantBaseline.length > 0) {
        await database.roleGrant.createMany({
          data: actorGrantBaseline.map(({ action, scope }) => ({
            roleTemplateId: e2eFixtures.roleA,
            action,
            scope,
          })),
          skipDuplicates: true,
        });
      }
      await database.roleGrant.deleteMany({
        where: { roleTemplateId: concurrentRoleId },
      });
      await database.roleTemplate.deleteMany({
        where: { id: concurrentRoleId },
      });
    } finally {
      if (customerBlockerConnected) {
        await customerBlocker.end().catch(() => undefined);
      }
      if (roleBlockerConnected) {
        await roleBlocker.end().catch(() => undefined);
      }
    }
  }
}

async function verifyAdmissionContactConstraintRejectsBlankValues() {
  const client = new Client({ connectionString: databaseUrl });
  const invalidContacts = [
    {
      id: '60000000-0000-4000-8000-000000000001',
      name: '空白联系人姓名',
      contactName: '   ',
      contactPhone: '13800138000',
      contactEmail: null,
    },
    {
      id: '60000000-0000-4000-8000-000000000002',
      name: '空白联系人电话',
      contactName: '张三',
      contactPhone: '   ',
      contactEmail: null,
    },
    {
      id: '60000000-0000-4000-8000-000000000003',
      name: '空白联系人整体',
      contactName: '',
      contactPhone: '',
      contactEmail: '   ',
    },
  ];
  const rejectedBy = [];

  await client.connect();
  try {
    await client.query('BEGIN');
    for (const [index, contact] of invalidContacts.entries()) {
      const savepoint = `contact_case_${index}`;
      await client.query(`SAVEPOINT ${savepoint}`);
      try {
        await client.query(
          `INSERT INTO customers(
             id, name, normalized_name, department_id, responsible_user_id,
             admission_contact_name, admission_contact_phone, admission_contact_email,
             updated_at
           ) VALUES ($1, $2, $2, $3, $4, $5, $6, $7, NOW())`,
          [
            contact.id,
            contact.name,
            e2eFixtures.departmentA,
            e2eFixtures.userA,
            contact.contactName,
            contact.contactPhone,
            contact.contactEmail,
          ],
        );
        rejectedBy.push(null);
      } catch (error) {
        rejectedBy.push(error.constraint ?? null);
      } finally {
        await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      }
    }
    await client.query('ROLLBACK');
    return rejectedBy;
  } finally {
    await client.end();
  }
}

function disableDepartmentARoleAssignment() {
  return database.roleAssignment.updateMany({
    where: {
      userId: e2eFixtures.userA,
      departmentId: e2eFixtures.departmentA,
    },
    data: { active: false },
  });
}

async function assignDepartmentBRoleInsideDepartmentA() {
  await database.roleAssignment.deleteMany({
    where: {
      userId: e2eFixtures.userA,
      departmentId: e2eFixtures.departmentA,
    },
  });
  await database.roleAssignment.create({
    data: {
      userId: e2eFixtures.userA,
      departmentId: e2eFixtures.departmentA,
      roleTemplateId: e2eFixtures.roleB,
    },
  });
}

async function duplicateDepartmentLevelRoleAssignment() {
  await database.roleAssignment.create({
    data: {
      userId: e2eFixtures.userSelf,
      departmentId: e2eFixtures.departmentA,
      roleTemplateId: e2eFixtures.roleSelf,
    },
  });
}

async function assignForeignDepartmentResponsibility() {
  await database.customer.create({
    data: {
      name: '跨部门负责人必须失败',
      normalizedName: '跨部门负责人必须失败',
      departmentId: e2eFixtures.departmentA,
      responsibleUserId: e2eFixtures.userB,
    },
  });
}

async function assignForeignDepartmentAuditActor() {
  await database.auditEvent.create({
    data: {
      departmentId: e2eFixtures.departmentA,
      actorUserId: e2eFixtures.userB,
      resourceType: 'customer',
      resourceId: '50000000-0000-4000-8000-000000000001',
      action: 'customer.updated',
    },
  });
}

async function rejectCustomerDraftAuditWrites() {
  await allowCustomerDraftAuditWrites();
  await database.$executeRawUnsafe(
    `ALTER TABLE "audit_events" ADD CONSTRAINT "e2e_reject_customer_draft_audit" CHECK ("action" <> 'customer.draft-created') NOT VALID`,
  );
}

async function allowCustomerDraftAuditWrites() {
  await database.$executeRawUnsafe(
    'ALTER TABLE "audit_events" DROP CONSTRAINT IF EXISTS "e2e_reject_customer_draft_audit"',
  );
}

async function rejectCustomerUpdateAuditWrites() {
  await allowCustomerUpdateAuditWrites();
  await database.$executeRawUnsafe(
    `ALTER TABLE "audit_events" ADD CONSTRAINT "e2e_reject_customer_update_audit" CHECK ("action" <> 'customer.updated') NOT VALID`,
  );
}

async function allowCustomerUpdateAuditWrites() {
  await database.$executeRawUnsafe(
    'ALTER TABLE "audit_events" DROP CONSTRAINT IF EXISTS "e2e_reject_customer_update_audit"',
  );
}

async function rejectNamedCustomerWrites(name) {
  await allowNamedCustomerWrites();
  await database.$executeRawUnsafe(
    `ALTER TABLE "customers" ADD CONSTRAINT "e2e_reject_named_customer" CHECK ("name" <> '${name.replaceAll("'", "''")}') NOT VALID`,
  );
}

async function allowNamedCustomerWrites() {
  await database.$executeRawUnsafe(
    'ALTER TABLE "customers" DROP CONSTRAINT IF EXISTS "e2e_reject_named_customer"',
  );
}

function disconnectCustomerTestDatabase() {
  return database.$disconnect();
}

async function getRightsHolderCounts(departmentId) {
  const [holders, links, receipts, createdAudits, linkedAudits] =
    await database.$transaction([
      database.rightsHolder.count({ where: { departmentId } }),
      database.customerRightsHolderLink.count({ where: { departmentId } }),
      database.rightsHolderCommandReceipt.count({ where: { departmentId } }),
      database.auditEvent.count({
        where: { departmentId, action: 'rights-holder.created' },
      }),
      database.auditEvent.count({
        where: { departmentId, action: 'customer.rights-holder-linked' },
      }),
    ]);
  return { holders, links, receipts, createdAudits, linkedAudits };
}

function revokeRightsHolderGrant(action) {
  return database.roleGrant.deleteMany({
    where: { roleTemplateId: e2eFixtures.roleA, action },
  });
}

function linkRightsHolderFixture(customerId, rightsHolderId, departmentId) {
  return database.customerRightsHolderLink.create({
    data: { customerId, rightsHolderId, departmentId },
  });
}

async function rejectRightsHolderAuditWrites(action) {
  if (
    !['rights-holder.created', 'customer.rights-holder-linked'].includes(action)
  ) {
    throw new Error('Unsupported audit failure fixture');
  }
  await allowRightsHolderAuditWrites();
  await database.$executeRawUnsafe(
    `ALTER TABLE audit_events ADD CONSTRAINT e2e_reject_rights_holder_audit CHECK (action <> '${action}') NOT VALID`,
  );
}

async function allowRightsHolderAuditWrites() {
  await database.$executeRawUnsafe(
    'ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS e2e_reject_rights_holder_audit',
  );
}

async function verifyRightsHolderMigration() {
  const client = new Client({ connectionString: databaseUrl });
  const migrationRoot = resolve(process.cwd(), 'backend/prisma/migrations');
  const target = '20260917070000_add_customer_rights_holders';
  const whitespaceTarget =
    '20260917080000_enforce_rights_holder_name_whitespace';
  const previous = '20260917060000_add_customer_admission_contact';
  const migrations = (await readdir(migrationRoot))
    .filter((name) => /^\d{14}_/.test(name))
    .sort();
  const previousMigrations = migrations.filter((name) => name <= previous);
  const migrationSql = await readFile(
    resolve(migrationRoot, target, 'migration.sql'),
    'utf8',
  );
  const whitespaceMigrationSql = await readFile(
    resolve(migrationRoot, whitespaceTarget, 'migration.sql'),
    'utf8',
  );
  const schema = `rights_holder_probe_${randomUUID().replaceAll('-', '')}`;
  const failedSchema = `${schema}_failed`;
  const ids = Array.from({ length: 12 }, () => randomUUID());
  const [
    departmentA,
    departmentB,
    userId,
    customerA,
    customerB,
    holderA,
    holderB,
  ] = ids;
  await client.connect();
  try {
    const actual = await client.query('SELECT current_database() AS database');
    if (actual.rows[0].database !== 'dev_cor_test')
      throw new Error('Unexpected migration database');
    for (const namespace of [schema, failedSchema]) {
      await client.query(`CREATE SCHEMA "${namespace}"`);
      await client.query(`SET search_path TO "${namespace}"`);
      for (const migration of previousMigrations) {
        await client.query(
          await readFile(
            resolve(migrationRoot, migration, 'migration.sql'),
            'utf8',
          ),
        );
      }
      await client.query(
        "INSERT INTO departments(id,name,updated_at) VALUES ($1,'升级部门A',NOW()),($2,'升级部门B',NOW())",
        [departmentA, departmentB],
      );
      await client.query(
        "INSERT INTO user_accounts(id,external_subject,updated_at) VALUES ($1,'migration-synthetic-user',NOW())",
        [userId],
      );
      await client.query(
        'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES ($1,$3,$4,NOW()),($2,$3,$5,NOW())',
        [ids[7], ids[8], userId, departmentA, departmentB],
      );
      await client.query(
        `INSERT INTO customers(id,name,normalized_name,department_id,responsible_user_id,admission_contact_name,admission_contact_email,updated_at)
        VALUES ($1,'迁移旧客户A','迁移旧客户A',$3,$5,'旧联系人','synthetic@example.test',NOW()),
        ($2,'迁移旧客户B','迁移旧客户B',$4,$5,NULL,NULL,NOW())`,
        [customerA, customerB, departmentA, departmentB, userId],
      );
    }
    await client.query(`SET search_path TO "${schema}"`);
    const before = (await client.query('SELECT * FROM customers ORDER BY id'))
      .rows;
    await client.query(migrationSql);
    const after = (await client.query('SELECT * FROM customers ORDER BY id'))
      .rows;
    const tables = (
      await client.query(
        'SELECT table_name FROM information_schema.tables WHERE table_schema=$1 ORDER BY table_name',
        [schema],
      )
    ).rows.map((row) => row.table_name);
    await client.query(
      "INSERT INTO rights_holders(id,name,department_id,updated_at) VALUES ($1,'迁移主体A',$3,NOW()),($2,'迁移主体B',$4,NOW())",
      [holderA, holderB, departmentA, departmentB],
    );
    await client.query(
      'INSERT INTO customer_rights_holder_links(id,customer_id,rights_holder_id,department_id) VALUES ($1,$2,$3,$4)',
      [ids[9], customerA, holderA, departmentA],
    );
    const holdersBefore = (
      await client.query('SELECT * FROM rights_holders ORDER BY id')
    ).rows;
    await client.query(whitespaceMigrationSql);
    const holdersAfter = (
      await client.query('SELECT * FROM rights_holders ORDER BY id')
    ).rows;
    const customersAfterWhitespace = (
      await client.query('SELECT * FROM customers ORDER BY id')
    ).rows;
    const rejections = [];
    const invalidStatements = [
      ...[null, '', '   '].map((name) => ({
        sql: 'INSERT INTO rights_holders(id,name,department_id,updated_at) VALUES ($1,$2,$3,NOW())',
        values: [randomUUID(), name, departmentA],
      })),
      ...[
        [customerB, holderA],
        [customerA, holderB],
        [customerA, holderA],
      ].map(([customerId, holderId]) => ({
        sql: 'INSERT INTO customer_rights_holder_links(id,customer_id,rights_holder_id,department_id) VALUES ($1,$2,$3,$4)',
        values: [randomUUID(), customerId, holderId, departmentA],
      })),
    ];
    for (const statement of invalidStatements) {
      await client.query('BEGIN');
      try {
        await client.query(statement.sql, statement.values);
        rejections.push({ code: null, constraint: null });
      } catch (error) {
        rejections.push({
          code: error.code ?? null,
          constraint: error.constraint ?? null,
        });
      } finally {
        await client.query('ROLLBACK');
      }
    }
    const validLinks = Number(
      (await client.query('SELECT count(*) FROM customer_rights_holder_links'))
        .rows[0].count,
    );
    await client.query(`SET search_path TO "${failedSchema}"`);
    await client.query(
      'CREATE TABLE rights_holder_command_receipts (fixture_marker TEXT)',
    );
    let failedMigrationCode = null;
    try {
      await client.query(migrationSql);
    } catch (error) {
      failedMigrationCode = error.code ?? null;
      await client.query('ROLLBACK');
    }
    const partialTables = (
      await client.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_name IN ('rights_holders','customer_rights_holder_links')",
        [failedSchema],
      )
    ).rows;
    const partialConstraints = (
      await client.query(
        "SELECT conname FROM pg_constraint WHERE conrelid='customers'::regclass AND conname='customers_id_department_id_key'",
      )
    ).rows;
    const failedCustomers = Number(
      (await client.query('SELECT count(*) FROM customers')).rows[0].count,
    );
    await client.query('DROP TABLE rights_holder_command_receipts');
    await client.query(migrationSql);
    await client.query(
      'INSERT INTO rights_holders(id,name,department_id,updated_at) VALUES ($1,$2,$3,NOW())',
      [holderA, '\t\n\u3000', departmentA],
    );
    const readNameConstraint = async () =>
      (
        await client.query(
          "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='rights_holders'::regclass AND conname='rights_holders_name_nonblank_check'",
        )
      ).rows[0].definition;
    const previousNameConstraint = await readNameConstraint();
    let whitespaceMigrationFailure = null;
    try {
      await client.query(whitespaceMigrationSql);
    } catch (error) {
      whitespaceMigrationFailure = error.code ?? null;
      await client.query('ROLLBACK');
    }
    const whitespaceRollbackPreservedConstraint =
      (await readNameConstraint()) === previousNameConstraint;
    const dirtyHolder = (
      await client.query('SELECT name FROM rights_holders WHERE id=$1', [
        holderA,
      ])
    ).rows[0];
    return {
      previousMigrations: previousMigrations.length,
      previousSchema: previous,
      upgradedSchema: whitespaceTarget,
      preservedCustomers:
        JSON.stringify(before) === JSON.stringify(after) &&
        JSON.stringify(before) === JSON.stringify(customersAfterWhitespace)
          ? after.length
          : 0,
      preservedHolders:
        JSON.stringify(holdersBefore) === JSON.stringify(holdersAfter)
          ? holdersAfter.length
          : 0,
      whitespaceMigrationFailure,
      whitespaceRollbackPreservedConstraint,
      whitespaceRollbackPreservedHolder: dirtyHolder?.name === '\t\n\u3000',
      tables,
      validLinks,
      rejections,
      failedMigrationCode,
      partialTables: partialTables.length,
      partialConstraints: partialConstraints.length,
      failedCustomers,
    };
  } finally {
    await client.query('ROLLBACK');
    await client.query('RESET search_path');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.query(`DROP SCHEMA IF EXISTS "${failedSchema}" CASCADE`);
    await client.end();
  }
}

async function verifyRightsHolderNames(names) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const results = [];
  try {
    for (const name of names) {
      await client.query('BEGIN');
      try {
        await client.query(
          'INSERT INTO rights_holders(id,name,department_id,updated_at) VALUES ($1,$2,$3,NOW())',
          [randomUUID(), name, e2eFixtures.departmentA],
        );
        results.push(null);
      } catch (error) {
        results.push(error.constraint ?? error.code ?? null);
      } finally {
        await client.query('ROLLBACK');
      }
    }
    return results;
  } finally {
    await client.end();
  }
}

const personnelFixtures = {
  departmentId: '10000000-0000-4000-8000-000000000020',
  foreignDepartmentId: '10000000-0000-4000-8000-000000000021',
  adminUserId: '20000000-0000-4000-8000-000000000020',
  foreignUserId: '20000000-0000-4000-8000-000000000021',
  adminRoleId: '30000000-0000-4000-8000-000000000020',
  operatorRoleId: '30000000-0000-4000-8000-000000000021',
  teamAId: '40000000-0000-4000-8000-000000000020',
  teamBId: '40000000-0000-4000-8000-000000000021',
};

async function resetPersonnelAccessE2eData() {
  await allowPersonnelCreatedAuditWrites();
  const departmentId = personnelFixtures.departmentId;
  const departmentIds = [departmentId, personnelFixtures.foreignDepartmentId];
  const memberships = await database.departmentMembership.findMany({
    where: { departmentId: { in: departmentIds } },
    select: { userId: true },
  });
  const userIds = [
    personnelFixtures.adminUserId,
    personnelFixtures.foreignUserId,
    ...memberships.map((membership) => membership.userId),
  ];
  await database.$transaction(async (transaction) => {
    await transaction.authSession.deleteMany({
      where: { userId: { in: userIds } },
    });
    await transaction.authThrottle.deleteMany({});
    await transaction.auditEvent.deleteMany({
      where: { departmentId: { in: departmentIds } },
    });
    await transaction.customer.deleteMany({
      where: { departmentId: { in: departmentIds } },
    });
    await transaction.roleAssignment.deleteMany({
      where: { departmentId: { in: departmentIds } },
    });
    await transaction.roleGrant.deleteMany({
      where: {
        roleTemplateId: {
          in: [personnelFixtures.adminRoleId, personnelFixtures.operatorRoleId],
        },
      },
    });
    await transaction.roleTemplate.deleteMany({
      where: { departmentId: { in: departmentIds } },
    });
    await transaction.departmentMembership.deleteMany({
      where: { departmentId: { in: departmentIds } },
    });
    await transaction.team.deleteMany({
      where: { departmentId: { in: departmentIds } },
    });
    await transaction.localCredential.deleteMany({
      where: { userId: { in: userIds } },
    });
    await transaction.userAccount.deleteMany({
      where: { id: { in: userIds } },
    });
    await transaction.department.deleteMany({
      where: { id: { in: departmentIds } },
    });
  });

  const password = 'Personnel-admin-pass-2026';
  const passwordHash = await hashPassword(password);
  await database.$transaction(async (transaction) => {
    await transaction.department.create({
      data: { id: departmentId, name: 'E2E 人员管理部' },
    });
    await transaction.department.create({
      data: {
        id: personnelFixtures.foreignDepartmentId,
        name: 'E2E 其他部门',
      },
    });
    await transaction.userAccount.create({
      data: {
        id: personnelFixtures.adminUserId,
        externalSubject: 'local:e2e-personnel-admin',
        displayName: 'E2E 人员管理员',
      },
    });
    await transaction.localCredential.create({
      data: {
        userId: personnelFixtures.adminUserId,
        username: 'e2e.personnel.admin',
        passwordHash,
      },
    });
    await transaction.userAccount.create({
      data: {
        id: personnelFixtures.foreignUserId,
        externalSubject: 'local:e2e-personnel-foreign',
        displayName: 'E2E 其他部门人员',
      },
    });
    await transaction.departmentMembership.create({
      data: {
        userId: personnelFixtures.foreignUserId,
        departmentId: personnelFixtures.foreignDepartmentId,
      },
    });
    await transaction.team.createMany({
      data: [
        {
          id: personnelFixtures.teamAId,
          departmentId,
          name: '商标一组',
        },
        {
          id: personnelFixtures.teamBId,
          departmentId,
          name: '商标二组',
        },
      ],
    });
    await transaction.departmentMembership.create({
      data: {
        userId: personnelFixtures.adminUserId,
        departmentId,
        teamId: personnelFixtures.teamAId,
      },
    });
    await transaction.roleTemplate.createMany({
      data: [
        {
          id: personnelFixtures.adminRoleId,
          departmentId,
          name: '部门管理员',
        },
        {
          id: personnelFixtures.operatorRoleId,
          departmentId,
          name: '团队客户经办',
        },
      ],
    });
    const departmentActions = [
      'USER_READ',
      'USER_MANAGE',
      'TEAM_READ',
      'TEAM_MANAGE',
      'ROLE_READ',
      'ROLE_ASSIGN',
      'CUSTOMER_READ',
      'CUSTOMER_CREATE_DRAFT',
      'CUSTOMER_EDIT_ROUTINE',
    ];
    await transaction.roleGrant.createMany({
      data: [
        ...departmentActions.map((action) => ({
          roleTemplateId: personnelFixtures.adminRoleId,
          action,
          scope: 'DEPARTMENT',
        })),
        ...[
          'CUSTOMER_READ',
          'CUSTOMER_CREATE_DRAFT',
          'CUSTOMER_EDIT_ROUTINE',
        ].map((action) => ({
          roleTemplateId: personnelFixtures.operatorRoleId,
          action,
          scope: 'TEAM',
        })),
      ],
    });
    await transaction.roleAssignment.create({
      data: {
        userId: personnelFixtures.adminUserId,
        departmentId,
        roleTemplateId: personnelFixtures.adminRoleId,
      },
    });
  });
  return { username: 'e2e.personnel.admin', password };
}

async function addPersonnelForeignMembership(username) {
  const credential = await database.localCredential.findUniqueOrThrow({
    where: { username },
    select: { userId: true },
  });
  await database.departmentMembership.create({
    data: {
      userId: credential.userId,
      departmentId: personnelFixtures.foreignDepartmentId,
    },
  });
}

async function countPersonnelCredentials(username) {
  return database.localCredential.count({ where: { username } });
}

async function rejectPersonnelCreatedAuditWrites() {
  await allowPersonnelCreatedAuditWrites();
  await database.$executeRawUnsafe(
    `ALTER TABLE "audit_events" ADD CONSTRAINT "e2e_reject_personnel_created_audit" CHECK ("action" <> 'user.created') NOT VALID`,
  );
}

async function allowPersonnelCreatedAuditWrites() {
  await database.$executeRawUnsafe(
    'ALTER TABLE "audit_events" DROP CONSTRAINT IF EXISTS "e2e_reject_personnel_created_audit"',
  );
}

async function getPersonnelAccessSnapshot(username) {
  const credential = await database.localCredential.findUniqueOrThrow({
    where: { username },
    select: {
      passwordHash: true,
      user: {
        select: {
          id: true,
          active: true,
          memberships: {
            where: { departmentId: personnelFixtures.departmentId },
            select: { active: true, teamId: true },
          },
          roleAssignments: {
            where: { departmentId: personnelFixtures.departmentId },
            select: { active: true, roleTemplateId: true, teamId: true },
          },
        },
      },
    },
  });
  const audits = await database.auditEvent.findMany({
    where: {
      departmentId: personnelFixtures.departmentId,
      resourceId: credential.user.id,
    },
    select: { action: true, details: true },
  });
  return {
    userId: credential.user.id,
    accountActive: credential.user.active,
    memberships: credential.user.memberships,
    assignments: credential.user.roleAssignments,
    auditActions: audits.map((audit) => audit.action),
    serializedAudits: JSON.stringify(audits),
    passwordHash: credential.passwordHash,
  };
}

export {
  personnelFixtures,
  resetPersonnelAccessE2eData,
  getPersonnelAccessSnapshot,
  addPersonnelForeignMembership,
  countPersonnelCredentials,
  rejectPersonnelCreatedAuditWrites,
  allowPersonnelCreatedAuditWrites,
  resetLocalAuthE2eData,
  verifyLocalAuthMigration,
  verifyRightsHolderNames,
  allowRightsHolderAuditWrites,
  getRightsHolderCounts,
  linkRightsHolderFixture,
  rejectRightsHolderAuditWrites,
  revokeRightsHolderGrant,
  verifyRightsHolderMigration,
  allowNamedCustomerWrites,
  allowCustomerDraftAuditWrites,
  allowCustomerUpdateAuditWrites,
  assignCrossDepartmentTeamToCustomer,
  assignCrossDepartmentTeamToMembership,
  assignForeignDepartmentAuditActor,
  assignForeignDepartmentResponsibility,
  assignMissingTeamToMembership,
  assignMissingTeamToRoleAssignment,
  assignDepartmentBRoleInsideDepartmentA,
  countCustomerAuditEvents,
  countCustomerResourceAuditEvents,
  countCustomersByNormalizedIdentity,
  countCustomers,
  createTeamForMissingDepartment,
  countCustomerDraftAuditEvents,
  disableDepartmentARoleAssignment,
  disconnectCustomerTestDatabase,
  duplicateDepartmentLevelRoleAssignment,
  e2eFixtures,
  exerciseRoleAssignmentBoundary,
  exerciseAuthorizationLockConcurrency,
  findCustomerId,
  getCustomer,
  getCustomerById,
  getLatestCustomerAudit,
  getTeamReferenceCounts,
  getTeamArchitectureSnapshot,
  getCustomerAuditEvents,
  rejectCustomerDraftAuditWrites,
  rejectCustomerUpdateAuditWrites,
  rejectNamedCustomerWrites,
  resetCustomerE2eData,
  setTeamStatus,
  moveTeamToDepartment,
  verifyAdmissionContactConstraintRejectsBlankValues,
  verifyRoleAssignmentMigrationRollback,
  verifyTeamArchitectureMigration,
};
