import { randomUUID } from 'node:crypto';
import {
  test as base,
  expect,
  type APIResponse,
  type Page,
  type Locator,
  type Request,
} from '@playwright/test';
import {
  assertSectionRecordUiSourceReady,
  assertSectionRecordUiRunner,
  createSectionRecordUiActor,
  sectionRecordUiSnapshot,
  sectionRecordUiUploads,
  sectionRecordUiBaselineSecurity,
  revokeSectionRecordUiActor,
  type SectionRecordUiActor,
} from '../support/case-section-record-ui-database.mjs';

// Append-only browser acceptance. The unique protected runner owns all actual execution.
// No legacy reset/seed imports; no route.fulfill, fake API responses, or direct business SQL.
type FileVersion = {
  materialId: string;
  contentVersionId: string;
  originalFilename: string;
};
type Values = {
  mailedAt?: string;
  submittedAt?: string;
  finishedAt?: string;
  hearingAt?: string | null;
  judgmentReceivedAt?: string;
  closeAt?: string | null;
  judgmentAmountState?: string;
  judgmentAmount?: string | null;
  paidLitigationFeeState?: string;
  paidLitigationFee?: string | null;
  closeAmountState?: string;
  closeAmt?: string | null;
  note?: string | null;
  reason?: string;
  basisNote?: string | null;
  mailReceiptContentVersionIds?: string[];
  executionFilingProofContentVersionIds?: string[];
  basisContentVersionIds?: string[];
  judgmentContentVersionIds?: string[];
  closeContentVersionIds?: string[];
  files?: FileVersion[];
};
type RecordRow = {
  mailingId?: string;
  mailingRevision?: number;
  filingId?: string;
  filingRevision?: number;
  finishId?: string;
  finishRevision?: number;
  arrangementId?: string;
  hearingRevision?: number;
  judgmentId?: string;
  judgmentRevision?: number;
  closureId?: string;
  closureRevision?: number;
  trialRoundId?: string;
  canEdit: boolean;
  original: Values;
  effective: Values;
  history: Array<
    Values & {
      id: string;
      fromRevision: number;
      toRevision: number;
      correctionReason: string;
    }
  >;
};
type Detail = {
  id: string;
  businessNo: string;
  stage: string;
  version: number;
  acceptance: unknown | null;
  canCorrectHearing: boolean;
  origin: { kind: string; initialStage: string } | null;
  hearing: {
    currentArrangement: { id: string; hearingAt: string | null } | null;
    currentAdvance: { id: string } | null;
    arrangements: unknown[];
    advances: unknown[];
    corrections: unknown[];
  };
  closure: { id: string; current: { id: string }; history: unknown[] } | null;
  archive: {
    closureVersionId: string;
    current: { id: string };
    history: unknown[];
  } | null;
  recordEdits: {
    executionMailings: RecordRow[];
    executionFilings: RecordRow[];
    executionFinishes: RecordRow[];
    hearings: RecordRow[];
    judgments: RecordRow[];
    closures: RecordRow[];
  };
};
const variants = [
  {
    kind: 'execution-mailing',
    section: 'execution',
    command: 'record-execution-mailing',
    key: 'executionMailings',
    route: 'execution-mailing-correction',
    dateKey: 'mailedAt',
    idKey: 'mailingId',
    revisionKey: 'mailingRevision',
    expectedKey: 'expectedMailingRevision',
    fileKey: 'mailReceiptContentVersionIds',
  },
  {
    kind: 'execution-filing',
    section: 'execution',
    command: 'record-execution-filing',
    key: 'executionFilings',
    route: 'execution-filing-correction',
    dateKey: 'submittedAt',
    idKey: 'filingId',
    revisionKey: 'filingRevision',
    expectedKey: 'expectedFilingRevision',
    fileKey: 'executionFilingProofContentVersionIds',
  },
  {
    kind: 'execution-finish',
    section: 'execution',
    command: 'record-execution-finish',
    key: 'executionFinishes',
    route: 'execution-finish-correction',
    dateKey: 'finishedAt',
    idKey: 'finishId',
    revisionKey: 'finishRevision',
    expectedKey: 'expectedFinishRevision',
    fileKey: 'basisContentVersionIds',
  },
  {
    kind: 'hearing',
    section: 'first-instance',
    command: 'record-hearing-first',
    key: 'hearings',
    route: 'hearing-record-correction',
    dateKey: 'hearingAt',
    idKey: 'arrangementId',
    revisionKey: 'hearingRevision',
    expectedKey: 'expectedHearingRevision',
    fileKey: null,
  },
  {
    kind: 'judgment',
    section: 'judgment',
    command: 'record-judgment',
    key: 'judgments',
    route: 'judgment-record-correction',
    dateKey: 'judgmentReceivedAt',
    idKey: 'judgmentId',
    revisionKey: 'judgmentRevision',
    expectedKey: 'expectedJudgmentRevision',
    fileKey: 'judgmentContentVersionIds',
  },
  {
    kind: 'closure',
    section: 'closure-info',
    command: 'record-closure',
    key: 'closures',
    route: 'closure-record-correction',
    dateKey: 'closeAt',
    idKey: 'closureId',
    revisionKey: 'closureRevision',
    expectedKey: 'expectedClosureRevision',
    fileKey: 'closeContentVersionIds',
  },
] as const;
type Variant = (typeof variants)[number];
const origin = 'http://127.0.0.1:5174';
const byTest = (parent: Page | Locator, value: string) =>
  parent.locator(`[data-test="${value}"]`);
const visiblePanel = (page: Page) =>
  page.locator('[data-test="section-record-panel"]:visible');
const businessPath = (caseId: string, variant: Variant) =>
  `/api/v1/cases/${caseId}/${variant.route}`;
const date = (offset: number) => {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const value = new Date(`${today}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
};
async function json<T>(response: APIResponse, status = 200): Promise<T> {
  expect(
    response.status(),
    `Unexpected status for ${new URL(response.url()).pathname}`,
  ).toBe(status);
  return response.json() as Promise<T>;
}
async function login(page: Page, actor: SectionRecordUiActor) {
  assertSectionRecordUiSourceReady();
  await page.goto('/cases');
  await expect(page).toHaveURL(/\/login\?returnTo=/u);
  await page.getByLabel('用户名').fill(actor.username);
  await page.getByLabel('密码').fill(actor.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/cases');
}
const test = base.extend<{
  actor: SectionRecordUiActor;
  csrf: string;
}>({
  actor: async ({ baseURL }, use) => {
    assertSectionRecordUiSourceReady();
    expect(baseURL).toBe(origin);
    // Source permission admission precedes even the R2 environment capture.
    await assertSectionRecordUiRunner();
    const before = await sectionRecordUiBaselineSecurity();
    try {
      await use(await createSectionRecordUiActor());
    } finally {
      expect(await sectionRecordUiBaselineSecurity()).toEqual(before);
    }
  },
  page: async ({ page, actor }, use) => {
    assertSectionRecordUiSourceReady();
    await login(page, actor);
    await use(page);
  },
  csrf: async ({ page }, use) => {
    assertSectionRecordUiSourceReady();
    const session = await json<{ csrfToken: string }>(
      await page.request.get('/api/v1/auth/session'),
    );
    expect(session.csrfToken).toBeTruthy();
    await use(session.csrfToken);
  },
});
test.beforeAll(() => {
  // Discovery never executes this callback. Actual execution must refuse before
  // any fixture, browser page, capture, PG connection, or account/Grant creation.
  assertSectionRecordUiSourceReady();
});
const read = (page: Page, caseId: string) =>
  page.request
    .get(`/api/v1/cases/${caseId}`)
    .then((response) => json<Detail>(response));
const post = (
  page: Page,
  csrf: string,
  caseId: string,
  route: string,
  data: object,
) =>
  page.request.post(`/api/v1/cases/${caseId}/${route}`, {
    headers: { Origin: origin, 'X-CSRF-Token': csrf },
    data,
  });

// Normal lead-to-case preparation is pending its finite Action admission.
// Never replace this with external backfill, direct facts, or a fabricated case.
async function ordinarySource(): Promise<{ id: string; version: number }> {
  assertSectionRecordUiSourceReady();
}
function bytesFor(label: string) {
  return Buffer.from(`%PDF-1.7\nsynthetic section UI ${label}\n%%EOF\n`);
}
async function originalUpload(
  page: Page,
  csrf: string,
  caseId: string,
  category: string,
) {
  const bytes = bytesFor(`original ${category} ${caseId}`);
  const draft = await json<{ id: string }>(
    await page.request.post('/api/v1/materials/upload-drafts', {
      headers: { Origin: origin, 'X-CSRF-Token': csrf },
      data: {
        ownerType: 'CASE',
        ownerId: caseId,
        category,
        purpose: category,
        originalFilename: `ui-original-${category}-${randomUUID()}.pdf`,
        declaredMimeType: 'application/pdf',
      },
    }),
    201,
  );
  const file = await json<FileVersion>(
    await page.request.put(
      `/api/v1/materials/upload-drafts/${draft.id}/content`,
      {
        headers: {
          Origin: origin,
          'X-CSRF-Token': csrf,
          'Content-Type': 'application/octet-stream',
        },
        data: bytes,
      },
    ),
    200,
  );
  return { file, bytes };
}
type Source = {
  caseId: string;
  originals: Array<{ file: FileVersion; bytes: Buffer }>;
};
async function executionSource(page: Page, csrf: string): Promise<Source> {
  const entry = await ordinarySource();
  const originals = [];
  const mail = await originalUpload(page, csrf, entry.id, 'MAIL_RECEIPT');
  originals.push(mail);
  const mailed = await json<{ mailingId: string; version: number }>(
    await post(page, csrf, entry.id, 'execution-mail', {
      expectedVersion: entry.version,
      idempotencyKey: randomUUID(),
      expectedConfirmationId: null,
      mailedAt: date(-8),
      mailReceiptContentVersionIds: [mail.file.contentVersionId],
    }),
    201,
  );
  const filing = await originalUpload(
    page,
    csrf,
    entry.id,
    'EXECUTION_FILING_PROOF',
  );
  originals.push(filing);
  const filed = await json<{ filingId: string; version: number }>(
    await post(page, csrf, entry.id, 'execution-filing-submit', {
      expectedVersion: mailed.version,
      idempotencyKey: randomUUID(),
      expectedMailingId: mailed.mailingId,
      submittedAt: date(-7),
      executionFilingProofContentVersionIds: [filing.file.contentVersionId],
    }),
    201,
  );
  const finish = await originalUpload(
    page,
    csrf,
    entry.id,
    'EXECUTION_FINISH_BASIS',
  );
  originals.push(finish);
  const finished = await json<{ finishId: string; version: number }>(
    await post(page, csrf, entry.id, 'execution-finish', {
      expectedVersion: filed.version,
      idempotencyKey: randomUUID(),
      expectedFilingId: filed.filingId,
      finishedAt: date(-6),
      reason: 'Synthetic original finish reason',
      basisNote: 'Frozen original basis',
      basisContentVersionIds: [finish.file.contentVersionId],
    }),
    201,
  );
  const close = await originalUpload(
    page,
    csrf,
    entry.id,
    'CASE_CLOSURE_DOCUMENT',
  );
  originals.push(close);
  const closed = await json<{ closureVersionId: string; version: number }>(
    await post(page, csrf, entry.id, 'closure', {
      expectedVersion: finished.version,
      idempotencyKey: randomUUID(),
      expectedFinishId: finished.finishId,
      closeAt: date(-5),
      closeAmountState: 'PENDING',
      closeAmt: null,
      note: 'Frozen original closure note',
      closeContentVersionIds: [close.file.contentVersionId],
    }),
    201,
  );
  await json(
    await post(page, csrf, entry.id, 'archive', {
      expectedVersion: closed.version,
      idempotencyKey: randomUUID(),
      expectedClosureVersionId: closed.closureVersionId,
      archiveAt: date(-4),
      archiveType: 'EXECUTION_CLOSED',
      archiveReason: 'Synthetic browser archive source',
    }),
    201,
  );
  expect((await read(page, entry.id)).stage).toBe('ARCHIVED');
  return { caseId: entry.id, originals };
}
async function judgmentSource(page: Page, csrf: string): Promise<Source> {
  const entry = await ordinarySource();
  const original = await originalUpload(page, csrf, entry.id, 'JUDGMENT');
  const registered = await json<{ judgmentId: string; version: number }>(
    await post(page, csrf, entry.id, 'judgment-register', {
      expectedVersion: entry.version,
      idempotencyKey: randomUUID(),
      judgmentReceivedAt: date(-8),
      judgmentAmountState: 'KNOWN',
      judgmentAmount: '10.00',
      paidLitigationFeeState: 'KNOWN',
      paidLitigationFee: '0.00',
      judgmentContentVersionIds: [original.file.contentVersionId],
    }),
    201,
  );
  await json(
    await post(page, csrf, entry.id, 'judgment-next-step', {
      expectedVersion: registered.version,
      idempotencyKey: randomUUID(),
      judgmentId: registered.judgmentId,
      next: 'EXECUTION',
      executionReadinessConfirmed: true,
    }),
    201,
  );
  expect((await read(page, entry.id)).stage).toBe(
    'WAITING_EXECUTION_DOCUMENTS',
  );
  return { caseId: entry.id, originals: [original] };
}
const sourceFor = (page: Page, csrf: string, variant: Variant) =>
  variant.kind === 'judgment'
    ? judgmentSource(page, csrf)
    : executionSource(page, csrf);
function row(detail: Detail, variant: Variant): RecordRow {
  const rows = detail.recordEdits[variant.key];
  expect(rows).toHaveLength(1);
  const entry = rows[0];
  if (
    !entry ||
    typeof entry[variant.idKey] !== 'string' ||
    typeof entry[variant.revisionKey] !== 'number'
  )
    throw new Error(`Missing exact ${variant.kind} record identity`);
  return entry;
}
function command(
  detail: Detail,
  variant: Variant,
  reason: string,
  newDate?: string,
) {
  const entry = row(detail, variant);
  const common = {
    [variant.idKey]: entry[variant.idKey],
    [variant.expectedKey]: entry[variant.revisionKey],
  };
  const e = entry.effective;
  const value = newDate ?? e[variant.dateKey];
  switch (variant.kind) {
    case 'execution-mailing':
      return {
        ...common,
        mailedAt: value,
        mailReceiptContentVersionIds: e.mailReceiptContentVersionIds,
        reason,
      };
    case 'execution-filing':
      return {
        ...common,
        submittedAt: value,
        executionFilingProofContentVersionIds:
          e.executionFilingProofContentVersionIds,
        reason,
      };
    case 'execution-finish':
      return {
        ...common,
        finishedAt: value,
        reason: e.reason,
        basisNote: e.basisNote,
        basisContentVersionIds: e.basisContentVersionIds,
        correctionReason: reason,
      };
    case 'hearing':
      return {
        ...common,
        trialRoundId: entry.trialRoundId,
        hearingAt: value,
        reason,
      };
    case 'judgment':
      return {
        ...common,
        trialRoundId: entry.trialRoundId,
        judgmentReceivedAt: value,
        judgmentAmountState: e.judgmentAmountState,
        judgmentAmount: e.judgmentAmount,
        paidLitigationFeeState: e.paidLitigationFeeState,
        paidLitigationFee: e.paidLitigationFee,
        judgmentContentVersionIds: e.judgmentContentVersionIds,
        reason,
      };
    case 'closure': {
      const closureVersionId = detail.closure?.current.id;
      if (!closureVersionId)
        throw new Error('Closure requires its actually read workflow version');
      return {
        ...common,
        expectedClosureVersionId: closureVersionId,
        closeAt: value,
        closeAmountState: e.closeAmountState,
        closeAmt: e.closeAmt,
        note: e.note,
        closeContentVersionIds: e.closeContentVersionIds,
        correctionReason: reason,
      };
    }
  }
}
async function openDetail(page: Page, caseId: string, variant: Variant) {
  await page.goto(`/cases/${caseId}`);
  const edit = page.locator(
    `[data-section="${variant.section}"] .case-workspace-section__edit`,
  );
  await expect(edit).toBeEnabled();
  await edit.click();
  await byTest(page, 'workspace-command').selectOption(variant.command);
  const panel = visiblePanel(page);
  await expect(panel).toBeVisible();
  return panel;
}
async function assertPrefill(panel: Locator, detail: Detail, variant: Variant) {
  const entry = row(detail, variant);
  expect(entry.canEdit).toBe(true);
  await expect(byTest(panel, 'section-record-effective')).toContainText(
    entry.effective[variant.dateKey] ?? '未确定',
  );
  await expect(byTest(panel, 'section-record-date')).toHaveValue(
    entry.effective[variant.dateKey] ?? '',
  );
  if (variant.kind === 'judgment') {
    await expect(byTest(panel, 'section-record-amount-state')).toHaveValue(
      entry.effective.judgmentAmountState!,
    );
    await expect(byTest(panel, 'section-record-amount')).toHaveValue(
      entry.effective.judgmentAmount!,
    );
    await expect(byTest(panel, 'section-record-fee-state')).toHaveValue(
      entry.effective.paidLitigationFeeState!,
    );
    await expect(byTest(panel, 'section-record-fee')).toHaveValue(
      entry.effective.paidLitigationFee!,
    );
  }
  if (variant.kind === 'closure') {
    await expect(byTest(panel, 'section-record-amount-state')).toHaveValue(
      'PENDING',
    );
    await expect(byTest(panel, 'section-record-amount')).toHaveCount(0);
    await expect(byTest(panel, 'section-record-note')).toHaveValue(
      entry.effective.note ?? '',
    );
  }
  if (variant.kind === 'execution-finish') {
    await expect(byTest(panel, 'section-record-business-reason')).toHaveValue(
      entry.effective.reason!,
    );
    await expect(byTest(panel, 'section-record-basis-note')).toHaveValue(
      entry.effective.basisNote ?? '',
    );
  }
  for (const file of entry.effective.files ?? [])
    await expect(
      byTest(panel, `section-record-file-${file.contentVersionId}`),
    ).toBeChecked();
  await byTest(panel, 'section-record-history')
    .locator('summary')
    .first()
    .click();
  await expect(byTest(panel, 'section-record-history')).toContainText(
    entry.original[variant.dateKey] ?? '未确定',
  );
}
function watchCommands(page: Page, path: string) {
  const bodies: unknown[] = [];
  const listener = (request: Request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === path)
      bodies.push(request.postDataJSON());
  };
  page.on('request', listener);
  return bodies;
}
async function clickSave(
  page: Page,
  panel: Locator,
  path: string,
  status = 201,
) {
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === path,
  );
  await expect(byTest(panel, 'section-record-save')).toBeEnabled();
  await byTest(panel, 'section-record-save').click();
  expect((await saved).status()).toBe(status);
}
function assertInvariant(
  before: Detail,
  after: Detail,
  variant: Variant,
  effective: Values,
) {
  expect(after.stage).toBe(before.stage);
  expect(after.version).toBe(before.version);
  const oldRow = row(before, variant),
    newRow = row(after, variant);
  expect(newRow[variant.idKey]).toBe(oldRow[variant.idKey]);
  expect(newRow[variant.revisionKey]).toBe(oldRow[variant.revisionKey]! + 1);
  expect(newRow.original).toEqual(oldRow.original);
  expect(newRow.effective).toEqual(effective);
  expect(newRow.history).toHaveLength(oldRow.history.length + 1);
  expect(newRow.history.slice(0, oldRow.history.length)).toEqual(
    oldRow.history,
  );
  for (const candidate of variants.filter(
    (candidate) => candidate.key !== variant.key,
  ))
    expect(after.recordEdits[candidate.key]).toEqual(
      before.recordEdits[candidate.key],
    );
  expect(after.hearing.arrangements).toEqual(before.hearing.arrangements);
  expect(after.hearing.advances).toEqual(before.hearing.advances);
  expect(after.hearing.corrections).toEqual(before.hearing.corrections);
  expect(after.closure?.history).toEqual(before.closure?.history);
  expect(after.archive).toEqual(before.archive);
}
async function reloginAndOpen(
  page: Page,
  actor: SectionRecordUiActor,
  caseId: string,
  variant: Variant,
  expectedSummaryDate?: string,
) {
  await page.reload();
  if (expectedSummaryDate) {
    const section = page.locator(`[data-section="${variant.section}"]`);
    await section.locator('.case-workspace-section__toggle').click();
    const groups = section.locator('.case-workspace-group');
    const index = (await groups.allTextContents()).findIndex((value) =>
      value.includes(expectedSummaryDate),
    );
    expect(
      index,
      'Fresh GET must project the effective date into its real detail section',
    ).toBeGreaterThanOrEqual(0);
    const tabs = section.locator('.case-workspace-group-nav button');
    if (await tabs.count()) await tabs.nth(index).click();
    await expect(groups.nth(index)).toBeVisible();
    await expect(groups.nth(index)).toContainText(expectedSummaryDate);
  }
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await login(page, actor);
  return openDetail(page, caseId, variant);
}
async function browserDownload(
  page: Page,
  button: Locator,
  bytes: Buffer,
  file: FileVersion,
) {
  const waiting = page.waitForEvent('download');
  const response = page.waitForResponse(
    (value) =>
      value.request().method() === 'GET' &&
      new URL(value.url()).pathname ===
        `/api/v1/materials/${file.materialId}/versions/${file.contentVersionId}/content`,
  );
  await button.click();
  const downloadedResponse = await response;
  expect(downloadedResponse.status()).toBe(200);
  expect(await downloadedResponse.body()).toEqual(bytes);
  const download = await waiting;
  const stream = await download.createReadStream();
  if (!stream) throw new Error('Exact version download has no readable bytes');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks)).toEqual(bytes);
}

for (const variant of variants.filter((item) => item.kind !== 'hearing')) {
  test.describe(`${variant.kind} detail registered information`, () => {
    test('real section click pre-fills, cancels without write, saves only this record and survives refresh/login', async ({
      page,
      actor,
      csrf,
    }) => {
      const source = await sourceFor(page, csrf, variant);
      const before = await read(page, source.caseId);
      const frozen = await sectionRecordUiSnapshot(source.caseId);
      const path = businessPath(source.caseId, variant);
      const bodies = watchCommands(page, path);
      let panel = await openDetail(page, source.caseId, variant);
      await assertPrefill(panel, before, variant);
      const newDate = date(-2);
      await byTest(panel, 'section-record-date').fill(newDate);
      await byTest(panel, 'section-record-reason').fill(
        'Unsaved cancelled draft',
      );
      await byTest(panel, 'section-record-cancel').click();
      await expect(visiblePanel(page)).toHaveCount(0);
      expect(bodies).toHaveLength(0);
      expect(await read(page, source.caseId)).toEqual(before);
      expect(await sectionRecordUiSnapshot(source.caseId)).toEqual(frozen);
      panel = await openDetail(page, source.caseId, variant);
      await assertPrefill(panel, before, variant);
      const reason = '  browser exact target correction  ';
      await byTest(panel, 'section-record-date').fill(newDate);
      await byTest(panel, 'section-record-reason').fill(reason);
      await clickSave(page, panel, path);
      const after = await read(page, source.caseId);
      expect(bodies).toEqual([
        {
          ...command(before, variant, reason, newDate),
          idempotencyKey: expect.any(String),
        },
      ]);
      assertInvariant(before, after, variant, {
        ...row(before, variant).effective,
        [variant.dateKey]: newDate,
      });
      expect((await sectionRecordUiSnapshot(source.caseId)).frozen).toEqual(
        frozen.frozen,
      );
      panel = await reloginAndOpen(
        page,
        actor,
        source.caseId,
        variant,
        newDate,
      );
      await assertPrefill(panel, after, variant);
      await expect(byTest(panel, 'section-record-history')).toContainText(
        reason.trim(),
      );
      expect(await read(page, source.caseId)).toEqual(after);
      for (const original of source.originals) {
        const response = await page.request.get(
          `/api/v1/materials/${original.file.materialId}/versions/${original.file.contentVersionId}/content`,
        );
        expect(response.status()).toBe(200);
        expect(await response.body()).toEqual(original.bytes);
      }
    });
  });
}

for (const variant of variants.filter((item) => item.fileKey !== null)) {
  test(`${variant.kind}: browser selects new bytes, prepares without command, then explicitly saves and downloads frozen old/new versions`, async ({
    page,
    actor,
    csrf,
  }) => {
    const source = await sourceFor(page, csrf, variant);
    const before = await read(page, source.caseId);
    const oldRow = row(before, variant);
    const path = businessPath(source.caseId, variant);
    const commands = watchCommands(page, path);
    const frozen = await sectionRecordUiSnapshot(source.caseId);
    let listUrl: string | undefined;
    let panel: Locator;
    if (variant.kind === 'judgment') {
      await page.goto(
        '/cases?view=department&stage=WAITING_EXECUTION_DOCUMENTS&page=1',
      );
      listUrl = page.url();
      const listRow = page
        .getByRole('row')
        .filter({ hasText: before.businessNo });
      await expect(listRow).toHaveCount(1);
      await listRow.locator('[data-case-record-edit]').click();
      await byTest(page, 'case-list-record-kind').selectOption('judgment');
      panel = visiblePanel(page);
    } else panel = await openDetail(page, source.caseId, variant);
    await assertPrefill(panel, before, variant);
    const bytes = bytesFor(`replacement ${variant.kind} ${source.caseId}`);
    const postResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === path + '/upload-drafts',
    );
    const putResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' &&
        /\/api\/v1\/materials\/upload-drafts\/[^/]+\/content$/u.test(
          new URL(response.url()).pathname,
        ),
    );
    await byTest(panel, 'section-record-upload').setInputFiles({
      name: `ui-new-${variant.kind}.pdf`,
      mimeType: 'application/pdf',
      buffer: bytes,
    });
    const draftResponse = await postResponse;
    expect(draftResponse.status()).toBe(201);
    const draft = (await draftResponse.json()) as {
      id: string;
      recordCorrection: { targetId: string; expectedRevision: number };
    };
    const uploadedResponse = await putResponse;
    expect(uploadedResponse.status()).toBe(200);
    expect(new URL(uploadedResponse.url()).pathname).toBe(
      `/api/v1/materials/upload-drafts/${draft.id}/content`,
    );
    const uploaded = (await uploadedResponse.json()) as FileVersion & {
      recordCorrection: object;
    };
    expect(draft.recordCorrection).toMatchObject({
      targetId: oldRow[variant.idKey],
      expectedRevision: oldRow[variant.revisionKey],
    });
    expect(uploaded.recordCorrection).toEqual(draft.recordCorrection);
    const body = draftResponse.request().postDataJSON() as Record<
      string,
      unknown
    >;
    const expectedTarget = {
      [variant.idKey]: oldRow[variant.idKey],
      [variant.expectedKey]: oldRow[variant.revisionKey],
      ...(variant.kind === 'judgment'
        ? { trialRoundId: oldRow.trialRoundId }
        : {}),
      ...(variant.kind === 'closure'
        ? { expectedClosureVersionId: before.closure?.current.id }
        : {}),
      originalFilename: `ui-new-${variant.kind}.pdf`,
      declaredMimeType: 'application/pdf',
    };
    expect(body).toEqual(expectedTarget);
    await expect(
      byTest(panel, `section-record-file-${uploaded.contentVersionId}`),
    ).toBeChecked();
    await expect(byTest(panel, 'section-record-upload-notice')).toContainText(
      '尚未保存资料更正',
    );
    expect(commands).toHaveLength(0);
    expect(await read(page, source.caseId)).toEqual(before);
    expect(await sectionRecordUiSnapshot(source.caseId)).toEqual(frozen);
    expect(
      (await sectionRecordUiUploads(source.caseId)).find(
        (item) => item.versionId === uploaded.contentVersionId,
      ),
    ).toMatchObject({
      draftId: draft.id,
      targetId: oldRow[variant.idKey],
      revision: oldRow[variant.revisionKey],
      firstFreeze: false,
    });
    await expect(panel).toBeVisible();
    if (listUrl) {
      expect(page.url()).toBe(listUrl);
      await expect(byTest(page, 'case-list-workflow')).toBeVisible();
      await expect(byTest(panel, 'section-record-date')).toBeEnabled();
    }
    const reason = 'Explicit save after browser file preparation';
    await byTest(panel, 'section-record-reason').fill(reason);
    await clickSave(page, panel, path);
    const after = await read(page, source.caseId);
    const ids = [
      ...(oldRow.effective[variant.fileKey!] ?? []),
      uploaded.contentVersionId,
    ];
    expect(commands).toEqual([
      {
        ...command(before, variant, reason),
        [variant.fileKey!]: ids,
        idempotencyKey: expect.any(String),
      },
    ]);
    const newFiles = row(after, variant).effective.files ?? [];
    expect(newFiles.map((file) => file.contentVersionId)).toEqual(ids);
    assertInvariant(before, after, variant, {
      ...oldRow.effective,
      [variant.fileKey!]: ids,
      files: newFiles,
    });
    expect((await sectionRecordUiSnapshot(source.caseId)).frozen).toEqual(
      frozen.frozen,
    );
    if (listUrl) {
      await expect(byTest(page, 'case-list-workflow')).toHaveCount(0);
      expect(page.url()).toBe(listUrl);
    }
    expect(
      (await sectionRecordUiUploads(source.caseId)).find(
        (item) => item.versionId === uploaded.contentVersionId,
      )?.firstFreeze,
    ).toBe(true);
    panel = await reloginAndOpen(page, actor, source.caseId, variant);
    await browserDownload(
      page,
      byTest(panel, 'section-record-effective-files').getByRole('button', {
        name: `ui-new-${variant.kind}.pdf（当前有效版本）`,
        exact: true,
      }),
      bytes,
      uploaded,
    );
    const original = source.originals.find((item) =>
      oldRow.original.files?.some(
        (file) => file.contentVersionId === item.file.contentVersionId,
      ),
    );
    if (!original)
      throw new Error(
        'Fixture requires an actual frozen original file for every upload kind',
      );
    await byTest(panel, 'section-record-history')
      .locator('summary')
      .first()
      .click();
    await browserDownload(
      page,
      byTest(panel, 'section-record-history').getByRole('button', {
        name: `${original.file.originalFilename}（原登记版本）`,
        exact: true,
      }),
      original.bytes,
      original.file,
    );
    expect(await read(page, source.caseId)).toEqual(after);
  });
}

test('real committed response is lost, reload/login restores exact original body/key/target and one receipt', async ({
  page,
  actor,
  csrf,
}) => {
  const variant = variants[5];
  const source = await executionSource(page, csrf);
  const before = await read(page, source.caseId);
  const path = businessPath(source.caseId, variant);
  const bodies: string[] = [];
  let originalReceipt: unknown;
  let first = true;
  await page.route(`**${path}`, async (route) => {
    bodies.push(route.request().postData()!);
    expect(route.request().headers()['idempotency-key']).toBe(
      (route.request().postDataJSON() as { idempotencyKey: string })
        .idempotencyKey,
    );
    if (first) {
      first = false;
      const upstream = await route.fetch();
      expect(upstream.status()).toBe(201);
      originalReceipt = await upstream.json();
      await route.abort('failed');
    } else await route.continue();
  });
  let panel = await openDetail(page, source.caseId, variant);
  await byTest(panel, 'section-record-note').fill(
    '  preserved original closure body  ',
  );
  await byTest(panel, 'section-record-reason').fill(
    '  preserved original reason  ',
  );
  await byTest(panel, 'section-record-save').click();
  await expect(byTest(panel, 'section-record-retry')).toBeEnabled();
  expect(bodies).toHaveLength(1);
  const saved = await read(page, source.caseId);
  expect(row(saved, variant).closureRevision).toBe(1);
  const committed = await sectionRecordUiSnapshot(source.caseId);
  panel = await reloginAndOpen(page, actor, source.caseId, variant);
  await expect(byTest(panel, 'section-record-pending')).toBeVisible();
  expect(bodies).toHaveLength(1);
  const replay = page.waitForResponse(
    (response) => new URL(response.url()).pathname === path,
  );
  await byTest(panel, 'section-record-retry').click();
  const replayResponse = await replay;
  expect(replayResponse.status()).toBe(201);
  expect(await replayResponse.json()).toEqual(originalReceipt);
  await expect(byTest(panel, 'section-record-pending')).toHaveCount(0);
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toBe(bodies[0]);
  expect(JSON.parse(bodies[0])).toMatchObject({
    closureId: row(before, variant).closureId,
    expectedClosureRevision: 0,
    expectedClosureVersionId: before.closure?.current.id,
    note: '  preserved original closure body  ',
    correctionReason: '  preserved original reason  ',
  });
  expect(await read(page, source.caseId)).toEqual(saved);
  expect(await sectionRecordUiSnapshot(source.caseId)).toEqual(committed);
  expect(committed.corrections.case_closure_record_corrections).toHaveLength(1);
  expect(committed.corrections.case_section_record_edit_receipts).toHaveLength(
    1,
  );
});

test('real stale closure CAS is rejected, refresh obtains new independent revision and original closure anchor', async ({
  page,
  actor,
  csrf,
}) => {
  const variant = variants[5];
  const source = await executionSource(page, csrf);
  const before = await read(page, source.caseId);
  let panel = await openDetail(page, source.caseId, variant);
  const path = businessPath(source.caseId, variant);
  await json(
    await post(page, csrf, source.caseId, variant.route, {
      ...command(before, variant, 'Concurrent legitimate correction'),
      idempotencyKey: randomUUID(),
      note: 'Other session note',
    }),
    201,
  );
  const concurrent = await read(page, source.caseId);
  const committed = await sectionRecordUiSnapshot(source.caseId);
  await byTest(panel, 'section-record-note').fill(
    'Stale form must not overwrite',
  );
  await byTest(panel, 'section-record-reason').fill('Stale browser correction');
  const fresh = page.waitForResponse(
    (value) =>
      value.request().method() === 'GET' &&
      new URL(value.url()).pathname === `/api/v1/cases/${source.caseId}`,
  );
  await clickSave(page, panel, path, 409);
  expect((await fresh).status()).toBe(200);
  await expect(byTest(panel, 'section-record-error')).toBeVisible();
  // VERSION_CONFLICT triggers the existing automatic fresh GET; it must preserve
  // the concurrent value and allow the subsequently refreshed independent revision.
  expect(await sectionRecordUiSnapshot(source.caseId)).toEqual(committed);
  await expect(byTest(panel, 'section-record-note')).toHaveValue(
    'Other session note',
  );
  const bodies = watchCommands(page, path);
  await byTest(panel, 'section-record-note').fill(
    'Fresh form legitimate update',
  );
  await byTest(panel, 'section-record-reason').fill(
    'Refreshed independent revision',
  );
  await clickSave(page, panel, path);
  expect(bodies[0]).toMatchObject({
    expectedClosureRevision: 1,
    expectedClosureVersionId: before.closure?.current.id,
  });
  expect(row(await read(page, source.caseId), variant).closureRevision).toBe(2);
  expect((await read(page, source.caseId)).version).toBe(concurrent.version);
  panel = await reloginAndOpen(page, actor, source.caseId, variant);
  await expect(byTest(panel, 'section-record-note')).toHaveValue(
    'Fresh form legitimate update',
  );
});

test('revoking only this run actor during an open editor rejects the real save and preserves facts', async ({
  page,
  actor,
  csrf,
}) => {
  const variant = variants[0];
  const source = await executionSource(page, csrf);
  const before = await sectionRecordUiSnapshot(source.caseId);
  const panel = await openDetail(page, source.caseId, variant);
  await byTest(panel, 'section-record-date').fill(date(-2));
  await byTest(panel, 'section-record-reason').fill(
    'Must be denied after own actor revocation',
  );
  await revokeSectionRecordUiActor(actor.userId);
  await clickSave(page, panel, businessPath(source.caseId, variant), 403);
  await expect(byTest(panel, 'section-record-success')).toHaveCount(0);
  await expect(byTest(panel, 'section-record-form')).toHaveCount(0);
  expect(await sectionRecordUiSnapshot(source.caseId)).toEqual(before);
  expect(
    (await page.request.get(`/api/v1/cases/${source.caseId}`)).status(),
  ).toBe(403);
});

test('no registered information disables section editing with its reason and never redirects to the current workflow', async ({
  page,
}) => {
  const source = await ordinarySource();
  const before = await read(page, source.id);
  for (const variant of variants)
    expect(before.recordEdits[variant.key]).toEqual([]);
  const commands: string[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname.startsWith(`/api/v1/cases/${source.id}/`)
    )
      commands.push(new URL(request.url()).pathname);
  });
  await page.goto(`/cases/${source.id}`);
  for (const section of [
    'first-instance',
    'second-instance',
    'judgment',
    'execution',
    'closure-info',
    'timeline',
  ]) {
    const edit = page.locator(
      `[data-section="${section}"] .case-workspace-section__edit`,
    );
    await expect(edit).toBeDisabled();
    await expect(edit).toHaveAttribute('aria-describedby', /.+/u);
  }
  await expect(visiblePanel(page)).toHaveCount(0);
  expect(commands).toEqual([]);
  expect(await read(page, source.id)).toEqual(before);
});

for (const cancel of [true, false]) {
  test(`real PUT succeeds but ${cancel ? 'user cancels before confirmation' : 'its response is lost'}: no confirmed version or automatic business request`, async ({
    page,
    csrf,
  }) => {
    const variant = variants[0];
    const source = await executionSource(page, csrf);
    const before = await read(page, source.caseId);
    const snapshot = await sectionRecordUiSnapshot(source.caseId);
    const commands = watchCommands(page, businessPath(source.caseId, variant));
    const panel = await openDetail(page, source.caseId, variant);
    let entered!: () => void;
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let completed!: () => void;
    const handled = new Promise<void>((resolve) => {
      completed = resolve;
    });
    let uploaded: FileVersion | undefined;
    const bytes = bytesFor(`unconfirmed ${cancel} ${source.caseId}`);
    const route = /\/api\/v1\/materials\/upload-drafts\/[^/]+\/content$/u;
    await page.route(route, async (intercepted) => {
      const upstream = await intercepted.fetch();
      expect(upstream.status()).toBe(200);
      uploaded = (await upstream.json()) as FileVersion;
      entered();
      await released;
      try {
        await intercepted.abort('failed');
      } finally {
        completed();
      }
    });
    try {
      await byTest(panel, 'section-record-upload').setInputFiles({
        name: 'unconfirmed.pdf',
        mimeType: 'application/pdf',
        buffer: bytes,
      });
      await reached;
      await expect(
        byTest(panel, 'section-record-upload-progress'),
      ).toBeVisible();
      await expect(byTest(panel, 'section-record-save')).toBeDisabled();
      await expect(byTest(panel, 'section-record-cancel')).toBeDisabled();
      if (cancel) await byTest(panel, 'section-record-upload-cancel').click();
      release();
      await handled;
      await expect(byTest(panel, 'section-record-upload-progress')).toHaveCount(
        0,
      );
      if (!uploaded)
        throw new Error(
          'Expected actual successful upstream PUT before response loss',
        );
      await expect(
        byTest(panel, `section-record-file-${uploaded.contentVersionId}`),
      ).toHaveCount(0);
      await expect(byTest(panel, 'section-record-retry')).toHaveCount(0);
      await expect(byTest(panel, 'section-record-pending')).toHaveCount(0);
      expect(commands).toHaveLength(0);
      expect(await read(page, source.caseId)).toEqual(before);
      expect(await sectionRecordUiSnapshot(source.caseId)).toEqual(snapshot);
      const uploads = await sectionRecordUiUploads(source.caseId);
      expect(
        uploads.find((item) => item.versionId === uploaded!.contentVersionId)
          ?.firstFreeze,
      ).toBe(false);
      // Cancellation does not delete the unconfirmed uploaded bytes. Their existing
      // lifecycle is preserved; they cannot silently enter the business command.
      const response = await page.request.get(
        `/api/v1/materials/${uploaded.materialId}/versions/${uploaded.contentVersionId}/content`,
      );
      expect(response.status()).toBe(200);
      expect(await response.body()).toEqual(bytes);
      await page.unroute(route);
      await byTest(panel, 'section-record-date').fill(date(-2));
      await byTest(panel, 'section-record-reason').fill(
        'Save fields without unconfirmed material',
      );
      await clickSave(page, panel, businessPath(source.caseId, variant));
      expect(commands).toHaveLength(1);
      expect(commands[0]).toMatchObject({
        mailReceiptContentVersionIds: row(before, variant).effective
          .mailReceiptContentVersionIds,
      });
      expect(
        row(await read(page, source.caseId), variant).effective
          .mailReceiptContentVersionIds,
      ).not.toContain(uploaded.contentVersionId);
    } finally {
      release();
      await page.unrouteAll({ behavior: 'wait' });
    }
  });
}

// Hearing record and legacy external CORRECT acceptance remain blocked: the existing H actor
// lacks case.external-entry.create; the requested extra Grant was denied. No skipped tests
// or substitute actor/Grant is used to turn that missing coverage into a pass.
