import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
  allowInjectedFailures,
  coreLeadFixtures,
  disconnectCoreLeadTestDatabase,
  getNotaryListExportAudits,
  moveNotaryListExportMatterToOtherStage,
  rejectAuditWrites,
  resetCoreLeadE2eData,
  seedNotaryListExportData,
  seedNotaryListExportOverLimitData,
  setInternalAccountActive,
  setRoleGrant,
} from '../support/core-lead-database.mjs';

test.beforeEach(async () => {
  await resetCoreLeadE2eData();
});

test('real authorized filtered scope above 1000 is rejected without audit', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await seedNotaryListExportOverLimitData();
  await page.goto('/notary-matters?stage=PENDING_EVIDENCE');
  await expect(page).toHaveURL(/\/login\?returnTo=/u);
  await page.getByLabel('用户名').fill(coreLeadFixtures.operatorUsername);
  await page.getByLabel('密码').fill(coreLeadFixtures.operatorPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/notary-matters\?stage=PENDING_EVIDENCE/u);
  await expect(page.locator('[data-test="matter-row"]')).toHaveCount(20);

  const session = await page.request.get('/api/v1/auth/session');
  expect(session.status(), await session.text()).toBe(200);
  const sessionBody = (await session.json()) as { csrfToken: string };
  const csrfToken = sessionBody.csrfToken;
  const list = await page.request.get(
    '/api/v1/notary-matters?page=1&pageSize=20&stage=PENDING_EVIDENCE',
  );
  expect(list.status(), await list.text()).toBe(200);
  const preview = await page.request.post(
    '/api/v1/notary-matters/exports/preview',
    {
      headers: { 'X-CSRF-Token': csrfToken },
      data: { mode: 'FILTERED', stage: 'PENDING_EVIDENCE' },
    },
  );
  expect(preview.status(), await preview.text()).toBe(400);
  await expect(preview.json()).resolves.toMatchObject({
    code: 'EXPORT_LIMIT_EXCEEDED',
  });

  const final = await page.request.post('/api/v1/notary-matters/exports', {
    headers: { 'X-CSRF-Token': csrfToken },
    data: {
      mode: 'FILTERED',
      stage: 'PENDING_EVIDENCE',
      expectedCount: 1000,
    },
  });
  expect(final.status(), await final.text()).toBe(409);
  await expect(final.json()).resolves.toMatchObject({
    code: 'EXPORT_SCOPE_CHANGED',
  });
  expect(await getNotaryListExportAudits()).toHaveLength(0);
});

test.afterAll(async () => {
  await disconnectCoreLeadTestDatabase();
});

test('real operator selects across pages, previews and downloads explicit ranges from isolated PostgreSQL', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const matters = await seedNotaryListExportData();
  const inScope = matters.filter((matter) => matter.scopeKind === 'TEAM');
  const foreign = matters.find(
    (matter) => matter.departmentId === coreLeadFixtures.departmentB,
  )!;

  await page.goto('/notary-matters?stage=PENDING_EVIDENCE');
  await expect(page).toHaveURL(/\/login\?returnTo=/u);
  await page.getByLabel('用户名').fill(coreLeadFixtures.operatorUsername);
  await page.getByLabel('密码').fill(coreLeadFixtures.operatorPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/notary-matters\?stage=PENDING_EVIDENCE/u);
  await expect(page.locator('[data-test="matter-row"]')).toHaveCount(20);
  await expect(page.getByText(foreign.businessNo)).toHaveCount(0);

  await page.getByRole('button', { name: '列设置' }).click();
  await page.locator('[data-column-key="sourceLead"]').uncheck();
  await page.locator('[data-column-key="notaryOffice"]').uncheck();
  await page.locator('[data-column-key="createdAt"]').uncheck();
  await page.locator('[data-test="save-columns"]').click();
  await expect(page.locator('thead th')).toHaveCount(3);
  await page.getByRole('button', { name: '列设置' }).click();
  const firstPageBusinessNo = await page
    .locator('[data-test="matter-link"]')
    .first()
    .innerText();
  const firstPageMatterId = (await page
    .locator('[data-test="matter-link"]')
    .first()
    .getAttribute('href'))!
    .split('/')
    .at(-1)!;
  await page.locator('[data-test="select-matter"]').first().check();
  await page.locator('[data-test="next-page"]').click();
  await expect(page.locator('[data-test="matter-row"]')).toHaveCount(2);
  const secondPageBusinessNo = await page
    .locator('[data-test="matter-link"]')
    .first()
    .innerText();
  const secondPageMatterId = (await page
    .locator('[data-test="matter-link"]')
    .first()
    .getAttribute('href'))!
    .split('/')
    .at(-1)!;
  await page.locator('[data-test="select-matter"]').first().check();
  await expect(page.locator('[data-test="selected-count"]')).toContainText(
    '已选择 2 项',
  );

  await page.locator('[data-test="export-open"]').click();
  await page.locator('[data-test="export-mode-selected"]').check();
  await expect(page.locator('[data-test="export-confirm"]')).toHaveCount(0);
  await page.locator('[data-test="export-preview"]').click();
  await expect(
    page.locator('[data-test="export-preview-count"]'),
  ).toContainText('共 2 条');
  await page.screenshot({
    path: '.local/logs/nt009-task2-export-preview.png',
    fullPage: true,
  });
  const selectedDownloadPromise = page.waitForEvent('download');
  await page.locator('[data-test="export-confirm"]').click();
  const selectedDownload = await selectedDownloadPromise;
  const selectedCsv = await readFile(await selectedDownload.path(), 'utf8');
  expect(selectedCsv).toContain(
    '公证事项编号,阶段,来源线索编号,公证处,创建时间',
  );
  expect(selectedCsv).toContain("'=HYPERLINK");
  expect(selectedCsv.split('\r\n').filter(Boolean)).toHaveLength(3);
  expect(selectedCsv).toContain(firstPageBusinessNo);
  expect(selectedCsv).toContain(secondPageBusinessNo);
  expect(selectedCsv).not.toContain(foreign.businessNo);
  expect(await getNotaryListExportAudits()).toMatchObject([
    {
      actorUserId: coreLeadFixtures.userA,
      details: { mode: 'SELECTED', count: 2 },
    },
  ]);
  const selectedAudit = (await getNotaryListExportAudits())[0]!.details as {
    actualIds: string[];
  };
  expect(selectedAudit.actualIds.toSorted()).toEqual(
    [firstPageMatterId, secondPageMatterId].toSorted(),
  );

  await page.locator('[data-test="export-mode-filtered"]').check();
  await page.locator('[data-test="export-preview"]').click();
  await expect(
    page.locator('[data-test="export-preview-count"]'),
  ).toContainText('共 22 条');
  const filteredDownloadPromise = page.waitForEvent('download');
  await page.locator('[data-test="export-confirm"]').click();
  const filteredDownload = await filteredDownloadPromise;
  const filteredCsv = await readFile(await filteredDownload.path(), 'utf8');
  expect(filteredCsv.split('\r\n').filter(Boolean)).toHaveLength(23);
  for (const matter of inScope.filter(
    (matter) => matter.stage === 'PENDING_EVIDENCE',
  ))
    expect(filteredCsv).toContain(matter.businessNo);
  expect(filteredCsv).not.toContain('NT-EXPORT-OTHER-STAGE');
  expect(filteredCsv).not.toContain(foreign.businessNo);
  expect(filteredCsv).toContain('来源线索编号');
  expect(filteredCsv).toContain("'=HYPERLINK");
  const audits = await getNotaryListExportAudits();
  expect(audits).toHaveLength(2);
  expect(
    audits.map((audit) => (audit.details as { count: number }).count),
  ).toEqual([2, 22]);
  const filteredAudit = audits[1]!.details as { actualIds: string[] };
  expect(filteredAudit.actualIds.toSorted()).toEqual(
    inScope
      .filter((matter) => matter.stage === 'PENDING_EVIDENCE')
      .map((matter) => matter.id)
      .toSorted(),
  );

  await page.locator('[data-test="export-mode-filtered"]').check();
  await page.locator('[data-test="export-preview"]').click();
  await expect(
    page.locator('[data-test="export-preview-count"]'),
  ).toContainText('共 22 条');
  await rejectAuditWrites('notary.list.export.generated');
  try {
    const auditFailureDownload = page
      .waitForEvent('download', { timeout: 1_000 })
      .catch(() => null);
    await page.locator('[data-test="export-confirm"]').click();
    await expect(page.locator('[data-test="export-confirm"]')).toHaveCount(0);
    expect(await auditFailureDownload).toBeNull();
    await expect(getNotaryListExportAudits()).resolves.toHaveLength(2);
  } finally {
    await allowInjectedFailures();
  }

  await page.locator('[data-test="export-preview"]').click();
  await expect(
    page.locator('[data-test="export-preview-count"]'),
  ).toContainText('共 22 条');
  await moveNotaryListExportMatterToOtherStage(
    inScope.find((matter) => matter.businessNo === 'NT-EXPORT-022')!.id,
  );
  const changedScopeDownload = page
    .waitForEvent('download', { timeout: 1_000 })
    .catch(() => null);
  await page.locator('[data-test="export-confirm"]').click();
  await expect(page.locator('[data-test="export-status"]')).toContainText(
    '事项数量已变化',
  );
  expect(await changedScopeDownload).toBeNull();
  await expect(getNotaryListExportAudits()).resolves.toHaveLength(2);

  await page.reload();
  await expect(page.locator('thead th')).toHaveCount(3);
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login$/u);
  await page.getByLabel('用户名').fill(coreLeadFixtures.operatorUsername);
  await page.getByLabel('密码').fill(coreLeadFixtures.operatorPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/customers$/u);
  await page.goto('/notary-matters?stage=PENDING_EVIDENCE');
  await expect(page.locator('thead th')).toHaveCount(3);

  const session = await page.request.get('/api/v1/auth/session');
  const csrfToken = (await session.json()).csrfToken as string;
  const exportUrl = '/api/v1/notary-matters/exports/preview';
  const emptyScope = await page.request.post(exportUrl, {
    headers: { 'X-CSRF-Token': csrfToken },
    data: { mode: 'SELECTED', matterIds: [] },
  });
  expect(emptyScope.status(), await emptyScope.text()).toBe(400);
  const oversizedScope = await page.request.post(exportUrl, {
    headers: { 'X-CSRF-Token': csrfToken },
    data: {
      mode: 'SELECTED',
      matterIds: Array.from({ length: 1001 }, () => randomUUID()),
    },
  });
  expect(oversizedScope.status(), await oversizedScope.text()).toBe(400);
  const forgedId = await page.request.post(exportUrl, {
    headers: { 'X-CSRF-Token': csrfToken },
    data: { mode: 'SELECTED', matterIds: [randomUUID()] },
  });
  expect(forgedId.status(), await forgedId.text()).toBe(403);

  const clientUsername = 'nt-export-client';
  const clientPassword = 'client export password';
  const clientAccount = await page.request.post(
    `/api/v1/customers/${coreLeadFixtures.admittedCustomer}/client-accounts`,
    {
      headers: { 'X-CSRF-Token': csrfToken },
      data: {
        displayName: '导出测试客户',
        username: clientUsername,
        password: clientPassword,
      },
    },
  );
  expect(clientAccount.status(), await clientAccount.text()).toBe(201);
  const notaryUsername = 'nt-export-notary';
  const notaryPassword = 'notary export password';
  const notaryAccount = await page.request.post(
    `/api/v1/notary-offices/${inScope[0]!.notaryOfficeId}/accounts`,
    {
      headers: { 'X-CSRF-Token': csrfToken },
      data: {
        displayName: '导出测试公证员',
        username: notaryUsername,
        password: notaryPassword,
      },
    },
  );
  expect(notaryAccount.status(), await notaryAccount.text()).toBe(201);
  await setRoleGrant(
    coreLeadFixtures.roleA,
    'notary.list.export',
    'TEAM',
    false,
  );
  const revoked = await page.request.post(
    '/api/v1/notary-matters/exports/preview',
    {
      headers: { 'X-CSRF-Token': csrfToken },
      data: { mode: 'FILTERED', stage: 'PENDING_EVIDENCE' },
    },
  );
  expect(revoked.status(), await revoked.text()).toBe(403);
  await setInternalAccountActive(coreLeadFixtures.userA, false);
  const inactive = await page.request.post(exportUrl, {
    headers: { 'X-CSRF-Token': csrfToken },
    data: { mode: 'FILTERED', stage: 'PENDING_EVIDENCE' },
  });
  expect(inactive.status(), await inactive.text()).toBe(401);
  await setInternalAccountActive(coreLeadFixtures.userA, true);

  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login$/u);
  const anonymous = await page.request.post(exportUrl, {
    data: { mode: 'FILTERED', stage: 'PENDING_EVIDENCE' },
  });
  expect(anonymous.status(), await anonymous.text()).toBe(401);

  await page.getByLabel('用户名').fill(clientUsername);
  await page.getByLabel('密码').fill(clientPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/client\/leads$/u);
  const clientSession = await page.request.get('/api/v1/auth/session');
  const clientCsrf = (await clientSession.json()).csrfToken as string;
  const clientDenied = await page.request.post(exportUrl, {
    headers: { 'X-CSRF-Token': clientCsrf },
    data: { mode: 'FILTERED', stage: 'PENDING_EVIDENCE' },
  });
  expect(clientDenied.status(), await clientDenied.text()).toBe(403);

  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login$/u);
  await page.getByLabel('用户名').fill(notaryUsername);
  await page.getByLabel('密码').fill(notaryPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/notary-portal\/matters$/u);
  const notarySession = await page.request.get('/api/v1/auth/session');
  const notaryCsrf = (await notarySession.json()).csrfToken as string;
  const notaryDenied = await page.request.post(exportUrl, {
    headers: { 'X-CSRF-Token': notaryCsrf },
    data: { mode: 'FILTERED', stage: 'PENDING_EVIDENCE' },
  });
  expect(notaryDenied.status(), await notaryDenied.text()).toBe(403);

  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login$/u);
  await page.getByLabel('用户名').fill(coreLeadFixtures.selfUsername);
  await page.getByLabel('密码').fill(coreLeadFixtures.selfPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/customers$/u);
  const selfSession = await page.request.get('/api/v1/auth/session');
  const selfCsrf = (await selfSession.json()).csrfToken as string;
  const deniedMatter = inScope[0]!;
  const outOfScope = await page.request.post(
    '/api/v1/notary-matters/exports/preview',
    {
      headers: { 'X-CSRF-Token': selfCsrf },
      data: { mode: 'SELECTED', matterIds: [deniedMatter.id] },
    },
  );
  expect(outOfScope.status(), await outOfScope.text()).toBe(403);

  const selfMatter = matters.find((matter) => matter.scopeKind === 'SELF')!;
  const selfList = await page.request.get(
    '/api/v1/notary-matters?page=1&pageSize=20&stage=PENDING_EVIDENCE',
  );
  expect(selfList.status(), await selfList.text()).toBe(200);
  const selfListBody = (await selfList.json()) as {
    items: Array<{ id: string; businessNo: string }>;
  };
  expect(selfListBody.items).toEqual([
    expect.objectContaining({
      id: selfMatter.id,
      businessNo: selfMatter.businessNo,
    }),
  ]);
  const selfPreview = await page.request.post(exportUrl, {
    headers: { 'X-CSRF-Token': selfCsrf },
    data: { mode: 'FILTERED', stage: 'PENDING_EVIDENCE' },
  });
  expect(selfPreview.status(), await selfPreview.text()).toBe(200);
  await expect(selfPreview.json()).resolves.toMatchObject({
    count: 1,
    maxRows: 1000,
  });
  const selfExport = await page.request.post('/api/v1/notary-matters/exports', {
    headers: { 'X-CSRF-Token': selfCsrf },
    data: { mode: 'FILTERED', stage: 'PENDING_EVIDENCE', expectedCount: 1 },
  });
  expect(selfExport.status(), await selfExport.text()).toBe(200);
  const selfCsv = await selfExport.text();
  expect(selfCsv).toContain(selfMatter.businessNo);
  expect(selfCsv).not.toContain(inScope[0]!.businessNo);
  const selfAudit = (await getNotaryListExportAudits()).at(-1)!;
  expect(selfAudit.actorUserId).toBe(coreLeadFixtures.userSelf);
  expect(selfAudit.details).toMatchObject({
    mode: 'FILTERED',
    count: 1,
    actualIds: [selfMatter.id],
  });
});
