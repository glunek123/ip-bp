import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const columns = [
  'businessNo',
  'stage',
  'customerName',
  'rightsHolderName',
  'platform',
  'shopName',
  'shopExternalId',
  'defendants',
  'lawyers',
  'court',
  'courtCaseNo',
  'claimAmount',
  'judgmentAmount',
  'closureAmount',
];
const counts = {
  PENDING_MATCH: 0,
  WAITING_COMPLAINT: 0,
  WAITING_COMPLAINT_CONFIRMATION: 0,
  WAITING_COMPLAINT_STAMP: 0,
  WAITING_FILING: 0,
  WAITING_FORMAL_ACCEPTANCE: 0,
  WAITING_HEARING: 0,
  WAITING_JUDGMENT: 0,
  SECOND_INSTANCE: 0,
  WAITING_EXECUTION_DOCUMENTS: 0,
  WAITING_EXECUTION_CONFIRMATION: 0,
  WAITING_EXECUTION_STAMP: 0,
  WAITING_EXECUTION_FILING: 0,
  EXECUTING: 0,
  WAITING_ARCHIVE: 0,
  ARCHIVED: 0,
};
const syntheticCase = {
  id: 'synthetic-case',
  businessNo: 'CA-SYNTHETIC-001',
  stage: 'WAITING_COMPLAINT',
  createdAt: '2026-11-01T00:00:00.000Z',
  version: 1,
  owner: { id: 'synthetic-operator', displayName: '测试运营' },
  sourceLead: { id: 'synthetic-lead', businessNo: 'LD-SYNTHETIC-001' },
  sourceNotaryMatter: {
    id: 'synthetic-matter',
    businessNo: 'NZ-SYNTHETIC-001',
  },
  canMatch: false,
  canSubmitComplaint: false,
  canConfirmComplaint: false,
  canMailComplaint: false,
  canSubmitFiling: false,
  canRegisterAcceptance: false,
  canUploadAcceptanceMaterials: false,
  canScheduleHearing: false,
  canCorrectHearing: false,
  canRegisterJudgment: false,
  canCorrectJudgment: false,
  canChooseJudgmentNextStep: false,
  canRevokeJudgmentNextStep: false,
  canSaveSecondInstance: false,
  canRegisterSecondInstanceResult: false,
  canRevokeSecondInstanceResult: false,
  canSubmitExecution: false,
  canConfirmExecution: false,
  canMailExecution: false,
  canSubmitExecutionFiling: false,
  canFinishExecution: false,
  canRecordClosure: false,
  canCorrectClosure: false,
  canArchive: false,
  canCorrectArchive: false,
  displaySummary: {
    customerName: '合成测试客户',
    rightsHolderName: '合成测试权利主体',
    source: {
      platform: 'TMALL',
      shopName: '合成测试店铺',
      shopExternalId: 'SYNTHETIC-STORE-001',
    },
    defendants: [{ id: 'synthetic-defendant', name: '合成测试被告' }],
    lawyers: [{ id: 'synthetic-lawyer', fullName: '合成测试律师' }],
    court: { id: 'synthetic-court', name: '合成测试法院' },
    courtCaseNo: '（2026）合成民初001号',
    claimAmount: {
      state: 'UNRECORDED',
      amount: null,
      sourceType: null,
      sourceId: null,
    },
    judgmentAmount: {
      state: 'UNRECORDED',
      amount: null,
      sourceType: null,
      sourceId: null,
    },
    closureAmount: {
      state: 'UNRECORDED',
      amount: null,
      sourceType: null,
      sourceId: null,
    },
  },
};

test('mine owner preference and workflow stage filter use synthetic browser responses', async ({
  page,
}) => {
  const preferences = new Map<string, { order: string[]; hidden: string[] }>();
  const listQueries: URL[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    if (path === '/auth/session') {
      await route.fulfill({
        json: {
          principalType: 'INTERNAL',
          user: {
            id: 'synthetic-operator',
            displayName: '测试运营',
            username: 'synthetic-operator',
          },
          department: { id: 'synthetic-department', name: '测试部门' },
          departments: [{ id: 'synthetic-department', name: '测试部门' }],
          customer: null,
          notaryOffice: null,
          authorizationRevision: 1,
          expiresAt: '2099-01-01T00:00:00.000Z',
          csrfToken: 'synthetic-csrf',
        },
      });
      return;
    }
    if (path === '/cases/list-preferences/COMPLAINT_PREPARATION') {
      const view = url.searchParams.get('view') ?? 'department';
      const key = `${view}:${path}`;
      if (route.request().method() === 'PUT') {
        const body = route.request().postDataJSON() as {
          order: string[];
          hidden: string[];
        };
        preferences.set(key, body);
        await route.fulfill({ json: body });
        return;
      }
      await route.fulfill({
        json: preferences.get(key) ?? {
          order: columns,
          hidden: view === 'mine' ? ['owner'] : [],
        },
      });
      return;
    }
    if (path === '/cases') {
      listQueries.push(url);
      await route.fulfill({
        json: {
          items: [syntheticCase],
          total: 1,
          page: Number(url.searchParams.get('page') ?? 1),
          pageSize: Number(url.searchParams.get('pageSize') ?? 20),
          counts,
        },
      });
      return;
    }
    await route.fulfill({
      status: 403,
      json: { code: 'ACTION_FORBIDDEN', message: 'synthetic response' },
    });
  });

  await page.goto('/cases?view=mine&stageGroup=COMPLAINT_PREPARATION');
  const progress = page.locator('[data-test="case-workflow-stage-filter"]');
  await expect(progress).toBeVisible();
  await expect(progress.locator('option')).toHaveText([
    '全部进展',
    '待写诉状',
    '诉状待确认',
    '诉状待盖章',
  ]);

  await page.locator('[data-test="open-column-settings"]').click();
  const ownerRow = page.getByRole('dialog').locator('li').filter({
    hasText: '负责人',
  });
  await expect(ownerRow.getByRole('checkbox')).not.toBeChecked();
  await ownerRow.getByRole('checkbox').check();
  const screenshot = resolve(
    '.local/case-workflow-acceptance/case-list-settings-browser.png',
  );
  await mkdir(dirname(screenshot), { recursive: true });
  await page.screenshot({ path: screenshot, fullPage: true });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('th[data-column="owner"]')).toBeVisible();
  await page.reload();
  await expect(page.locator('th[data-column="owner"]')).toBeVisible();

  await page
    .locator('[data-test="case-workflow-stage-filter"]')
    .selectOption('WAITING_COMPLAINT_CONFIRMATION');
  await expect(page).toHaveURL(/stage=WAITING_COMPLAINT_CONFIRMATION/u);
  await expect(page).not.toHaveURL(/stageGroup=/u);
  const filter = page.getByTestId('case-workflow-stage-filter');
  await expect(filter).toHaveValue('WAITING_COMPLAINT_CONFIRMATION');
  await filter.selectOption('');
  await expect(page).toHaveURL(/stageGroup=COMPLAINT_PREPARATION/u);
  expect(
    listQueries.some(
      (query) =>
        query.searchParams.get('stage') === 'WAITING_COMPLAINT_CONFIRMATION',
    ),
  ).toBe(true);
  expect(
    [...preferences.values()].some((preference) =>
      preference.hidden.includes('owner'),
    ),
  ).toBe(false);
});
