import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import {
  coreLeadFixtures,
  resetCoreLeadE2eData,
  setRoleGrant,
} from '../support/core-lead-database.mjs';
import {
  clearCaseClosureFixture,
  createFinishedCaseClosureSourceThroughApi,
  setCaseClosureFixtureGrant,
} from '../support/case-closure-database.mjs';
import { createSubmittedCaseThroughApi } from '../support/case-complaint-confirmation-database.mjs';
import { clearCaseExecutionFinishFixture } from '../support/case-execution-finish-database.mjs';
import {
  allowOtherEnterpriseAccountSetup,
  clearCaseComplaintMailingFixture,
} from '../support/case-complaint-mailing-database.mjs';
import {
  clearCaseAcceptanceFault,
  clearCaseAcceptanceFixture,
  prepareCaseAcceptanceFixture,
} from '../support/case-acceptance-database.mjs';
import {
  clearCaseFilingFixture,
  prepareCaseFilingFixture,
} from '../support/case-filing-database.mjs';
import {
  clearCoreCaseHearingAdmin,
  clearCoreCaseHearingAdminSessions,
  prepareCoreCaseHearingAdmin,
} from '../support/case-hearing-database.mjs';
import { clearCoreCaseSecondInstanceFixture } from '../support/case-second-instance-database.mjs';
import { disconnectCustomerTestDatabase } from '../support/customer-database.mjs';

const operator = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };
const foreign = { Authorization: `Bearer ${coreLeadFixtures.tokenB}` };
const headerOrder = [
  '操作／案件编号',
  '案件进展',
  '客户',
  '权利主体',
  '平台',
  '店铺',
  '店铺ID',
  '被告',
  '律师',
  '法院',
  '案号',
  '标的额',
  '判决额',
  '结案额',
];
type Amount = {
  state: 'UNRECORDED' | 'PENDING' | 'KNOWN';
  amount: string | null;
  sourceType: string | null;
  sourceId: string | null;
};
type CaseRow = {
  id: string;
  businessNo: string;
  stage: string;
  canRecordClosure: boolean;
  sourceLead: { id: string; businessNo: string };
  displaySummary: {
    customerName: string;
    rightsHolderName: string;
    source: {
      platform: string;
      shopName: string;
      shopExternalId: string | null;
    };
    defendants: Array<{ id: string; name: string }>;
    lawyers: Array<{ id: string; fullName: string }>;
    court: { id: string; name: string } | null;
    courtCaseNo: string | null;
    claimAmount: Amount;
    judgmentAmount: Amount;
    closureAmount: Amount;
  };
};
async function body<T>(
  response: Awaited<ReturnType<APIRequestContext['get']>>,
  status = 200,
): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);
  return response.json() as Promise<T>;
}
async function signIn(
  page: Page,
  path: string,
  username: string,
  password: string,
) {
  await page.goto(path);
  await expect(page).toHaveURL(/\/login\?returnTo=/u);
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect
    .poll(() => new URL(page.url()).pathname)
    .toBe(new URL(path, 'http://127.0.0.1:5174').pathname);
}
async function clean() {
  await clearCaseClosureFixture();
  await clearCaseExecutionFinishFixture();
  await clearCoreCaseHearingAdminSessions();
  await clearCaseAcceptanceFault();
  await clearCoreCaseSecondInstanceFixture();
  await clearCaseAcceptanceFixture();
  await clearCaseFilingFixture();
  await clearCaseComplaintMailingFixture();
  await resetCoreLeadE2eData();
  await clearCoreCaseHearingAdmin();
}
test.beforeEach(async () => {
  if (process.env.NODE_ENV !== 'test')
    throw new Error('Case display acceptance requires NODE_ENV=test');
  await clean();
  await prepareCoreCaseHearingAdmin();
  await prepareCaseFilingFixture();
  await prepareCaseAcceptanceFixture();
  await allowOtherEnterpriseAccountSetup();
});
test.afterEach(clean);
test.afterAll(disconnectCustomerTestDatabase);

test('real case summary keeps fourteen display columns, source amounts and permission scope across navigation and viewports', async ({
  request,
  page,
  browser,
}, testInfo) => {
  test.setTimeout(300_000);
  const closedSource = await createFinishedCaseClosureSourceThroughApi(request);
  await setCaseClosureFixtureGrant(
    coreLeadFixtures.roleA,
    'case.closure.record',
    'TEAM',
  );
  const key = randomUUID();
  const closure = await body<{ closureVersionId: string }>(
    await request.post(`/api/v1/cases/${closedSource.caseId}/closure`, {
      headers: { ...operator, 'Idempotency-Key': key },
      data: {
        expectedVersion: closedSource.finished.version,
        expectedFinishId: closedSource.finished.finishId,
        idempotencyKey: key,
        closeAt: null,
        closeAmountState: 'KNOWN',
        closeAmt: '0.00',
        note: null,
        closeContentVersionIds: [],
      },
    }),
    201,
  );
  const defendants = [
    {
      kind: 'ORGANIZATION' as const,
      name: `华东多被告第一公司${'甲'.repeat(28)}`,
    },
    {
      kind: 'ORGANIZATION' as const,
      name: `华东多被告第二公司${'乙'.repeat(28)}`,
    },
  ];
  const submitted = await createSubmittedCaseThroughApi(request, {
    defendants,
  });
  const list = await body<{ items: CaseRow[]; total: number }>(
    await request.get('/api/v1/cases?view=department&page=1&pageSize=20', {
      headers: operator,
    }),
  );
  expect(list.total).toBe(2);
  const finishedRow = list.items.find(
    (item) => item.id === closedSource.caseId,
  );
  const submittedRow = list.items.find((item) => item.id === submitted.caseId);
  expect(finishedRow).toBeDefined();
  expect(submittedRow).toBeDefined();
  if (!finishedRow || !submittedRow)
    throw new Error('Real cases absent from internal list');
  const lead = await body<{
    displayNames: { customerName: string; rightsHolderName: string };
    platform: string;
    shopName: string;
    shopExternalId: string | null;
  }>(
    await request.get(`/api/v1/leads/${finishedRow.sourceLead.id}`, {
      headers: operator,
    }),
  );
  expect(finishedRow.displaySummary).toMatchObject({
    customerName: lead.displayNames.customerName,
    rightsHolderName: lead.displayNames.rightsHolderName,
    source: {
      platform: lead.platform,
      shopName: lead.shopName,
      shopExternalId: lead.shopExternalId,
    },
    courtCaseNo: expect.any(String),
    claimAmount: {
      state: 'KNOWN',
      amount: '123.45',
      sourceType: 'COMPLAINT_CONFIRMATION',
    },
    judgmentAmount: { state: 'PENDING', amount: null },
    closureAmount: {
      state: 'KNOWN',
      amount: '0.00',
      sourceType: 'CASE_CLOSURE_VERSION',
      sourceId: closure.closureVersionId,
    },
  });
  expect(finishedRow.displaySummary.defendants).toHaveLength(1);
  expect(finishedRow.displaySummary.lawyers).toHaveLength(1);
  expect(finishedRow.displaySummary.lawyers[0]?.fullName).toBeTruthy();
  expect(finishedRow.displaySummary.court?.name).toBeTruthy();
  expect(submittedRow.stage).toBe('WAITING_COMPLAINT_CONFIRMATION');
  expect(
    submittedRow.displaySummary.defendants
      .map((defendant) => defendant.name)
      .sort(),
  ).toEqual(defendants.map((defendant) => defendant.name).sort());
  expect(submittedRow.displaySummary.claimAmount).toMatchObject({
    state: 'KNOWN',
    amount: '123.45',
    sourceType: 'COMPLAINT_SUBMISSION',
  });
  expect(submittedRow.displaySummary.closureAmount).toEqual({
    state: 'UNRECORDED',
    amount: null,
    sourceType: null,
    sourceId: null,
  });
  expect(submittedRow.displaySummary.court).toBeNull();
  expect(submittedRow.displaySummary.courtCaseNo).toBeNull();
  const detail = await body<Record<string, unknown>>(
    await request.get(`/api/v1/cases/${closedSource.caseId}`, {
      headers: operator,
    }),
  );
  expect(detail).not.toHaveProperty('displaySummary');
  expect(detail.courtCaseNo).toBe(finishedRow.displaySummary.courtCaseNo);

  await setRoleGrant(coreLeadFixtures.roleSelf, 'case.read', 'DEPARTMENT');
  const sameDepartment = await body<{ items: CaseRow[] }>(
    await request.get('/api/v1/cases?view=department&page=1&pageSize=20', {
      headers: { Authorization: `Bearer ${coreLeadFixtures.tokenSelf}` },
    }),
  );
  expect(sameDepartment.items.map((item) => item.id).sort()).toEqual(
    [closedSource.caseId, submitted.caseId].sort(),
  );
  expect(
    sameDepartment.items.find((item) => item.id === closedSource.caseId)
      ?.canRecordClosure,
  ).toBe(false);
  const otherDepartment = await body<{ items: CaseRow[] }>(
    await request.get('/api/v1/cases?view=department&page=1&pageSize=20', {
      headers: foreign,
    }),
  );
  expect(otherDepartment.items).toEqual([]);
  expect(
    (
      await request.get(`/api/v1/cases/${closedSource.caseId}`, {
        headers: foreign,
      })
    ).status(),
  ).toBe(404);

  for (const [credentials, path] of [
    [closedSource.client, `/api/v1/client/cases/${closedSource.caseId}`],
    [closedSource.lawyer, `/api/v1/lawyer/cases/${closedSource.caseId}`],
  ] as const) {
    const context = await browser.newContext({
      baseURL: 'http://127.0.0.1:5174',
    });
    try {
      const external = await context.newPage();
      await external.goto('/login');
      await external.getByLabel('用户名').fill(credentials.username);
      await external.getByLabel('密码').fill(credentials.password);
      await external.getByRole('button', { name: '登录', exact: true }).click();
      await expect(external).not.toHaveURL(/\/login$/u);
      const response = await body<Record<string, unknown>>(
        await external.request.get(path),
      );
      expect(response).not.toHaveProperty('displaySummary');
      const listPath = path.replace(`/${closedSource.caseId}`, '');
      const externalList = await body<{
        items: Array<Record<string, unknown>>;
      }>(
        await external.request.get(
          listPath.startsWith('/api/v1/client/')
            ? `${listPath}?view=RECORDED`
            : listPath,
        ),
      );
      const externalRow = externalList.items.find(
        (row) => row.id === closedSource.caseId,
      );
      expect(externalRow).toBeDefined();
      expect(externalRow).not.toHaveProperty('displaySummary');
    } finally {
      await context.close();
    }
  }

  await signIn(
    page,
    '/notary-matters?stage=ARCHIVED&view=department&page=7',
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  await page.locator('[data-test="case-nav"]').click();
  await expect(page).toHaveURL(/\/cases$/u);
  const expand = page.locator('[data-test="case-expand"]');
  if ((await expand.getAttribute('aria-expanded')) !== 'true')
    await expand.click();
  await expect(page.locator('[data-test="case-view-mine"]')).toHaveClass(
    /(?:^|\s)active(?:\s|$)/u,
  );
  await expect(
    page.locator('[data-test="case-view-department"]'),
  ).not.toHaveClass(/(?:^|\s)active(?:\s|$)/u);
  await page.locator('[data-test="case-view-department"]').click();
  await expect(page).toHaveURL(/\/cases\?view=department$/u);
  await expect(page.locator('[data-test="case-view-department"]')).toHaveClass(
    /(?:^|\s)active(?:\s|$)/u,
  );
  await expect(page.locator('[data-test="case-view-mine"]')).not.toHaveClass(
    /(?:^|\s)active(?:\s|$)/u,
  );
  await page.locator('[data-test="complaint-preparation-stage"]').click();
  await expect(page).toHaveURL(/stageGroup=COMPLAINT_PREPARATION/u);
  await expect(
    page.locator('[data-test="complaint-preparation-stage"]'),
  ).toHaveClass(/(?:^|\s)active(?:\s|$)/u);
  await expect(page.locator('[data-test="case-list"] tbody tr')).toHaveCount(1);
  await expect(
    page.locator(`a[href*="/cases/${submitted.caseId}"]`),
  ).toBeVisible();
  await page.goto(
    '/cases?view=department&stage=WAITING_COMPLAINT_CONFIRMATION',
  );
  await expect(page.locator('[data-test="case-list"] tbody tr')).toHaveCount(1);
  await expect(
    page.locator(
      '[data-test="case-stage"].active, [data-test="complaint-preparation-stage"].active, [data-test="execution-preparation-stage"].active',
    ),
  ).toHaveCount(1);
  await expect(
    page.locator('[data-test="complaint-preparation-stage"]'),
  ).toHaveClass(/(?:^|\s)active(?:\s|$)/u);
  await expect(
    page.locator(`a[href*="/cases/${submitted.caseId}"]`),
  ).toBeVisible();

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    const label = `${viewport.width}x${viewport.height}`;
    await page.goto('/cases?view=department');
    const table = page.locator('[data-test="case-list"] table');
    await expect(table.locator('tbody tr')).toHaveCount(2);
    await expect(table.locator('thead th')).toHaveText(headerOrder);
    const closedCells = table
      .locator('tbody tr')
      .filter({ has: page.locator(`a[href*="/cases/${closedSource.caseId}"]`) })
      .locator('td');
    await expect(closedCells.nth(2)).toContainText(
      finishedRow.displaySummary.customerName,
    );
    await expect(closedCells.nth(3)).toContainText(
      finishedRow.displaySummary.rightsHolderName,
    );
    await expect(closedCells.nth(5)).toContainText(
      finishedRow.displaySummary.source.shopName,
    );
    await expect(closedCells.nth(6)).toContainText(
      finishedRow.displaySummary.source.shopExternalId ?? '未登记',
    );
    await expect(closedCells.nth(8)).toContainText(
      finishedRow.displaySummary.lawyers[0]!.fullName,
    );
    await expect(closedCells.nth(9)).toContainText(
      finishedRow.displaySummary.court!.name,
    );
    await expect(closedCells.nth(10)).toContainText(
      finishedRow.displaySummary.courtCaseNo!,
    );
    await expect(closedCells.nth(11)).toContainText('123.45');
    await expect(closedCells.nth(12)).toContainText('待定');
    await expect(closedCells.nth(13)).toContainText('0.00');
    const submittedCells = table
      .locator('tbody tr')
      .filter({ has: page.locator(`a[href*="/cases/${submitted.caseId}"]`) })
      .locator('td');
    await expect(submittedCells.nth(11)).toContainText('123.45');
    await expect(submittedCells.nth(13)).toContainText('未登记');
    const region = page.locator(
      '[data-test="case-list"] .business-list-scroll',
    );
    const dimensions = await region.evaluate((element) => ({
      width: element.clientWidth,
      scroll: element.scrollWidth,
    }));
    expect(dimensions.scroll).toBeGreaterThan(dimensions.width);
    await region.focus();
    await page.keyboard.press('ArrowRight');
    await expect
      .poll(() => region.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(0);
    expect(
      await page.evaluate(() => document.body.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width + 1);
    await region.evaluate((element) => {
      element.scrollLeft = 0;
    });
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      window.scrollTo(0, 0);
    });
    await page.screenshot({
      path: testInfo.outputPath(`cases-${label}.png`),
      fullPage: true,
    });
    await region.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
    });
    await page.screenshot({
      path: testInfo.outputPath(`cases-amounts-${label}.png`),
      fullPage: true,
    });
    const longRow = table
      .locator('tbody tr')
      .filter({ has: page.locator(`a[href*="/cases/${submitted.caseId}"]`) });
    await longRow.locator('td').nth(7).locator('details summary').click();
    await expect(longRow.locator('td').nth(7)).toContainText(
      defendants[0].name,
    );
    await expect(longRow.locator('td').nth(7)).toContainText(
      defendants[1].name,
    );
    expect(
      (await longRow.locator('td').nth(7).textContent()) ?? '',
    ).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu,
    );
    await region.evaluate((element) => {
      element.scrollLeft = 0;
    });
    await page.screenshot({
      path: testInfo.outputPath(`cases-expanded-${label}.png`),
      fullPage: true,
    });
  }
});
