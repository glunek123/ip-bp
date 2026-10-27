import { randomUUID } from 'node:crypto';
import { expect, test, type Page, type APIResponse } from '@playwright/test';
import {
  inspectBatch2CaseConsolidationFixture,
  prepareBatch2CaseConsolidationFixture,
  addBatch2OriginalCaseFees,
} from '../support/batch2-case-consolidation-database.mjs';

let fixture: Awaited<ReturnType<typeof prepareBatch2CaseConsolidationFixture>>;
let sourceCertificate: { materialId: string; contentVersionId: string };
test.use({ baseURL: 'http://127.0.0.1:5174' });
const defendant = {
  kind: 'PERSON',
  name: '批次二合成被告',
  idNo: '110101200001011234',
};
const day = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const pdf = (() => {
  const parts = ['%PDF-1.4\n'];
  const offsets = [0];
  for (const body of [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>',
  ]) {
    offsets.push(Buffer.byteLength(parts.join(''), 'ascii'));
    parts.push(`${offsets.length - 1} 0 obj\n${body}\nendobj\n`);
  }
  const startXref = Buffer.byteLength(parts.join(''), 'ascii');
  parts.push('xref\n0 4\n0000000000 65535 f \n');
  for (const offset of offsets.slice(1))
    parts.push(`${String(offset).padStart(10, '0')} 00000 n \n`);
  parts.push(
    `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`,
  );
  return Buffer.from(parts.join(''), 'ascii');
})();
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
  'base64',
);
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

async function upload(
  page: Page,
  csrf: string,
  ownerType: 'CASE' | 'NOTARY_MATTER',
  ownerId: string,
  category: string,
  bytes: Buffer,
) {
  const draft = await json<{ id: string }>(
    await page.request.post('/api/v1/materials/upload-drafts', {
      headers: { 'X-CSRF-Token': csrf },
      data: {
        ownerType,
        ownerId,
        category,
        purpose: category,
        originalFilename: `batch2-${category}-${randomUUID()}.${category === 'NOTARY_OPENING_PHOTO' ? 'png' : 'pdf'}`,
        declaredMimeType:
          category === 'NOTARY_OPENING_PHOTO' ? 'image/png' : 'application/pdf',
      },
    }),
    201,
  );
  return json<{ materialId: string; contentVersionId: string }>(
    await page.request.put(
      `/api/v1/materials/upload-drafts/${draft.id}/content`,
      {
        headers: {
          'X-CSRF-Token': csrf,
          'Content-Type': 'application/octet-stream',
        },
        data: bytes,
      },
    ),
    200,
  );
}

async function createExternalCase(page: Page, csrf: string, index: number) {
  const created = await json<{
    id: string;
    businessNo: string;
    version: number;
  }>(
    await page.request.post('/api/v1/cases/external-entries', {
      headers: { 'X-CSRF-Token': csrf },
      data: {
        idempotencyKey: randomUUID(),
        entryKind: 'EXTERNAL_TRANSFER',
        initialStage: 'PENDING_MATCH',
        stageReachedOn: day(),
        source: `Batch2 ${fixture.run} external ${index}`,
        reason: '合成业务来源验收',
        customerId: fixture.customerId,
        rightsHolderId: fixture.holderId,
        defendants: [],
        lawyerAccountId: null,
        lawyerProfileId: null,
        known: {
          courtId: null,
          courtCaseNo: null,
          acceptedOn: null,
          secondInstanceAcceptedOn: null,
          platform: 'TAOBAO',
          shopName: fixture.businessTag,
          shopExternalId: fixture.shopExternalId,
          caseType: 'CIVIL',
          infringementTypes: null,
        },
      },
    }),
    201,
  );
  expect(created.version).toBe(1);
  return created;
}

async function createNotarySourceCase(page: Page, csrf: string) {
  const headers = { 'X-CSRF-Token': csrf };
  const command = () => ({ ...headers, 'Idempotency-Key': randomUUID() });
  const lead = await json<{ id: string; version: number }>(
    await page.request.post('/api/v1/leads', {
      headers: command(),
      data: {
        customerId: fixture.customerId,
        rightsHolderId: fixture.holderId,
        caseType: 'CIVIL',
        infringementTypes: ['TRADEMARK'],
        source: 'ONLINE',
        platform: 'TAOBAO',
        foundAt: new Date().toISOString(),
        shopName: fixture.businessTag,
        shopExternalId: fixture.shopExternalId,
        needDisclose: false,
        products: [
          {
            title: '合成来源商品',
            quantity: 1,
            unitPrice: '10.00',
            commentCount: 1,
          },
        ],
        leadScreenshotContentVersionIds: [],
      },
    }),
    201,
  );
  expect(lead.version).toBe(1);
  await json(
    await page.request.post(`/api/v1/leads/${lead.id}/push`, {
      headers: command(),
      data: { expectedVersion: 1 },
    }),
    201,
  );
  await json(
    await page.request.post(`/api/v1/leads/${lead.id}/proxy-reviews`, {
      headers: command(),
      data: { result: 'INFRINGEMENT', expectedVersion: 2 },
    }),
    201,
  );
  const office = await json<{ id: string }>(
    await page.request.post('/api/v1/notary-offices', {
      headers,
      data: { name: `Batch2 office ${randomUUID()}` },
    }),
    201,
  );
  const detail = await json<{ products: Array<{ id: string }> }>(
    await page.request.get(`/api/v1/leads/${lead.id}`),
    200,
  );
  expect(detail.products).toHaveLength(1);
  const matter = await json<{ id: string }>(
    await page.request.post(`/api/v1/leads/${lead.id}/notary-matters`, {
      headers: command(),
      data: {
        selectedProductIds: [detail.products[0].id],
        selectedContentVersionIds: [],
        notaryOfficeId: office.id,
        evidenceMode: 'ONLINE_PURCHASE',
        batchPurpose: '本批真实取证',
        expectedVersion: 3,
      },
    }),
    201,
  );
  await json(
    await page.request.post(`/api/v1/notary-matters/${matter.id}/evidence`, {
      headers: command(),
      data: {
        evidenceAt: day(),
        sampleFeeState: 'PENDING',
        logistics: [{ companyState: 'NONE', trackingState: 'NONE' }],
        expectedVersion: 1,
      },
    }),
    201,
  );
  const photo = await upload(
    page,
    csrf,
    'NOTARY_MATTER',
    matter.id,
    'NOTARY_OPENING_PHOTO',
    png,
  );
  await json(
    await page.request.post(`/api/v1/notary-matters/${matter.id}/opening`, {
      headers: command(),
      data: { expectedVersion: 2, contentVersionIds: [photo.contentVersionId] },
    }),
    201,
  );
  await json(
    await page.request.post(
      `/api/v1/notary-matters/${matter.id}/opening-review`,
      {
        headers: command(),
        data: { result: 'INFRINGEMENT', expectedVersion: 3 },
      },
    ),
    201,
  );
  await json(
    await page.request.post(
      `/api/v1/notary-matters/${matter.id}/issuance-decision`,
      {
        headers: command(),
        data: { decision: 'ISSUE', expectedVersion: 4 },
      },
    ),
    201,
  );
  const certificate = await upload(
    page,
    csrf,
    'NOTARY_MATTER',
    matter.id,
    'NOTARY_CERTIFICATE',
    pdf,
  );
  const issued = await json<{ case: { id: string } }>(
    await page.request.post(
      `/api/v1/notary-matters/${matter.id}/proxy-certificate`,
      {
        headers: command(),
        data: {
          expectedVersion: 5,
          certificateNo: `（2026）批证字${randomUUID().slice(0, 8)}号`,
          certificateDate: day(),
          contentVersionIds: [certificate.contentVersionId],
          needDisclose: false,
          disclosureContentVersionIds: [],
          fees: {
            notary: { state: 'KNOWN', amount: '120.00' },
            investigation: { state: 'PENDING', amount: null },
            disclosure: { state: 'KNOWN', amount: '0.00' },
          },
        },
      },
    ),
    201,
  );
  const source = await json<{
    id: string;
    businessNo: string;
    stage: string;
    version: number;
  }>(await page.request.get(`/api/v1/cases/${issued.case.id}`), 200);
  expect(source).toMatchObject({ stage: 'PENDING_MATCH', version: 1 });
  return { ...source, certificate };
}

test.describe
  .serial('Batch 2 case search and consolidation on the owned one-time target', () => {
  test.setTimeout(300_000);
  test.beforeAll(async () => {
    fixture = await prepareBatch2CaseConsolidationFixture();
  });

  test('server query page/count/export agree, and list confirmation preserves each original fee ID', async ({
    page,
  }) => {
    const csrf = await login(page);
    for (let index = 22; index >= 2; index--)
      fixture.cases[index] = {
        ...(await createExternalCase(page, csrf, index)),
        feeId: null,
      };
    const notaryCase = await createNotarySourceCase(page, csrf);
    sourceCertificate = notaryCase.certificate;
    fixture.cases[1] = {
      id: notaryCase.id,
      businessNo: notaryCase.businessNo,
      feeId: null,
    };
    fixture.cases[0] = {
      ...(await createExternalCase(page, csrf, 0)),
      feeId: null,
    };
    const feeIds = await addBatch2OriginalCaseFees(
      fixture.departmentId,
      fixture.userId,
      fixture.cases.slice(0, 2),
    );
    fixture.cases[0].feeId = feeIds[0];
    fixture.cases[1].feeId = feeIds[1];
    const initialFees = (
      await inspectBatch2CaseConsolidationFixture(
        fixture.departmentId,
        fixture.cases.slice(0, 2).map((item) => item.id),
      )
    ).feeRows;
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
    expect(trace.cases.flatMap((item) => item.feeRecordIds)).toEqual(
      expect.arrayContaining(feeIds),
    );
    expect(new Set(trace.cases.flatMap((item) => item.feeRecordIds)).size).toBe(
      trace.cases.flatMap((item) => item.feeRecordIds).length,
    );
    const stored = await inspectBatch2CaseConsolidationFixture(
      fixture.departmentId,
      fixture.cases.slice(0, 2).map((item) => item.id),
    );
    expect(stored.feeRows).toEqual(initialFees);
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
    const mainId = fixture.cases[0].id;
    const commandHeaders = () => ({ 'X-CSRF-Token': csrf });
    const matched = await json<{ stage: string; version: number }>(
      await page.request.post(`/api/v1/cases/${mainId}/match`, {
        headers: commandHeaders(),
        data: {
          expectedVersion: 2,
          idempotencyKey: randomUUID(),
          matchedOn: day(),
          defendants: [defendant],
          lawyerAccountId: fixture.lawyerUserId,
        },
      }),
      201,
    );
    expect(matched.stage).toBe('WAITING_COMPLAINT');
    const complaint = await upload(
      page,
      csrf,
      'CASE',
      mainId,
      'COMPLAINT',
      pdf,
    );
    const authorization = await upload(
      page,
      csrf,
      'CASE',
      mainId,
      'AUTHORIZATION',
      pdf,
    );
    const submittedComplaint = await json<{ version: number; stage: string }>(
      await page.request.post(`/api/v1/cases/${mainId}/complaint-submit`, {
        headers: commandHeaders(),
        data: {
          expectedVersion: matched.version,
          idempotencyKey: randomUUID(),
          amountState: 'PENDING',
          amount: null,
          pendingReason: '待核实诉讼金额',
          complaintContentVersionIds: [complaint.contentVersionId],
          authorizationContentVersionIds: [authorization.contentVersionId],
        },
      }),
      201,
    );
    expect(submittedComplaint.stage).toBe('WAITING_COMPLAINT_CONFIRMATION');
    const confirmed = await json<{ version: number; stage: string }>(
      await page.request.post(`/api/v1/cases/${mainId}/complaint-confirm`, {
        headers: commandHeaders(),
        data: {
          expectedVersion: submittedComplaint.version,
          idempotencyKey: randomUUID(),
          confirmedComplaintContentVersionId: complaint.contentVersionId,
          amountState: 'KNOWN',
          amount: '10.00',
          pendingReason: null,
          changeNote: '合成来源核实金额',
          confirmDisclose: true,
        },
      }),
      201,
    );
    expect(confirmed.stage).toBe('WAITING_COMPLAINT_STAMP');
    const receipt = await upload(
      page,
      csrf,
      'CASE',
      mainId,
      'MAIL_RECEIPT',
      pdf,
    );
    const mailed = await json<{ version: number; stage: string }>(
      await page.request.post(`/api/v1/cases/${mainId}/complaint-mail`, {
        headers: commandHeaders(),
        data: {
          expectedVersion: confirmed.version,
          idempotencyKey: randomUUID(),
          mailedAt: day(),
          mailReceiptContentVersionIds: [receipt.contentVersionId],
        },
      }),
      201,
    );
    expect(mailed.stage).toBe('WAITING_FILING');
    const court = await json<{ id: string }>(
      await page.request.post(`/api/v1/cases/${mainId}/filing-courts`, {
        headers: commandHeaders(),
        data: { name: `Batch2 court ${randomUUID()}` },
      }),
      201,
    );
    const submitted = await json<{ stage: string }>(
      await page.request.post(`/api/v1/cases/${mainId}/filing-submit`, {
        headers: { 'X-CSRF-Token': csrf },
        data: {
          expectedVersion: mailed.version,
          idempotencyKey: randomUUID(),
          courtId: court.id,
          submittedAt: day(),
          filingEvidenceContentVersionIds: [],
          filingScreenshotContentVersionIds: [],
          consolidationSourceContentVersionIds: [
            sourceCertificate.contentVersionId,
          ],
        },
      }),
      201,
    );
    expect(submitted.stage).toBe('WAITING_FORMAL_ACCEPTANCE');
    const detail = await json<{
      filingSubmission: {
        evidenceFiles: Array<{ materialId: string; contentVersionId: string }>;
      };
    }>(await page.request.get(`/api/v1/cases/${mainId}`), 200);
    expect(detail.filingSubmission.evidenceFiles).toContainEqual(
      expect.objectContaining({
        materialId: sourceCertificate.materialId,
        contentVersionId: sourceCertificate.contentVersionId,
      }),
    );
    const downloaded = await page.request.get(
      `/api/v1/materials/${sourceCertificate.materialId}/versions/${sourceCertificate.contentVersionId}/content`,
    );
    expect(downloaded.status(), await downloaded.text()).toBe(200);
    expect((await downloaded.body()).equals(pdf)).toBe(true);
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
