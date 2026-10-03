import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import {
  coreLeadFixtures,
  resetCoreLeadE2eData,
} from '../support/core-lead-database.mjs';
import { createSubmittedCaseThroughApi } from '../support/case-complaint-confirmation-database.mjs';
import { clearCaseComplaintMailingFixture } from '../support/case-complaint-mailing-database.mjs';
import {
  clearCaseFilingFault,
  clearCaseFilingFixture,
  prepareCaseFilingFixture,
} from '../support/case-filing-database.mjs';

const auth = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };
const pdfBytes = Buffer.from(
  '%PDF-1.4\nCA005 browser evidence exact bytes\n%%EOF\n',
);
const dateShanghai = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

type ApiCase = {
  caseId: string;
  complaint: { contentVersionId: string };
  clientSession: { user: { username: string } };
};

async function expectStatus(
  response: { status(): number; text(): Promise<string> },
  status: number,
) {
  expect(response.status(), await response.text()).toBe(status);
}

async function loginOperator(page: Page) {
  await page.goto('/cases');
  await expect(page).toHaveURL(/\/login\?returnTo=/u);
  await page.getByLabel('用户名').fill(coreLeadFixtures.operatorUsername);
  await page.getByLabel('密码').fill(coreLeadFixtures.operatorPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/cases');
  await expect(page.getByRole('button', { name: '退出登录' })).toBeVisible();
}

async function waitingFilingCase(request: APIRequestContext) {
  const source = (await createSubmittedCaseThroughApi(
    request,
  )) as unknown as ApiCase;
  await expectStatus(
    await request.post(`/api/v1/cases/${source.caseId}/complaint-confirm`, {
      headers: auth,
      data: {
        expectedVersion: 3,
        idempotencyKey: randomUUID(),
        confirmedComplaintContentVersionId: source.complaint.contentVersionId,
        amountState: 'KNOWN',
        amount: '123.45',
        pendingReason: null,
        confirmDisclose: true,
      },
    }),
    201,
  );
  const draft = await request.post('/api/v1/materials/upload-drafts', {
    headers: auth,
    data: {
      ownerType: 'CASE',
      ownerId: source.caseId,
      category: 'MAIL_RECEIPT',
      purpose: 'MAIL_RECEIPT',
      originalFilename: '正式邮寄回执.pdf',
      declaredMimeType: 'application/pdf',
    },
  });
  await expectStatus(draft, 201);
  const draftId = (await draft.json()).id as string;
  const receipt = await request.put(
    `/api/v1/materials/upload-drafts/${draftId}/content`,
    {
      headers: { ...auth, 'Content-Type': 'application/octet-stream' },
      data: pdfBytes,
    },
  );
  await expectStatus(receipt, 200);
  const receiptVersion = (await receipt.json()).contentVersionId as string;
  await expectStatus(
    await request.post(`/api/v1/cases/${source.caseId}/complaint-mail`, {
      headers: auth,
      data: {
        expectedVersion: 4,
        idempotencyKey: randomUUID(),
        mailedAt: dateShanghai(),
        mailReceiptContentVersionIds: [receiptVersion],
      },
    }),
    201,
  );
  return source;
}

test.beforeEach(async () => {
  await clearCaseFilingFixture();
  await clearCaseComplaintMailingFixture();
  await resetCoreLeadE2eData();
  await prepareCaseFilingFixture();
});

test.afterEach(async () => {
  await clearCaseFilingFault();
  await clearCaseFilingFixture();
  await clearCaseComplaintMailingFixture();
});

test('operator records a real court and files through the browser with exact frozen evidence', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(180_000);
  const source = await waitingFilingCase(request);
  await loginOperator(page);
  await page.goto(`/cases/${source.caseId}`);
  await expect(page.locator('[data-test="case-filing-panel"]')).toBeVisible();
  await expect(
    page.getByText('本部门还没有可选法院，请在下方录入真实法院名称。'),
  ).toBeVisible();

  const courtName = `浏览器真实法院-${randomUUID().slice(0, 8)}`;
  await page.locator('[data-test="filing-court-name"]').fill(courtName);
  await page.locator('[data-test="filing-court-create"]').click();
  const courtControl = page.locator('[data-test="filing-court-fixed"]');
  await expect(courtControl).toBeVisible();
  const stableCourtId = await courtControl.inputValue();
  expect(stableCourtId).toMatch(/^[0-9a-f-]{36}$/iu);

  await page.locator('[data-test="filing-submitted-at"]').fill(dateShanghai());
  await page
    .locator('[data-test="filing-mediation-no"]')
    .fill('浏览器诉调-001');
  await page.locator('[data-test="filing-evidence-input"]').setInputFiles({
    name: '浏览器起诉及证据.pdf',
    mimeType: 'application/pdf',
    buffer: pdfBytes,
  });
  await expect(page.getByText('浏览器起诉及证据.pdf')).toBeVisible();
  await page.locator('[data-test="filing-review"]').click();
  await expect(
    page.locator('[data-test="filing-review-summary"]'),
  ).toContainText(courtName);
  await page.getByRole('button', { name: '确认提交并进入待正式立案' }).click();
  await expect(page.getByText('待正式立案', { exact: true })).toBeVisible();
  await expect(page.locator('[data-test="case-filing-panel"]')).toHaveCount(0);
  await expect(page.locator('[data-test="case-filing-record"]')).toContainText(
    courtName,
  );
  await expect(page.locator('[data-test="case-filing-record"]')).toContainText(
    '浏览器诉调-001',
  );
  await expect(page.locator('[data-test="case-filing-record"]')).toContainText(
    '123.45',
  );

  const saved = await request.get(`/api/v1/cases/${source.caseId}`, {
    headers: auth,
  });
  await expectStatus(saved, 200);
  const detail = await saved.json();
  expect(detail.filingSubmission).toMatchObject({
    court: { id: stableCourtId, name: courtName },
    submittedAt: dateShanghai(),
    mediationNo: '浏览器诉调-001',
    evidenceFiles: [{ originalFilename: '浏览器起诉及证据.pdf' }],
  });
  expect(detail.complaintConfirmation.amount).toBe('123.45');

  await page.reload();
  await expect(page.locator('[data-test="case-filing-record"]')).toContainText(
    courtName,
  );
  const operatorDownload = page.waitForEvent('download');
  await page
    .locator('[data-test="case-filing-record"]')
    .getByRole('button', { name: '下载' })
    .click();
  expect(await readFile(await (await operatorDownload).path())).toEqual(
    pdfBytes,
  );

  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login$/u);
  await loginOperator(page);
  await page.goto(`/cases/${source.caseId}`);
  await expect(page.locator('[data-test="case-filing-record"]')).toContainText(
    courtName,
  );
  const reloggedDownload = page.waitForEvent('download');
  await page
    .locator('[data-test="case-filing-record"]')
    .getByRole('button', { name: '下载' })
    .click();
  expect(await readFile(await (await reloggedDownload).path())).toEqual(
    pdfBytes,
  );

  const readOnlyContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  try {
    const readOnlyPage = await readOnlyContext.newPage();
    await readOnlyPage.goto('/cases');
    await expect(readOnlyPage).toHaveURL(/\/login\?returnTo=/u);
    await readOnlyPage.getByLabel('用户名').fill(coreLeadFixtures.selfUsername);
    await readOnlyPage.getByLabel('密码').fill(coreLeadFixtures.selfPassword);
    await readOnlyPage
      .getByRole('button', { name: '登录', exact: true })
      .click();
    await expect
      .poll(() => new URL(readOnlyPage.url()).pathname)
      .toBe('/cases');
    await readOnlyPage.goto(`/cases/${source.caseId}`);
    await expect(
      readOnlyPage.locator('[data-test="case-filing-panel"]'),
    ).toHaveCount(0);
    await expect(
      readOnlyPage.locator('[data-test="case-filing-record"]'),
    ).toContainText(courtName);
    await expect(
      readOnlyPage.locator('[data-test="filing-review"]'),
    ).toHaveCount(0);
    await expect(
      readOnlyPage.locator('[data-test="filing-submit"]'),
    ).toHaveCount(0);
    const readOnlyDownload = readOnlyPage.waitForEvent('download');
    await readOnlyPage
      .locator('[data-test="case-filing-record"]')
      .getByRole('button', { name: '下载' })
      .click();
    expect(await readFile(await (await readOnlyDownload).path())).toEqual(
      pdfBytes,
    );
  } finally {
    await readOnlyContext.close();
  }

  const clientContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  try {
    const clientPage = await clientContext.newPage();
    await clientPage.goto('/client/cases');
    await expect(clientPage).toHaveURL(/\/login\?returnTo=/u);
    await clientPage
      .getByLabel('用户名')
      .fill(source.clientSession.user.username);
    await clientPage.getByLabel('密码').fill('client correct horse battery');
    await clientPage.getByRole('button', { name: '登录', exact: true }).click();
    await expect(
      clientPage.getByRole('button', { name: '退出登录', exact: true }),
    ).toBeVisible();
    await clientPage.goto(`/client/cases/${source.caseId}`);
    await expect(
      clientPage.getByText('待正式立案', { exact: true }),
    ).toBeVisible();
    await expect(clientPage.getByText(courtName, { exact: true })).toHaveCount(
      0,
    );
    await expect(
      clientPage.locator('[data-test="case-filing-record"]'),
    ).toHaveCount(0);
  } finally {
    await clientContext.close();
  }
});
