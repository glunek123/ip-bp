import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import {
  allowInjectedFailures,
  coreLeadFixtures,
  resetCoreLeadE2eData,
} from '../support/core-lead-database.mjs';
import { createSubmittedCaseThroughApi } from '../support/case-complaint-confirmation-database.mjs';

async function loginWithPassword(
  page: Page,
  username: string,
  password: string,
  target = '/cases',
): Promise<void> {
  await page.goto(target);
  await expect(page).toHaveURL(/\/login\?returnTo=/u);
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(target);
  await expect(
    page.getByRole('button', { name: '退出登录', exact: true }),
  ).toBeVisible();
}

async function readDownloadedBytes(
  page: Page,
  selector: string,
): Promise<Buffer> {
  const downloadReady = page.waitForEvent('download');
  await page.locator(selector).click();
  const download = await downloadReady;
  const path = await download.path();
  if (path === null) throw new Error('浏览器未生成附件下载文件');
  return readFile(path);
}

test.beforeEach(async () => resetCoreLeadE2eData());
test.afterEach(async () => allowInjectedFailures());

test('normal password pagination keeps 21 source cases accessible to operations and their enterprise client', async ({
  page,
  request,
}) => {
  test.setTimeout(300_000);
  const cases: Array<
    Awaited<ReturnType<typeof createSubmittedCaseThroughApi>>
  > = [];
  for (let index = 0; index < 21; index += 1) {
    const source = await createSubmittedCaseThroughApi(request);
    const confirmationKey = randomUUID();
    const confirmation = await request.post(
      `/api/v1/cases/${source.caseId}/complaint-confirm`,
      {
        headers: {
          Authorization: `Bearer ${coreLeadFixtures.tokenA}`,
          'Idempotency-Key': confirmationKey,
        },
        data: {
          idempotencyKey: confirmationKey,
          expectedVersion: source.submitted.version,
          confirmedComplaintContentVersionId: source.complaint.contentVersionId,
          amountState: 'KNOWN',
          amount: source.submitInput.amount,
          pendingReason: null,
          confirmDisclose: false,
        },
      },
    );
    expect(confirmation.status()).toBe(201);
    cases.push(source);
  }
  const sourceIds = cases.map((source) => source.caseId).sort();
  type ListPayload = {
    items: Array<{ id: string }>;
    total: number;
    page: number;
    pageSize: number;
  };
  async function readList(
    pathname: '/api/v1/cases' | '/api/v1/client/cases',
    requestedPage: number,
    action: () => Promise<unknown>,
    expectedTotal = 21,
  ): Promise<ListPayload> {
    const ready = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === 'GET' &&
        url.pathname === pathname &&
        url.searchParams.get('page') === String(requestedPage) &&
        url.searchParams.get('pageSize') === '20'
      );
    });
    await action();
    const response = await ready;
    expect(response.status()).toBe(200);
    const payload: ListPayload = await response.json();
    expect(payload.page).toBe(requestedPage);
    expect(payload.pageSize).toBe(20);
    expect(payload.total).toBe(expectedTotal);
    return payload;
  }

  const internalFirst = await readList('/api/v1/cases', 1, () =>
    loginWithPassword(
      page,
      coreLeadFixtures.operatorUsername,
      coreLeadFixtures.operatorPassword,
    ),
  );
  expect(internalFirst.items).toHaveLength(20);
  const internalList = page.locator('[data-test="case-list"]');
  await expect(internalList.locator('li')).toHaveCount(20);
  await expect(
    page.getByRole('button', { name: '上一页', exact: true }),
  ).toBeDisabled();
  const internalSecond = await readList('/api/v1/cases', 2, () =>
    page.getByRole('button', { name: '下一页', exact: true }).click(),
  );
  expect(internalSecond.items).toHaveLength(1);
  expect(
    [...internalFirst.items, ...internalSecond.items]
      .map((item) => item.id)
      .sort(),
  ).toEqual(sourceIds);
  const internalCaseId = internalSecond.items[0]!.id;
  await expect(internalList.locator('li')).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: '下一页', exact: true }),
  ).toBeDisabled();
  await readList('/api/v1/cases', 2, () => page.reload());
  const internalDetail = internalList.locator(
    `a[href^="/cases/${internalCaseId}?"]`,
  );
  await expect(internalDetail).toBeVisible();
  await internalDetail.click();
  await expect(page).toHaveURL(
    (url) => url.pathname === `/cases/${internalCaseId}`,
  );
  expect(new URL(page.url()).searchParams.get('page')).toBe('2');
  await readList('/api/v1/cases', 2, () => page.goBack());
  await expect(
    internalList.locator(`a[href^="/cases/${internalCaseId}?"]`),
  ).toBeVisible();
  await readList('/api/v1/cases', 1, () =>
    page.getByRole('button', { name: '本部门全部', exact: true }).click(),
  );
  expect(new URL(page.url()).searchParams.get('page')).toBe('1');
  await expect(internalList.locator('li')).toHaveCount(20);
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/u);

  const clientFirst = await readList('/api/v1/client/cases', 1, () =>
    loginWithPassword(
      page,
      cases[0]!.client.username,
      cases[0]!.client.password,
      '/client/cases',
    ),
  );
  expect(clientFirst.items).toHaveLength(20);
  const clientList = page.locator('[data-test="client-case-list"]');
  await expect(clientList.locator('li')).toHaveCount(20);
  const clientSecond = await readList('/api/v1/client/cases', 2, () =>
    page.getByRole('button', { name: '下一页', exact: true }).click(),
  );
  expect(clientSecond.items).toHaveLength(1);
  expect(
    [...clientFirst.items, ...clientSecond.items].map((item) => item.id).sort(),
  ).toEqual(sourceIds);
  for (const item of [...clientFirst.items, ...clientSecond.items]) {
    expect(Object.keys(item).sort()).toEqual(
      [
        'id',
        'businessNo',
        'stage',
        'version',
        'canMailComplaint',
        'canMailExecution',
        'rightsHolderName',
        'defendantNames',
      ].sort(),
    );
  }
  const clientCaseId = clientSecond.items[0]!.id;
  await expect(clientList.locator('li')).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: '下一页', exact: true }),
  ).toBeDisabled();
  await readList('/api/v1/client/cases', 2, () => page.reload());
  await clientList.locator(`a[href="/client/cases/${clientCaseId}"]`).click();
  await expect(page).toHaveURL(
    new RegExp(`/client/cases/${clientCaseId}$`, 'u'),
  );
  await readList('/api/v1/client/cases', 2, () => page.goBack());
  await expect(
    clientList.locator(`a[href="/client/cases/${clientCaseId}"]`),
  ).toBeVisible();
  const recorded = await readList(
    '/api/v1/client/cases',
    1,
    () => page.getByRole('button', { name: '已登记', exact: true }).click(),
    0,
  );
  expect(recorded.items).toHaveLength(0);
  expect(new URL(page.url()).searchParams.has('page')).toBe(false);
  await expect(clientList).toContainText('当前没有案件');
  await readList('/api/v1/client/cases', 1, () =>
    page.getByRole('button', { name: '待盖章', exact: true }).click(),
  );
  await expect(clientList.locator('li')).toHaveCount(20);
});

test('password sessions confirm an exact revision, download real bytes and keep other same-department users read-only', async ({
  page,
  request,
}) => {
  test.setTimeout(300_000);
  const seeded = await createSubmittedCaseThroughApi(request);
  const revisionBytes = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%CA003 browser revision\n%%EOF\n',
  );

  await loginWithPassword(
    page,
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  await page.goto(`/cases/${seeded.caseId}`);
  await expect(page.locator('.page-head .pill')).toHaveText('诉状待确认');
  await expect(page.getByText('标的额：¥ 123.45')).toBeVisible();

  await page.locator('[data-test="complaint-revision-upload"]').setInputFiles({
    name: '浏览器修订诉状.pdf',
    mimeType: 'application/pdf',
    buffer: revisionBytes,
  });
  const revisedVersion = page.locator(
    '[data-test^="complaint-version-"]:checked',
  );
  await expect(revisedVersion).toHaveAttribute(
    'data-test',
    /^complaint-version-/u,
  );
  const revisedVersionTestId = await revisedVersion.getAttribute('data-test');
  if (revisedVersionTestId === null)
    throw new Error('未能读取浏览器上传的精确诉状版本');
  const revisedVersionId = revisedVersionTestId.replace(
    'complaint-version-',
    '',
  );
  await page.locator('[data-test="confirmation-amount"]').fill('223.45');
  await expect(page.locator('[data-test="change-note"]')).toHaveAttribute(
    'required',
    '',
  );
  await page
    .locator('[data-test="change-note"]')
    .fill('按客户确认的修订诉状及金额办理');
  await page.locator('[data-test="confirm-disclose-true"]').check();
  await page.locator('[data-test="confirmation-review"]').click();
  await expect(page.getByRole('dialog')).toContainText('确认后进入诉状待盖章');
  await page.locator('[data-test="confirmation-submit"]').click();
  await expect(page.locator('.page-head .pill')).toHaveText('诉状待盖章');
  await expect(
    page.locator('[data-test="confirmed-complaint-record"]'),
  ).toContainText('确认金额：¥ 223.45');
  await expect(
    page.locator('[data-test="case-stage"]').filter({
      hasText: '诉状待盖章',
    }),
  ).toContainText('1');

  await page
    .locator('[data-test="case-stage"]')
    .filter({
      hasText: '诉状待盖章',
    })
    .click();
  await expect(
    page.locator(`[data-test="case-list"] a[href^="/cases/${seeded.caseId}"]`),
  ).toBeVisible();
  await page
    .locator(`[data-test="case-list"] a[href^="/cases/${seeded.caseId}"]`)
    .click();
  await expect(page.locator('.page-head .pill')).toHaveText('诉状待盖章');
  expect(
    await readDownloadedBytes(
      page,
      '[data-test="confirmed-complaint-download"]',
    ),
  ).toEqual(revisionBytes);

  await page.reload();
  await expect(page.locator('.page-head .pill')).toHaveText('诉状待盖章');
  await expect(page.getByText('标的额：¥ 123.45')).toBeVisible();
  await expect(
    page.locator('[data-test="confirmed-complaint-record"]'),
  ).toContainText('确认金额：¥ 223.45');

  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/u);
  await loginWithPassword(
    page,
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  await page.goto(`/cases/${seeded.caseId}`);
  await expect(
    page.locator('[data-test="confirmed-complaint-record"]'),
  ).toContainText('确认金额：¥ 223.45');

  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/u);
  await loginWithPassword(
    page,
    coreLeadFixtures.selfUsername,
    coreLeadFixtures.selfPassword,
  );
  await page.goto(`/cases/${seeded.caseId}`);
  await expect(
    page.locator('[data-test="complaint-confirmation-panel"]'),
  ).toContainText('诉状确认记录');
  await expect(page.locator('[data-test="confirmation-submit"]')).toHaveCount(
    0,
  );
  await expect(
    page.locator('[data-test="complaint-revision-upload"]'),
  ).toHaveCount(0);
  expect(
    await readDownloadedBytes(
      page,
      '[data-test="confirmed-complaint-download"]',
    ),
  ).toEqual(revisionBytes);

  const forbiddenStatus = await page.evaluate(
    async ({ caseId, versionId }) => {
      const sessionResponse = await fetch('/api/v1/auth/session');
      const session = (await sessionResponse.json()) as { csrfToken: string };
      const idempotencyKey = crypto.randomUUID();
      const response = await fetch(
        `/api/v1/cases/${caseId}/complaint-confirm`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
            'X-CSRF-Token': session.csrfToken,
          },
          body: JSON.stringify({
            expectedVersion: 4,
            idempotencyKey,
            confirmedComplaintContentVersionId: versionId,
            amountState: 'KNOWN',
            amount: '223.45',
            pendingReason: null,
            confirmDisclose: true,
          }),
        },
      );
      return response.status;
    },
    {
      caseId: seeded.caseId,
      versionId: revisedVersionId,
    },
  );
  expect(forbiddenStatus).toBe(403);
});
