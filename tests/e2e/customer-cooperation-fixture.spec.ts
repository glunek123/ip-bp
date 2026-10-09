import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
  disconnectCustomerTestDatabase,
  e2eFixtures,
  getCustomerMaintenanceCounts,
  getCustomerMaintenanceGuardState,
  grantCustomerCooperation,
  resetCustomerE2eData,
} from '../support/customer-database.mjs';
import {
  coreLeadFixtures,
  resetCoreLeadE2eData,
} from '../support/core-lead-database.mjs';

const auth = { Authorization: `Bearer ${e2eFixtures.tokenA}` };

test.afterAll(async () => disconnectCustomerTestDatabase());

test('customer and core-lead fixture resets remove committed maintenance evidence', async ({
  request,
}) => {
  await resetCustomerE2eData();
  await grantCustomerCooperation(e2eFixtures.roleA);
  const created = await request.post('/api/v1/customers', {
    headers: auth,
    data: { name: 'CU005 fixture customer' },
  });
  expect(created.status(), await created.text()).toBe(201);
  const draft: { id: string; version: number } = await created.json();
  const paused = await request.post(
    `/api/v1/customers/${draft.id}/cooperation`,
    {
      headers: { ...auth, 'Idempotency-Key': randomUUID() },
      data: {
        expectedVersion: draft.version,
        action: 'pause',
        reason: '验证清理顺序',
      },
    },
  );
  expect(paused.status(), await paused.text()).toBe(201);
  expect(await getCustomerMaintenanceCounts(draft.id)).toEqual({
    facts: 1,
    receipts: 1,
  });

  await resetCustomerE2eData();
  expect(await getCustomerMaintenanceCounts(draft.id)).toEqual({
    facts: 0,
    receipts: 0,
  });
  expect(await getCustomerMaintenanceGuardState()).toEqual({
    customer_maintenance_fact_immutable: 'O',
    customer_maintenance_receipt_immutable: 'O',
  });

  await resetCoreLeadE2eData();
  await grantCustomerCooperation(coreLeadFixtures.roleA);
  const existing = await request.get(
    `/api/v1/customers/${coreLeadFixtures.admittedCustomer}`,
    {
      headers: auth,
    },
  );
  expect(existing.status(), await existing.text()).toBe(200);
  const customer: { version: number } = await existing.json();
  const corePaused = await request.post(
    `/api/v1/customers/${coreLeadFixtures.admittedCustomer}/cooperation`,
    {
      headers: { ...auth, 'Idempotency-Key': randomUUID() },
      data: {
        expectedVersion: customer.version,
        action: 'pause',
        reason: '验证核心线索清理顺序',
      },
    },
  );
  expect(corePaused.status(), await corePaused.text()).toBe(201);
  expect(
    await getCustomerMaintenanceCounts(coreLeadFixtures.admittedCustomer),
  ).toEqual({ facts: 1, receipts: 1 });

  await resetCoreLeadE2eData();
  expect(
    await getCustomerMaintenanceCounts(coreLeadFixtures.admittedCustomer),
  ).toEqual({ facts: 0, receipts: 0 });
  expect(await getCustomerMaintenanceGuardState()).toEqual({
    customer_maintenance_fact_immutable: 'O',
    customer_maintenance_receipt_immutable: 'O',
  });
});
