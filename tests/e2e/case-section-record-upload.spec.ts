import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
} from '@playwright/test';
import {
  assertSectionUploadRunner,
  createSectionUploadActor,
  ownSectionUploadCase,
  revokeSectionUploadActor,
  sectionUploadFixture,
  sectionUploadRollbackProbe,
  sectionUploadSnapshot,
  sectionUploadLifecycleProbe,
  sectionUploadQuotaProofProbe,
  type SectionUploadActor,
} from '../support/case-section-record-upload-database.mjs';

const origin = 'http://127.0.0.1:5174';
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
type File = {
  materialId: string;
  contentVersionId: string;
  recordCorrection?: {
    kind: string;
    targetId: string;
    expectedRevision: number;
  };
};
type Draft = {
  id: string;
  recordCorrection: {
    kind: string;
    targetId: string;
    expectedRevision: number;
  };
};
type ExecutionRecord = {
  mailingId?: string;
  filingId?: string;
  finishId?: string;
  mailingRevision?: number;
  filingRevision?: number;
  finishRevision?: number;
  effective: { files: File[] };
};
type Detail = {
  id: string;
  stage: string;
  version: number;
  closure?: null | { id: string; current: { id: string } };
  judgment?: null | {
    current: { id: string; trialRoundId: string; files: File[] };
  };
  recordEdits: {
    executionMailings: ExecutionRecord[];
    executionFilings: ExecutionRecord[];
    executionFinishes: ExecutionRecord[];
    closures?: Array<{
      closureId: string;
      closureRevision: number;
      effective: { files: File[] };
    }>;
    judgments?: Array<{
      judgmentId: string;
      judgmentRevision: number;
      effective: { files: File[] };
    }>;
  };
};
async function body<T>(response: APIResponse, status: number): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);
  return response.json() as Promise<T>;
}
async function login(request: APIRequestContext, actor: SectionUploadActor) {
  const session = await body<{ csrfToken: string }>(
    await request.post('/api/v1/auth/login', {
      headers: { Origin: origin },
      data: { username: actor.username, password: actor.password },
    }),
    200,
  );
  return { Origin: origin, 'X-CSRF-Token': session.csrfToken };
}
async function ordinaryUpload(
  request: APIRequestContext,
  headers: Record<string, string>,
  caseId: string,
  category: string,
  bytes: Buffer,
): Promise<File> {
  const draft = await body<{ id: string }>(
    await request.post('/api/v1/materials/upload-drafts', {
      headers,
      data: {
        ownerType: 'CASE',
        ownerId: caseId,
        category,
        purpose: category,
        originalFilename: `section-original-${randomUUID()}.pdf`,
        declaredMimeType: 'application/pdf',
      },
    }),
    201,
  );
  return body<File>(
    await request.put(`/api/v1/materials/upload-drafts/${draft.id}/content`, {
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      data: bytes,
    }),
    200,
  );
}
async function dedicatedUpload(
  request: APIRequestContext,
  headers: Record<string, string>,
  caseId: string,
  route: string,
  target: object,
  bytes: Buffer,
) {
  const draft = await body<Draft>(
    await request.post(`/api/v1/cases/${caseId}/${route}/upload-drafts`, {
      headers,
      data: {
        ...target,
        originalFilename: `section-replacement-${randomUUID()}.pdf`,
        declaredMimeType: 'application/pdf',
      },
    }),
    201,
  );
  expect(draft.recordCorrection.targetId).toBe(Object.values(target)[0]);
  const file = await body<File>(
    await request.put(`/api/v1/materials/upload-drafts/${draft.id}/content`, {
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      data: bytes,
    }),
    200,
  );
  expect(file.recordCorrection).toEqual(draft.recordCorrection);
  return { draft, file };
}
const post = (
  request: APIRequestContext,
  headers: Record<string, string>,
  caseId: string,
  route: string,
  data: object,
) => request.post(`/api/v1/cases/${caseId}/${route}`, { headers, data });
const read = async (
  request: APIRequestContext,
  headers: Record<string, string>,
  caseId: string,
) =>
  body<Detail>(await request.get(`/api/v1/cases/${caseId}`, { headers }), 200);
async function download(
  request: APIRequestContext,
  headers: Record<string, string>,
  file: File,
  bytes: Buffer,
) {
  const response = await request.get(
    `/api/v1/materials/${file.materialId}/versions/${file.contentVersionId}/content`,
    { headers },
  );
  expect(response.status(), await response.text()).toBe(200);
  expect(await response.body()).toEqual(bytes);
}

test('archived execution and closure records bind replacement bytes to exact correction targets', async ({
  request,
}) => {
  test.setTimeout(300_000);
  // This must be first: no API request, direct SQL, or fixture write precedes admission.
  await assertSectionUploadRunner();
  const actor = await createSectionUploadActor();
  const headers = await login(request, actor);
  const fixture = sectionUploadFixture();
  const created = await body<{ id: string; version: number }>(
    await request.post('/api/v1/cases/external-entries', {
      headers,
      data: {
        idempotencyKey: randomUUID(),
        entryKind: 'HISTORICAL_BACKFILL',
        initialStage: 'WAITING_EXECUTION_STAMP',
        stageReachedOn: date(-6),
        source: `${fixture.sourcePrefix}${randomUUID()}`,
        reason: 'Synthetic section upload source',
        customerId: actor.customerId,
        rightsHolderId: actor.rightsHolderId,
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
  const caseId = created.id;
  await ownSectionUploadCase(caseId, actor.userId);
  const original = {
    mailing: Buffer.from('%PDF-1.7\noriginal mailing ' + caseId + '\n%%EOF\n'),
    filing: Buffer.from('%PDF-1.7\noriginal filing ' + caseId + '\n%%EOF\n'),
    finish: Buffer.from('%PDF-1.7\noriginal finish ' + caseId + '\n%%EOF\n'),
  };
  const oldMail = await ordinaryUpload(
    request,
    headers,
    caseId,
    'MAIL_RECEIPT',
    original.mailing,
  );
  const mailed = await body<{ mailingId: string; version: number }>(
    await post(request, headers, caseId, 'execution-mail', {
      expectedVersion: created.version,
      idempotencyKey: randomUUID(),
      expectedConfirmationId: null,
      mailedAt: date(-5),
      mailReceiptContentVersionIds: [oldMail.contentVersionId],
    }),
    201,
  );
  const oldFiling = await ordinaryUpload(
    request,
    headers,
    caseId,
    'EXECUTION_FILING_PROOF',
    original.filing,
  );
  const filed = await body<{ filingId: string; version: number }>(
    await post(request, headers, caseId, 'execution-filing-submit', {
      expectedVersion: mailed.version,
      idempotencyKey: randomUUID(),
      expectedMailingId: mailed.mailingId,
      submittedAt: date(-4),
      executionFilingProofContentVersionIds: [oldFiling.contentVersionId],
    }),
    201,
  );
  const oldFinish = await ordinaryUpload(
    request,
    headers,
    caseId,
    'EXECUTION_FINISH_BASIS',
    original.finish,
  );
  const finished = await body<{ finishId: string; version: number }>(
    await post(request, headers, caseId, 'execution-finish', {
      expectedVersion: filed.version,
      idempotencyKey: randomUUID(),
      expectedFilingId: filed.filingId,
      finishedAt: date(-3),
      reason: 'Synthetic original finish',
      basisNote: null,
      basisContentVersionIds: [oldFinish.contentVersionId],
    }),
    201,
  );
  const closed = await body<{
    closureId: string;
    closureVersionId: string;
    version: number;
  }>(
    await post(request, headers, caseId, 'closure', {
      expectedVersion: finished.version,
      idempotencyKey: randomUUID(),
      expectedFinishId: finished.finishId,
      closeAt: date(-2),
      closeAmountState: 'PENDING',
      closeAmt: null,
      note: null,
      closeContentVersionIds: [],
    }),
    201,
  );
  await body(
    await post(request, headers, caseId, 'archive', {
      expectedVersion: closed.version,
      idempotencyKey: randomUUID(),
      expectedClosureVersionId: closed.closureVersionId,
      archiveAt: date(-1),
      archiveType: 'EXECUTION_CLOSED',
      archiveReason: 'Synthetic archived source',
    }),
    201,
  );
  const before = await read(request, headers, caseId);
  expect(before.stage).toBe('ARCHIVED');

  // Replacement bytes are first uploaded here, after the later business stage is real.
  const variants = [
    {
      route: 'execution-mailing-correction',
      target: { mailingId: mailed.mailingId, expectedMailingRevision: 0 },
      category: 'MAIL_RECEIPT',
      bytes: Buffer.from(
        '%PDF-1.7\nreplacement mailing ' + caseId + '\n%%EOF\n',
      ),
      command: (id: string) => ({
        mailingId: id,
        expectedMailingRevision: 0,
        mailedAt: date(-5),
        reason: 'Replacement mailing file',
        mailReceiptContentVersionIds: [] as string[],
      }),
      readKey: 'executionMailings' as const,
      idKey: 'mailingId' as const,
      revisionKey: 'mailingRevision' as const,
      old: oldMail,
      oldBytes: original.mailing,
    },
    {
      route: 'execution-filing-correction',
      target: { filingId: filed.filingId, expectedFilingRevision: 0 },
      category: 'EXECUTION_FILING_PROOF',
      bytes: Buffer.from(
        '%PDF-1.7\nreplacement filing ' + caseId + '\n%%EOF\n',
      ),
      command: (id: string) => ({
        filingId: id,
        expectedFilingRevision: 0,
        submittedAt: date(-4),
        reason: 'Replacement filing file',
        executionFilingProofContentVersionIds: [] as string[],
      }),
      readKey: 'executionFilings' as const,
      idKey: 'filingId' as const,
      revisionKey: 'filingRevision' as const,
      old: oldFiling,
      oldBytes: original.filing,
    },
    {
      route: 'execution-finish-correction',
      target: { finishId: finished.finishId, expectedFinishRevision: 0 },
      category: 'EXECUTION_FINISH_BASIS',
      bytes: Buffer.from(
        '%PDF-1.7\nreplacement finish ' + caseId + '\n%%EOF\n',
      ),
      command: (id: string) => ({
        finishId: id,
        expectedFinishRevision: 0,
        finishedAt: date(-3),
        reason: 'Updated finish reason',
        basisNote: null,
        correctionReason: 'Replacement finish file',
        basisContentVersionIds: [] as string[],
      }),
      readKey: 'executionFinishes' as const,
      idKey: 'finishId' as const,
      revisionKey: 'finishRevision' as const,
      old: oldFinish,
      oldBytes: original.finish,
    },
  ];
  for (const variant of variants) {
    const { draft, file } = await dedicatedUpload(
      request,
      headers,
      caseId,
      variant.route,
      variant.target,
      variant.bytes,
    );
    expect(
      (await sectionUploadSnapshot(caseId)).find(
        (row) => row.version_id === file.contentVersionId,
      ),
    ).toMatchObject({
      draft_id: draft.id,
      first_freeze: false,
    });
    if (variant.route === 'execution-mailing-correction') {
      expect(
        await sectionUploadRollbackProbe(
          caseId,
          file.contentVersionId,
          'workflow',
        ),
      ).toBe(true);
      expect(
        await sectionUploadRollbackProbe(
          caseId,
          file.contentVersionId,
          'fake-reference',
        ),
      ).toBe(true);
      expect(
        await sectionUploadRollbackProbe(
          caseId,
          file.contentVersionId,
          'material-scope',
        ),
      ).toBe(true);
      expect(
        await sectionUploadRollbackProbe(
          caseId,
          file.contentVersionId,
          'material-purpose',
        ),
      ).toBe(true);
    }
    const input = {
      ...variant.command(Object.values(variant.target)[0] as string),
      idempotencyKey: randomUUID(),
    };
    const fileKey = variant.route.includes('mailing')
      ? 'mailReceiptContentVersionIds'
      : variant.route.includes('filing')
        ? 'executionFilingProofContentVersionIds'
        : 'basisContentVersionIds';
    const correction = { ...input, [fileKey]: [file.contentVersionId] };
    const saved = await body<{ correctionId: string }>(
      await post(request, headers, caseId, variant.route, correction),
      201,
    );
    expect(saved.correctionId).toBeTruthy();
    const replay = await body<{ correctionId: string }>(
      await post(request, headers, caseId, variant.route, correction),
      201,
    );
    expect(replay).toEqual(saved);
    const stale = await post(request, headers, caseId, variant.route, {
      ...correction,
      idempotencyKey: randomUUID(),
    });
    expect(await body<{ code: string }>(stale, 409)).toMatchObject({
      code: 'VERSION_CONFLICT',
    });
    const refreshed = await read(request, headers, caseId);
    expect(refreshed.stage).toBe(before.stage);
    expect(refreshed.version).toBe(before.version);
    const record = refreshed.recordEdits[variant.readKey].find(
      (row) => row[variant.idKey] === Object.values(variant.target)[0],
    );
    expect(record?.[variant.revisionKey]).toBe(1);
    const reuseKey = variant.route.includes('mailing')
      ? 'expectedMailingRevision'
      : variant.route.includes('filing')
        ? 'expectedFilingRevision'
        : 'expectedFinishRevision';
    const correctionReasonKey = variant.route.includes('finish')
      ? 'correctionReason'
      : 'reason';
    const reuse = {
      ...correction,
      [reuseKey]: 1,
      [correctionReasonKey]: 'Reuse the exact committed frozen file',
      idempotencyKey: randomUUID(),
      ...(variant.route.includes('finish')
        ? { basisNote: 'Further correction using the retained evidence' }
        : variant.route.includes('filing')
          ? { submittedAt: date(-3) }
          : { mailedAt: date(-4) }),
    };
    const reused = await body<Record<string, unknown>>(
      await post(request, headers, caseId, variant.route, reuse),
      201,
    );
    expect(reused[variant.revisionKey]).toBe(2);
    expect(
      await body(
        await post(request, headers, caseId, variant.route, correction),
        201,
      ),
    ).toEqual(saved);
    expect(
      record?.effective.files.map((entry) => entry.contentVersionId),
    ).toContain(file.contentVersionId);
    expect(
      (await sectionUploadSnapshot(caseId)).find(
        (row) => row.version_id === file.contentVersionId,
      )?.first_freeze,
    ).toBe(true);
    await download(request, headers, file, variant.bytes);
    await download(request, headers, variant.old, variant.oldBytes);
    expect(
      await sectionUploadRollbackProbe(caseId, file.contentVersionId, 'rebind'),
    ).toBe(true);
    expect(
      await sectionUploadRollbackProbe(caseId, file.contentVersionId, 'unlink'),
    ).toBe(true);
    expect(
      await sectionUploadRollbackProbe(
        caseId,
        file.contentVersionId,
        'material-scope',
      ),
    ).toBe(true);
    if (variant.route === 'execution-mailing-correction') {
      expect(
        await sectionUploadRollbackProbe(
          caseId,
          file.contentVersionId,
          'material-purpose',
        ),
      ).toBe(true);
      expect(
        await sectionUploadRollbackProbe(
          caseId,
          file.contentVersionId,
          'fake-reference',
        ),
      ).toBe(true);
      expect(
        await sectionUploadRollbackProbe(
          caseId,
          file.contentVersionId,
          'workflow',
        ),
      ).toBe(true);
    }
  }
  const closureBytes = Buffer.from(
    '%PDF-1.7\nreplacement closure ' + caseId + '\n%%EOF\n',
  );
  const closureTarget = {
    closureId: closed.closureId,
    expectedClosureRevision: 0,
    expectedClosureVersionId: closed.closureVersionId,
  };
  const { file: closureFile } = await dedicatedUpload(
    request,
    headers,
    caseId,
    'closure-record-correction',
    closureTarget,
    closureBytes,
  );
  expect(
    (await sectionUploadSnapshot(caseId)).find(
      (row) => row.version_id === closureFile.contentVersionId,
    )?.first_freeze,
  ).toBe(false);
  const wrongClosureAnchor = await request.post(
    `/api/v1/cases/${caseId}/closure-record-correction/upload-drafts`,
    {
      headers,
      data: {
        ...closureTarget,
        expectedClosureVersionId: randomUUID(),
        originalFilename: 'wrong.pdf',
        declaredMimeType: 'application/pdf',
      },
    },
  );
  expect(wrongClosureAnchor.status()).toBe(409);
  const closureInput = {
    ...closureTarget,
    idempotencyKey: randomUUID(),
    closeAt: date(-2),
    closeAmountState: 'PENDING',
    closeAmt: null,
    note: 'Synthetic closure evidence update',
    correctionReason: 'Replacement closure document',
    closeContentVersionIds: [closureFile.contentVersionId],
  };
  const closureSaved = await body<{ closureRevision: number }>(
    await post(
      request,
      headers,
      caseId,
      'closure-record-correction',
      closureInput,
    ),
    201,
  );
  expect(closureSaved.closureRevision).toBe(1);
  const reusedClosure = await body<{ closureRevision: number }>(
    await post(request, headers, caseId, 'closure-record-correction', {
      ...closureInput,
      expectedClosureRevision: 1,
      note: 'Reuse committed closure evidence',
      correctionReason: 'Reuse the retained version',
      idempotencyKey: randomUUID(),
    }),
    201,
  );
  expect(reusedClosure.closureRevision).toBe(2);
  expect(
    await body(
      await post(
        request,
        headers,
        caseId,
        'closure-record-correction',
        closureInput,
      ),
      201,
    ),
  ).toEqual(closureSaved);
  expect(
    await body<{ code: string }>(
      await post(request, headers, caseId, 'closure-record-correction', {
        ...closureInput,
        idempotencyKey: randomUUID(),
      }),
      409,
    ),
  ).toMatchObject({ code: 'VERSION_CONFLICT' });
  expect(
    (await sectionUploadSnapshot(caseId)).find(
      (row) => row.version_id === closureFile.contentVersionId,
    )?.first_freeze,
  ).toBe(true);
  const afterClosure = await read(request, headers, caseId);
  expect(afterClosure.stage).toBe('ARCHIVED');
  expect(afterClosure.version).toBe(before.version);
  expect(
    afterClosure.recordEdits.closures
      ?.find((row) => row.closureId === closed.closureId)
      ?.effective.files.map((file) => file.contentVersionId),
  ).toContain(closureFile.contentVersionId);
  await download(request, headers, closureFile, closureBytes);
  // Original workflow and first dedicated filing are both exact frozen history.
  // Nine new, unconsumed replacements occupy nine of ten dedicated slots.
  const nextFilingTarget = {
    filingId: filed.filingId,
    expectedFilingRevision: 2,
  };
  for (let index = 0; index < 9; index++) {
    const pending = await dedicatedUpload(
      request,
      headers,
      caseId,
      'execution-filing-correction',
      nextFilingTarget,
      Buffer.from(`%PDF-1.7\npending filing ${index} ${caseId}\n%%EOF\n`),
    );
    expect(
      (await sectionUploadSnapshot(caseId)).find(
        (row) => row.version_id === pending.file.contentVersionId,
      )?.first_freeze,
    ).toBe(false);
  }
  const quotaDraft = async () =>
    body<Draft>(
      await request.post(
        `/api/v1/cases/${caseId}/execution-filing-correction/upload-drafts`,
        {
          headers,
          data: {
            ...nextFilingTarget,
            originalFilename: `quota-${randomUUID()}.pdf`,
            declaredMimeType: 'application/pdf',
          },
        },
      ),
      201,
    );
  const quotaDrafts = await Promise.all([quotaDraft(), quotaDraft()]);
  const quotaBytes = Buffer.from(
    '%PDF-1.7\nquota race ' + caseId + '\n%%EOF\n',
  );
  const quotaResults = await Promise.all(
    quotaDrafts.map((draft) =>
      request.put(`/api/v1/materials/upload-drafts/${draft.id}/content`, {
        headers: { ...headers, 'Content-Type': 'application/octet-stream' },
        data: quotaBytes,
      }),
    ),
  );
  expect(quotaResults.map((response) => response.status()).sort()).toEqual([
    200, 400,
  ]);
  const overQuota = await quotaDraft();
  expect(
    (
      await request.put(
        `/api/v1/materials/upload-drafts/${overQuota.id}/content`,
        {
          headers: { ...headers, 'Content-Type': 'application/octet-stream' },
          data: quotaBytes,
        },
      )
    ).status(),
  ).toBe(400);
  // The ordinary endpoint still enforces its original stage on this archived case.
  await body<{ code: string }>(
    await request.post('/api/v1/materials/upload-drafts', {
      headers,
      data: {
        ownerType: 'CASE',
        ownerId: caseId,
        category: 'EXECUTION_FILING_PROOF',
        purpose: 'EXECUTION_FILING_PROOF',
        originalFilename: 'ordinary-quota.pdf',
        declaredMimeType: 'application/pdf',
      },
    }),
    409,
  );
  const nextMailTarget = {
    mailingId: mailed.mailingId,
    expectedMailingRevision: 2,
  };
  const raceDraft = await body<Draft>(
    await request.post(
      `/api/v1/cases/${caseId}/execution-mailing-correction/upload-drafts`,
      {
        headers,
        data: {
          ...nextMailTarget,
          originalFilename: 'race.pdf',
          declaredMimeType: 'application/pdf',
        },
      },
    ),
    201,
  );
  const raceBytes = Buffer.from(
    '%PDF-1.7\nconcurrent replacement ' + caseId + '\n%%EOF\n',
  );
  const racePut = () =>
    request.put(`/api/v1/materials/upload-drafts/${raceDraft.id}/content`, {
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      data: raceBytes,
    });
  const raced = await Promise.all([racePut(), racePut()]);
  expect(raced.map((response) => response.status()).sort()).toEqual([200, 409]);
  const deniedDraft = await body<Draft>(
    await request.post(
      `/api/v1/cases/${caseId}/execution-mailing-correction/upload-drafts`,
      {
        headers,
        data: {
          ...nextMailTarget,
          originalFilename: 'revoked.pdf',
          declaredMimeType: 'application/pdf',
        },
      },
    ),
    201,
  );
  await revokeSectionUploadActor(actor.userId);
  const revokedPut = await request.put(
    `/api/v1/materials/upload-drafts/${deniedDraft.id}/content`,
    {
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      data: raceBytes,
    },
  );
  expect(revokedPut.status()).toBe(403);
  const revokedCreate = await request.post(
    `/api/v1/cases/${caseId}/execution-mailing-correction/upload-drafts`,
    {
      headers,
      data: {
        ...nextMailTarget,
        originalFilename: 'denied-create.pdf',
        declaredMimeType: 'application/pdf',
      },
    },
  );
  expect(revokedCreate.status()).toBe(403);
});

test('judgment replacement is uploaded only after a real later execution stage', async ({
  request,
}) => {
  test.setTimeout(120_000);
  await assertSectionUploadRunner();
  const actor = await createSectionUploadActor();
  const headers = await login(request, actor);
  const created = await body<{ id: string; version: number }>(
    await request.post('/api/v1/cases/external-entries', {
      headers,
      data: {
        idempotencyKey: randomUUID(),
        entryKind: 'HISTORICAL_BACKFILL',
        initialStage: 'WAITING_JUDGMENT',
        stageReachedOn: date(-4),
        source: `${sectionUploadFixture().sourcePrefix}${randomUUID()}`,
        reason: 'Synthetic historical judgment source',
        customerId: actor.customerId,
        rightsHolderId: actor.rightsHolderId,
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
  const caseId = created.id;
  await ownSectionUploadCase(caseId, actor.userId);
  const oldBytes = Buffer.from(
    '%PDF-1.7\noriginal judgment ' + caseId + '\n%%EOF\n',
  );
  const oldFile = await ordinaryUpload(
    request,
    headers,
    caseId,
    'JUDGMENT',
    oldBytes,
  );
  const registered = await body<{ judgmentId: string; version: number }>(
    await post(request, headers, caseId, 'judgment-register', {
      expectedVersion: created.version,
      idempotencyKey: randomUUID(),
      judgmentReceivedAt: date(-3),
      judgmentAmountState: 'KNOWN',
      judgmentAmount: '10.00',
      paidLitigationFeeState: 'KNOWN',
      paidLitigationFee: '0.00',
      judgmentContentVersionIds: [oldFile.contentVersionId],
    }),
    201,
  );
  const advanced = await body<{ stage: string; version: number }>(
    await post(request, headers, caseId, 'judgment-next-step', {
      expectedVersion: registered.version,
      idempotencyKey: randomUUID(),
      judgmentId: registered.judgmentId,
      next: 'EXECUTION',
      executionReadinessConfirmed: true,
    }),
    201,
  );
  expect(advanced.stage).toBe('WAITING_EXECUTION_DOCUMENTS');
  const before = await read(request, headers, caseId);
  const round = before.judgment?.current.trialRoundId;
  expect(round).toBeTruthy();
  const replacement = Buffer.from(
    '%PDF-1.7\nreplacement judgment ' + caseId + '\n%%EOF\n',
  );
  const target = {
    judgmentId: registered.judgmentId,
    trialRoundId: round!,
    expectedJudgmentRevision: 0,
  };
  const { file } = await dedicatedUpload(
    request,
    headers,
    caseId,
    'judgment-record-correction',
    target,
    replacement,
  );
  const wrongTarget = await request.post(
    `/api/v1/cases/${caseId}/judgment-record-correction/upload-drafts`,
    {
      headers,
      data: {
        ...target,
        judgmentId: randomUUID(),
        originalFilename: 'wrong.pdf',
        declaredMimeType: 'application/pdf',
      },
    },
  );
  expect(wrongTarget.status()).toBe(404);
  const correction = {
    ...target,
    idempotencyKey: randomUUID(),
    reason: 'Updated judgment evidence',
    judgmentReceivedAt: date(-3),
    judgmentAmountState: 'KNOWN',
    judgmentAmount: '10.00',
    paidLitigationFeeState: 'KNOWN',
    paidLitigationFee: '0.00',
    judgmentContentVersionIds: [file.contentVersionId],
  };
  const saved = await body<{ judgmentRevision: number }>(
    await post(
      request,
      headers,
      caseId,
      'judgment-record-correction',
      correction,
    ),
    201,
  );
  expect(saved.judgmentRevision).toBe(1);
  const reusedJudgment = await body<{ judgmentRevision: number }>(
    await post(request, headers, caseId, 'judgment-record-correction', {
      ...correction,
      expectedJudgmentRevision: 1,
      judgmentAmount: '11.00',
      idempotencyKey: randomUUID(),
    }),
    201,
  );
  expect(reusedJudgment.judgmentRevision).toBe(2);
  expect(
    await body(
      await post(
        request,
        headers,
        caseId,
        'judgment-record-correction',
        correction,
      ),
      201,
    ),
  ).toEqual(saved);
  expect(
    await body<{ code: string }>(
      await post(request, headers, caseId, 'judgment-record-correction', {
        ...correction,
        idempotencyKey: randomUUID(),
      }),
      409,
    ),
  ).toMatchObject({ code: 'VERSION_CONFLICT' });
  const after = await read(request, headers, caseId);
  expect(after.stage).toBe(before.stage);
  expect(after.version).toBe(before.version);
  expect(
    after.recordEdits.judgments
      ?.find((row) => row.judgmentId === registered.judgmentId)
      ?.effective.files.map((entry) => entry.contentVersionId),
  ).toContain(file.contentVersionId);
  expect(
    (await sectionUploadSnapshot(caseId)).find(
      (row) => row.version_id === file.contentVersionId,
    )?.first_freeze,
  ).toBe(true);
  await download(request, headers, oldFile, oldBytes);
  await download(request, headers, file, replacement);
  const nextTarget = { ...target, expectedJudgmentRevision: 2 };
  const unconsumed = await dedicatedUpload(
    request,
    headers,
    caseId,
    'judgment-record-correction',
    nextTarget,
    Buffer.from('%PDF-1.7\nrevoked consumption ' + caseId + '\n%%EOF\n'),
  );
  await revokeSectionUploadActor(actor.userId);
  const revokedCorrection = await post(
    request,
    headers,
    caseId,
    'judgment-record-correction',
    {
      ...correction,
      ...nextTarget,
      idempotencyKey: randomUUID(),
      judgmentContentVersionIds: [unconsumed.file.contentVersionId],
    },
  );
  expect(revokedCorrection.status()).toBe(403);
  expect(
    (await sectionUploadSnapshot(caseId)).find(
      (row) => row.version_id === unconsumed.file.contentVersionId,
    )?.first_freeze,
  ).toBe(false);
});

test('ten frozen filing originals stay retained while dedicated capacity and original generic quota remain distinct', async ({
  request,
}) => {
  test.setTimeout(180_000);
  await assertSectionUploadRunner();
  const actor = await createSectionUploadActor();
  const headers = await login(request, actor);
  const created = await body<{ id: string; version: number }>(
    await request.post('/api/v1/cases/external-entries', {
      headers,
      data: {
        idempotencyKey: randomUUID(),
        entryKind: 'HISTORICAL_BACKFILL',
        initialStage: 'WAITING_EXECUTION_FILING',
        stageReachedOn: date(-3),
        source: `${sectionUploadFixture().sourcePrefix}${randomUUID()}`,
        reason: 'Ten retained synthetic filing originals',
        customerId: actor.customerId,
        rightsHolderId: actor.rightsHolderId,
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
  await ownSectionUploadCase(created.id, actor.userId);
  const originals: Array<{ file: File; bytes: Buffer }> = [];
  const alternate = await body<{ id: string }>(
    await request.post('/api/v1/cases/external-entries', {
      headers,
      data: {
        idempotencyKey: randomUUID(),
        entryKind: 'HISTORICAL_BACKFILL',
        initialStage: 'WAITING_EXECUTION_FILING',
        stageReachedOn: date(-3),
        source: `${sectionUploadFixture().sourcePrefix}${randomUUID()}`,
        reason: 'Existing owned alternative case for binding rejection',
        customerId: actor.customerId,
        rightsHolderId: actor.rightsHolderId,
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
  await ownSectionUploadCase(alternate.id, actor.userId);
  for (let index = 0; index < 10; index++) {
    const bytes = Buffer.from(`%PDF-1.7\nretained filing ${index}\n%%EOF\n`);
    originals.push({
      file: await ordinaryUpload(
        request,
        headers,
        created.id,
        'EXECUTION_FILING_PROOF',
        bytes,
      ),
      bytes,
    });
  }
  const ordinaryDraft = await body<{ id: string }>(
    await request.post('/api/v1/materials/upload-drafts', {
      headers,
      data: {
        ownerType: 'CASE',
        ownerId: created.id,
        category: 'EXECUTION_FILING_PROOF',
        purpose: 'EXECUTION_FILING_PROOF',
        originalFilename: 'eleventh.pdf',
        declaredMimeType: 'application/pdf',
      },
    }),
    201,
  );
  expect(
    (
      await request.put(
        `/api/v1/materials/upload-drafts/${ordinaryDraft.id}/content`,
        {
          headers: { ...headers, 'Content-Type': 'application/octet-stream' },
          data: Buffer.from('%PDF-1.7\nover quota\n%%EOF\n'),
        },
      )
    ).status(),
  ).toBe(400);
  const filed = await body<{ filingId: string; version: number }>(
    await post(request, headers, created.id, 'execution-filing-submit', {
      expectedVersion: created.version,
      idempotencyKey: randomUUID(),
      expectedMailingId: null,
      submittedAt: date(-2),
      executionFilingProofContentVersionIds: originals.map(
        (entry) => entry.file.contentVersionId,
      ),
    }),
    201,
  );
  const bytes = Buffer.from(
    '%PDF-1.7\nnew correction after ten retained originals\n%%EOF\n',
  );
  const uploaded = await dedicatedUpload(
    request,
    headers,
    created.id,
    'execution-filing-correction',
    { filingId: filed.filingId, expectedFilingRevision: 0 },
    bytes,
  );
  expect(
    await sectionUploadLifecycleProbe(
      created.id,
      uploaded.file.contentVersionId,
    ),
  ).toBe(true);
  await body(
    await post(request, headers, created.id, 'execution-filing-correction', {
      filingId: filed.filingId,
      expectedFilingRevision: 0,
      idempotencyKey: randomUUID(),
      submittedAt: date(-2),
      reason: 'Retain the ten originals and select new evidence',
      executionFilingProofContentVersionIds: [uploaded.file.contentVersionId],
    }),
    201,
  );
  expect(
    await sectionUploadQuotaProofProbe(
      created.id,
      uploaded.file.contentVersionId,
    ),
  ).toEqual({ excludesOldFrozen: false });
  for (const original of originals)
    await download(request, headers, original.file, original.bytes);
  await download(request, headers, uploaded.file, bytes);
  expect((await read(request, headers, created.id)).version).toBe(
    filed.version,
  );
});
