import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const requireFromBackend = createRequire(
  resolve(process.cwd(), 'backend/package.json'),
);
const { PrismaPg } = requireFromBackend('@prisma/adapter-pg');
const { PrismaClient } = requireFromBackend(
  './dist/generated/prisma/client.js',
);

const e2eFixtures = {
  departmentA: '10000000-0000-4000-8000-000000000001',
  departmentB: '10000000-0000-4000-8000-000000000002',
  userA: '20000000-0000-4000-8000-000000000001',
  userB: '20000000-0000-4000-8000-000000000002',
  roleA: '30000000-0000-4000-8000-000000000001',
  roleB: '30000000-0000-4000-8000-000000000002',
  tokenA: 'e2e-department-a',
  tokenB: 'e2e-department-b',
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
  const userIds = [e2eFixtures.userA, e2eFixtures.userB];

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
      where: { roleTemplateId: { in: [e2eFixtures.roleA, e2eFixtures.roleB] } },
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
    ],
  });
  await database.departmentMembership.createMany({
    data: [
      { userId: e2eFixtures.userA, departmentId: e2eFixtures.departmentA },
      { userId: e2eFixtures.userB, departmentId: e2eFixtures.departmentB },
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
    ],
  });
  await database.roleGrant.createMany({
    data: [
      {
        roleTemplateId: e2eFixtures.roleA,
        action: 'CUSTOMER_READ',
        scope: 'DEPARTMENT',
      },
      {
        roleTemplateId: e2eFixtures.roleA,
        action: 'CUSTOMER_CREATE_DRAFT',
        scope: 'DEPARTMENT',
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
    ],
  });
  await database.roleAssignment.createMany({
    data: [
      {
        userId: e2eFixtures.userA,
        departmentId: e2eFixtures.departmentA,
        roleTemplateId: e2eFixtures.roleA,
      },
      {
        userId: e2eFixtures.userB,
        departmentId: e2eFixtures.departmentB,
        roleTemplateId: e2eFixtures.roleB,
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
  assignDepartmentBRoleInsideDepartmentA,
  countCustomers,
  countCustomerDraftAuditEvents,
  disableDepartmentARoleAssignment,
  disconnectCustomerTestDatabase,
  e2eFixtures,
  findCustomerId,
  rejectCustomerDraftAuditWrites,
  rejectNamedCustomerWrites,
  resetCustomerE2eData,
};
