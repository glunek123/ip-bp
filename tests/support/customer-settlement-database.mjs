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
const { Client } = backend('pg');
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
    select: { version: true, deletedAt: true },
  });
  const records = await database.customerSettlementRecord.findMany({
    where: { customerId },
    include: { versions: true, receipts: true },
  });
  const [versionCount, receiptCount] = await Promise.all([
    database.customerSettlementVersion.count({ where: { customerId } }),
    database.customerSettlementReceipt.count({ where: { customerId } }),
  ]);
  const audits = await database.auditEvent.findMany({
    where: {
      resourceType: 'customer_settlement',
      resourceId: { in: records.map((row) => row.id) },
    },
    select: { id: true, action: true },
  });
  return {
    customerVersion: customer?.version,
    customerDeletedAt: customer?.deletedAt,
    records,
    versionCount,
    receiptCount,
    audits,
  };
}

async function waitForCustomerLockQueue(client, count, blockerPid, firstPid) {
  const deadline = Date.now() + 5000;
  let lastActive = [];
  while (Date.now() < deadline) {
    const result = await client.query(
      `SELECT pid, pg_blocking_pids(pid) AS blockers
       FROM pg_stat_activity
       WHERE datname = current_database()
         AND pid <> pg_backend_pid()
         AND wait_event_type = 'Lock'
       ORDER BY pid`,
    );
    const queued = result.rows.filter(
      (row) =>
        row.blockers.includes(blockerPid) ||
        (firstPid !== undefined && row.blockers.includes(firstPid)),
    );
    if (queued.length >= count) return queued;
    lastActive = (
      await client.query(
        `SELECT pid, wait_event_type, wait_event,
                pg_blocking_pids(pid) AS blockers
         FROM pg_stat_activity
         WHERE datname = current_database() AND pid <> pg_backend_pid()`,
      )
    ).rows;
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  throw new Error(
    `Expected ${count} customer row lock waiters: ${JSON.stringify(lastActive)}`,
  );
}

export async function exerciseCustomerSettlementDeletionRace(
  customerId,
  issueFirst,
  issueSecond,
) {
  const blocker = new Client({ connectionString: process.env.DATABASE_URL });
  let firstPromise;
  let secondPromise;
  let transactionOpen = false;
  try {
    await blocker.connect();
    await blocker.query('BEGIN');
    transactionOpen = true;
    const pid = Number(
      (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,
    );
    await blocker.query(
      'SELECT id FROM customers WHERE id=$1::uuid FOR UPDATE',
      [customerId],
    );
    firstPromise = issueFirst();
    const firstWaiters = await waitForCustomerLockQueue(blocker, 1, pid);
    if (!firstWaiters[0].blockers.includes(pid))
      throw new Error('First request is not blocked by fixture row lock');
    const firstPid = firstWaiters[0].pid;
    secondPromise = issueSecond();
    const queued = await waitForCustomerLockQueue(blocker, 2, pid, firstPid);
    if (!queued.some((row) => row.pid === firstPid))
      throw new Error('First request left the customer row lock queue');
    if (
      !queued.some(
        (row) =>
          row.pid !== firstPid &&
          (row.blockers.includes(pid) || row.blockers.includes(firstPid)),
      )
    )
      throw new Error('Second request did not queue behind customer row lock');
    await blocker.query('COMMIT');
    transactionOpen = false;
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    return { first, second, firstQueued: true, secondQueued: true };
  } finally {
    if (transactionOpen) await blocker.query('ROLLBACK').catch(() => undefined);
    await Promise.allSettled(
      [firstPromise, secondPromise].filter((promise) => promise !== undefined),
    );
    await blocker.end().catch(() => undefined);
  }
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
