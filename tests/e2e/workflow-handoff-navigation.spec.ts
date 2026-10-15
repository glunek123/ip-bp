import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import {
  coreLeadFixtures,
  disconnectCoreLeadTestDatabase,
  resetCoreLeadE2eData,
  setGrant,
} from '../support/core-lead-database.mjs';

// Run only through the repository E2E runner in the integration owner's new
// isolated test environment. Setup creates accounts and a waiting-push lead;
// every business transition below goes through the real browser forms.
const internalHeaders = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n');
const photo = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46,
]);
const byTest = (page: Page, name: string) =>
  page.locator(`[data-test="${name}"]`);

async function createFixture(request: APIRequestContext) {
  const suffix = randomUUID().slice(0, 8);
  const client = {
    username: `handoff-client-${suffix}`,
    password: 'handoff client test password',
  };
  const notary = {
    username: `handoff-notary-${suffix}`,
    password: 'handoff notary test password',
  };
  const createdClient = await request.post(
    `/api/v1/customers/${coreLeadFixtures.admittedCustomer}/client-accounts`,
    {
      headers: internalHeaders,
      data: { ...client, displayName: '流程验收客户' },
    },
  );
  expect(createdClient.status(), await createdClient.text()).toBe(201);
  const createdOffice = await request.post('/api/v1/notary-offices', {
    headers: internalHeaders,
    data: { name: `流程验收公证处-${suffix}` },
  });
  expect(createdOffice.status(), await createdOffice.text()).toBe(201);
  const office: { id: string } = await createdOffice.json();
  const createdNotary = await request.post(
    `/api/v1/notary-offices/${office.id}/accounts`,
    {
      headers: internalHeaders,
      data: { ...notary, displayName: '流程验收公证员' },
    },
  );
  expect(createdNotary.status(), await createdNotary.text()).toBe(201);
  const createdLead = await request.post('/api/v1/leads', {
    headers: { ...internalHeaders, 'Idempotency-Key': randomUUID() },
    data: {
      customerId: coreLeadFixtures.admittedCustomer,
      rightsHolderId: coreLeadFixtures.holder,
      caseType: 'CIVIL',
      infringementTypes: ['TRADEMARK'],
      source: 'ONLINE',
      platform: 'TAOBAO',
      foundAt: '2026-09-24T02:30:00.000Z',
      shopName: `流程验收店铺-${suffix}`,
      needDisclose: false,
      products: [
        {
          title: '流程验收商品',
          quantity: 1,
          unitPrice: '8.00',
          commentCount: 0,
        },
      ],
      leadScreenshotContentVersionIds: [],
    },
  });
  expect(createdLead.status(), await createdLead.text()).toBe(201);
  const lead: { id: string } = await createdLead.json();
  return { client, notary, office, lead };
}

async function login(
  page: Page,
  account: { username: string; password: string },
  path: string,
) {
  await page.goto(`/login?returnTo=${encodeURIComponent(path)}`);
  await page.getByLabel('用户名').fill(account.username);
  await page.getByLabel('密码').fill(account.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${path}$`, 'u'));
}
async function logout(page: Page) {
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login$/u);
}
const operator = {
  username: coreLeadFixtures.operatorUsername,
  password: coreLeadFixtures.operatorPassword,
};

test.beforeEach(async () => {
  await resetCoreLeadE2eData();
});
test.afterAll(async () => {
  await disconnectCoreLeadTestDatabase();
});

for (const outcome of ['ISSUE', 'NO_ISSUE'] as const) {
  test(`real three-role handoff navigation follows ${outcome} with refresh and recovery`, async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const fixture = await createFixture(request);
    const leadPath = `/leads/${fixture.lead.id}`;
    await login(page, operator, leadPath);
    await expect(byTest(page, 'lead-workflow')).toContainText('下一步由运营');
    page.once('dialog', (dialog) => dialog.accept());
    await byTest(page, 'push-lead').click();
    await expect(byTest(page, 'lead-workflow')).toContainText('下一步由客户');
    await expect(byTest(page, 'handoff-form-link')).toHaveCount(0);
    await logout(page);
    await login(page, fixture.client, `/client/leads/${fixture.lead.id}`);
    page.once('dialog', (dialog) => dialog.accept());
    await byTest(page, 'confirm-infringement').click();
    await expect(byTest(page, 'client-review-record')).toContainText(
      '确认侵权',
    );
    await logout(page);
    await login(page, operator, leadPath);
    await byTest(page, 'handoff-form-link').click();
    await expect(page.locator('#notary-transfer-form')).toBeInViewport();
    await page.locator('[data-test^="select-product-"]').first().check();
    await byTest(page, 'notary-office').selectOption(fixture.office.id);
    await byTest(page, 'batch-purpose').fill('流程衔接真实批次');

    const handoffEndpoint = `**/api/v1/leads/${fixture.lead.id}/notary-matters`;
    const attempts: Array<{ key: string | undefined; body: string | null }> =
      [];
    let resultId = '';
    await page.route(handoffEndpoint, async (route) => {
      const outgoing = route.request();
      attempts.push({
        key: outgoing.headers()['idempotency-key'],
        body: outgoing.postData(),
      });
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      const result: { id: string } = await response.json();
      resultId = result.id;
      if (outcome === 'ISSUE' && attempts.length === 1)
        await route.abort('connectionfailed');
      else await route.fulfill({ response });
    });
    page.once('dialog', (dialog) => dialog.accept());
    await byTest(page, 'transfer-to-notary').click();
    if (outcome === 'ISSUE') {
      await expect(page.getByRole('alert')).toContainText('结果暂时未知');
      await expect(byTest(page, 'handoff-matter-link')).toHaveCount(0);
      await expect(byTest(page, 'batch-purpose')).toBeDisabled();
      page.once('dialog', (dialog) => dialog.accept());
      await byTest(page, 'transfer-to-notary').click();
      await expect(byTest(page, 'handoff-matter-link')).toBeVisible();
      expect(attempts).toHaveLength(2);
      expect(attempts[1]).toEqual(attempts[0]);
    }
    await expect(byTest(page, 'handoff-matter-link')).toBeVisible();
    await expect(byTest(page, 'handoff-matter-link')).toHaveAttribute(
      'href',
      `/notary-matters/${resultId}`,
    );
    await page.unroute(handoffEndpoint);
    await byTest(page, 'handoff-matter-link').click();
    const matterPath = `/notary-matters/${resultId}`;
    await expect(page).toHaveURL(new RegExp(`${matterPath}$`, 'u'));
    await expect(byTest(page, 'notary-workflow')).toContainText('运营');

    // A failed read cannot leave a stale actionable workflow card behind.
    const detailEndpoint = `**/api/v1/notary-matters/${resultId}`;
    await page.route(detailEndpoint, (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"code":"INTERNAL_ERROR","message":"test read failure"}',
      }),
    );
    await byTest(page, 'refresh-matter').click();
    await expect(
      page.getByRole('heading', { name: '取证批次暂时无法加载' }),
    ).toBeVisible();
    await expect(byTest(page, 'notary-workflow-action')).toHaveCount(0);
    await page.unroute(detailEndpoint);
    await byTest(page, 'refresh-matter').click();
    await byTest(page, 'notary-workflow-action').click();
    await expect(page.locator('#evidence-form')).toBeInViewport();
    await byTest(page, 'evidence-date').fill('2026-09-24');
    await byTest(page, 'sample-fee-state').selectOption('PENDING');
    await byTest(page, 'logistics-company-state-0').selectOption('NONE');
    await byTest(page, 'logistics-tracking-state-0').selectOption('NONE');
    await byTest(page, 'record-evidence-submit').click();
    await expect(byTest(page, 'notary-workflow')).toContainText(
      '下一步由公证处',
    );
    await page.reload();
    await expect(byTest(page, 'saved-evidence')).toBeVisible();
    await logout(page);
    const portalPath = `/notary-portal/matters/${resultId}`;
    await login(page, fixture.notary, portalPath);
    await byTest(page, 'portal-workflow-action').click();
    await expect(page.locator('#portal-opening-form')).toBeInViewport();
    await byTest(page, 'notary-opening-photo-files').setInputFiles({
      name: 'handoff-opening.jpg',
      mimeType: 'image/jpeg',
      buffer: photo,
    });
    await expect(
      page.locator('[data-test^="notary-opening-photo-select-"]').first(),
    ).toBeChecked();
    await byTest(page, 'notary-opening-submit').click();
    await expect(byTest(page, 'portal-workflow')).toContainText(
      '下一步由客户或获授权运营审核',
    );
    await page.reload();
    await expect(byTest(page, 'notary-saved-opening')).toContainText(
      'handoff-opening.jpg',
    );
    await logout(page);
    await login(page, fixture.client, `/client/notary-matters/${resultId}`);
    await byTest(page, 'client-review-result').check();
    await byTest(page, 'client-opening-review-submit').click();
    await expect(byTest(page, 'client-review-record')).toContainText(
      '确认侵权',
    );
    await logout(page);
    await login(page, operator, matterPath);
    await byTest(page, 'notary-workflow-action').click();
    await byTest(
      page,
      outcome === 'ISSUE'
        ? 'issuance-decision-issue'
        : 'issuance-decision-no-issue',
    ).check();
    await byTest(page, 'issuance-decision-submit').click();
    if (outcome === 'NO_ISSUE') {
      await expect(byTest(page, 'notary-workflow')).toContainText(
        '已决定不出证',
      );
      await expect(byTest(page, 'notary-workflow-action')).toHaveAttribute(
        'href',
        `${matterPath}#return-archive-form`,
      );
      await byTest(page, 'notary-workflow-action').click();
      await byTest(page, 'return-archive-keep').check();
      await byTest(page, 'return-archive-reason').fill(
        '实际保留样品，不出证归档',
      );
      await byTest(page, 'return-archive-submit').click();
      await page.reload();
      await expect(byTest(page, 'notary-workflow')).toContainText(
        '本次公证流程结束',
      );
      await expect(byTest(page, 'linked-case')).toHaveCount(0);
      return;
    }
    await expect(byTest(page, 'notary-workflow')).toContainText(
      '下一步由公证处',
    );
    await expect(byTest(page, 'notary-workflow-action')).toHaveCount(0);
    await expect(byTest(page, 'certificate-submit')).toHaveCount(0);
    await logout(page);
    await login(page, fixture.notary, portalPath);
    await byTest(page, 'portal-workflow-action').click();
    await byTest(page, 'certificate-number').fill('（2026）流程验收001号');
    await byTest(page, 'certificate-date').fill('2026-09-28');
    await byTest(page, 'certificate-file-input').setInputFiles({
      name: 'handoff-certificate.pdf',
      mimeType: 'application/pdf',
      buffer: pdf,
    });
    await expect(
      page.locator('[data-test^="certificate-select-"]').first(),
    ).toBeChecked();
    await byTest(page, 'certificate-submit').click();
    await expect(byTest(page, 'certificate-record')).toBeVisible();
    await page.reload();
    await expect(byTest(page, 'portal-workflow')).toContainText('下一步由运营');
    await expect(page.locator('a[href^="/cases/"]')).toHaveCount(0);
    await logout(page);
    await login(page, operator, matterPath);
    const projected = await request.get(`/api/v1/notary-matters/${resultId}`, {
      headers: internalHeaders,
    });
    expect(projected.status(), await projected.text()).toBe(200);
    const detail: { linkedCase: { id: string; businessNo: string } } =
      await projected.json();
    await expect(byTest(page, 'linked-case')).toHaveAttribute(
      'href',
      `/cases/${detail.linkedCase.id}`,
    );
    await byTest(page, 'linked-case').click();
    await expect(page).toHaveURL(
      new RegExp(`/cases/${detail.linkedCase.id}$`, 'u'),
    );
    await page.reload();
    await expect(
      page.getByRole('heading', {
        name: detail.linkedCase.businessNo,
        exact: true,
      }),
    ).toBeVisible();

    // Live revocation uses the fixture's real grant, followed by a fresh login.
    await setGrant('lead.read', false);
    try {
      await page.goto(matterPath);
      await expect(byTest(page, 'linked-case')).toHaveCount(0);
      await expect(byTest(page, 'notary-workflow')).toHaveCount(0);
    } finally {
      await setGrant('lead.read', true);
    }
    await logout(page);
    await login(page, operator, matterPath);
    await expect(byTest(page, 'linked-case')).toHaveAttribute(
      'href',
      `/cases/${detail.linkedCase.id}`,
    );
  });
}
