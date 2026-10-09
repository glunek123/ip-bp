import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';

if (process.env.NODE_ENV !== 'test')
  throw new Error('CU008 fixture requires isolated test environment');
validateIsolatedTestDatabaseUrl(process.env.DATABASE_URL, {
  allowRandomPort: true,
});
const backend = createRequire(resolve(process.cwd(), 'backend/package.json'));
const { PrismaClient } = backend('./dist/generated/prisma/client.js');
const { PrismaPg } = backend('@prisma/adapter-pg');
const database = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 2 }),
});
const actions = [
  'CUSTOMER_SETTLEMENT_READ',
  'CUSTOMER_SETTLEMENT_REGISTER',
  'CUSTOMER_SETTLEMENT_CORRECT',
];

export async function setCustomerSettlementGrant(
  roleTemplateId,
  action,
  enabled,
  scope = 'TEAM',
) {
  if (
    !actions.includes(action) ||
    !['SELF', 'TEAM', 'DEPARTMENT'].includes(scope)
  )
    throw new Error('Invalid CU008 grant fixture');
  if (enabled)
    await database.roleGrant.upsert({
      where: { roleTemplateId_action_scope: { roleTemplateId, action, scope } },
      update: {},
      create: { roleTemplateId, action, scope },
    });
  else
    await database.roleGrant.deleteMany({ where: { roleTemplateId, action } });
}

export async function getCustomerSettlementState(customerId) {
  const customer = await database.customer.findUnique({
    where: { id: customerId },
    select: { version: true },
  });
  const records = await database.customerSettlementRecord.findMany({
    where: { customerId },
    include: { versions: true, receipts: true },
  });
  const audits = await database.auditEvent.findMany({
    where: {
      resourceType: 'customer_settlement',
      resourceId: { in: records.map((row) => row.id) },
    },
    select: { id: true, action: true },
  });
  return { customerVersion: customer?.version, records, audits };
}

export async function disconnectCustomerSettlementDatabase() {
  await database.$disconnect();
}

export async function rejectCustomerSettlementAudit() {
  await allowCustomerSettlementAudit();
  await database.$executeRawUnsafe(
    "ALTER TABLE audit_events ADD CONSTRAINT e2e_reject_customer_settlement_audit CHECK (action <> 'customer.settlement.register') NOT VALID",
  );
}
export async function allowCustomerSettlementAudit() {
  await database.$executeRawUnsafe(
    'ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS e2e_reject_customer_settlement_audit',
  );
}

export async function cleanupCustomerSettlementExternalActors(departmentId) {
  const clients = await database.customerAccountBinding.findMany({
    where: { departmentId, user: { displayName: '结算外部客户' } },
    include: { user: { include: { localCredential: true } } },
  });
  const lawyers = await database.lawyerAccountBinding.findMany({
    where: { departmentId },
    include: { user: { include: { localCredential: true } }, profile: true },
  });
  if (
    clients.some(
      ({ user }) => !user.localCredential?.username.startsWith('client-'),
    ) ||
    lawyers.some(
      ({ user, profile }) =>
        !user.localCredential?.username.startsWith('lawyer-') ||
        profile.fullName !== '承办律师',
    )
  )
    throw new Error('Unexpected actor in CU008 external cleanup scope');
  const userIds = [...clients, ...lawyers].map(({ userId }) => userId);
  if (userIds.length === 0) return;
  await database.$transaction(async (transaction) => {
    await transaction.authSession.deleteMany({
      where: { userId: { in: userIds } },
    });
    await transaction.localCredential.deleteMany({
      where: { userId: { in: userIds } },
    });
    await transaction.customerAccountBinding.deleteMany({
      where: { id: { in: clients.map(({ id }) => id) } },
    });
    await transaction.lawyerAccountBinding.deleteMany({
      where: { id: { in: lawyers.map(({ id }) => id) } },
    });
    await transaction.lawyerProfile.deleteMany({
      where: { id: { in: lawyers.map(({ profileId }) => profileId) } },
    });
    await transaction.userAccount.deleteMany({
      where: { id: { in: userIds } },
    });
  });
}
