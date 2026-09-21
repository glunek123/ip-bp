import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';

const requireFromBackend = createRequire(
  resolve(process.cwd(), 'backend/package.json'),
);
const { PrismaPg } = requireFromBackend('@prisma/adapter-pg');
const { Client } = requireFromBackend('pg');
const { PrismaClient } = requireFromBackend(
  './dist/generated/prisma/client.js',
);

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined) throw new Error('DATABASE_URL is required');
if (process.env.NODE_ENV !== 'test') {
  throw new Error('Core lead fixtures require an isolated local test database');
}
validateIsolatedTestDatabaseUrl(databaseUrl, { allowRandomPort: true });
const privateFileRoot = resolve(process.env.PRIVATE_FILE_ROOT ?? '');
const expectedPrivateFileRoot = resolve(
  process.cwd(),
  '.local/private-files/test',
);
if (privateFileRoot !== expectedPrivateFileRoot) {
  throw new Error('Core lead fixtures require the isolated test file root');
}

const database = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl, max: 8 }),
});

export const coreLeadFixtures = Object.freeze({
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
  draftCustomer: '50000000-0000-4000-8000-000000000001',
  admittedCustomer: '50000000-0000-4000-8000-000000000002',
  foreignCustomer: '50000000-0000-4000-8000-000000000003',
  selfCustomer: '50000000-0000-4000-8000-000000000004',
  holder: '60000000-0000-4000-8000-000000000001',
  unlinkedHolder: '60000000-0000-4000-8000-000000000002',
  foreignHolder: '60000000-0000-4000-8000-000000000003',
  selfHolder: '60000000-0000-4000-8000-000000000004',
  tokenA: 'e2e-department-a',
  tokenB: 'e2e-department-b',
  tokenSelf: 'e2e-department-a-self',
});

const allActions = [
  'CUSTOMER_READ',
  'CUSTOMER_ADMIT',
  'LEAD_READ',
  'LEAD_CREATE',
  'LEAD_EDIT',
];
const actionNames = Object.freeze({
  'customer.read': 'CUSTOMER_READ',
  'customer.admit': 'CUSTOMER_ADMIT',
  'lead.read': 'LEAD_READ',
  'lead.create': 'LEAD_CREATE',
  'lead.edit': 'LEAD_EDIT',
});

async function dropFaults() {
  for (const [table, constraint] of [
    ['audit_events', 'core_ld_reject_audit'],
    ['lead_products', 'core_ld_reject_product'],
    ['content_versions', 'core_ld_reject_metadata'],
  ]) {
    await database.$executeRawUnsafe(
      `ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${constraint}"`,
    );
  }
}

async function clearPrivateBytes() {
  if (
    privateFileRoot !== expectedPrivateFileRoot ||
    !privateFileRoot.startsWith(
      `${resolve(process.cwd(), '.local/private-files')}\\`,
    )
  ) {
    throw new Error('Refusing to remove an unexpected test file root');
  }
  await rm(privateFileRoot, { recursive: true, force: true });
  await mkdir(privateFileRoot, { recursive: true });
}

async function clearDatabase() {
  const departmentIds = [
    coreLeadFixtures.departmentA,
    coreLeadFixtures.departmentB,
  ];
  const userIds = [
    coreLeadFixtures.userA,
    coreLeadFixtures.userB,
    coreLeadFixtures.userSelf,
  ];
  await dropFaults();
  await database.materialReference.deleteMany({
    where: { departmentId: { in: departmentIds } },
  });
  await database.customerAdmissionReceipt.deleteMany({
    where: { departmentId: { in: departmentIds } },
  });
  await database.leadCommandReceipt.deleteMany({
    where: { departmentId: { in: departmentIds } },
  });
  await database.lead.deleteMany({
    where: { departmentId: { in: departmentIds } },
  });
  await database.uploadDraft.deleteMany({
    where: { departmentId: { in: departmentIds } },
  });
  await database.material.updateMany({
    where: { departmentId: { in: departmentIds } },
    data: { currentVersionId: null },
  });
  await database.contentVersion.deleteMany({
    where: { material: { departmentId: { in: departmentIds } } },
  });
  await database.material.deleteMany({
    where: { departmentId: { in: departmentIds } },
  });
  await database.auditEvent.deleteMany({
    where: { departmentId: { in: departmentIds } },
  });
  await database.rightsHolderCommandReceipt.deleteMany({
    where: { departmentId: { in: departmentIds } },
  });
  await database.customerRightsHolderLink.deleteMany({
    where: { departmentId: { in: departmentIds } },
  });
  await database.rightsHolder.deleteMany({
    where: { departmentId: { in: departmentIds } },
  });
  await database.customer.deleteMany({
    where: { departmentId: { in: departmentIds } },
  });
  await database.authSession.deleteMany({ where: { userId: { in: userIds } } });
  await database.localCredential.deleteMany({
    where: { userId: { in: userIds } },
  });
  await database.roleAssignment.deleteMany({
    where: { departmentId: { in: departmentIds } },
  });
  await database.roleGrant.deleteMany({
    where: {
      roleTemplateId: {
        in: [
          coreLeadFixtures.roleA,
          coreLeadFixtures.roleB,
          coreLeadFixtures.roleSelf,
        ],
      },
    },
  });
  await database.roleTemplate.deleteMany({
    where: { departmentId: { in: departmentIds } },
  });
  await database.departmentMembership.deleteMany({
    where: { departmentId: { in: departmentIds } },
  });
  await database.team.deleteMany({
    where: { departmentId: { in: departmentIds } },
  });
  await database.userAccount.deleteMany({ where: { id: { in: userIds } } });
  await database.department.deleteMany({
    where: { id: { in: departmentIds } },
  });
  await database.leadNumberCounter.deleteMany({});
}

function admittedCustomer(id, departmentId, userId, teamId, name, identity) {
  return {
    id,
    departmentId,
    responsibleUserId: userId,
    teamId,
    name,
    normalizedName: name,
    customerType: 'ENTERPRISE',
    identityType: 'BUSINESS_LICENSE',
    identityNumber: identity,
    normalizedIdentityNumber: identity,
    admissionContactName: '测试联系人',
    admissionContactPhone: '13800000000',
    identityValidityMode: 'LONG_TERM',
    profileStatus: 'ADMITTED',
    admittedAt: new Date('2026-09-21T00:00:00.000Z'),
  };
}

export async function resetCoreLeadE2eData() {
  await clearDatabase();
  await clearPrivateBytes();
  await database.department.createMany({
    data: [
      { id: coreLeadFixtures.departmentA, name: 'CORE 知产部' },
      { id: coreLeadFixtures.departmentB, name: 'CORE 外部门' },
    ],
  });
  await database.userAccount.createMany({
    data: [
      {
        id: coreLeadFixtures.userA,
        externalSubject: 'core-lead-user-a',
        displayName: '核心主管',
      },
      {
        id: coreLeadFixtures.userB,
        externalSubject: 'core-lead-user-b',
        displayName: '外部门主管',
      },
      {
        id: coreLeadFixtures.userSelf,
        externalSubject: 'core-lead-user-self',
        displayName: '本人范围人员',
      },
    ],
  });
  await database.team.createMany({
    data: [
      {
        id: coreLeadFixtures.teamA,
        departmentId: coreLeadFixtures.departmentA,
        name: 'CORE A 组',
      },
      {
        id: coreLeadFixtures.teamSelf,
        departmentId: coreLeadFixtures.departmentA,
        name: 'CORE SELF 组',
      },
    ],
  });
  await database.departmentMembership.createMany({
    data: [
      {
        userId: coreLeadFixtures.userA,
        departmentId: coreLeadFixtures.departmentA,
        teamId: coreLeadFixtures.teamA,
      },
      {
        userId: coreLeadFixtures.userB,
        departmentId: coreLeadFixtures.departmentB,
      },
      {
        userId: coreLeadFixtures.userSelf,
        departmentId: coreLeadFixtures.departmentA,
        teamId: coreLeadFixtures.teamSelf,
      },
    ],
  });
  await database.roleTemplate.createMany({
    data: [
      {
        id: coreLeadFixtures.roleA,
        departmentId: coreLeadFixtures.departmentA,
        name: 'CORE TEAM',
      },
      {
        id: coreLeadFixtures.roleB,
        departmentId: coreLeadFixtures.departmentB,
        name: 'CORE DEPARTMENT',
      },
      {
        id: coreLeadFixtures.roleSelf,
        departmentId: coreLeadFixtures.departmentA,
        name: 'CORE SELF',
      },
    ],
  });
  await database.roleGrant.createMany({
    data: [
      ...allActions.map((action) => ({
        roleTemplateId: coreLeadFixtures.roleA,
        action,
        scope: 'TEAM',
      })),
      ...allActions.map((action) => ({
        roleTemplateId: coreLeadFixtures.roleB,
        action,
        scope: 'DEPARTMENT',
      })),
      ...allActions.map((action) => ({
        roleTemplateId: coreLeadFixtures.roleSelf,
        action,
        scope: 'SELF',
      })),
    ],
  });
  await database.roleAssignment.createMany({
    data: [
      {
        userId: coreLeadFixtures.userA,
        departmentId: coreLeadFixtures.departmentA,
        roleTemplateId: coreLeadFixtures.roleA,
        teamId: coreLeadFixtures.teamA,
      },
      {
        userId: coreLeadFixtures.userB,
        departmentId: coreLeadFixtures.departmentB,
        roleTemplateId: coreLeadFixtures.roleB,
      },
      {
        userId: coreLeadFixtures.userSelf,
        departmentId: coreLeadFixtures.departmentA,
        roleTemplateId: coreLeadFixtures.roleSelf,
        teamId: coreLeadFixtures.teamSelf,
      },
    ],
  });
  await database.customer.createMany({
    data: [
      {
        id: coreLeadFixtures.draftCustomer,
        departmentId: coreLeadFixtures.departmentA,
        responsibleUserId: coreLeadFixtures.userA,
        teamId: coreLeadFixtures.teamA,
        name: '待准入客户',
        normalizedName: '待准入客户',
      },
      admittedCustomer(
        coreLeadFixtures.admittedCustomer,
        coreLeadFixtures.departmentA,
        coreLeadFixtures.userA,
        coreLeadFixtures.teamA,
        '已准入客户',
        'COREA001',
      ),
      admittedCustomer(
        coreLeadFixtures.foreignCustomer,
        coreLeadFixtures.departmentB,
        coreLeadFixtures.userB,
        null,
        '外部门客户',
        'COREB001',
      ),
      admittedCustomer(
        coreLeadFixtures.selfCustomer,
        coreLeadFixtures.departmentA,
        coreLeadFixtures.userSelf,
        coreLeadFixtures.teamSelf,
        '本人范围客户',
        'CORESELF1',
      ),
    ],
  });
  await database.rightsHolder.createMany({
    data: [
      {
        id: coreLeadFixtures.holder,
        departmentId: coreLeadFixtures.departmentA,
        name: '核心权利主体',
      },
      {
        id: coreLeadFixtures.unlinkedHolder,
        departmentId: coreLeadFixtures.departmentA,
        name: '未关联主体',
      },
      {
        id: coreLeadFixtures.foreignHolder,
        departmentId: coreLeadFixtures.departmentB,
        name: '外部门主体',
      },
      {
        id: coreLeadFixtures.selfHolder,
        departmentId: coreLeadFixtures.departmentA,
        name: '本人范围主体',
      },
    ],
  });
  await database.customerRightsHolderLink.createMany({
    data: [
      {
        customerId: coreLeadFixtures.draftCustomer,
        rightsHolderId: coreLeadFixtures.holder,
        departmentId: coreLeadFixtures.departmentA,
      },
      {
        customerId: coreLeadFixtures.admittedCustomer,
        rightsHolderId: coreLeadFixtures.holder,
        departmentId: coreLeadFixtures.departmentA,
      },
      {
        customerId: coreLeadFixtures.foreignCustomer,
        rightsHolderId: coreLeadFixtures.foreignHolder,
        departmentId: coreLeadFixtures.departmentB,
      },
      {
        customerId: coreLeadFixtures.selfCustomer,
        rightsHolderId: coreLeadFixtures.selfHolder,
        departmentId: coreLeadFixtures.departmentA,
      },
    ],
  });
  for (const [index, status] of [
    'WAITING_REVIEW',
    'WAITING_EVIDENCE_DECISION',
    'ARCHIVED',
  ].entries()) {
    await database.lead.create({
      data: {
        id: `70000000-0000-4000-8000-00000000000${index + 1}`,
        departmentId: coreLeadFixtures.departmentA,
        businessNo: `CORE-SEED-${index + 1}`,
        customerId: coreLeadFixtures.admittedCustomer,
        rightsHolderId: coreLeadFixtures.holder,
        responsibleUserId: coreLeadFixtures.userA,
        teamId: coreLeadFixtures.teamA,
        status,
        caseType: 'CIVIL',
        source: 'ONLINE',
        platform: 'TAOBAO',
        foundAt: new Date('2026-09-21T00:00:00.000Z'),
        shopName: `阶段种子 ${index + 1}`,
        needDisclose: false,
        products: {
          create: {
            position: 1,
            title: `阶段商品 ${index + 1}`,
            quantity: 1,
            unitPrice: '1.00',
            commentCount: 0,
            estimatedAmount: '1.00',
          },
        },
        infringements: { create: { type: 'TRADEMARK' } },
      },
    });
  }
}

export function getCustomer(id) {
  return database.customer.findUnique({ where: { id } });
}

export function getLead(id) {
  return database.lead.findUnique({
    where: { id },
    include: { products: { orderBy: { position: 'asc' } } },
  });
}

export function countLeads() {
  return database.lead.count({
    where: { departmentId: coreLeadFixtures.departmentA },
  });
}

export function countAdmissionReceipts() {
  return database.customerAdmissionReceipt.count({
    where: { departmentId: coreLeadFixtures.departmentA },
  });
}

export function countLeadReceipts() {
  return database.leadCommandReceipt.count({
    where: { departmentId: coreLeadFixtures.departmentA },
  });
}

export function setGrant(action, enabled) {
  const prismaAction = actionNames[action];
  if (prismaAction === undefined) throw new Error('Unsupported fixture action');
  if (enabled) {
    return database.roleGrant.create({
      data: {
        roleTemplateId: coreLeadFixtures.roleA,
        action: prismaAction,
        scope: 'TEAM',
      },
    });
  }
  return database.roleGrant.deleteMany({
    where: { roleTemplateId: coreLeadFixtures.roleA, action: prismaAction },
  });
}

export function markContentVersion(versionId, status) {
  return database.contentVersion.update({
    where: { id: versionId },
    data: { status },
  });
}

export async function rejectAuditWrites(action) {
  await dropFaults();
  await database.$executeRawUnsafe(
    `ALTER TABLE "audit_events" ADD CONSTRAINT "core_ld_reject_audit" CHECK ("action" <> '${action.replaceAll("'", "''")}') NOT VALID`,
  );
}

export async function rejectLeadProductWrites() {
  await dropFaults();
  await database.$executeRawUnsafe(
    `ALTER TABLE "lead_products" ADD CONSTRAINT "core_ld_reject_product" CHECK (COALESCE("title", '') <> 'ROLLBACK-PRODUCT') NOT VALID`,
  );
}

export async function rejectMaterialMetadataWrites() {
  await dropFaults();
  await database.$executeRawUnsafe(
    `ALTER TABLE "content_versions" ADD CONSTRAINT "core_ld_reject_metadata" CHECK ("original_filename" <> 'rollback.jpg') NOT VALID`,
  );
}

export function allowInjectedFailures() {
  return dropFaults();
}

export async function countStoredFiles() {
  async function walk(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return 0;
      throw error;
    }
    let count = 0;
    for (const entry of entries) {
      count += entry.isDirectory()
        ? await walk(resolve(directory, entry.name))
        : 1;
    }
    return count;
  }
  return walk(privateFileRoot);
}

export async function setLeadCounter(value) {
  await database.$executeRawUnsafe(
    `INSERT INTO "lead_number_counters" ("business_date", "last_value", "updated_at")
     VALUES ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date, $1, CURRENT_TIMESTAMP)
     ON CONFLICT ("business_date") DO UPDATE SET "last_value" = EXCLUDED."last_value", "updated_at" = CURRENT_TIMESTAMP`,
    value,
  );
}

export async function databaseCounts() {
  const [leads, products, audits, materials, versions, references] =
    await database.$transaction([
      database.lead.count({
        where: { departmentId: coreLeadFixtures.departmentA },
      }),
      database.leadProduct.count({}),
      database.auditEvent.count({
        where: { departmentId: coreLeadFixtures.departmentA },
      }),
      database.material.count({
        where: { departmentId: coreLeadFixtures.departmentA },
      }),
      database.contentVersion.count({
        where: { material: { departmentId: coreLeadFixtures.departmentA } },
      }),
      database.materialReference.count({
        where: { departmentId: coreLeadFixtures.departmentA },
      }),
    ]);
  return { leads, products, audits, materials, versions, references };
}

export function getMaterialByVersion(versionId) {
  return database.contentVersion.findUnique({
    where: { id: versionId },
    include: { material: true },
  });
}

export async function verifyCoreLeadMigration() {
  const migrationRoot = resolve(process.cwd(), 'backend/prisma/migrations');
  const actionTarget = '20260921010000_add_core_ld_actions';
  const schemaTarget = '20260921011000_add_core_ld_schema';
  const backfillTarget = '20260921012000_backfill_core_ld_bootstrap_grants';
  const migrations = (await readdir(migrationRoot))
    .filter((name) => /^\d{14}_/u.test(name))
    .sort();
  const previousMigrations = migrations.filter((name) => name < actionTarget);
  const laterMigrations = migrations.filter((name) => name > backfillTarget);
  const probe = randomUUID().replaceAll('-', '');
  const schemas = {
    empty: `core_ld_empty_${probe}`,
    upgrade: `core_ld_upgrade_${probe}`,
    schemaFailure: `core_ld_schema_failure_${probe}`,
    backfillFailure: `core_ld_backfill_failure_${probe}`,
  };
  const client = new Client({ connectionString: databaseUrl });

  async function migrationSql(name) {
    return readFile(resolve(migrationRoot, name, 'migration.sql'), 'utf8');
  }

  async function apply(names) {
    for (const name of names) await client.query(await migrationSql(name));
  }

  async function useSchema(schema) {
    await client.query(`SET search_path TO "${schema}"`);
  }

  async function seedLegacy(schema) {
    await useSchema(schema);
    const ids = {
      bootstrapDepartment: randomUUID(),
      bootstrapUser: randomUUID(),
      bootstrapRole: randomUUID(),
      sharedDepartment: randomUUID(),
      sharedUser: randomUUID(),
      sharedOtherUser: randomUUID(),
      sharedRole: randomUUID(),
      incompleteDepartment: randomUUID(),
      incompleteUser: randomUUID(),
      incompleteRole: randomUUID(),
      knownCustomer: randomUUID(),
      unknownCustomer: randomUUID(),
    };
    const existingActions = [
      'customer.read',
      'customer.create-draft',
      'customer.edit-routine',
      'user.read',
      'user.manage',
      'team.read',
      'team.manage',
      'role.read',
      'role.assign',
      'role.manage',
    ];
    for (const [id, name] of [
      [ids.bootstrapDepartment, '引导部门'],
      [ids.sharedDepartment, '共享部门'],
      [ids.incompleteDepartment, '非引导部门'],
    ]) {
      await client.query(
        'INSERT INTO departments(id,name,updated_at) VALUES ($1,$2,NOW())',
        [id, name],
      );
    }
    for (const [id, subject, displayName] of [
      [ids.bootstrapUser, 'local:core-bootstrap', '引导管理员'],
      [ids.sharedUser, 'local:core-shared', '共享管理员'],
      [ids.sharedOtherUser, 'external:core-shared', '共享受让人'],
      [ids.incompleteUser, 'local:core-incomplete', '非引导管理员'],
    ]) {
      await client.query(
        'INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES ($1,$2,$3,NOW())',
        [id, subject, displayName],
      );
    }
    for (const [userId, departmentId] of [
      [ids.bootstrapUser, ids.bootstrapDepartment],
      [ids.sharedUser, ids.sharedDepartment],
      [ids.sharedOtherUser, ids.sharedDepartment],
      [ids.incompleteUser, ids.incompleteDepartment],
    ]) {
      await client.query(
        'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES ($1,$2,$3,NOW())',
        [randomUUID(), userId, departmentId],
      );
    }
    for (const [userId, username] of [
      [ids.bootstrapUser, 'core.bootstrap'],
      [ids.sharedUser, 'core.shared'],
      [ids.incompleteUser, 'core.incomplete'],
    ]) {
      await client.query(
        'INSERT INTO local_credentials(id,user_id,username,password_hash,updated_at) VALUES ($1,$2,$3,$4,NOW())',
        [randomUUID(), userId, username, 'test-hash'],
      );
    }
    for (const [roleId, departmentId, name] of [
      [ids.bootstrapRole, ids.bootstrapDepartment, '引导角色'],
      [ids.sharedRole, ids.sharedDepartment, '共享角色'],
      [ids.incompleteRole, ids.incompleteDepartment, '非引导角色'],
    ]) {
      await client.query(
        'INSERT INTO role_templates(id,department_id,name,updated_at) VALUES ($1,$2,$3,NOW())',
        [roleId, departmentId, name],
      );
    }
    for (const [roleId, actions] of [
      [ids.bootstrapRole, existingActions],
      [ids.sharedRole, existingActions],
      [ids.incompleteRole, existingActions.slice(0, -1)],
    ]) {
      for (const action of actions) {
        await client.query(
          "INSERT INTO role_grants(id,role_template_id,action,scope) VALUES ($1,$2,$3,'DEPARTMENT')",
          [randomUUID(), roleId, action],
        );
      }
    }
    for (const [userId, departmentId, roleId] of [
      [ids.bootstrapUser, ids.bootstrapDepartment, ids.bootstrapRole],
      [ids.sharedUser, ids.sharedDepartment, ids.sharedRole],
      [ids.sharedOtherUser, ids.sharedDepartment, ids.sharedRole],
      [ids.incompleteUser, ids.incompleteDepartment, ids.incompleteRole],
    ]) {
      await client.query(
        'INSERT INTO role_assignments(id,user_id,department_id,role_template_id,updated_at) VALUES ($1,$2,$3,$4,NOW())',
        [randomUUID(), userId, departmentId, roleId],
      );
    }
    for (const customer of [
      {
        id: ids.knownCustomer,
        name: '旧企业客户',
        customerType: 'enterprise',
        identityType: 'credit-code',
        identityNumber: 'LEGACY-KNOWN-001',
      },
      {
        id: ids.unknownCustomer,
        name: '未知遗留客户',
        customerType: 'legacy-company',
        identityType: 'legacy-document',
        identityNumber: 'LEGACY-UNKNOWN-001',
      },
    ]) {
      await client.query(
        `INSERT INTO customers(
           id,name,normalized_name,customer_type,identity_type,
           identity_number,normalized_identity_number,
           admission_contact_name,admission_contact_phone,
           department_id,responsible_user_id,updated_at
         ) VALUES ($1,$2,$2,$3,$4,$5,$5,'迁移联系人','13800000000',$6,$7,NOW())`,
        [
          customer.id,
          customer.name,
          customer.customerType,
          customer.identityType,
          customer.identityNumber,
          ids.bootstrapDepartment,
          ids.bootstrapUser,
        ],
      );
    }
    return ids;
  }

  await client.connect();
  try {
    const actual = await client.query('SELECT current_database() AS database');
    if (actual.rows[0]?.database !== 'dev_cor_test') {
      throw new Error('Unexpected migration database');
    }
    for (const schema of Object.values(schemas)) {
      await client.query(`CREATE SCHEMA "${schema}"`);
    }

    await useSchema(schemas.empty);
    await apply(migrations);
    const emptyTables = (
      await client.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema=$1 AND table_name IN (
           'upload_drafts','materials','customer_admission_receipts',
           'leads','lead_number_counters','lead_command_receipts'
         ) ORDER BY table_name`,
        [schemas.empty],
      )
    ).rows.map(({ table_name: tableName }) => tableName);

    await useSchema(schemas.upgrade);
    await apply(previousMigrations);
    const upgradeIds = await seedLegacy(schemas.upgrade);
    await apply([actionTarget, schemaTarget, backfillTarget]);
    await apply(laterMigrations);
    const known = (
      await client.query(
        'SELECT customer_type,identity_type,profile_status FROM customers WHERE id=$1',
        [upgradeIds.knownCustomer],
      )
    ).rows[0];
    const unknown = (
      await client.query(
        'SELECT customer_type,identity_type,profile_status FROM customers WHERE id=$1',
        [upgradeIds.unknownCustomer],
      )
    ).rows[0];
    let invalidAdmittedCode = null;
    try {
      await client.query(
        `UPDATE customers
         SET customer_type='ENTERPRISE', identity_type='NATIONAL_ID',
             identity_validity_mode='LONG_TERM', identity_valid_from=CURRENT_DATE,
             identity_valid_to=NULL, admitted_at=NOW(), profile_status='ADMITTED'
         WHERE id=$1`,
        [upgradeIds.knownCustomer],
      );
    } catch (error) {
      invalidAdmittedCode = error.code ?? null;
    }
    await client.query(
      `UPDATE customers
       SET customer_type='ENTERPRISE', identity_type='BUSINESS_LICENSE',
           identity_validity_mode='LONG_TERM', identity_valid_from=CURRENT_DATE,
           identity_valid_to=NULL, admitted_at=NOW(), profile_status='ADMITTED'
       WHERE id=$1`,
      [upgradeIds.knownCustomer],
    );
    const compatibleAdmittedStatus = (
      await client.query('SELECT profile_status FROM customers WHERE id=$1', [
        upgradeIds.knownCustomer,
      ])
    ).rows[0]?.profile_status;
    const grantCounts = {};
    for (const [name, roleId] of [
      ['bootstrap', upgradeIds.bootstrapRole],
      ['shared', upgradeIds.sharedRole],
      ['incomplete', upgradeIds.incompleteRole],
    ]) {
      grantCounts[name] = Number(
        (
          await client.query(
            `SELECT COUNT(*) FROM role_grants
             WHERE role_template_id=$1
               AND action IN ('customer.admit','lead.read','lead.create','lead.edit')`,
            [roleId],
          )
        ).rows[0].count,
      );
    }
    const revisions = {};
    for (const [name, userId] of [
      ['bootstrap', upgradeIds.bootstrapUser],
      ['shared', upgradeIds.sharedUser],
      ['incomplete', upgradeIds.incompleteUser],
    ]) {
      revisions[name] = Number(
        (
          await client.query(
            'SELECT authorization_revision FROM user_accounts WHERE id=$1',
            [userId],
          )
        ).rows[0].authorization_revision,
      );
    }

    await useSchema(schemas.schemaFailure);
    await apply(previousMigrations);
    await apply([actionTarget]);
    await client.query('CREATE TABLE upload_drafts(id UUID PRIMARY KEY)');
    let schemaFailureCode = null;
    try {
      await apply([schemaTarget]);
    } catch (error) {
      schemaFailureCode = error.code ?? null;
      await client.query('ROLLBACK').catch(() => undefined);
    }
    const createdTables = Number(
      (
        await client.query(
          `SELECT COUNT(*) FROM information_schema.tables
           WHERE table_schema=$1 AND table_name IN (
             'materials','content_versions','material_references',
             'customer_admission_receipts','leads','lead_products',
             'lead_infringements','lead_number_counters','lead_command_receipts'
           )`,
          [schemas.schemaFailure],
        )
      ).rows[0].count,
    );
    const addedColumns = Number(
      (
        await client.query(
          `SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema=$1 AND table_name='customers'
             AND column_name IN (
               'identity_valid_from','identity_valid_to',
               'identity_validity_mode','admitted_at'
             )`,
          [schemas.schemaFailure],
        )
      ).rows[0].count,
    );
    const addedConstraints = Number(
      (
        await client.query(
          `SELECT COUNT(*) FROM information_schema.table_constraints
           WHERE table_schema=$1 AND table_name='customers'
             AND constraint_name IN (
               'customers_version_positive_check',
               'customers_admitted_fields_compatible_check'
             )`,
          [schemas.schemaFailure],
        )
      ).rows[0].count,
    );

    await useSchema(schemas.backfillFailure);
    await apply(previousMigrations);
    const failureIds = await seedLegacy(schemas.backfillFailure);
    await apply([actionTarget, schemaTarget]);
    await client.query('CREATE SEQUENCE core_ld_probe_grant_insert_attempts');
    await client.query(
      'CREATE SEQUENCE core_ld_probe_revision_update_attempts',
    );
    await client.query(
      `CREATE FUNCTION core_ld_probe_count_grant_insert() RETURNS trigger
       LANGUAGE plpgsql AS $$
       BEGIN
         PERFORM nextval('core_ld_probe_grant_insert_attempts');
         RETURN NEW;
       END
       $$`,
    );
    await client.query(
      `CREATE TRIGGER core_ld_probe_count_grant_insert
       BEFORE INSERT ON role_grants
       FOR EACH ROW
       WHEN (NEW.action::text IN (
         'customer.admit','lead.read','lead.create','lead.edit'
       ))
       EXECUTE FUNCTION core_ld_probe_count_grant_insert()`,
    );
    await client.query(
      `CREATE FUNCTION core_ld_probe_reject_revision_update() RETURNS trigger
       LANGUAGE plpgsql AS $$
       BEGIN
         PERFORM nextval('core_ld_probe_revision_update_attempts');
         RAISE EXCEPTION 'injected authorization revision failure'
           USING ERRCODE = '23514';
       END
       $$`,
    );
    await client.query(
      `CREATE TRIGGER core_ld_probe_reject_revision_update
       BEFORE UPDATE OF authorization_revision ON user_accounts
       FOR EACH ROW
       WHEN (NEW.authorization_revision > OLD.authorization_revision)
       EXECUTE FUNCTION core_ld_probe_reject_revision_update()`,
    );
    let backfillFailureCode = null;
    try {
      await apply([backfillTarget]);
    } catch (error) {
      backfillFailureCode = error.code ?? null;
      await client.query('ROLLBACK').catch(() => undefined);
    }
    const backfillGrantCount = Number(
      (
        await client.query(
          `SELECT COUNT(*) FROM role_grants
           WHERE role_template_id=$1
             AND action IN ('customer.admit','lead.read','lead.create','lead.edit')`,
          [failureIds.bootstrapRole],
        )
      ).rows[0].count,
    );
    const backfillRevision = Number(
      (
        await client.query(
          'SELECT authorization_revision FROM user_accounts WHERE id=$1',
          [failureIds.bootstrapUser],
        )
      ).rows[0].authorization_revision,
    );
    const grantInsertAttempts = Number(
      (
        await client.query(
          'SELECT last_value FROM core_ld_probe_grant_insert_attempts',
        )
      ).rows[0].last_value,
    );
    const revisionUpdateAttempts = Number(
      (
        await client.query(
          'SELECT last_value FROM core_ld_probe_revision_update_attempts',
        )
      ).rows[0].last_value,
    );

    return {
      empty: { tables: emptyTables },
      upgrade: {
        known,
        unknown,
        invalidAdmittedCode,
        compatibleAdmittedStatus,
        grantCounts,
        revisions,
      },
      schemaFailure: {
        code: schemaFailureCode,
        createdTables,
        addedColumns,
        addedConstraints,
      },
      backfillFailure: {
        code: backfillFailureCode,
        grantCount: backfillGrantCount,
        revision: backfillRevision,
        grantInsertAttempts,
        revisionUpdateAttempts,
      },
    };
  } finally {
    await client.query('RESET search_path').catch(() => undefined);
    for (const schema of Object.values(schemas)) {
      await client
        .query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        .catch(() => undefined);
    }
    await client.end();
  }
}

export async function disconnectCoreLeadTestDatabase() {
  await dropFaults().catch(() => undefined);
  await database.$disconnect();
}
