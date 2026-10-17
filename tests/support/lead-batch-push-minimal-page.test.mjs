import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createMinimalPageRequestBudget } from './minimal-page-acceptance.mjs';

const runId = '00000000-0000-4000-8000-000000000101';
const customerId = '50000000-0000-4000-8000-000000000002';
const rightsHolderId = '60000000-0000-4000-8000-000000000001';
const leadIds = [
  '70000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000002',
];

function leadCreateBody(index) {
  return {
    customerId,
    rightsHolderId,
    caseType: 'CIVIL',
    infringementTypes: ['TRADEMARK'],
    source: 'ONLINE',
    platform: 'TAOBAO',
    foundAt: new Date().toISOString(),
    shopName: `minimal-page:${runId}:${index}`,
    needDisclose: false,
    products: [
      {
        title: `${runId}-product-${index}`,
        quantity: 1,
        unitPrice: '1.00',
        commentCount: 0,
      },
    ],
    leadScreenshotContentVersionIds: [],
  };
}

const sourceFiles = [
  new URL('../e2e/lead-batch-push-minimal-page.spec.ts', import.meta.url),
  new URL('../../frontend/src/modules/leads/LeadForm.vue', import.meta.url),
  new URL('../../frontend/src/modules/leads/LeadNewPage.vue', import.meta.url),
  new URL('../../frontend/src/modules/leads/LeadListPage.vue', import.meta.url),
  new URL(
    '../../frontend/src/modules/leads/LeadDetailPage.vue',
    import.meta.url,
  ),
  new URL(
    '../../frontend/src/modules/leads/LeadBatchPushPanel.vue',
    import.meta.url,
  ),
  new URL('../../frontend/src/modules/auth/LoginPage.vue', import.meta.url),
  new URL('../../frontend/src/app/AppShell.vue', import.meta.url),
];

function readLiteralDataTestSelectors(specSource) {
  const selectors = new Set();
  for (const match of specSource.matchAll(
    /\[data-test\s*=\s*["']([^"']+)["']\]/gu,
  ))
    selectors.add(match[1]);
  for (const match of specSource.matchAll(
    /getByTestId\(\s*["']([^"']+)["']\s*\)/gu,
  ))
    selectors.add(match[1]);
  return [...selectors].sort();
}

function readStaticTemplateDataTests(templateSource) {
  const selectors = new Set();
  for (const match of templateSource.matchAll(
    /\sdata-test\s*=\s*["']([^"'$]+)["']/gu,
  ))
    selectors.add(match[1]);
  return selectors;
}

function readLiteralButtonNames(specSource) {
  const names = new Set();
  for (const match of specSource.matchAll(
    /getByRole\(\s*["']button["']\s*,\s*\{\s*name:\s*["']([^"'`]+)["']/gu,
  ))
    names.add(match[1]);
  return [...names].sort();
}

function readStaticTemplateButtonNames(templateSource) {
  const names = new Set();
  for (const match of templateSource.matchAll(
    /<(?:ElButton|button)\b[^>]*>([\s\S]*?)<\/(?:ElButton|button)>/gu,
  )) {
    const text = match[1]
      .replace(/<[^>]*>/gu, '')
      .replace(/\{\{[\s\S]*?\}\}/gu, '')
      .replace(/\s+/gu, ' ')
      .trim();
    if (text) names.add(text);
  }
  for (const match of templateSource.matchAll(
    /\b(?:aria-label|submit-label)\s*=\s*["']([^"'{}]+)["']/gu,
  ))
    names.add(match[1]);
  return names;
}

async function readSources() {
  const [specSource, ...templateSources] = await Promise.all(
    sourceFiles.map((url) => readFile(url, 'utf8')),
  );
  return { specSource, templateSources };
}

function missingSelectors(specSource, templateSources) {
  const available = new Set(
    templateSources.flatMap((source) => [
      ...readStaticTemplateDataTests(source),
    ]),
  );
  return readLiteralDataTestSelectors(specSource).filter(
    (selector) => !available.has(selector),
  );
}

function missingButtonNames(specSource, templateSources) {
  const available = new Set(
    templateSources.flatMap((source) => [
      ...readStaticTemplateButtonNames(source),
    ]),
  );
  return readLiteralButtonNames(specSource).filter(
    (name) => !available.has(name),
  );
}

test('minimal lead batch page selectors exist in the current Vue templates', async () => {
  const { specSource, templateSources } = await readSources();
  assert.deepEqual(missingSelectors(specSource, templateSources), []);
  assert.deepEqual(missingButtonNames(specSource, templateSources), []);
});

test('the checker catches the former nonexistent lead-record-meta test attribute', async () => {
  const { templateSources } = await readSources();
  const formerSpecSelector = `page.locator('[data-test="lead-record-meta"]')`;
  assert.deepEqual(missingSelectors(formerSpecSelector, templateSources), [
    'lead-record-meta',
  ]);
});

test('lead batch request budget accepts the exact UI pair and rejects cross-ID or extra rows before dispatch', () => {
  const budget = createMinimalPageRequestBudget('LEAD_BATCH');
  budget.setRunId(runId, 'offline-minimal-user');
  const endpoint = 'http://127.0.0.1:5174/api/v1/leads';

  const wrongCustomer = leadCreateBody(1);
  wrongCustomer.customerId = '50000000-0000-4000-8000-000000000099';
  assert.throws(
    () => budget.admit('POST', endpoint, JSON.stringify(wrongCustomer)),
    { code: 'MINIMAL_PAGE_BUDGET_BODY' },
  );
  budget.admit('POST', endpoint, JSON.stringify(leadCreateBody(1)));
  budget.admit('POST', endpoint, JSON.stringify(leadCreateBody(2)));
  budget.setLeads(leadIds);

  const batchEndpoint = 'http://127.0.0.1:5174/api/v1/leads/batch-push';
  const wrongIdBatch = {
    items: [
      { leadId: leadIds[0], expectedVersion: 1 },
      { leadId: '70000000-0000-4000-8000-000000000099', expectedVersion: 1 },
    ],
  };
  assert.throws(
    () => budget.admit('POST', batchEndpoint, JSON.stringify(wrongIdBatch)),
    { code: 'MINIMAL_PAGE_BUDGET_BODY' },
  );
  assert.deepEqual(budget.counts(), { leadCreate: 2 });

  const extraRowBatch = {
    items: [
      { leadId: leadIds[0], expectedVersion: 1 },
      { leadId: leadIds[1], expectedVersion: 1 },
      { leadId: '70000000-0000-4000-8000-000000000099', expectedVersion: 1 },
    ],
  };
  assert.throws(
    () => budget.admit('POST', batchEndpoint, JSON.stringify(extraRowBatch)),
    { code: 'MINIMAL_PAGE_BUDGET_BODY' },
  );
  assert.deepEqual(budget.counts(), { leadCreate: 2 });

  budget.admit(
    'POST',
    batchEndpoint,
    JSON.stringify({
      items: leadIds.map((leadId) => ({ leadId, expectedVersion: 1 })),
    }),
  );
  assert.deepEqual(budget.counts(), { leadCreate: 2, batchPush: 1 });
});
