import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
  countCustomers,
  disconnectCustomerTestDatabase,
  e2eFixtures,
  grantCustomerCooperation,
  resetCustomerE2eData,
  setCustomerDocumentGrant,
} from '../support/customer-database.mjs';

const auth = { Authorization: `Bearer ${e2eFixtures.tokenA}` };
const foreign = { Authorization: `Bearer ${e2eFixtures.tokenB}` };
const count = (name: string) => countCustomers(e2eFixtures.departmentA, name);

async function grantAgreement(roleId = e2eFixtures.roleA) {
  await setCustomerDocumentGrant(
    roleId,
    'CUSTOMER_AGREEMENT_READ',
    true,
    'DEPARTMENT',
  );
  await setCustomerDocumentGrant(
    roleId,
    'CUSTOMER_AGREEMENT_EDIT',
    true,
    'DEPARTMENT',
  );
}
function input(name = `首版建档 ${randomUUID()}`) {
  return {
    name,
    customerType: 'ENTERPRISE',
    identityType: 'BUSINESS_LICENSE',
    identityNumber: '91330100MA2ABC1234X',
    category: '家居日用',
    region: '华东',
    customerManagerName: '合成经理',
    responsibleUserId: e2eFixtures.userSelf,
    initialAgreement: {
      title: '合作协议',
      model: '全风险',
      settlementMethod: '月结 · 30 天',
      settlementFormula: '客户结算金额=结案金额*70%',
      validityMode: 'UNKNOWN',
    },
  };
}

test.beforeEach(async () => resetCustomerE2eData());
test.afterAll(async () => disconnectCustomerTestDatabase());

test('first-version creation preserves all entered facts, real ownership and immutable agreement versions', async ({
  request,
}) => {
  await grantAgreement();
  await grantCustomerCooperation(e2eFixtures.roleA, 'DEPARTMENT');
  const context = await request.get('/api/v1/customers/creation-context', {
    headers: auth,
  });
  expect(context.status()).toBe(200);
  const options = await context.json();
  expect(options.canSetInitialAgreement).toBe(true);
  expect(
    options.operators.map((operator: { id: string }) => operator.id),
  ).toContain(e2eFixtures.userSelf);
  expect(
    options.operators.map((operator: { id: string }) => operator.id),
  ).not.toContain(e2eFixtures.userB);

  const body = input();
  const response = await request.post('/api/v1/customers', {
    headers: auth,
    data: body,
  });
  expect(response.status(), await response.text()).toBe(201);
  const created = await response.json();
  expect(created).toMatchObject({
    name: body.name,
    customerManagerName: body.customerManagerName,
    identityType: body.identityType,
    identityNumber: body.identityNumber,
    category: body.category,
    region: body.region,
    responsibleUserId: e2eFixtures.userSelf,
    profileStatus: 'draft',
    admittedAt: null,
  });
  const detail = await request.get(`/api/v1/customers/${created.id}`, {
    headers: auth,
  });
  expect(detail.status()).toBe(200);
  expect(await detail.json()).toMatchObject(created);
  const agreementResponse = await request.get(
    `/api/v1/customers/${created.id}/agreements`,
    { headers: auth },
  );
  expect(agreementResponse.status()).toBe(200);
  const agreement = await agreementResponse.json();
  expect(agreement.agreement.currentVersion).toMatchObject({
    ...body.initialAgreement,
    contentVersionIds: [],
    files: [],
    effectiveFrom: null,
    effectiveTo: null,
  });
  expect(
    (
      await request.get(`/api/v1/customers/${created.id}`, { headers: foreign })
    ).status(),
  ).toBe(404);

  const revision = await request.post(
    `/api/v1/customers/${created.id}/agreements/${agreement.agreement.id}/revisions`,
    {
      headers: { ...auth, 'Idempotency-Key': randomUUID() },
      data: {
        expectedCustomerVersion: created.version,
        expectedAgreementVersion: 1,
        settlementFormula: '客户结算金额=结案金额*50%',
      },
    },
  );
  expect(revision.status(), await revision.text()).toBe(200);
  const revised = await revision.json();
  expect(revised.agreement.currentVersion.settlementFormula).toBe(
    '客户结算金额=结案金额*50%',
  );
  const history = await request.get(
    `/api/v1/customers/${created.id}/agreements/${agreement.agreement.id}/versions`,
    { headers: auth },
  );
  expect(history.status()).toBe(200);
  const versions = (await history.json()).items;
  expect(
    versions.find((version: { version: number }) => version.version === 1)
      .settlementFormula,
  ).toBe(body.initialAgreement.settlementFormula);
});

test('first-version creation rolls back the customer if initial agreement permission or dates are invalid', async ({
  request,
}) => {
  const unauthorized = input();
  delete (unauthorized as Partial<typeof unauthorized>).responsibleUserId;
  const denied = await request.post('/api/v1/customers', {
    headers: auth,
    data: unauthorized,
  });
  expect([403, 404]).toContain(denied.status());
  expect(await count(unauthorized.name)).toBe(0);

  await grantAgreement();
  const invalidDates = {
    ...unauthorized,
    name: `非法日期 ${randomUUID()}`,
    initialAgreement: {
      ...unauthorized.initialAgreement,
      validityMode: 'FIXED',
      effectiveTo: '2026-02-30',
    },
  };
  expect(
    (
      await request.post('/api/v1/customers', {
        headers: auth,
        data: invalidDates,
      })
    ).status(),
  ).toBe(400);
  expect(await count(invalidDates.name)).toBe(0);
});

test('unfilled cooperation fields create only a draft without agreement edit permission', async ({
  request,
}) => {
  const inputs = [
    { name: `空合作对象 ${randomUUID()}`, initialAgreement: {} },
    {
      name: `未填写合作字段 ${randomUUID()}`,
      initialAgreement: {
        model: null,
        settlementMethod: '  ',
        settlementFormula: null,
        effectiveFrom: null,
        effectiveTo: null,
        validityMode: 'UNKNOWN',
        contentVersionIds: [],
      },
    },
  ];
  const createdIds: string[] = [];
  for (const body of inputs) {
    const response = await request.post('/api/v1/customers', {
      headers: auth,
      data: body,
    });
    expect(response.status(), await response.text()).toBe(201);
    const created = await response.json();
    expect(created).toMatchObject({ profileStatus: 'draft', version: 1 });
    createdIds.push(created.id);
  }

  await setCustomerDocumentGrant(
    e2eFixtures.roleA,
    'CUSTOMER_AGREEMENT_READ',
    true,
    'DEPARTMENT',
  );
  for (const customerId of createdIds) {
    const agreement = await request.get(
      `/api/v1/customers/${customerId}/agreements`,
      { headers: auth },
    );
    expect(agreement.status()).toBe(200);
    expect(await agreement.json()).toMatchObject({
      agreement: null,
      customerVersion: 1,
    });
  }
});

test('first-version creation rejects a foreign or unreadable responsible operator without leaving an agreement or customer', async ({
  request,
}) => {
  await grantAgreement();
  await grantCustomerCooperation(e2eFixtures.roleA, 'DEPARTMENT');
  const foreignInput = { ...input(), responsibleUserId: e2eFixtures.userB };
  const wrongDepartment = await request.post('/api/v1/customers', {
    headers: auth,
    data: foreignInput,
  });
  expect(wrongDepartment.status()).toBe(404);
  expect(await wrongDepartment.json()).toMatchObject({
    code: 'CUSTOMER_OPERATOR_NOT_ELIGIBLE',
  });
  expect(await count(foreignInput.name)).toBe(0);

  await grantAgreement(e2eFixtures.roleSelf);
  await grantCustomerCooperation(e2eFixtures.roleSelf, 'DEPARTMENT');
  const selfAuth = { Authorization: `Bearer ${e2eFixtures.tokenSelf}` };
  const context = await request.get('/api/v1/customers/creation-context', {
    headers: selfAuth,
  });
  expect(
    (await context.json()).operators.map(
      (operator: { id: string }) => operator.id,
    ),
  ).toEqual([e2eFixtures.userSelf]);
  const unreadableInput = { ...input(), responsibleUserId: e2eFixtures.userA };
  const unreadable = await request.post('/api/v1/customers', {
    headers: selfAuth,
    data: unreadableInput,
  });
  expect(unreadable.status()).toBe(403);
  expect(await count(unreadableInput.name)).toBe(0);
});

test('first-version creation keeps the optional name-only draft and rejects duplicate identity or oversized nested terms', async ({
  request,
}) => {
  const draft = await request.post('/api/v1/customers', {
    headers: auth,
    data: { name: `仅名称 ${randomUUID()}` },
  });
  expect(draft.status()).toBe(201);
  expect(await draft.json()).toMatchObject({
    profileStatus: 'draft',
    responsibleUserId: e2eFixtures.userA,
  });
  const oversized = {
    ...input(),
    initialAgreement: {
      ...input().initialAgreement,
      settlementFormula: '长'.repeat(501),
    },
  };
  for (const invalid of [
    oversized,
    { name: '非法合作数组', initialAgreement: [] },
    { name: '非法合作空值', initialAgreement: null },
  ]) {
    expect(
      (
        await request.post('/api/v1/customers', {
          headers: auth,
          data: invalid,
        })
      ).status(),
    ).toBe(400);
    expect(await count(invalid.name)).toBe(0);
  }
  const first = {
    name: `信用码 ${randomUUID()}`,
    customerType: 'ENTERPRISE',
    identityType: 'BUSINESS_LICENSE',
    identityNumber: '91330100MA2ABC1234X',
  };
  expect(
    (
      await request.post('/api/v1/customers', { headers: auth, data: first })
    ).status(),
  ).toBe(201);
  const duplicateInput = { ...first, name: `重码 ${randomUUID()}` };
  const duplicate = await request.post('/api/v1/customers', {
    headers: auth,
    data: duplicateInput,
  });
  expect(duplicate.status()).toBe(409);
  expect(await count(first.name)).toBe(1);
  expect(await count(duplicateInput.name)).toBe(0);
});
