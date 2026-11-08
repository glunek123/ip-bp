import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  clearCoreLeadE2eData,
  coreLeadFixtures,
  resetCoreLeadE2eData,
} from '../support/core-lead-database.mjs';

const root = process.cwd();
const requireProject = createRequire(resolve(root, 'package.json'));
const requireBackend = createRequire(resolve(root, 'backend/package.json'));
const { validateBrowserTestDatabaseUrl } = requireProject(
  './scripts/test-environment.mjs',
) as {
  validateBrowserTestDatabaseUrl(value: string, root: string): unknown;
};
const { Client } = requireBackend('pg') as {
  Client: new (options: { connectionString: string }) => {
    connect(): Promise<void>;
    query(sql: string, values: unknown[]): Promise<unknown>;
    end(): Promise<void>;
  };
};
const headers = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };
type Item = {
  id: string;
  version: number;
  displayCode: string;
  status: string;
  remark: string | null;
};
type Group = {
  groupId: string | null;
  groupVersion: number;
  sourceVersion: number;
  items: Item[];
};

async function grant() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  validateBrowserTestDatabaseUrl(url, root);
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    for (const [action, scope] of [
      ['case.external-entry.create', 'TEAM'],
      ['evidence.read', 'DEPARTMENT'],
      ['evidence.edit', 'DEPARTMENT'],
      ['evidence.bulk-status', 'DEPARTMENT'],
    ])
      await client.query(
        'INSERT INTO role_grants(id,role_template_id,action,scope) VALUES(gen_random_uuid(),$1,$2::permission_action,$3::permission_scope) ON CONFLICT DO NOTHING',
        [coreLeadFixtures.roleA, action, scope],
      );
  } finally {
    await client.end();
  }
}

async function json<T>(
  response: Awaited<ReturnType<APIRequestContext['get']>>,
  status = 200,
): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);
  return response.json() as Promise<T>;
}

async function createEvidence(
  request: APIRequestContext,
  code: string,
  remark: string,
) {
  const created = await json<{ id: string }>(
    await request.post('/api/v1/cases/external-entries', {
      headers,
      data: {
        idempotencyKey: randomUUID(),
        entryKind: 'EXTERNAL_TRANSFER',
        initialStage: 'PENDING_MATCH',
        stageReachedOn: new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Shanghai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date()),
        source: `CA018 E2E:${randomUUID()}`,
        reason: '合成证物批量备注验证',
        customerId: coreLeadFixtures.admittedCustomer,
        rightsHolderId: coreLeadFixtures.holder,
        defendants: [],
        lawyerAccountId: null,
        lawyerProfileId: null,
        known: {
          courtId: null,
          courtCaseNo: null,
          acceptedOn: null,
          secondInstanceAcceptedOn: null,
          platform: null,
          shopName: null,
          shopExternalId: null,
          caseType: null,
          infringementTypes: null,
        },
      },
    }),
    201,
  );
  const path = `/api/v1/evidence/sources/CASE/${created.id}/group`;
  const initial = await json<Group>(await request.get(path, { headers }));
  const saved = await json<{ group: Group }>(
    await request.put(path, {
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
      data: {
        expectedSourceVersion: initial.sourceVersion,
        expectedGroupVersion: 0,
        rows: [
          {
            displayCode: code,
            shelfLocation: 'A1',
            status: 'IN_STOCK',
            manualStatus: true,
          },
        ],
        remark,
      },
    }),
  );
  expect(saved.group.items).toHaveLength(1);
  return { groupId: saved.group.groupId!, item: saved.group.items[0]! };
}

test.afterEach(async () => {
  await clearCoreLeadE2eData();
});

test('selected evidence remarks save atomically and stale combined edits retain drafts', async ({
  request,
  page,
}, testInfo) => {
  await resetCoreLeadE2eData();
  await grant();
  const a = await createEvidence(
    request,
    `EV-A-${randomUUID().slice(0, 6)}`,
    '原备注甲',
  );
  const b = await createEvidence(
    request,
    `EV-B-${randomUUID().slice(0, 6)}`,
    '原备注乙',
  );
  await page.goto('/evidence');
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  await page.getByLabel('用户名').fill(coreLeadFixtures.operatorUsername);
  await page.getByLabel('密码').fill(coreLeadFixtures.operatorPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/evidence$/);
  await expect(
    page.locator('[data-test="case-view-department"]'),
  ).toContainText('部门案件');
  await expect(
    page.locator('[data-test="case-view-department"]'),
  ).not.toContainText('全部部门案件');
  await page.getByLabel(`选择证物 ${a.item.displayCode}`).check();
  await page.getByLabel(`选择证物 ${b.item.displayCode}`).check();
  await page.getByRole('button', { name: '批量更改状态' }).click();
  const modal = page.getByRole('dialog', { name: '批量更改状态' });
  await expect(modal).toContainText('原备注甲');
  await expect(modal).toContainText('原备注乙');
  await modal.screenshot({
    path: testInfo.outputPath('evidence-bulk-remarks.png'),
  });
  await modal.getByLabel(`修改 ${a.item.displayCode} 的备注`).fill('新备注甲');
  await modal.getByLabel(`修改 ${b.item.displayCode} 的备注`).fill('');
  await modal.getByRole('button', { name: '保存' }).click();
  await expect(modal).toBeHidden();
  const read = async (id: string) =>
    json<Group>(
      await request.get(`/api/v1/evidence/items/${id}/group`, { headers }),
    );
  expect(
    (await read(a.item.id)).items.find((row) => row.id === a.item.id)?.remark,
  ).toBe('新备注甲');
  expect(
    (await read(b.item.id)).items.find((row) => row.id === b.item.id)?.remark,
  ).toBeNull();

  await page.getByRole('button', { name: '批量更改状态' }).click();
  await modal.getByLabel('证物状态').selectOption('DESTROYED');
  await modal
    .getByLabel(`修改 ${a.item.displayCode} 的备注`)
    .fill('待冲突备注');
  const before = await read(a.item.id);
  await json(
    await request.put(`/api/v1/evidence/groups/${a.groupId}`, {
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
      data: {
        expectedGroupVersion: before.groupVersion,
        rows: before.items.map((row) => ({
          id: row.id,
          displayCode: row.displayCode,
          shelfLocation: 'A1',
          status: row.status,
          manualStatus: true,
        })),
        remark: '并发修改',
        paperCertificates: [],
      },
    }),
  );
  await modal.getByRole('button', { name: '保存' }).click();
  await expect(modal.getByRole('alert')).toContainText('已经变化');
  await expect(
    modal.getByLabel(`修改 ${a.item.displayCode} 的备注`),
  ).toHaveValue('待冲突备注');
  expect(
    (await read(a.item.id)).items.find((row) => row.id === a.item.id),
  ).toMatchObject({ status: 'IN_STOCK', remark: '并发修改' });
  expect(
    (await read(b.item.id)).items.find((row) => row.id === b.item.id),
  ).toMatchObject({ status: 'IN_STOCK', remark: null });

  await modal.getByRole('button', { name: '刷新原备注' }).click();
  await expect(modal).toContainText('原备注：并发修改');
  await expect(
    modal.getByLabel('修改 ' + a.item.displayCode + ' 的备注'),
  ).toHaveValue('待冲突备注');
  await modal.getByRole('button', { name: '保存' }).click();
  await expect(modal).toBeHidden();
  expect(
    (await read(a.item.id)).items.find((row) => row.id === a.item.id),
  ).toMatchObject({
    status: 'DESTROYED',
    remark: '待冲突备注',
  });
  await page
    .getByRole('row', { name: `查看证物 ${a.item.displayCode}` })
    .click();
  await expect(
    page.getByRole('dialog', { name: '查看证物与公证书' }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('evidence-readonly-dialog.png'),
    animations: 'disabled',
  });
  await page.locator('.overlay').click({ position: { x: 5, y: 5 } });
  await expect(
    page.getByRole('dialog', { name: '查看证物与公证书' }),
  ).toBeHidden();
  await page.screenshot({
    path: testInfo.outputPath('evidence-filters-wide.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 760, height: 900 });
  await page.screenshot({
    path: testInfo.outputPath('evidence-filters-narrow.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('[data-test="case-view-department"]').click();
  await expect(page).toHaveURL(/view=department/u);
  await expect(
    page.getByRole('heading', { name: '部门案件', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.case-list-table')).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('department-cases.png'),
    fullPage: true,
  });
});
