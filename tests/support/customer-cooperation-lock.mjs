import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { captureTestEnvironment } from '../../scripts/test-environment.mjs';
import { acquireE2eResourceLock } from '../../scripts/run-e2e.mjs';

const root = resolve(import.meta.dirname, '../..');
const testEnvironment = captureTestEnvironment(root, {
  pnpmVersion: '11.27.0',
});
Object.assign(process.env, testEnvironment.childEnvironment);
const requireBackend = createRequire(resolve(root, 'backend/package.json'));
const { PrismaClient } = requireBackend('./dist/generated/prisma/client.js');
const { PrismaPg } = requireBackend('@prisma/adapter-pg');
const { AccessControlService } = requireBackend(
  './dist/access-control/access-control.service.js',
);
const { PrismaAccessControlStore } = requireBackend(
  './dist/access-control/prisma-access-control.store.js',
);
const { OrganizationService } = requireBackend(
  './dist/access-control/organization.service.js',
);
const { CustomerService } = requireBackend(
  './dist/modules/customers/customer.service.js',
);
const { CustomerCooperationService } = requireBackend(
  './dist/modules/customers/customer-cooperation.service.js',
);

export async function verifyCustomerCooperationCrossDepartmentLock() {
  const lock = acquireE2eResourceLock();
  const database = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DATABASE_URL,
      max: 4,
    }),
  });
  let blocker;
  let fixtures;
  try {
    fixtures = await import('./customer-database.mjs');
    const actual = await database.$queryRaw`SELECT current_database() AS name`;
    assert.equal(actual[0]?.name, 'dev_cor_test');
    await fixtures.resetCustomerE2eData();
    await fixtures.grantCustomerCooperation(fixtures.e2eFixtures.roleA);
    const account = await database.userAccount.findUniqueOrThrow({
      where: { id: fixtures.e2eFixtures.userA },
      select: { authorizationRevision: true },
    });
    const actor = {
      userId: fixtures.e2eFixtures.userA,
      departmentId: fixtures.e2eFixtures.departmentA,
      authorizationRevision: account.authorizationRevision,
    };
    const access = new AccessControlService(
      new PrismaAccessControlStore(database),
    );
    const organization = new OrganizationService(database);
    const customers = new CustomerService(database, access);
    const cooperation = new CustomerCooperationService(
      database,
      access,
      organization,
    );
    const customer = await customers.createDraft(actor, {
      name: `跨部门锁探针-${randomUUID()}`,
    });
    const requestKey = randomUUID();
    const command = {
      expectedVersion: customer.version,
      targetUserId: fixtures.e2eFixtures.userSelf,
      reason: '跨部门锁重试',
    };
    const baseline = await fixtures.getCustomerMaintenanceState(customer.id);
    blocker = await fixtures.beginForeignCustomerAccountBlocker(actor.userId);
    await assert.rejects(
      cooperation.transferResponsible(actor, customer.id, requestKey, command),
      (error) =>
        error.getResponse?.().code === 'CUSTOMER_MAINTENANCE_BUSY' &&
        error.getStatus?.() === 409,
    );
    assert.deepEqual(
      await fixtures.getCustomerMaintenanceState(customer.id),
      baseline,
    );
    await blocker.rollback();
    blocker = undefined;
    const committed = await cooperation.transferResponsible(
      actor,
      customer.id,
      requestKey,
      command,
    );
    assert.equal(committed.resultVersion, customer.version + 1);
    assert.equal(committed.canReadAfter, true);
    assert.deepEqual(
      (({ facts, receipts, audits }) => ({ facts, receipts, audits }))(
        await fixtures.getCustomerMaintenanceState(customer.id),
      ),
      { facts: 1, receipts: 1, audits: 1 },
    );
    console.log(
      'Cross-department NOWAIT 409 rollback and same-key recovery passed',
    );
  } finally {
    await blocker?.rollback();
    await fixtures?.disconnectCustomerTestDatabase();
    await database.$disconnect();
    lock.release();
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  verifyCustomerCooperationCrossDepartmentLock().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Lock probe failed');
    process.exitCode = 1;
  });
}
