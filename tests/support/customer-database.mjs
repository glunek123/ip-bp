import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const requireFromBackend = createRequire(
  resolve(process.cwd(), 'backend/package.json'),
);
const { PrismaPg } = requireFromBackend('@prisma/adapter-pg');
const { Client } = requireFromBackend('pg');
const { PrismaClient } = requireFromBackend(
  './dist/generated/prisma/client.js',
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
  teamSelf: '40000000-0000-4000-8000-000000000002',
  tokenA: 'e2e-department-a',
  tokenB: 'e2e-department-b',
  tokenSelf: 'e2e-department-a-self',
};

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined) {
  throw new Error('DATABASE_URL is required for customer E2E setup');
}

const database = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl, max: 2 }),
});

async function resetCustomerE2eData() {
  const departmentIds = [e2eFixtures.departmentA, e2eFixtures.departmentB];
  const userIds = [e2eFixtures.userA, e2eFixtures.userB, e2eFixtures.userSelf];

  await database.$transaction([
    database.auditEvent.deleteMany({
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
      { id: e2eFixtures.userA, externalSubject: 'e2e-user-a' },
      { id: e2eFixtures.userB, externalSubject: 'e2e-user-b' },
      { id: e2eFixtures.userSelf, externalSubject: 'e2e-user-self' },
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

export {
  allowNamedCustomerWrites,
  allowCustomerDraftAuditWrites,
  allowCustomerUpdateAuditWrites,
  assignForeignDepartmentAuditActor,
  assignForeignDepartmentResponsibility,
  assignDepartmentBRoleInsideDepartmentA,
  countCustomerAuditEvents,
  countCustomerResourceAuditEvents,
  countCustomersByNormalizedIdentity,
  countCustomers,
  countCustomerDraftAuditEvents,
  disableDepartmentARoleAssignment,
  disconnectCustomerTestDatabase,
  duplicateDepartmentLevelRoleAssignment,
  e2eFixtures,
  findCustomerId,
  getCustomer,
  getCustomerById,
  getLatestCustomerAudit,
  getCustomerAuditEvents,
  rejectCustomerDraftAuditWrites,
  rejectCustomerUpdateAuditWrites,
  rejectNamedCustomerWrites,
  resetCustomerE2eData,
  verifyAdmissionContactConstraintRejectsBlankValues,
  verifyRoleAssignmentMigrationRollback,
};
