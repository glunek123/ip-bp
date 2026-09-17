import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';

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
const testEnvironment = parseEnv(
  readFileSync(resolve(process.cwd(), 'backend/.env.test'), 'utf8'),
);
const testTarget = new URL(databaseUrl);
if (
  process.env.NODE_ENV !== 'test' ||
  testEnvironment.NODE_ENV !== 'test' ||
  databaseUrl !== testEnvironment.DATABASE_URL ||
  testTarget.hostname !== '127.0.0.1' ||
  testTarget.port !== '55433' ||
  testTarget.pathname !== '/dev_cor_test'
) {
  throw new Error(
    'Customer fixtures require the isolated backend/.env.test database',
  );
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

export {
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
