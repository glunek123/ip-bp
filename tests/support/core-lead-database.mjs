import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { setImmediate as waitForImmediate } from 'node:timers/promises';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';

const requireFromBackend = createRequire(
  resolve(process.cwd(), 'backend/package.json'),
);
const { PrismaPg } = requireFromBackend('@prisma/adapter-pg');
const { Client } = requireFromBackend('pg');
const { PrismaClient } = requireFromBackend(
  './dist/generated/prisma/client.js',
);
const { MaterialCleanupService } = requireFromBackend(
  './dist/modules/materials/material-cleanup.service.js',
);
const { MaterialStorageKeyCoordinator } = requireFromBackend(
  './dist/modules/materials/material-storage-key-coordinator.js',
);
const { hashPassword } = requireFromBackend('./dist/auth/password.js');

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
  operatorUsername: 'core-lead-operator',
  operatorPassword: 'correct horse battery staple',
});

const operatorPasswordHash = hashPassword(coreLeadFixtures.operatorPassword);

const allActions = [
  'CUSTOMER_READ',
  'CUSTOMER_ADMIT',
  'LEAD_READ',
  'LEAD_CREATE',
  'LEAD_EDIT',
  'LEAD_PUSH',
];
const actionNames = Object.freeze({
  'customer.read': 'CUSTOMER_READ',
  'customer.admit': 'CUSTOMER_ADMIT',
  'lead.read': 'LEAD_READ',
  'lead.create': 'LEAD_CREATE',
  'lead.edit': 'LEAD_EDIT',
  'lead.push': 'LEAD_PUSH',
});

async function dropFaults() {
  await database.$executeRawUnsafe(
    'DROP TRIGGER IF EXISTS "core_ld_material_barrier" ON "materials"',
  );
  await database.$executeRawUnsafe(
    'DROP FUNCTION IF EXISTS core_ld_material_barrier()',
  );
  for (const [table, constraint] of [
    ['audit_events', 'core_ld_reject_audit'],
    ['lead_products', 'core_ld_reject_product'],
    ['content_versions', 'core_ld_reject_metadata'],
    ['lead_command_receipts', 'core_ld_reject_push_receipt'],
    ['lead_review_decisions', 'core_ld_reject_review_decision'],
    ['client_lead_review_receipts', 'core_ld_reject_review_receipt'],
  ]) {
    await database.$executeRawUnsafe(
      `ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${constraint}"`,
    );
  }
}

const materialBarrierKey = 918273645;

export async function installMaterialStatusBarrier(materialId, status) {
  if (!/^[0-9a-f-]{36}$/iu.test(materialId)) {
    throw new Error('Invalid material barrier id');
  }
  if (status !== 'ACTIVE' && status !== 'DELETED') {
    throw new Error('Invalid material barrier status');
  }
  const blocker = new Client({ connectionString: databaseUrl });
  await blocker.connect();
  await blocker.query('SELECT pg_advisory_lock($1)', [materialBarrierKey]);
  await database.$executeRawUnsafe(
    `CREATE FUNCTION core_ld_material_barrier() RETURNS trigger
     LANGUAGE plpgsql AS $$
     BEGIN
       IF NEW."id" = '${materialId}'::uuid AND NEW."status" = '${status}' THEN
         PERFORM pg_advisory_xact_lock(${materialBarrierKey});
       END IF;
       RETURN NEW;
     END
     $$`,
  );
  await database.$executeRawUnsafe(
    `CREATE TRIGGER "core_ld_material_barrier"
     BEFORE UPDATE ON "materials"
     FOR EACH ROW EXECUTE FUNCTION core_ld_material_barrier()`,
  );
  return {
    async wait() {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const waiting = await database.$queryRawUnsafe(
          `SELECT EXISTS (
             SELECT 1 FROM pg_locks
             WHERE locktype = 'advisory' AND granted = false
           ) AS waiting`,
        );
        if (waiting[0]?.waiting === true) return;
        await waitForImmediate();
      }
      throw new Error('Material status transition did not reach the barrier');
    },
    async release() {
      await blocker.query('SELECT pg_advisory_unlock($1)', [
        materialBarrierKey,
      ]);
      await blocker.end();
    },
  };
}

export async function setMaterialDeletedAt(materialId, deletedAt) {
  await database.material.update({
    where: { id: materialId },
    data: { deletedAt },
  });
}

export async function getMaterialLifecycle(materialId) {
  return database.material.findUnique({
    where: { id: materialId },
    include: { contentVersions: { orderBy: { createdAt: 'asc' } } },
  });
}

export async function getMaterialAuditActions(materialId) {
  const rows = await database.auditEvent.findMany({
    where: { resourceType: 'material', resourceId: materialId },
    orderBy: { createdAt: 'asc' },
    select: { action: true },
  });
  return rows.map(({ action }) => action);
}

export function startMaterialCleanup(now) {
  let markDeleteStarted;
  let allowDelete;
  const deleteStarted = new Promise((resolvePromise) => {
    markDeleteStarted = resolvePromise;
  });
  const deleteAllowed = new Promise((resolvePromise) => {
    allowDelete = resolvePromise;
  });
  const storage = {
    async delete() {
      markDeleteStarted();
      await deleteAllowed;
    },
    async health() {
      return 'ready';
    },
    async open() {
      throw new Error('not used');
    },
    async put() {
      throw new Error('not used');
    },
  };
  const service = new MaterialCleanupService(
    database,
    storage,
    new MaterialStorageKeyCoordinator(),
    () => now,
  );
  const result = service.runOnce();
  return {
    deleteStarted,
    allowDelete: () => allowDelete(),
    result,
  };
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
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Core lead reset requires NODE_ENV=test');
  }
  validateIsolatedTestDatabaseUrl(databaseUrl, { allowRandomPort: true });
  const actualDatabase = await database.$queryRawUnsafe(
    'SELECT current_database() AS name',
  );
  if (actualDatabase[0]?.name !== 'dev_cor_test') {
    throw new Error('Refusing to reset an unexpected database');
  }
  const departmentIds = [
    coreLeadFixtures.departmentA,
    coreLeadFixtures.departmentB,
  ];
  const userIds = [
    coreLeadFixtures.userA,
    coreLeadFixtures.userB,
    coreLeadFixtures.userSelf,
  ];
  const clientBindings = await database.customerAccountBinding.findMany({
    where: { departmentId: { in: departmentIds } },
    select: { userId: true },
  });
  const allUserIds = [
    ...userIds,
    ...clientBindings.map(({ userId }) => userId),
  ];
  await dropFaults();
  await database.$executeRawUnsafe(
    'TRUNCATE TABLE "client_lead_review_receipts", "lead_review_decisions"',
  );
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
  await database.authSession.deleteMany({
    where: { userId: { in: allUserIds } },
  });
  await database.localCredential.deleteMany({
    where: { userId: { in: allUserIds } },
  });
  await database.$transaction(async (transaction) => {
    await transaction.customerAccountBinding.deleteMany({
      where: { departmentId: { in: departmentIds } },
    });
    await transaction.userAccount.deleteMany({
      where: { id: { in: clientBindings.map(({ userId }) => userId) } },
    });
  });
  await database.rightsHolder.deleteMany({
    where: { departmentId: { in: departmentIds } },
  });
  await database.customer.deleteMany({
    where: { departmentId: { in: departmentIds } },
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
  const resolvedOperatorPasswordHash = await operatorPasswordHash;
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
  await database.localCredential.create({
    data: {
      userId: coreLeadFixtures.userA,
      username: coreLeadFixtures.operatorUsername,
      passwordHash: resolvedOperatorPasswordHash,
    },
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
      {
        roleTemplateId: coreLeadFixtures.roleA,
        action: 'USER_MANAGE',
        scope: 'DEPARTMENT',
      },
      ...allActions.map((action) => ({
        roleTemplateId: coreLeadFixtures.roleB,
        action,
        scope: 'DEPARTMENT',
      })),
      {
        roleTemplateId: coreLeadFixtures.roleB,
        action: 'USER_MANAGE',
        scope: 'DEPARTMENT',
      },
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

export function countLeadPushReceipts(leadId) {
  return database.leadCommandReceipt.count({
    where: {
      departmentId: coreLeadFixtures.departmentA,
      resultLeadId: leadId,
      action: 'push',
    },
  });
}

export function countLeadPushAudits(leadId) {
  return database.auditEvent.count({
    where: {
      departmentId: coreLeadFixtures.departmentA,
      resourceType: 'lead',
      resourceId: leadId,
      action: 'lead.pushed',
    },
  });
}

export function getLeadReviewDecision(leadId) {
  return database.leadReviewDecision.findUnique({ where: { leadId } });
}

export function countLeadReviewDecisions(leadId) {
  return database.leadReviewDecision.count({ where: { leadId } });
}

export function countClientLeadReviewReceipts(leadId) {
  return database.clientLeadReviewReceipt.count({
    where: { resultLeadId: leadId },
  });
}

export function setClientBindingActive(customerId, active) {
  return database.customerAccountBinding.updateMany({
    where: { customerId },
    data: { active, version: { increment: 1 } },
  });
}

export async function setClientUserActive(customerId, active) {
  const binding = await database.customerAccountBinding.findFirstOrThrow({
    where: { customerId },
    select: { userId: true },
  });
  return database.userAccount.update({
    where: { id: binding.userId },
    data: { active, authorizationRevision: { increment: 1 } },
  });
}

export function setCustomerStatus(customerId, profileStatus) {
  return database.customer.update({
    where: { id: customerId },
    data: { profileStatus },
  });
}

export function setClientAccountActive(customerId, active) {
  return database.$transaction(async (transaction) => {
    const binding = await transaction.customerAccountBinding.findFirstOrThrow({
      where: { customerId },
      select: { id: true, userId: true },
    });
    await transaction.customerAccountBinding.update({
      where: { id: binding.id },
      data: { active, version: { increment: 1 } },
    });
    await transaction.userAccount.update({
      where: { id: binding.userId },
      data: { active, authorizationRevision: { increment: 1 } },
    });
    return binding;
  });
}

export function removeLeadProducts(leadId) {
  return database.leadProduct.deleteMany({ where: { leadId } });
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

export async function rejectLeadPushReceiptWrites() {
  await dropFaults();
  await database.$executeRawUnsafe(
    `ALTER TABLE "lead_command_receipts" ADD CONSTRAINT "core_ld_reject_push_receipt" CHECK ("action" <> 'push') NOT VALID`,
  );
}

export async function rejectLeadReviewDecisionWrites() {
  await dropFaults();
  await database.$executeRawUnsafe(
    'ALTER TABLE "lead_review_decisions" ADD CONSTRAINT "core_ld_reject_review_decision" CHECK (false) NOT VALID',
  );
}

export async function rejectClientLeadReviewReceiptWrites() {
  await dropFaults();
  await database.$executeRawUnsafe(
    'ALTER TABLE "client_lead_review_receipts" ADD CONSTRAINT "core_ld_reject_review_receipt" CHECK (false) NOT VALID',
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
  const clientActionTarget = '20260922009000_add_client_identity_actions';
  const clientSchemaTarget = '20260922010000_add_client_accounts_and_lead_push';
  const reviewActionTarget = '20260922011000_add_client_lead_review_action';
  const reviewSchemaTarget = '20260922012000_add_client_lead_review';
  const reviewIntegrityTarget =
    '20260922013000_harden_client_lead_review_integrity';
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
    clientActionRecovery: `core_ld_client_action_recovery_${probe}`,
    clientSchemaFailure: `core_ld_client_schema_failure_${probe}`,
    reviewIntegrity: `core_ld_review_integrity_${probe}`,
    reviewUpgrade: `core_ld_review_upgrade_${probe}`,
    reviewActionRecovery: `core_ld_review_action_recovery_${probe}`,
    reviewSchemaFailure: `core_ld_review_schema_failure_${probe}`,
    reviewIntegrityFailure: `core_ld_review_integrity_failure_${probe}`,
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

  async function probeReviewIntegrity() {
    const ids = Object.fromEntries(
      [
        'department',
        'operator',
        'reviewer',
        'otherReviewer',
        'customer',
        'otherCustomer',
        'holder',
        'binding',
        'otherBinding',
        'lead',
        'otherLead',
        'decision',
        'receipt',
      ].map((key) => [key, randomUUID()]),
    );
    const reject = async (sql, values) => {
      await client.query('SAVEPOINT review_probe');
      try {
        await client.query(sql, values);
        await client.query('ROLLBACK TO SAVEPOINT review_probe');
        return null;
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT review_probe');
        return error.code ?? null;
      } finally {
        await client.query('RELEASE SAVEPOINT review_probe');
      }
    };
    await client.query('BEGIN');
    try {
      await client.query(
        'INSERT INTO departments(id,name,updated_at) VALUES ($1,$2,NOW())',
        [ids.department, '审核约束部门'],
      );
      for (const [id, type] of [
        [ids.operator, 'INTERNAL'],
        [ids.reviewer, 'CLIENT'],
        [ids.otherReviewer, 'CLIENT'],
      ]) {
        await client.query(
          'INSERT INTO user_accounts(id,external_subject,display_name,account_type,updated_at) VALUES ($1,$2,$2,$3,NOW())',
          [id, `review-${id}`, type],
        );
      }
      await client.query(
        'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES ($1,$2,$3,NOW())',
        [randomUUID(), ids.operator, ids.department],
      );
      for (const id of [ids.customer, ids.otherCustomer]) {
        await client.query(
          'INSERT INTO customers(id,name,normalized_name,department_id,responsible_user_id,updated_at) VALUES ($1,$2,$2,$3,$4,NOW())',
          [id, `审核客户-${id}`, ids.department, ids.operator],
        );
      }
      await client.query(
        'INSERT INTO rights_holders(id,name,department_id,updated_at) VALUES ($1,$2,$3,NOW())',
        [ids.holder, '审核权利人', ids.department],
      );
      for (const [id, userId, customerId] of [
        [ids.binding, ids.reviewer, ids.customer],
        [ids.otherBinding, ids.otherReviewer, ids.otherCustomer],
      ]) {
        await client.query(
          'INSERT INTO customer_account_bindings(id,user_id,customer_id,department_id,updated_at) VALUES ($1,$2,$3,$4,NOW())',
          [id, userId, customerId, ids.department],
        );
      }
      for (const [id, customerId] of [
        [ids.lead, ids.customer],
        [ids.otherLead, ids.otherCustomer],
      ]) {
        await client.query(
          `INSERT INTO leads(id,department_id,business_no,customer_id,rights_holder_id,responsible_user_id,case_type,source,platform,found_at,shop_name,need_disclose,updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,'CIVIL','ONLINE','TAOBAO',NOW(),'审核测试店铺',false,NOW())`,
          [
            id,
            ids.department,
            `REVIEW-${id}`,
            customerId,
            ids.holder,
            ids.operator,
          ],
        );
      }
      const decisionSql = `INSERT INTO lead_review_decisions(id,department_id,lead_id,customer_id,reviewer_user_id,customer_account_binding_id,reviewer_display_name_snapshot,result,from_version,to_version)
        VALUES ($1,$2,$3,$4,$5,$6,'审核人','INFRINGEMENT',1,2)`;
      const decision = (overrides = {}) =>
        [
          ids.decision,
          ids.department,
          ids.lead,
          ids.customer,
          ids.reviewer,
          ids.binding,
        ].map((value, index) => overrides[index] ?? value);
      const wrongCustomer = await reject(
        decisionSql,
        decision({ 3: ids.otherCustomer }),
      );
      const wrongReviewer = await reject(
        decisionSql,
        decision({ 4: ids.otherReviewer }),
      );
      const wrongBindingCustomer = await reject(
        decisionSql,
        decision({ 5: ids.otherBinding, 4: ids.otherReviewer }),
      );
      const invalidVersionPair = await reject(
        decisionSql.replace('1,2)', '2,4)'),
        decision(),
      );
      await client.query(decisionSql, decision());
      const receiptSql = `INSERT INTO client_lead_review_receipts(id,department_id,actor_user_id,customer_account_binding_id,action,idempotency_key,request_fingerprint,result_lead_id,result_lead_version,review_decision_id,result_snapshot)
        VALUES ($1,$2,$3,$4,'client.lead.review',$5,$6,$7,$8,$9,'{}'::jsonb)`;
      const receipt = (overrides = {}) =>
        [
          ids.receipt,
          ids.department,
          ids.reviewer,
          ids.binding,
          randomUUID(),
          'a'.repeat(64),
          ids.lead,
          2,
          ids.decision,
        ].map((value, index) => overrides[index] ?? value);
      const wrongActor = await reject(
        receiptSql,
        receipt({ 2: ids.otherReviewer }),
      );
      const wrongReceiptBinding = await reject(
        receiptSql,
        receipt({ 3: ids.otherBinding }),
      );
      const wrongLead = await reject(receiptSql, receipt({ 6: ids.otherLead }));
      const wrongVersion = await reject(receiptSql, receipt({ 7: 3 }));
      const nonReviewAction = await reject(
        receiptSql.replace("'client.lead.review'", "'lead.push'"),
        receipt(),
      );
      await client.query(receiptSql, receipt());
      const decisionUpdate = await reject(
        'UPDATE lead_review_decisions SET to_version=3 WHERE id=$1',
        [ids.decision],
      );
      const decisionDelete = await reject(
        'DELETE FROM lead_review_decisions WHERE id=$1',
        [ids.decision],
      );
      const receiptUpdate = await reject(
        'UPDATE client_lead_review_receipts SET result_lead_version=3 WHERE id=$1',
        [ids.receipt],
      );
      const receiptDelete = await reject(
        'DELETE FROM client_lead_review_receipts WHERE id=$1',
        [ids.receipt],
      );
      const leadIdentityUpdate = await reject(
        'UPDATE leads SET customer_id=$1 WHERE id=$2',
        [ids.otherCustomer, ids.lead],
      );
      const bindingIdentityUpdate = await reject(
        'UPDATE customer_account_bindings SET customer_id=$1 WHERE id=$2',
        [ids.otherCustomer, ids.binding],
      );
      return {
        wrongCustomer,
        wrongReviewer,
        wrongBindingCustomer,
        wrongActor,
        wrongReceiptBinding,
        wrongLead,
        wrongVersion,
        invalidVersionPair,
        nonReviewAction,
        decisionUpdate,
        decisionDelete,
        receiptUpdate,
        receiptDelete,
        leadIdentityUpdate,
        bindingIdentityUpdate,
      };
    } finally {
      await client.query('ROLLBACK');
    }
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
    await useSchema(schemas.reviewIntegrity);
    await apply(migrations);
    const reviewIntegrity = await probeReviewIntegrity();
    await useSchema(schemas.empty);
    const emptyTables = (
      await client.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema=$1 AND table_name IN (
           'upload_drafts','materials','customer_admission_receipts',
           'leads','lead_number_counters','lead_command_receipts',
           'customer_account_bindings','lead_review_decisions',
           'client_lead_review_receipts'
         ) ORDER BY table_name`,
        [schemas.empty],
      )
    ).rows.map(({ table_name: tableName }) => tableName);

    await useSchema(schemas.reviewUpgrade);
    await apply(migrations.filter((name) => name <= reviewSchemaTarget));
    const reviewIds = Object.fromEntries(
      [
        'department',
        'operator',
        'reviewer',
        'customer',
        'holder',
        'binding',
        'lead',
        'decision',
        'receipt',
      ].map((key) => [key, randomUUID()]),
    );
    const admittedAt = '2026-09-21T09:00:00.000Z';
    const pushedAt = '2026-09-22T09:00:00.000Z';
    const reviewDecisionAt = '2026-09-22T12:34:56.000Z';
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO departments(id,name,updated_at) VALUES ($1,$2,NOW())',
      [reviewIds.department, '升级审核部门'],
    );
    for (const [id, type] of [
      [reviewIds.operator, 'INTERNAL'],
      [reviewIds.reviewer, 'CLIENT'],
    ]) {
      await client.query(
        'INSERT INTO user_accounts(id,external_subject,display_name,account_type,updated_at) VALUES ($1,$2,$2,$3,NOW())',
        [id, `upgrade-${id}`, type],
      );
    }
    await client.query(
      'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES ($1,$2,$3,NOW())',
      [randomUUID(), reviewIds.operator, reviewIds.department],
    );
    await client.query(
      'INSERT INTO customers(id,name,normalized_name,department_id,responsible_user_id,updated_at) VALUES ($1,$2,$2,$3,$4,NOW())',
      [
        reviewIds.customer,
        '升级审核客户',
        reviewIds.department,
        reviewIds.operator,
      ],
    );
    await client.query(
      `UPDATE customers SET profile_status='ADMITTED',customer_type='ENTERPRISE',
         identity_type='BUSINESS_LICENSE',identity_number='UPGRADE-REVIEW-LICENSE',
         normalized_identity_number='UPGRADE-REVIEW-LICENSE',
         admission_contact_name='升级审核联系人',admission_contact_phone='13800000000',
         identity_validity_mode='LONG_TERM',admitted_at=$2
       WHERE id=$1`,
      [reviewIds.customer, admittedAt],
    );
    await client.query(
      'INSERT INTO rights_holders(id,name,department_id,updated_at) VALUES ($1,$2,$3,NOW())',
      [reviewIds.holder, '升级审核权利人', reviewIds.department],
    );
    await client.query(
      'INSERT INTO customer_account_bindings(id,user_id,customer_id,department_id,updated_at) VALUES ($1,$2,$3,$4,NOW())',
      [
        reviewIds.binding,
        reviewIds.reviewer,
        reviewIds.customer,
        reviewIds.department,
      ],
    );
    await client.query('COMMIT');
    await client.query(
      `INSERT INTO leads(id,department_id,business_no,customer_id,rights_holder_id,responsible_user_id,status,version,case_type,source,platform,found_at,shop_name,need_disclose,pushed_at,pushed_by_user_id,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'WAITING_EVIDENCE_DECISION',2,'CIVIL','ONLINE','TAOBAO',NOW(),'升级审核店铺',false,$7,$6,NOW())`,
      [
        reviewIds.lead,
        reviewIds.department,
        `REVIEW-UPGRADE-${probe}`,
        reviewIds.customer,
        reviewIds.holder,
        reviewIds.operator,
        pushedAt,
      ],
    );
    const reviewBusinessNo = `REVIEW-UPGRADE-${probe}`;
    await client.query(
      `INSERT INTO lead_review_decisions(id,department_id,lead_id,customer_id,reviewer_user_id,customer_account_binding_id,reviewer_display_name_snapshot,result,from_version,to_version,decided_at)
       VALUES ($1,$2,$3,$4,$5,$6,'升级前审核人','INFRINGEMENT',1,2,$7)`,
      [
        reviewIds.decision,
        reviewIds.department,
        reviewIds.lead,
        reviewIds.customer,
        reviewIds.reviewer,
        reviewIds.binding,
        reviewDecisionAt,
      ],
    );
    const reviewResultSnapshot = {
      id: reviewIds.lead,
      businessNo: reviewBusinessNo,
      status: 'WAITING_EVIDENCE_DECISION',
      version: 2,
      reviewDecision: {
        result: 'INFRINGEMENT',
        reviewerDisplayName: '升级前审核人',
        decidedAt: reviewDecisionAt,
      },
    };
    await client.query(
      `INSERT INTO client_lead_review_receipts(id,department_id,actor_user_id,customer_account_binding_id,action,idempotency_key,request_fingerprint,result_lead_id,result_lead_version,review_decision_id,result_snapshot)
       VALUES ($1,$2,$3,$4,'client.lead.review','upgrade-key',$5,$6,2,$7,$8::jsonb)`,
      [
        reviewIds.receipt,
        reviewIds.department,
        reviewIds.reviewer,
        reviewIds.binding,
        createHash('sha256')
          .update(
            JSON.stringify({
              leadId: reviewIds.lead,
              result: 'INFRINGEMENT',
              expectedVersion: 1,
            }),
          )
          .digest('hex'),
        reviewIds.lead,
        reviewIds.decision,
        JSON.stringify(reviewResultSnapshot),
      ],
    );
    const reviewFactsBefore = (
      await client.query(
        `SELECT l.business_no,l.status AS lead_status,l.version AS lead_version,
                c.admitted_at,
                l.pushed_at,l.pushed_by_user_id,
                d.id AS decision_id,d.lead_id,d.customer_id,d.reviewer_user_id,d.customer_account_binding_id,
                d.reviewer_display_name_snapshot,d.result,d.decided_at,d.from_version,d.to_version,
                r.id AS receipt_id,r.actor_user_id,r.idempotency_key,r.request_fingerprint,
                r.result_lead_id,r.result_lead_version,r.review_decision_id,r.result_snapshot,r.created_at
         FROM lead_review_decisions d
         JOIN client_lead_review_receipts r ON r.review_decision_id=d.id
         JOIN leads l ON l.id=d.lead_id
         JOIN customers c ON c.id=l.customer_id
         WHERE d.id=$1`,
        [reviewIds.decision],
      )
    ).rows[0];
    await apply([reviewIntegrityTarget]);
    const reviewFactsAfter = (
      await client.query(
        `SELECT l.business_no,l.status AS lead_status,l.version AS lead_version,
                c.admitted_at,
                l.pushed_at,l.pushed_by_user_id,
                d.id AS decision_id,d.lead_id,d.customer_id,d.reviewer_user_id,d.customer_account_binding_id,
                d.reviewer_display_name_snapshot,d.result,d.decided_at,d.from_version,d.to_version,
                r.id AS receipt_id,r.actor_user_id,r.idempotency_key,r.request_fingerprint,
                r.result_lead_id,r.result_lead_version,r.review_decision_id,r.result_snapshot,r.created_at
         FROM lead_review_decisions d
         JOIN client_lead_review_receipts r ON r.review_decision_id=d.id
         JOIN leads l ON l.id=d.lead_id
         JOIN customers c ON c.id=l.customer_id
         WHERE d.id=$1`,
        [reviewIds.decision],
      )
    ).rows[0];
    const reviewUpgrade = {
      rowsPreserved:
        JSON.stringify(reviewFactsAfter) === JSON.stringify(reviewFactsBefore),
      leadFactsPreserved:
        reviewFactsBefore.lead_status === 'WAITING_EVIDENCE_DECISION' &&
        reviewFactsBefore.lead_version === 2 &&
        reviewFactsBefore.pushed_at !== null &&
        reviewFactsBefore.pushed_by_user_id === reviewIds.operator &&
        reviewFactsAfter.lead_status === reviewFactsBefore.lead_status &&
        reviewFactsAfter.lead_version === reviewFactsBefore.lead_version &&
        reviewFactsAfter.pushed_at?.getTime() ===
          reviewFactsBefore.pushed_at?.getTime() &&
        reviewFactsAfter.pushed_by_user_id ===
          reviewFactsBefore.pushed_by_user_id,
      receiptReplayable: (() => {
        const snapshot = reviewFactsAfter.result_snapshot;
        const decision = snapshot?.reviewDecision;
        const expectedFingerprint = createHash('sha256')
          .update(
            JSON.stringify({
              leadId: reviewIds.lead,
              result: 'INFRINGEMENT',
              expectedVersion: 1,
            }),
          )
          .digest('hex');
        return (
          reviewFactsAfter.request_fingerprint === expectedFingerprint &&
          reviewFactsAfter.admitted_at < reviewFactsAfter.pushed_at &&
          reviewFactsAfter.pushed_at < reviewFactsAfter.decided_at &&
          Object.keys(snapshot ?? {}).length === 5 &&
          snapshot.id === reviewIds.lead &&
          snapshot.businessNo === reviewFactsAfter.business_no &&
          snapshot.status === 'WAITING_EVIDENCE_DECISION' &&
          snapshot.version === 2 &&
          decision?.result === 'INFRINGEMENT' &&
          decision.reviewerDisplayName ===
            reviewFactsAfter.reviewer_display_name_snapshot &&
          decision.decidedAt === reviewFactsAfter.decided_at.toISOString() &&
          reviewFactsAfter.result_lead_id === reviewIds.lead &&
          reviewFactsAfter.result_lead_version === snapshot.version
        );
      })(),
      decisionCount: Number(
        (await client.query('SELECT COUNT(*) FROM lead_review_decisions'))
          .rows[0].count,
      ),
      receiptCount: Number(
        (await client.query('SELECT COUNT(*) FROM client_lead_review_receipts'))
          .rows[0].count,
      ),
    };

    await useSchema(schemas.reviewActionRecovery);
    await apply(migrations.filter((name) => name < reviewActionTarget));
    await apply([reviewActionTarget, reviewActionTarget]);
    const reviewActionRecovery = {
      actionCount: Number(
        (
          await client.query(
            `SELECT COUNT(*) FROM pg_enum e
             JOIN pg_type t ON t.oid=e.enumtypid
             JOIN pg_namespace n ON n.oid=t.typnamespace
             WHERE n.nspname=$1 AND t.typname='permission_action'
               AND e.enumlabel='client.lead.review'`,
            [schemas.reviewActionRecovery],
          )
        ).rows[0].count,
      ),
    };

    await useSchema(schemas.reviewSchemaFailure);
    await apply(migrations.filter((name) => name < reviewSchemaTarget));
    await client.query('CREATE TABLE lead_review_decisions(id UUID)');
    const reviewSchemaFailureCode = await rejectedCode(
      await migrationSql(reviewSchemaTarget),
    );
    const reviewSchemaFailure = {
      code: reviewSchemaFailureCode,
      originalDecisionColumns: Number(
        (
          await client.query(
            `SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=$1 AND table_name='lead_review_decisions'`,
            [schemas.reviewSchemaFailure],
          )
        ).rows[0].count,
      ),
      receiptTables: Number(
        (
          await client.query(
            `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=$1 AND table_name='client_lead_review_receipts'`,
            [schemas.reviewSchemaFailure],
          )
        ).rows[0].count,
      ),
      mutationTriggers: Number(
        (
          await client.query(
            `SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema=$1 AND trigger_name='reject_lead_review_decision_mutation'`,
            [schemas.reviewSchemaFailure],
          )
        ).rows[0].count,
      ),
      reviewEnumTypes: Number(
        (
          await client.query(
            `SELECT COUNT(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=$1 AND t.typname='lead_review_result'`,
            [schemas.reviewSchemaFailure],
          )
        ).rows[0].count,
      ),
    };

    await useSchema(schemas.reviewIntegrityFailure);
    await apply(migrations.filter((name) => name < reviewIntegrityTarget));
    await client.query(
      `CREATE FUNCTION reject_client_lead_review_receipt_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$`,
    );
    const reviewIntegrityFailureCode = await rejectedCode(
      await migrationSql(reviewIntegrityTarget),
    );
    const reviewIntegrityFailure = {
      code: reviewIntegrityFailureCode,
      addedConstraints: Number(
        (
          await client.query(
            `SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema=$1 AND constraint_name IN ('leads_review_identity_key','customer_account_bindings_review_identity_key','lead_review_decisions_lead_identity_key','lead_review_decisions_receipt_identity_key','lead_review_decisions_lead_customer_department_fkey','lead_review_decisions_binding_reviewer_customer_department_fkey','client_lead_review_receipts_decision_identity_key','client_lead_review_receipts_decision_identity_fkey')`,
            [schemas.reviewIntegrityFailure],
          )
        ).rows[0].count,
      ),
      receiptTriggers: Number(
        (
          await client.query(
            `SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema=$1 AND trigger_name='reject_client_lead_review_receipt_mutation'`,
            [schemas.reviewIntegrityFailure],
          )
        ).rows[0].count,
      ),
    };

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
    const pushGrantCounts = {};
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
      pushGrantCounts[name] = Number(
        (
          await client.query(
            `SELECT COUNT(*) FROM role_grants
             WHERE role_template_id=$1 AND action='lead.push'`,
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

    const clientUserId = randomUUID();
    const clientBindingId = randomUUID();
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO user_accounts(
         id,external_subject,display_name,account_type,updated_at
       ) VALUES ($1,$2,$3,'CLIENT',NOW())`,
      [clientUserId, `local:${clientUserId}`, '迁移客户账号'],
    );
    await client.query(
      `INSERT INTO customer_account_bindings(
         id,user_id,customer_id,department_id,updated_at
       ) VALUES ($1,$2,$3,$4,NOW())`,
      [
        clientBindingId,
        clientUserId,
        upgradeIds.knownCustomer,
        upgradeIds.bootstrapDepartment,
      ],
    );
    await client.query('COMMIT');

    async function rejectedCode(sql, params = []) {
      try {
        await client.query(sql, params);
        return null;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        return error.code ?? null;
      }
    }

    const unboundClientCode = await rejectedCode(
      `INSERT INTO user_accounts(
         id,external_subject,display_name,account_type,updated_at
       ) VALUES ($1,$2,$3,'CLIENT',NOW())`,
      [randomUUID(), `local:${randomUUID()}`, '无绑定客户账号'],
    );
    const clientMembershipCode = await rejectedCode(
      `INSERT INTO department_memberships(
         id,user_id,department_id,updated_at
       ) VALUES ($1,$2,$3,NOW())`,
      [randomUUID(), clientUserId, upgradeIds.bootstrapDepartment],
    );
    const clientRoleCode = await rejectedCode(
      `INSERT INTO role_assignments(
         id,user_id,department_id,role_template_id,updated_at
       ) VALUES ($1,$2,$3,$4,NOW())`,
      [
        randomUUID(),
        clientUserId,
        upgradeIds.bootstrapDepartment,
        upgradeIds.bootstrapRole,
      ],
    );
    const internalBindingCode = await rejectedCode(
      `INSERT INTO customer_account_bindings(
         id,user_id,customer_id,department_id,updated_at
       ) VALUES ($1,$2,$3,$4,NOW())`,
      [
        randomUUID(),
        upgradeIds.bootstrapUser,
        upgradeIds.knownCustomer,
        upgradeIds.bootstrapDepartment,
      ],
    );
    const lastBindingDeleteCode = await rejectedCode(
      'DELETE FROM customer_account_bindings WHERE id=$1',
      [clientBindingId],
    );

    const constraintHolderId = randomUUID();
    const constraintLeadId = randomUUID();
    await client.query(
      `INSERT INTO rights_holders(id,name,department_id,updated_at)
       VALUES ($1,$2,$3,NOW())`,
      [constraintHolderId, '迁移约束权利人', upgradeIds.bootstrapDepartment],
    );
    await client.query(
      `INSERT INTO leads(
         id,department_id,business_no,customer_id,rights_holder_id,
         responsible_user_id,case_type,source,platform,found_at,
         shop_name,need_disclose,updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,'CIVIL','ONLINE','TAOBAO',NOW(),$7,false,NOW()
       )`,
      [
        constraintLeadId,
        upgradeIds.bootstrapDepartment,
        `LD-MIGRATION-${probe}`,
        upgradeIds.knownCustomer,
        constraintHolderId,
        upgradeIds.bootstrapUser,
        '迁移约束店铺',
      ],
    );
    const pushedAtOnlyCode = await rejectedCode(
      'UPDATE leads SET pushed_at=NOW() WHERE id=$1',
      [constraintLeadId],
    );
    const pushedByOnlyCode = await rejectedCode(
      'UPDATE leads SET pushed_by_user_id=$2 WHERE id=$1',
      [constraintLeadId, upgradeIds.bootstrapUser],
    );

    await useSchema(schemas.clientActionRecovery);
    await apply(migrations.filter((name) => name < clientActionTarget));
    await apply([clientActionTarget, clientActionTarget]);
    const clientActionRecovery = {
      pushActionCount: Number(
        (
          await client.query(
            `SELECT COUNT(*) FROM pg_enum e
             JOIN pg_type t ON t.oid=e.enumtypid
             JOIN pg_namespace n ON n.oid=t.typnamespace
             WHERE n.nspname=$1 AND t.typname='permission_action'
               AND e.enumlabel IN ('lead.push','client.lead.read')`,
            [schemas.clientActionRecovery],
          )
        ).rows[0].count,
      ),
      accountTypeExists: Boolean(
        (
          await client.query(
            `SELECT 1 FROM pg_type t
             JOIN pg_namespace n ON n.oid=t.typnamespace
             WHERE n.nspname=$1 AND t.typname='user_account_type'`,
            [schemas.clientActionRecovery],
          )
        ).rowCount,
      ),
    };

    await useSchema(schemas.clientSchemaFailure);
    await apply(migrations.filter((name) => name < clientActionTarget));
    await apply([clientActionTarget]);
    await client.query('CREATE TABLE customer_account_bindings(id UUID)');
    const clientSchemaFailureCode = await rejectedCode(
      await migrationSql(clientSchemaTarget),
    );
    const clientSchemaFailureColumns = Number(
      (
        await client.query(
          `SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema=$1 AND (
             (table_name='user_accounts' AND column_name='account_type')
             OR (table_name='leads' AND column_name IN ('pushed_at','pushed_by_user_id'))
           )`,
          [schemas.clientSchemaFailure],
        )
      ).rows[0].count,
    );

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
      reviewIntegrity,
      reviewUpgrade,
      reviewActionRecovery,
      reviewSchemaFailure,
      reviewIntegrityFailure,
      upgrade: {
        known,
        unknown,
        invalidAdmittedCode,
        compatibleAdmittedStatus,
        grantCounts,
        pushGrantCounts,
        revisions,
        identityIsolation: {
          unboundClientCode,
          clientMembershipCode,
          clientRoleCode,
          internalBindingCode,
          lastBindingDeleteCode,
          pushedAtOnlyCode,
          pushedByOnlyCode,
        },
      },
      clientActionRecovery,
      clientSchemaFailure: {
        code: clientSchemaFailureCode,
        addedColumns: clientSchemaFailureColumns,
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
