import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  allowInjectedFailures,
  coreLeadFixtures,
  resetCoreLeadE2eData,
} from '../support/core-lead-database.mjs';
import { createSubmittedCaseThroughApi } from '../support/case-complaint-confirmation-database.mjs';

const dateShanghai = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

async function loginWithPassword(
  page: Page,
  path: string,
  username: string,
  password: string,
): Promise<void> {
  await page.goto(path);
  await expect(page).toHaveURL(/\/login\?returnTo=/u);
  const usernameInput = page.getByLabel('用户名');
  const passwordInput = page.getByLabel('密码');
  const loginButton = page.getByRole('button', {
    name: '登录',
    exact: true,
  });
  await expect(usernameInput).toBeVisible();
  await expect(passwordInput).toBeVisible();
  await usernameInput.fill(username);
  await passwordInput.fill(password);
  await expect(loginButton).toBeEnabled();
  await loginButton.click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(path);
  await expect(
    page.getByRole('button', { name: '退出登录', exact: true }),
  ).toBeVisible();
}

async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/u);
}

async function createLawyerInUi(
  page: Page,
  fullName: string,
  username: string,
  password: string,
): Promise<void> {
  const fullNameInput = page.getByLabel('真实姓名');
  const usernameInput = page.getByLabel('用户名');
  const passwordInput = page.getByLabel('初始密码');
  const createButton = page.getByRole('button', {
    name: '创建并绑定新档案',
  });
  await expect(fullNameInput).toBeVisible();
  await expect(usernameInput).toBeVisible();
  await expect(passwordInput).toBeVisible();
  await expect(createButton).toBeVisible();
  await fullNameInput.fill(fullName);
  await usernameInput.fill(username);
  await passwordInput.fill(password);
  await createButton.click();
  await expect(page.getByRole('status')).toContainText(
    '律师账号已创建，并已绑定新建的承办档案。',
  );
  await expect(
    page.getByRole('listitem').filter({ hasText: username }),
  ).toBeVisible();
}

async function matchCaseInUi(
  page: Page,
  caseId: string,
  lawyer: { displayName: string; username: string },
  defendantName: string,
): Promise<void> {
  await page.goto('/cases/' + caseId);
  const form = page.locator('[data-test="case-match-form"]');
  await expect(form).toBeVisible();
  const subjectType = form.getByLabel('主体类型');
  const defendantInput = form.getByLabel('名称');
  const lawyerSearch = form.getByLabel('按姓名或用户名搜索');
  const matchedOn = form.getByLabel('实际匹配日期');
  await expect(subjectType).toBeVisible();
  await expect(defendantInput).toBeVisible();
  await expect(lawyerSearch).toBeVisible();
  await expect(matchedOn).toBeVisible();
  await subjectType.selectOption('ORGANIZATION');
  await defendantInput.fill(defendantName);
  await lawyerSearch.fill(lawyer.username);
  const lawyerSelect = form.getByLabel('账号');
  const optionLabel = lawyer.displayName + '（' + lawyer.username + '）';
  await expect(lawyerSelect).toContainText(optionLabel);
  await lawyerSelect.selectOption({ label: optionLabel });
  await matchedOn.fill(dateShanghai());
  const matchButton = page.getByRole('button', {
    name: '确认匹配并进入待写诉状',
  });
  await expect(matchButton).toBeVisible();
  await matchButton.click();
  await expect(page.getByRole('status')).toContainText('待写诉状');
  await page.reload();
  await expect(
    page
      .getByRole('heading', { name: '当事人与承办律师' })
      .locator('xpath=following-sibling::ul[1]'),
  ).toContainText(defendantName);
}

async function downloadBytes(page: Page, button: Locator): Promise<Buffer> {
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  const ready = page.waitForEvent('download');
  await button.click();
  const download = await ready;
  const path = await download.path();
  if (path === null) throw new Error('浏览器未生成附件下载文件');
  return readFile(path);
}

test.beforeEach(async () => resetCoreLeadE2eData());
test.afterEach(async () => allowInjectedFailures());

test('管理员创建律师，律师独立办理真实来源案件并受账号撤销约束', async ({
  browser,
  page,
  request,
}) => {
  test.setTimeout(300_000);

  await loginWithPassword(
    page,
    '/settings/lawyer-accounts',
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );

  const tag = randomUUID().replaceAll('-', '').slice(0, 8);
  const lawyerA = {
    displayName: '浏览器律师甲-' + tag,
    username: 'lawyer-a-' + tag,
    password: 'Lawyer-' + randomUUID().slice(0, 16) + '-A!2026',
  };
  const lawyerB = {
    displayName: '浏览器律师乙-' + tag,
    username: 'lawyer-b-' + tag,
    password: 'Lawyer-' + randomUUID().slice(0, 16) + '-B!2026',
  };
  await createLawyerInUi(
    page,
    lawyerA.displayName,
    lawyerA.username,
    lawyerA.password,
  );
  await createLawyerInUi(
    page,
    lawyerB.displayName,
    lawyerB.username,
    lawyerB.password,
  );

  const sources = [];
  for (let index = 0; index < 3; index += 1) {
    sources.push(
      await createSubmittedCaseThroughApi(request, {
        stopAtPendingMatch: true,
      }),
    );
  }
  const caseA1 = sources[0]!;
  const caseA2 = sources[1]!;
  const caseB1 = sources[2]!;

  await matchCaseInUi(page, caseA1.caseId, lawyerA, '甲律师验收被告公司');
  await matchCaseInUi(page, caseA2.caseId, lawyerA, '甲律师第二案件公司');
  await matchCaseInUi(page, caseB1.caseId, lawyerB, '乙律师验收被告公司');
  const caseA1Response = await request.get('/api/v1/cases/' + caseA1.caseId, {
    headers: { Authorization: 'Bearer ' + coreLeadFixtures.tokenA },
  });
  expect(caseA1Response.status(), await caseA1Response.text()).toBe(200);
  const caseA1BusinessNo = (await caseA1Response.json()).businessNo as string;

  await logout(page);
  const lawyerPage = await browser.newPage();
  await loginWithPassword(
    lawyerPage,
    '/lawyer/cases',
    lawyerA.username,
    lawyerA.password,
  );
  const lawyerNav = lawyerPage.getByRole('navigation', { name: '律师导航' });
  await expect(lawyerNav.getByText('本人案件')).toBeVisible();
  await expect(lawyerNav.getByText('设置')).toHaveCount(0);
  const ownCases = lawyerPage.locator('[data-test="lawyer-case-list"] li');
  await expect(ownCases).toHaveCount(2);
  await expect(
    lawyerPage.locator(
      '[data-test="lawyer-case-list"] a[href="/lawyer/cases/' +
        caseA1.caseId +
        '"]',
    ),
  ).toBeVisible();
  await expect(
    lawyerPage.locator(
      '[data-test="lawyer-case-list"] a[href="/lawyer/cases/' +
        caseA2.caseId +
        '"]',
    ),
  ).toBeVisible();
  await expect(
    lawyerPage.locator(
      '[data-test="lawyer-case-list"] a[href="/lawyer/cases/' +
        caseB1.caseId +
        '"]',
    ),
  ).toHaveCount(0);

  await lawyerPage.goto('/lawyer/cases/' + caseA1.caseId);
  await expect(lawyerPage.locator('.page-head')).toContainText('待写诉状');
  await expect(lawyerPage.locator('body')).not.toContainText('120.00');
  const certificateSection = lawyerPage
    .getByRole('heading', { name: '证书材料' })
    .locator('xpath=following-sibling::ul[1]');
  const certificateRow = certificateSection
    .getByRole('listitem')
    .filter({ hasText: caseA1.certificateFile.originalFilename });
  await expect(certificateRow).toBeVisible();
  expect(
    await downloadBytes(
      lawyerPage,
      certificateRow.getByRole('button', { name: '下载' }),
    ),
  ).toEqual(Buffer.from(caseA1.certificateBytes));

  const complaintBytes = Buffer.from(
    '%PDF-1.4\nLAWYER browser complaint bytes\n%%EOF\n',
  );
  const authorizationBytes = Buffer.from(
    '%PDF-1.4\nLAWYER browser authorization bytes\n%%EOF\n',
  );
  const complaintName = '律师起诉状-' + tag + '.pdf';
  const authorizationName = '律师授权书-' + tag + '.pdf';
  const complaintForm = lawyerPage.locator(
    '[data-test="complaint-submit-form"]',
  );
  await expect(complaintForm).toBeVisible();
  await expect(complaintForm.locator('input[type="file"]')).toHaveCount(2);
  await complaintForm.locator('input[type="file"]').nth(0).setInputFiles({
    name: complaintName,
    mimeType: 'application/pdf',
    buffer: complaintBytes,
  });
  await expect(complaintForm.getByText(complaintName)).toBeVisible();
  await complaintForm.locator('input[type="file"]').nth(1).setInputFiles({
    name: authorizationName,
    mimeType: 'application/pdf',
    buffer: authorizationBytes,
  });
  await expect(complaintForm.getByText(authorizationName)).toBeVisible();
  const complaintAmount = complaintForm.getByRole('textbox', {
    name: '金额',
    exact: true,
  });
  const complaintSubmit = complaintForm.locator(
    '[data-test="submit-complaint"]',
  );
  await expect(complaintAmount).toBeVisible();
  await expect(complaintSubmit).toBeEnabled();
  await complaintAmount.fill('123.45');
  await complaintSubmit.click();
  await expect(lawyerPage.locator('.page-head')).toContainText('诉状待确认');
  const complaintRow = lawyerPage
    .getByRole('listitem')
    .filter({ hasText: complaintName });
  expect(
    await downloadBytes(
      lawyerPage,
      complaintRow.getByRole('button', { name: '下载' }),
    ),
  ).toEqual(complaintBytes);
  const authorizationRow = lawyerPage
    .getByRole('listitem')
    .filter({ hasText: authorizationName });
  expect(
    await downloadBytes(
      lawyerPage,
      authorizationRow.getByRole('button', { name: '下载' }),
    ),
  ).toEqual(authorizationBytes);

  await expect(
    lawyerPage.locator('[data-test="confirmation-form"]'),
  ).toBeVisible();
  const confirmationVersion = lawyerPage
    .locator('[data-test^="complaint-version-"]')
    .first();
  const confirmationAmount = lawyerPage.locator(
    '[data-test="confirmation-amount"]',
  );
  const confirmationDisclosure = lawyerPage.locator(
    '[data-test="confirm-disclose-false"]',
  );
  const confirmationReview = lawyerPage.locator(
    '[data-test="confirmation-review"]',
  );
  const confirmationSubmit = lawyerPage.locator(
    '[data-test="confirmation-submit"]',
  );
  await expect(confirmationVersion).toBeVisible();
  await expect(confirmationAmount).toBeVisible();
  await expect(confirmationDisclosure).toBeVisible();
  await expect(confirmationReview).toBeVisible();
  await confirmationVersion.check();
  await confirmationAmount.fill('123.45');
  await confirmationDisclosure.check();
  await confirmationReview.click();
  await expect(confirmationSubmit).toBeVisible();
  await confirmationSubmit.click();
  await expect(lawyerPage.locator('.page-head')).toContainText('诉状待盖章');

  const mailingPanel = lawyerPage.locator(
    '[data-test="complaint-mailing-panel"]',
  );
  await expect(mailingPanel).toBeVisible();
  const mailedAt = mailingPanel.getByLabel('实际邮寄日期');
  const mailingFile = mailingPanel.locator('input[type="file"]');
  await expect(mailedAt).toBeVisible();
  await expect(mailingFile).toBeVisible();
  await mailedAt.fill(dateShanghai());
  const receiptBytes = Buffer.from(
    '%PDF-1.4\nLAWYER browser mail receipt bytes\n%%EOF\n',
  );
  const receiptName = '律师邮寄回执-' + tag + '.pdf';
  await mailingFile.setInputFiles({
    name: receiptName,
    mimeType: 'application/pdf',
    buffer: receiptBytes,
  });
  await expect(mailingPanel.getByText(receiptName)).toBeVisible();
  const mailingReview = mailingPanel.getByRole('button', {
    name: '核对邮寄信息',
  });
  const mailingSubmit = mailingPanel.locator('[data-test="mailing-submit"]');
  await expect(mailingReview).toBeVisible();
  await mailingReview.click();
  await expect(mailingSubmit).toBeVisible();
  await mailingSubmit.click();
  await expect(lawyerPage.locator('.page-head')).toContainText('待提交立案');
  const receiptRow = mailingPanel
    .getByRole('listitem')
    .filter({ hasText: receiptName });
  expect(
    await downloadBytes(
      lawyerPage,
      receiptRow.getByRole('button', { name: '下载' }),
    ),
  ).toEqual(receiptBytes);

  const filingPanel = lawyerPage.locator('[data-test="case-filing-panel"]');
  await expect(filingPanel).toBeVisible();
  const courtName = '浏览器验收法院-' + tag;
  const courtNameInput = filingPanel.locator('[data-test="filing-court-name"]');
  const courtCreate = filingPanel.locator('[data-test="filing-court-create"]');
  await expect(courtNameInput).toBeVisible();
  await expect(courtCreate).toBeVisible();
  await courtNameInput.fill(courtName);
  await courtCreate.click();
  const courtFixed = filingPanel.locator('[data-test="filing-court-fixed"]');
  await expect(courtFixed).toHaveValue(/.+/u);
  const filingBytes = Buffer.from(
    '%PDF-1.4\nLAWYER browser filing evidence bytes\n%%EOF\n',
  );
  const filingName = '律师立案证据-' + tag + '.pdf';
  const filingEvidence = filingPanel.locator(
    '[data-test="filing-evidence-input"]',
  );
  const submittedAt = filingPanel.locator('[data-test="filing-submitted-at"]');
  const mediationNo = filingPanel.locator('[data-test="filing-mediation-no"]');
  const filingReview = filingPanel.locator('[data-test="filing-review"]');
  await expect(filingEvidence).toBeVisible();
  await filingEvidence.setInputFiles({
    name: filingName,
    mimeType: 'application/pdf',
    buffer: filingBytes,
  });
  await expect(filingPanel.getByText(filingName)).toBeVisible();
  await expect(submittedAt).toBeVisible();
  await expect(mediationNo).toBeVisible();
  await expect(filingReview).toBeVisible();
  await submittedAt.fill(dateShanghai());
  await mediationNo.fill('律所调-' + tag);
  await filingReview.click();
  const filingSubmit = filingPanel.locator('[data-test="filing-submit"]');
  await expect(filingSubmit).toBeVisible();
  await filingSubmit.click();
  await expect(lawyerPage.locator('.page-head')).toContainText('待正式立案');
  await expect(lawyerPage.getByText(courtName)).toBeVisible();
  await expect(
    lawyerPage.getByText('诉调号：律所调-' + tag, { exact: true }),
  ).toBeVisible();
  const filedCaseResponse = await lawyerPage.request.get(
    '/api/v1/lawyer/cases/' + caseA1.caseId,
  );
  expect(filedCaseResponse.status()).toBe(200);
  expect(await filedCaseResponse.json()).toMatchObject({
    stage: 'WAITING_FORMAL_ACCEPTANCE',
    filingSubmission: {
      court: { name: courtName },
      mediationNo: '律所调-' + tag,
      evidenceFiles: [
        expect.objectContaining({ originalFilename: filingName }),
      ],
    },
  });
  const filingRow = lawyerPage
    .getByRole('listitem')
    .filter({ hasText: filingName });
  expect(
    await downloadBytes(
      lawyerPage,
      filingRow.getByRole('button', { name: '下载' }),
    ),
  ).toEqual(filingBytes);

  await lawyerPage.reload();
  await expect(lawyerPage.locator('.page-head')).toContainText('待正式立案');
  await expect(lawyerPage.getByText(courtName)).toBeVisible();
  await logout(lawyerPage);
  await loginWithPassword(
    lawyerPage,
    '/lawyer/cases',
    lawyerA.username,
    lawyerA.password,
  );
  await expect(
    lawyerPage.locator('[data-test="lawyer-case-list"]'),
  ).toContainText('待正式立案');
  await lawyerPage.goto('/lawyer/cases/' + caseA1.caseId);
  await expect(lawyerPage.locator('.page-head')).toContainText('待正式立案');
  await expect(lawyerPage.getByText(courtName)).toBeVisible();

  const lawyerBPage = await browser.newPage();
  await loginWithPassword(
    lawyerBPage,
    '/lawyer/cases',
    lawyerB.username,
    lawyerB.password,
  );
  await expect(
    lawyerBPage.locator('[data-test="lawyer-case-list"] li'),
  ).toHaveCount(1);
  await expect(
    lawyerBPage.locator(
      '[data-test="lawyer-case-list"] a[href="/lawyer/cases/' +
        caseB1.caseId +
        '"]',
    ),
  ).toBeVisible();
  await lawyerBPage.goto('/lawyer/cases/' + caseA1.caseId);
  await expect(
    lawyerBPage.getByRole('heading', { name: '案件暂不可访问' }),
  ).toBeVisible();
  await expect(lawyerBPage.locator('body')).not.toContainText(caseA1BusinessNo);

  const adminPage = await browser.newPage();
  await loginWithPassword(
    adminPage,
    '/settings/lawyer-accounts',
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  const lawyerARow = adminPage
    .getByRole('listitem')
    .filter({ hasText: lawyerA.username });
  await lawyerARow.getByRole('button', { name: '停用账号' }).click();
  await expect(adminPage.getByRole('status')).toContainText('账号已停用');
  const revokedRead = await lawyerPage.request.get(
    '/api/v1/lawyer/cases/' + caseA1.caseId,
  );
  expect([401, 403, 404]).toContain(revokedRead.status());
  await lawyerPage.goto('/lawyer/cases/' + caseA1.caseId);
  await expect
    .poll(async () => {
      const path = new URL(lawyerPage.url()).pathname;
      const inaccessible = await lawyerPage
        .getByRole('heading', { name: '案件暂不可访问' })
        .count();
      return path === '/login' || path === '/health' || inaccessible > 0;
    })
    .toBe(true);
  await expect(lawyerPage.locator('body')).not.toContainText(caseA1BusinessNo);

  await adminPage.close();
  await lawyerBPage.close();
  await lawyerPage.close();
});
