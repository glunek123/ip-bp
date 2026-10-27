import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  expect,
  test,
  type APIResponse,
  type Page,
  type Response,
} from '@playwright/test';
import { prepareV6FollowupUi } from '../support/v6-followup-ui.mjs';

const output = resolve(process.cwd(), '.local/v6-followups-20261026/ui');
const businessDate = '2026-10-26';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGO4o6HxX2Panf8MIALEAQBSpgmJplS0fgAAAABJRU5ErkJggg==',
  'base64',
);
function syntheticPdf(): Buffer {
  const chunks = ['%PDF-1.4\n%Synthetic V6 test document\n'];
  const offsets = [0];
  const addObject = (number: number, body: string) => {
    offsets[number] = Buffer.byteLength(chunks.join(''), 'ascii');
    chunks.push(`${number} 0 obj\n${body}\nendobj\n`);
  };
  const content = 'BT /F1 16 Tf 36 180 Td (Synthetic V6 Agreement) Tj ET\n';
  addObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
  addObject(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  addObject(
    3,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 240] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
  );
  addObject(
    4,
    `<< /Length ${Buffer.byteLength(content, 'ascii')} >>\nstream\n${content}endstream`,
  );
  addObject(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const xrefOffset = Buffer.byteLength(chunks.join(''), 'ascii');
  chunks.push('xref\n0 6\n0000000000 65535 f \n');
  for (let number = 1; number <= 5; number++)
    chunks.push(`${String(offsets[number]).padStart(10, '0')} 00000 n \n`);
  chunks.push(
    `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );
  return Buffer.from(chunks.join(''), 'ascii');
}
const pdf = syntheticPdf();

async function body<T>(
  response: APIResponse | Response,
  status: number,
): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);
  return (await response.json()) as T;
}

function csvRow(
  customerBusinessId: string,
  courtName: string,
  courtNo: string,
  reason: string,
) {
  const values = [
    '外部移交',
    '待匹配',
    businessDate,
    'V6 合成外录',
    reason,
    customerBusinessId,
    '核心权利主体',
    '',
    '',
    '',
    '',
    '',
    '',
    courtName,
    courtNo,
    '',
    '',
    '',
    '',
    '',
    '',
    '',
  ];
  return values.map((value) => `"${value.replaceAll('"', '""')}"`).join(',');
}

async function capture(page: Page, name: string) {
  for (const [device, width, height] of [
    ['desktop', 1440, 1000],
    ['mobile', 390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate(async () => {
      await document.fonts.ready;
      window.scrollTo(0, 0);
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    });
    await page.screenshot({
      path: resolve(output, `${name}-${device}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

test('v6 fresh synthetic UI follows agreement, screenshots, CSV, archive and fee reconciliation', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const fixture = await prepareV6FollowupUi();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await mkdir(output, { recursive: true });
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/customers');
    await page.getByLabel('用户名').fill(fixture.username);
    await page.getByLabel('密码').fill(fixture.password);
    const login = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/auth/login') &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: '登录', exact: true }).click();
    const session = await body<{ csrfToken: string }>(await login, 200);
    const headers = {
      Origin: new URL(page.url()).origin,
      'X-CSRF-Token': session.csrfToken,
    };

    await page.goto(`/customers/${fixture.customerId}`);
    const agreement = page.locator('[data-test="agreement-panel"]');
    await expect(agreement).toBeVisible();
    await agreement.locator('[data-test="agreement-edit"]').click();
    await agreement.getByLabel('合作协议名称').fill('V6 合成合作协议');
    await agreement
      .getByLabel('结算条件（公式）')
      .fill('客户结算金额=实际结案金额*70%');
    await agreement.getByLabel('期限类型').selectOption('LONG_TERM');
    await agreement.locator('[data-test="agreement-submit"]').click();
    await expect(
      agreement.locator('[data-test="agreement-version"]'),
    ).toContainText('第 1 版');
    await agreement.locator('[data-test="agreement-edit"]').click();
    await agreement.locator('input[type="file"]').setInputFiles({
      name: 'V6-后补合作协议.pdf',
      mimeType: 'application/pdf',
      buffer: pdf,
    });
    await expect(
      agreement.getByText('合作协议文件已上传，尚未绑定到新版本。'),
    ).toBeVisible();
    await agreement.locator('[data-test="agreement-submit"]').click();
    await expect(
      agreement.locator('[data-test="agreement-version"]'),
    ).toContainText('第 2 版');
    await page.reload();
    await expect(agreement.getByText('V6-后补合作协议.pdf')).toBeVisible();
    await agreement.getByRole('button', { name: '预览' }).click();
    const preview = page.getByRole('dialog', {
      name: '预览 V6-后补合作协议.pdf',
    });
    const iframe = preview.locator('iframe[title="V6-后补合作协议.pdf"]');
    await expect(iframe).toBeVisible();
    expect(
      (await iframe.getAttribute('src'))?.startsWith(
        `blob:${new URL(page.url()).origin}/`,
      ),
    ).toBe(true);
    await capture(page, 'customer-agreement-preview');
    await preview.locator('[data-test="material-preview-close"]').click();
    await expect(preview).toHaveCount(0);
    await capture(page, 'customer-agreement');

    const lead = await body<{ id: string; products: Array<{ id: string }> }>(
      await page.request.post('/api/v1/leads', {
        headers: { ...headers, 'Idempotency-Key': randomUUID() },
        data: {
          customerId: fixture.customerId,
          rightsHolderId: fixture.rightsHolderId,
          caseType: 'CIVIL',
          infringementTypes: ['TRADEMARK'],
          source: 'ONLINE',
          platform: 'TAOBAO',
          foundAt: '2026-10-26T04:00:00.000Z',
          shopName: 'V6 合成商品店',
          needDisclose: false,
          products: [
            {
              title: '合成商品甲',
              quantity: 1,
              unitPrice: '10.00',
              commentCount: 0,
            },
          ],
          leadScreenshotContentVersionIds: [],
        },
      }),
      201,
    );
    expect(lead.products).toHaveLength(1);
    await page.goto(`/leads/${lead.id}`);
    const product = page
      .locator('[data-test="product-screenshots-row"]')
      .first();
    await expect(product).toBeVisible();
    await product.getByLabel('替换商品截图').setInputFiles({
      name: 'V6-商品截图.png',
      mimeType: 'image/png',
      buffer: png,
    });
    await expect(product.getByText('V6-商品截图.png')).toBeVisible();
    await page.reload();
    await expect(product.getByText('V6-商品截图.png')).toBeVisible();
    await body(
      await page.request.post(
        `/api/v1/customers/${fixture.customerId}/client-accounts`,
        {
          headers,
          data: {
            displayName: 'V6 合成客户账号',
            username: `v6-client-${randomUUID().slice(0, 8)}`,
            password: 'synthetic client password 2026',
          },
        },
      ),
      201,
    );
    const currentLead = await body<{ version: number }>(
      await page.request.get(`/api/v1/leads/${lead.id}`),
      200,
    );
    await body(
      await page.request.post(`/api/v1/leads/${lead.id}/push`, {
        headers: { ...headers, 'Idempotency-Key': randomUUID() },
        data: { expectedVersion: currentLead.version },
      }),
      201,
    );
    await page.reload();
    await product.getByLabel('替换商品截图').setInputFiles({
      name: 'V6-推送后截图.png',
      mimeType: 'image/png',
      buffer: png,
    });
    await expect(product.getByText('V6-推送后截图.png')).toBeVisible();
    await page.reload();
    await expect(product.getByText('V6-推送后截图.png')).toBeVisible();
    await capture(page, 'lead-product-screenshot-after-push');

    const templateResponse = await page.request.get(
      '/api/v1/cases/csv-import/template',
    );
    expect(templateResponse.status(), await templateResponse.text()).toBe(200);
    const template = (await templateResponse.text()).trimEnd();
    const importCsv = async (courtNo: string, expectDuplicate: boolean) => {
      await page.goto('/cases');
      await page.locator('[data-test="open-case-csv-import"]').click();
      const dialog = page.getByRole('dialog', { name: 'CSV批量录入案件' });
      await dialog.locator('input[type="file"]').setInputFiles({
        name: `V6-${courtNo}.csv`,
        mimeType: 'text/csv',
        buffer: Buffer.from(
          `${template}\r\n${csvRow(
            fixture.customerBusinessId,
            fixture.courtName,
            courtNo,
            expectDuplicate ? '跨文件候选人工核对后续录' : '首份合成验收录入',
          )}\r\n`,
          'utf8',
        ),
      });
      await expect(dialog.getByText('有效 1 行，错误 0 行。')).toBeVisible();
      if (expectDuplicate) {
        await expect(
          dialog.getByText('疑似重复按客户、法院和法院案号匹配'),
        ).toBeVisible();
        await dialog.getByLabel('确认CSV第2行重复候选').check();
      } else {
        await expect(dialog.getByText('未发现疑似重复')).toBeVisible();
      }
      const committed = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/v1/cases/csv-import/commit') &&
          response.request().method() === 'POST',
      );
      await dialog.locator('[data-test="commit-case-csv"]').click();
      const response = await committed;
      const posted = response.request().postDataJSON() as {
        duplicateConfirmations: Array<{
          caseIds: string[];
          rowNumbers: number[];
        }>;
      };
      if (expectDuplicate) {
        expect(posted.duplicateConfirmations).toHaveLength(1);
        expect(posted.duplicateConfirmations[0]!.caseIds).toHaveLength(1);
      } else expect(posted.duplicateConfirmations).toEqual([]);
      const result = await body<{
        items: Array<{ id: string; businessNo: string }>;
      }>(response, 200);
      await expect(dialog.getByText('已成功提交 1 行。')).toBeVisible();
      return result.items[0]!;
    };
    const imported = await importCsv('V6-UI-001', false);
    await capture(page, 'csv-import-first');
    const duplicate = await importCsv('V6-UI-001', true);
    expect(duplicate.id).not.toBe(imported.id);
    await capture(page, 'csv-import-duplicate');

    const makeCase = async (name: string) =>
      body<{ id: string; businessNo: string; version: number }>(
        await page.request.post('/api/v1/cases/external-entries', {
          headers: { ...headers, 'Idempotency-Key': randomUUID() },
          data: {
            idempotencyKey: randomUUID(),
            entryKind: 'HISTORICAL_BACKFILL',
            initialStage: 'PENDING_MATCH',
            stageReachedOn: businessDate,
            source: 'V6 合成外录',
            reason: name,
            customerId: fixture.customerId,
            rightsHolderId: fixture.rightsHolderId,
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
    const single = await makeCase('单案提前归档');
    const batchA = await makeCase('批量提前归档甲');
    const batchB = await makeCase('批量提前归档乙');
    await page.goto('/cases');
    await page.locator(`[data-test="select-case-${imported.id}"]`).check();
    const exported = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/cases/exports/selection') &&
        response.request().method() === 'POST',
    );
    const download = page.waitForEvent('download');
    await page.locator('[data-test="export-selected-cases"]').click();
    const exportResponse = await exported;
    expect(exportResponse.status()).toBe(200);
    const selection = exportResponse.request().postDataJSON() as {
      ids: string[];
      view: string;
    };
    expect(selection.ids).toEqual([imported.id]);
    expect(['mine', 'department']).toContain(selection.view);
    const selectedFile = await download;
    expect(selectedFile.suggestedFilename()).toBe('case-selection.csv');
    const selectedCsv = await readFile(await selectedFile.path(), 'utf8');
    const selectedRows = selectedCsv
      .replace(/^\uFEFF/u, '')
      .trimEnd()
      .split('\r\n');
    expect(selectedRows).toHaveLength(2);
    expect(selectedRows[1]!.startsWith(`"${imported.businessNo}",`)).toBe(true);
    expect(selectedCsv).not.toContain(`"${duplicate.businessNo}"`);

    await page.goto(`/cases/${single.id}`);
    await page.locator('[data-test="open-detail-early-archive"]').click();
    const singleDialog = page.getByRole('dialog', { name: '提前归档案件' });
    await singleDialog.getByLabel('归档日期').fill(businessDate);
    await singleDialog.getByLabel('提前归档原因').fill('V6 合成单案提前归档');
    await singleDialog.getByLabel('我确认停止此案后续诉讼办理并归档。').check();
    await singleDialog.locator('[data-test="submit-early-archive"]').click();
    await expect(page.locator('[data-test="case-read-only"]')).toBeVisible();
    await page.goto('/cases');
    await page.locator(`[data-test="select-case-${batchA.id}"]`).check();
    await page.locator(`[data-test="select-case-${batchB.id}"]`).check();
    await page.locator('[data-test="open-batch-early-archive"]').click();
    const batchDialog = page.getByRole('dialog', { name: '批量提前归档' });
    await batchDialog.getByLabel('归档日期').fill(businessDate);
    await batchDialog.getByLabel('提前归档原因').fill('V6 合成批量提前归档');
    await batchDialog
      .getByLabel('我确认停止所选案件后续诉讼办理并归档。')
      .check();
    const batchRequest = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/cases/early-archive-batches') &&
        response.request().method() === 'POST',
    );
    await batchDialog
      .locator('[data-test="submit-batch-early-archive"]')
      .click();
    const batchResponse = await batchRequest;
    const batchResult = await body<{
      items: Array<{
        id: string;
        status: 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
        result?: {
          id: string;
          earlyArchiveId: string;
          stage: string;
          version: number;
        };
      }>;
    }>(batchResponse, 200);
    expect(batchResult.items.map((item) => item.id).sort()).toEqual(
      [batchA.id, batchB.id].sort(),
    );
    for (const item of batchResult.items) {
      expect(item.status).toBe('SUCCEEDED');
      expect(item.result).toMatchObject({
        id: item.id,
        stage: 'ARCHIVED',
        version: 2,
      });
      expect(item.result?.earlyArchiveId).toBeTruthy();
      const detail = await body<{
        id: string;
        stage: string;
        version: number;
        earlyArchive: {
          id: string;
          fromVersion: number;
          toVersion: number;
          archiveAt: string;
          reason: string;
        } | null;
      }>(await page.request.get(`/api/v1/cases/${item.id}`), 200);
      expect(detail).toMatchObject({
        id: item.id,
        stage: 'ARCHIVED',
        version: 2,
      });
      expect(detail.earlyArchive).toMatchObject({
        id: item.result?.earlyArchiveId,
        fromVersion: 1,
        toVersion: 2,
        archiveAt: businessDate,
        reason: 'V6 合成批量提前归档',
      });
    }
    const batchResults = batchDialog.getByRole('list', {
      name: '逐案归档结果',
    });
    await expect(batchResults.locator('li')).toHaveCount(2);
    for (const item of [batchA, batchB])
      await expect(
        batchResults.getByRole('listitem').filter({ hasText: item.businessNo }),
      ).toContainText('已归档');
    await capture(page, 'case-batch-archive');

    const fee = await body<{ id: string; version: number }>(
      await page.request.post('/api/v1/fees', {
        headers,
        data: {
          caseId: single.id,
          type: '诉讼费',
          direction: '支出',
          amount: '10.00',
          status: '发起',
          feeDate: businessDate,
          idempotencyKey: randomUUID(),
        },
      }),
      201,
    );
    await body(
      await page.request.post(`/api/v1/fees/${fee.id}/cancel`, {
        headers,
        data: {
          expectedVersion: fee.version,
          idempotencyKey: randomUUID(),
          reason: 'V6 合成费用取消',
        },
      }),
      201,
    );
    await page.goto('/settlements');
    await page.getByRole('tab', { name: '费用中心' }).click();
    await page.getByRole('button', { name: '取消／作废记录' }).click();
    const cancellationHistory = page.getByRole('region', {
      name: '取消费用历史',
    });
    await expect(cancellationHistory).toContainText(single.businessNo);
    await cancellationHistory
      .getByRole('button', { name: '查看历史' })
      .first()
      .click();
    await cancellationHistory.getByLabel(/实际付款金额/u).fill('6.00');
    await cancellationHistory
      .getByLabel('收付日期（金额大于0必填）')
      .fill(businessDate);
    await cancellationHistory.getByLabel('收付凭证（可选）').setInputFiles({
      name: 'V6-实付凭证.png',
      mimeType: 'image/png',
      buffer: png,
    });
    await expect(
      cancellationHistory.getByText('已上传并绑定精确版本'),
    ).toHaveCount(1);
    const paymentRequest = page.waitForResponse(
      (response) =>
        response
          .url()
          .endsWith(`/api/v1/fees/${fee.id}/payment-verification`) &&
        response.request().method() === 'POST',
    );
    await cancellationHistory
      .getByRole('button', { name: '保存收付核对' })
      .click();
    const paymentResponse = await paymentRequest;
    await body(paymentResponse, 201);
    const paymentProof = paymentResponse.request().postDataJSON() as {
      proofMaterialId: string | null;
      proofContentVersionId: string | null;
    };
    expect(paymentProof.proofMaterialId).toBeTruthy();
    expect(paymentProof.proofContentVersionId).toBeTruthy();
    await expect(
      cancellationHistory.getByRole('button', { name: '预览收付凭证' }),
    ).toBeVisible();

    await cancellationHistory.getByLabel('退款金额').fill('2.00');
    await cancellationHistory.getByLabel('实际退款日期').fill(businessDate);
    await cancellationHistory.getByLabel('退款凭证（可选）').setInputFiles({
      name: 'V6-退款凭证.png',
      mimeType: 'image/png',
      buffer: png,
    });
    await expect(
      cancellationHistory.getByText('已上传并绑定精确版本'),
    ).toHaveCount(2);
    const refundRequest = page.waitForResponse(
      (response) =>
        response
          .url()
          .endsWith(`/api/v1/fees/${fee.id}/refund-reconciliations`) &&
        response.request().method() === 'POST',
    );
    await cancellationHistory.getByRole('button', { name: '记录退款' }).click();
    const refundResponse = await refundRequest;
    await body(refundResponse, 201);
    const refundProof = refundResponse.request().postDataJSON() as {
      proofMaterialId: string | null;
      proofContentVersionId: string | null;
    };
    expect(refundProof.proofMaterialId).toBeTruthy();
    expect(refundProof.proofContentVersionId).toBeTruthy();
    await body(
      await page.request.post(`/api/v1/fees/${fee.id}/refund-reconciliations`, {
        headers,
        data: {
          amount: '3.00',
          refundDate: businessDate,
          proofMaterialId: null,
          proofContentVersionId: null,
          idempotencyKey: randomUUID(),
        },
      }),
      201,
    );
    await page.reload();
    await page.getByRole('tab', { name: '费用中心' }).click();
    await page.getByRole('button', { name: '取消／作废记录' }).click();
    await cancellationHistory
      .getByRole('button', { name: '查看历史' })
      .first()
      .click();
    await expect(
      cancellationHistory.getByText('核实后剩余收付：1.00'),
    ).toBeVisible();
    for (const [label, proof, filename, expectedBytes] of [
      ['收付凭证', paymentProof, 'V6-实付凭证.png', png],
      ['凭证', refundProof, 'V6-退款凭证.png', png],
    ] as const) {
      const contentPath = `/api/v1/materials/${proof.proofMaterialId}/versions/${proof.proofContentVersionId}/content`;
      const previewed = page.waitForResponse(
        (response) =>
          response.url().endsWith(contentPath) &&
          response.request().method() === 'GET',
      );
      await cancellationHistory
        .getByRole('button', { name: `预览${label}`, exact: true })
        .click();
      expect((await previewed).status()).toBe(200);
      const proofPreview = page.getByRole('dialog', {
        name: '预览 费用核对凭证',
      });
      const image = proofPreview.locator('img[alt="费用核对凭证"]');
      await expect(image).toBeVisible();
      expect(
        (await image.getAttribute('src'))?.startsWith(
          `blob:${new URL(page.url()).origin}/`,
        ),
      ).toBe(true);
      await capture(
        page,
        label === '收付凭证' ? 'fee-payment-proof' : 'fee-refund-proof',
      );
      await proofPreview
        .locator('[data-test="material-preview-close"]')
        .click();
      await expect(proofPreview).toHaveCount(0);
      const downloaded = page.waitForResponse(
        (response) =>
          response.url().endsWith(contentPath) &&
          response.request().method() === 'GET',
      );
      const downloadProof = page.waitForEvent('download');
      await cancellationHistory
        .getByRole('button', { name: `下载${label}`, exact: true })
        .click();
      expect((await downloaded).status()).toBe(200);
      const savedProof = await downloadProof;
      expect(savedProof.suggestedFilename()).toBe(filename);
      expect(
        (await readFile(await savedProof.path())).equals(expectedBytes),
      ).toBe(true);
    }
    await capture(page, 'fee-cancellation');
    expect(pageErrors).toEqual([]);
  } finally {
    await fixture.disconnect();
  }
});
