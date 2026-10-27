import { randomUUID } from 'node:crypto';
import { expect, test, type Page, type APIResponse } from '@playwright/test';
import {
  inspectBatch2CaseConsolidationFixture,
  prepareBatch2CaseConsolidationFixture,
  prepareBatch2ConsolidatedFilingSource,
} from '../support/batch2-case-consolidation-database.mjs';

let fixture: Awaited<ReturnType<typeof prepareBatch2CaseConsolidationFixture>>;
test.use({ baseURL: 'http://127.0.0.1:5174' });
const defendant = {
  kind: 'PERSON',
  name: '批次二合成被告',
  idNo: '110101200001011234',
};
const json = async <T>(response: APIResponse, status: number): Promise<T> => {
  expect(response.status(), await response.text()).toBe(status);
  return response.json() as Promise<T>;
};
async function login(page: Page) {
  await page.goto('/cases');
  await expect(page).toHaveURL(/\/login\?returnTo=/u);
  await page.getByLabel('用户名').fill(fixture.username);
  await page.getByLabel('密码').fill(fixture.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/cases');
  return (
    await json<{ csrfToken: string }>(
      await page.request.get('/api/v1/auth/session'),
      200,
    )
  ).csrfToken;
}
const body = (indexes: number[], key = randomUUID()) => ({
  members: indexes.map((index) => ({
    caseId: fixture.cases[index].id,
    expectedVersion: 1,
    confirmed: true,
    defendant,
  })),
  mainCaseId: fixture.cases[indexes[0]].id,
  idempotencyKey: key,
});

test.describe('Batch 2 case search and consolidation on the owned one-time target', () => {
  test.beforeAll(async () => {
    fixture = await prepareBatch2CaseConsolidationFixture();
  });

  test('server query page/count/export agree, and list confirmation preserves each original fee ID', async ({
    page,
  }) => {
    const csrf = await login(page);
    const query = `view=mine&stage=PENDING_MATCH&q=${encodeURIComponent(fixture.businessTag)}`;
    const first = await json<{ total: number; items: Array<{ id: string }> }>(
      await page.request.get(`/api/v1/cases?${query}&page=1&pageSize=20`),
      200,
    );
    const second = await json<{ total: number; items: Array<{ id: string }> }>(
      await page.request.get(`/api/v1/cases?${query}&page=2&pageSize=20`),
      200,
    );
    expect(first.total).toBe(23);
    expect(second.total).toBe(23);
    expect(first.items).toHaveLength(20);
    expect(second.items).toHaveLength(3);
    expect(
      new Set([...first.items, ...second.items].map((item) => item.id)).size,
    ).toBe(23);
    const csv = await page.request.post('/api/v1/cases/exports/csv', {
      headers: { 'X-CSRF-Token': csrf },
      data: { view: 'mine', stage: 'PENDING_MATCH', q: fixture.businessTag },
    });
    expect(csv.status()).toBe(200);
    const text = await csv.text();
    expect(fixture.cases.every((item) => text.includes(item.businessNo))).toBe(
      true,
    );
    await page.goto(`/cases?${query}`);
    await expect(
      page.getByRole('link', { name: fixture.cases[0].businessNo }),
    ).toBeVisible();
    await page.getByLabel(`选择案件 ${fixture.cases[0].businessNo}`).check();
    await page.getByLabel(`选择案件 ${fixture.cases[1].businessNo}`).check();
    await page.locator('[data-test="open-case-consolidation"]').click();
    const panel = page.locator('.consolidation-panel');
    await panel.getByLabel('被告姓名').fill(defendant.name);
    await panel.getByLabel('证件号／统一信用代码').fill(defendant.idNo);
    for (const row of await panel.locator('.consolidation-row').all()) {
      await row.getByLabel('已核对本案为上述同一被告').check();
    }
    await panel.locator('[data-test="preview-consolidation"]').click();
    await expect(panel).toContainText('参与 2 件');
    await expect(panel).toContainText(
      `主案编号：${fixture.cases[1].businessNo}`,
    );
    await panel
      .locator('[data-test="consolidation-main"]')
      .selectOption(fixture.cases[0].id);
    await panel.locator('[data-test="preview-consolidation"]').click();
    await expect(panel).toContainText(
      `主案编号：${fixture.cases[0].businessNo}`,
    );
    await panel.locator('[data-test="submit-consolidation"]').click();
    const trace = await json<{
      caseCount: number;
      cases: Array<{ caseId: string; feeRecordIds: string[] }>;
    }>(
      await page.request.get(
        `/api/v1/cases/${fixture.cases[0].id}/consolidation`,
      ),
      200,
    );
    expect(trace.caseCount).toBe(2);
    expect(trace.cases.flatMap((item) => item.feeRecordIds).sort()).toEqual(
      [fixture.cases[0].feeId, fixture.cases[1].feeId].sort(),
    );
    const stored = await inspectBatch2CaseConsolidationFixture(
      fixture.departmentId,
      fixture.cases.slice(0, 2).map((item) => item.id),
    );
    expect(
      stored.feeRows.map((row) => [row.id, row.case_id, row.amount]).sort(),
    ).toEqual(
      fixture.cases
        .slice(0, 2)
        .map((item) => [item.feeId, item.id, '10.00'])
        .sort(),
    );
    expect(stored.relations).toHaveLength(2);
    const child = stored.relations.find((item) => !item.is_main)!;
    const oldNo = fixture.cases.find(
      (item) => item.id === child.case_id,
    )!.businessNo;
    const redirected = await json<{
      total: number;
      items: Array<{ id: string }>;
    }>(
      await page.request.get(
        `/api/v1/cases?view=mine&q=${encodeURIComponent(oldNo)}&page=1&pageSize=20`,
      ),
      200,
    );
    expect(redirected.total).toBe(1);
    expect(redirected.items.map((item) => item.id)).toEqual([
      fixture.cases[0].id,
    ]);
    const active = await json<{
      total: number;
      counts: { PENDING_MATCH: number };
    }>(
      await page.request.get(`/api/v1/cases?${query}&page=1&pageSize=20`),
      200,
    );
    expect(active.total).toBe(22);
    expect(active.counts.PENDING_MATCH).toBe(22);
    const activeCsv = await page.request.post('/api/v1/cases/exports/csv', {
      headers: { 'X-CSRF-Token': csrf },
      data: { view: 'mine', stage: 'PENDING_MATCH', q: fixture.businessTag },
    });
    expect(activeCsv.status()).toBe(200);
    expect(await activeCsv.text()).not.toContain(oldNo);
    const rejected = await page.request.post(
      `/api/v1/cases/${child.case_id}/match`,
      {
        headers: { 'X-CSRF-Token': csrf },
        data: {
          expectedVersion: 2,
          idempotencyKey: randomUUID(),
          matchedOn: new Date().toISOString().slice(0, 10),
          defendants: [defendant],
        },
      },
    );
    expect(rejected.status()).toBe(409);
    expect((await rejected.json()).code).toBe('INVALID_STATE');
    const source = await prepareBatch2ConsolidatedFilingSource(
      fixture.departmentId,
      fixture.userId,
      fixture.cases[0].id,
      child.case_id,
    );
    const submitted = await json<{ stage: string }>(
      await page.request.post(
        `/api/v1/cases/${fixture.cases[0].id}/filing-submit`,
        {
          headers: { 'X-CSRF-Token': csrf },
          data: {
            expectedVersion: 2,
            idempotencyKey: randomUUID(),
            courtId: source.courtId,
            submittedAt: new Intl.DateTimeFormat('en-CA', {
              timeZone: 'Asia/Shanghai',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
            }).format(new Date()),
            filingEvidenceContentVersionIds: [],
            filingScreenshotContentVersionIds: [],
            consolidationSourceContentVersionIds: [source.contentVersionId],
          },
        },
      ),
      201,
    );
    expect(submitted.stage).toBe('WAITING_FORMAL_ACCEPTANCE');
    const detail = await json<{
      filingSubmission: {
        evidenceFiles: Array<{ materialId: string; contentVersionId: string }>;
      };
    }>(await page.request.get(`/api/v1/cases/${fixture.cases[0].id}`), 200);
    expect(detail.filingSubmission.evidenceFiles).toContainEqual(
      expect.objectContaining({
        materialId: source.materialId,
        contentVersionId: source.contentVersionId,
      }),
    );
  });

  test('two concurrent creates for the same members leave one immutable relationship; same key replays', async ({
    page,
  }) => {
    const csrf = await login(page);
    const input = body([2, 3]);
    const preview = await json<{ caseCount: number; mainCaseId: string }>(
      await page.request.post('/api/v1/cases/consolidations/preview', {
        headers: { 'X-CSRF-Token': csrf },
        data: { members: input.members, mainCaseId: input.mainCaseId },
      }),
      200,
    );
    expect(preview).toMatchObject({
      caseCount: 2,
      mainCaseId: fixture.cases[2].id,
    });
    const send = (data: typeof input) =>
      page.request.post('/api/v1/cases/consolidations', {
        headers: { 'X-CSRF-Token': csrf },
        data,
      });
    const outcomes = await Promise.all([
      send(input),
      send({ ...input, idempotencyKey: randomUUID() }),
    ]);
    expect(outcomes.map((response) => response.status()).sort()).toEqual([
      201, 409,
    ]);
    const replay = await json<{ mainCaseId: string }>(await send(input), 201);
    expect(replay.mainCaseId).toBe(preview.mainCaseId);
    const stored = await inspectBatch2CaseConsolidationFixture(
      fixture.departmentId,
      fixture.cases.slice(2, 4).map((item) => item.id),
    );
    expect(stored.relations).toHaveLength(2);
  });
});
