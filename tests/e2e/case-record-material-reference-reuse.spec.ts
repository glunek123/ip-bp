import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
} from '@playwright/test';
import {
  assertReferenceReuseRunner,
  referenceReuseActor,
  ownReferenceReuseCase,
  referenceReuseSnapshot,
  referenceReuseSqlRejections,
  verifyReferenceReusePredeploy,
  type ReferenceReuseActor,
} from '../support/case-record-material-reference-reuse.mjs';

// Full HTTP source and correction transactions. The only direct SQL writes below
// are rejected INSERT probes inside explicit ROLLBACK transactions.
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
type File = { materialId: string; contentVersionId: string };
type Row = {
  mailingId?: string;
  mailingRevision?: number;
  filingId?: string;
  filingRevision?: number;
  finishId?: string;
  finishRevision?: number;
  judgmentId?: string;
  judgmentRevision?: number;
  trialRoundId?: string;
  closureId?: string;
  closureRevision?: number;
  effective: Record<string, unknown>;
};
type Detail = {
  version: number;
  closure: { current: { id: string } } | null;
  recordEdits: {
    executionMailings: Row[];
    executionFilings: Row[];
    executionFinishes: Row[];
    judgments: Row[];
    closures: Row[];
  };
};
const variants = [
  {
    kind: 'mailing',
    route: 'execution-mailing-correction',
    rows: 'executionMailings',
    purpose: 'MAIL_RECEIPT',
    fileKey: 'mailReceiptContentVersionIds',
    dateKey: 'mailedAt',
  },
  {
    kind: 'filing',
    route: 'execution-filing-correction',
    rows: 'executionFilings',
    purpose: 'EXECUTION_FILING_PROOF',
    fileKey: 'executionFilingProofContentVersionIds',
    dateKey: 'submittedAt',
  },
  {
    kind: 'finish',
    route: 'execution-finish-correction',
    rows: 'executionFinishes',
    purpose: 'EXECUTION_FINISH_BASIS',
    fileKey: 'basisContentVersionIds',
    dateKey: 'finishedAt',
  },
  {
    kind: 'judgment',
    route: 'judgment-record-correction',
    rows: 'judgments',
    purpose: 'JUDGMENT',
    fileKey: 'judgmentContentVersionIds',
    dateKey: 'judgmentReceivedAt',
  },
  {
    kind: 'closure',
    route: 'closure-record-correction',
    rows: 'closures',
    purpose: 'CASE_CLOSURE_DOCUMENT',
    fileKey: 'closeContentVersionIds',
    dateKey: 'closeAt',
  },
] as const;
type Variant = (typeof variants)[number];
const row = (detail: Detail, variant: Variant) => {
  const rows = detail.recordEdits[variant.rows];
  expect(rows).toHaveLength(1);
  return rows[0]!;
};
async function body<T>(response: APIResponse, expected = 201): Promise<T> {
  expect(response.status(), await response.text()).toBe(expected);
  return response.json() as Promise<T>;
}
async function login(request: APIRequestContext, actor: ReferenceReuseActor) {
  const session = await body<{ csrfToken: string }>(
    await request.post('/api/v1/auth/login', {
      headers: { Origin: origin },
      data: { username: actor.username, password: actor.password },
    }),
    200,
  );
  return { Origin: origin, 'X-CSRF-Token': session.csrfToken };
}
const post = (
  request: APIRequestContext,
  headers: Record<string, string>,
  caseId: string,
  route: string,
  data: object,
) => request.post(`/api/v1/cases/${caseId}/${route}`, { headers, data });
const read = async (request: APIRequestContext, caseId: string) =>
  body<Detail>(await request.get(`/api/v1/cases/${caseId}`), 200);
async function source(
  request: APIRequestContext,
  headers: Record<string, string>,
  actor: ReferenceReuseActor,
  stage: string,
) {
  const externalSource = `case-record-reference-reuse:${randomUUID()}:${stage}`;
  const entry = await body<{ id: string; version: number }>(
    await request.post('/api/v1/cases/external-entries', {
      headers,
      data: {
        idempotencyKey: randomUUID(),
        entryKind: 'HISTORICAL_BACKFILL',
        initialStage: stage,
        stageReachedOn: date(-12),
        source: externalSource,
        reason: 'Synthetic record reference reuse source',
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
  );
  await ownReferenceReuseCase(entry.id, externalSource);
  return entry;
}
async function upload(
  request: APIRequestContext,
  headers: Record<string, string>,
  caseId: string,
  category: string,
) {
  const draft = await body<{ id: string }>(
    await request.post('/api/v1/materials/upload-drafts', {
      headers,
      data: {
        ownerType: 'CASE',
        ownerId: caseId,
        category,
        purpose: category,
        originalFilename: `reuse-${category}-${randomUUID()}.pdf`,
        declaredMimeType: 'application/pdf',
      },
    }),
  );
  return body<File>(
    await request.put(`/api/v1/materials/upload-drafts/${draft.id}/content`, {
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      data: Buffer.from(`%PDF-1.7\nsynthetic reuse ${category}\n%%EOF\n`),
    }),
    200,
  );
}
async function executionSource(
  request: APIRequestContext,
  headers: Record<string, string>,
  actor: ReferenceReuseActor,
) {
  const entry = await source(
    request,
    headers,
    actor,
    'WAITING_EXECUTION_STAMP',
  );
  const mail = await upload(request, headers, entry.id, 'MAIL_RECEIPT');
  const mailed = await body<{ mailingId: string; version: number }>(
    await post(request, headers, entry.id, 'execution-mail', {
      expectedVersion: entry.version,
      idempotencyKey: randomUUID(),
      expectedConfirmationId: null,
      mailedAt: date(-8),
      mailReceiptContentVersionIds: [mail.contentVersionId],
    }),
  );
  const filing = await upload(
    request,
    headers,
    entry.id,
    'EXECUTION_FILING_PROOF',
  );
  const filed = await body<{ filingId: string; version: number }>(
    await post(request, headers, entry.id, 'execution-filing-submit', {
      expectedVersion: mailed.version,
      idempotencyKey: randomUUID(),
      expectedMailingId: mailed.mailingId,
      submittedAt: date(-7),
      executionFilingProofContentVersionIds: [filing.contentVersionId],
    }),
  );
  const finish = await upload(
    request,
    headers,
    entry.id,
    'EXECUTION_FINISH_BASIS',
  );
  const finished = await body<{ finishId: string; version: number }>(
    await post(request, headers, entry.id, 'execution-finish', {
      expectedVersion: filed.version,
      idempotencyKey: randomUUID(),
      expectedFilingId: filed.filingId,
      finishedAt: date(-6),
      reason: 'Original finish reason',
      basisNote: 'Original basis',
      basisContentVersionIds: [finish.contentVersionId],
    }),
  );
  const close = await upload(
    request,
    headers,
    entry.id,
    'CASE_CLOSURE_DOCUMENT',
  );
  const closed = await body<{ closureVersionId: string; version: number }>(
    await post(request, headers, entry.id, 'closure', {
      expectedVersion: finished.version,
      idempotencyKey: randomUUID(),
      expectedFinishId: finished.finishId,
      closeAt: date(-5),
      closeAmountState: 'PENDING',
      closeAmt: null,
      note: 'Original closure note',
      closeContentVersionIds: [close.contentVersionId],
    }),
  );
  await body(
    await post(request, headers, entry.id, 'archive', {
      expectedVersion: closed.version,
      idempotencyKey: randomUUID(),
      expectedClosureVersionId: closed.closureVersionId,
      archiveAt: date(-4),
      archiveType: 'EXECUTION_CLOSED',
      archiveReason: 'Synthetic archive',
    }),
  );
  return entry.id;
}
async function judgmentSource(
  request: APIRequestContext,
  headers: Record<string, string>,
  actor: ReferenceReuseActor,
) {
  const entry = await source(request, headers, actor, 'WAITING_JUDGMENT');
  const original = await upload(request, headers, entry.id, 'JUDGMENT');
  const judgment = await body<{ judgmentId: string; version: number }>(
    await post(request, headers, entry.id, 'judgment-register', {
      expectedVersion: entry.version,
      idempotencyKey: randomUUID(),
      judgmentReceivedAt: date(-8),
      judgmentAmountState: 'KNOWN',
      judgmentAmount: '10.00',
      paidLitigationFeeState: 'KNOWN',
      paidLitigationFee: '0.00',
      judgmentContentVersionIds: [original.contentVersionId],
    }),
  );
  await body(
    await post(request, headers, entry.id, 'judgment-next-step', {
      expectedVersion: judgment.version,
      idempotencyKey: randomUUID(),
      judgmentId: judgment.judgmentId,
      next: 'EXECUTION',
      executionReadinessConfirmed: true,
    }),
  );
  return entry.id;
}
function correction(
  detail: Detail,
  variant: Variant,
  reason: string,
  newDate: string,
) {
  const current = row(detail, variant);
  const effective = current.effective;
  const ids = effective[variant.fileKey];
  expect(Array.isArray(ids) && ids.length === 1).toBe(true);
  const value = { [variant.dateKey]: newDate, [variant.fileKey]: ids };
  switch (variant.kind) {
    case 'mailing':
      return {
        mailingId: current.mailingId,
        expectedMailingRevision: current.mailingRevision,
        ...value,
        reason,
      };
    case 'filing':
      return {
        filingId: current.filingId,
        expectedFilingRevision: current.filingRevision,
        ...value,
        reason,
      };
    case 'finish':
      return {
        finishId: current.finishId,
        expectedFinishRevision: current.finishRevision,
        ...value,
        reason: effective.reason,
        basisNote: effective.basisNote,
        correctionReason: reason,
      };
    case 'judgment':
      return {
        judgmentId: current.judgmentId,
        expectedJudgmentRevision: current.judgmentRevision,
        trialRoundId: current.trialRoundId,
        ...value,
        judgmentAmountState: effective.judgmentAmountState,
        judgmentAmount: effective.judgmentAmount,
        paidLitigationFeeState: effective.paidLitigationFeeState,
        paidLitigationFee: effective.paidLitigationFee,
        reason,
      };
    case 'closure':
      return {
        closureId: current.closureId,
        expectedClosureRevision: current.closureRevision,
        expectedClosureVersionId: detail.closure?.current.id,
        ...value,
        closeAmountState: effective.closeAmountState,
        closeAmt: effective.closeAmt,
        note: effective.note,
        correctionReason: reason,
      };
  }
}

test('predeploy owned schema proves 0930 rollback, six index exemptions, and four original guards', async () => {
  test.setTimeout(180_000);
  expect(await verifyReferenceReusePredeploy()).toMatchObject({
    failedMigrationRolledBack: true,
    sixExemptPurposesPreserved: true,
    fourOriginalAndCorrectionBranches: true,
    publicUnchanged: true,
  });
});

test('five real case transactions reuse exact frozen versions and preserve ordinary uniqueness', async ({
  request,
}) => {
  test.setTimeout(600_000);
  await assertReferenceReuseRunner();
  const actor = referenceReuseActor();
  const headers = await login(request, actor);
  const executionCaseId = await executionSource(request, headers, actor);
  const judgmentCaseId = await judgmentSource(request, headers, actor);
  for (const variant of variants) {
    const caseId =
      variant.kind === 'judgment' ? judgmentCaseId : executionCaseId;
    const before = await read(request, caseId);
    const beforeSnapshot = await referenceReuseSnapshot(caseId);
    const originalIds = row(before, variant).effective[variant.fileKey];
    const wrong = {
      ...correction(before, variant, 'wrong version must fail', date(-2)),
      [variant.fileKey]: [randomUUID()],
      idempotencyKey: randomUUID(),
    };
    const invalid = await post(request, headers, caseId, variant.route, wrong);
    expect(invalid.status()).not.toBe(201);
    expect(await referenceReuseSnapshot(caseId)).toEqual(beforeSnapshot);
    const firstBody = {
      ...correction(before, variant, 'First same-version correction', date(-2)),
      idempotencyKey: randomUUID(),
    };
    const first = await body<Record<string, unknown>>(
      await post(request, headers, caseId, variant.route, firstBody),
    );
    const afterFirst = await read(request, caseId);
    const secondBody = {
      ...correction(
        afterFirst,
        variant,
        'Second same-version correction',
        date(-1),
      ),
      idempotencyKey: randomUUID(),
    };
    await body(await post(request, headers, caseId, variant.route, secondBody));
    const afterSecond = await read(request, caseId);
    expect(row(afterSecond, variant).effective[variant.fileKey]).toEqual(
      originalIds,
    );
    const rows = (await referenceReuseSnapshot(caseId)).references.filter(
      (ref) =>
        ref.purpose === variant.purpose &&
        ref.content_version_id === (originalIds as string[])[0],
    );
    expect(rows).toHaveLength(3);
    expect(
      rows.filter((ref) => ref.is_repeatable_typed_reference),
    ).toHaveLength(2);
    expect(
      rows.filter((ref) => !ref.is_repeatable_typed_reference),
    ).toHaveLength(1);
    expect(new Set(rows.map((ref) => ref.action_event_id)).size).toBe(3);
    const committed = await referenceReuseSnapshot(caseId);
    expect(
      await body(
        await post(request, headers, caseId, variant.route, firstBody),
      ),
    ).toEqual(first);
    expect(await referenceReuseSnapshot(caseId)).toEqual(committed);
    if (variant.kind === 'mailing') {
      expect(
        (await referenceReuseSqlRejections(caseId, variant.purpose)).map(
          (item) => item.code,
        ),
      ).toEqual(['23505', '23514']);
      expect(await referenceReuseSnapshot(caseId)).toEqual(committed);
    }
  }
  const detail = await read(request, executionCaseId);
  const mailing = variants[0];
  const two = await Promise.all([
    post(request, headers, executionCaseId, mailing.route, {
      ...correction(detail, mailing, 'Concurrent A', date(-3)),
      idempotencyKey: randomUUID(),
    }),
    post(request, headers, executionCaseId, mailing.route, {
      ...correction(detail, mailing, 'Concurrent B', date(-4)),
      idempotencyKey: randomUUID(),
    }),
  ]);
  expect(two.map((response) => response.status()).sort()).toEqual([201, 409]);
  const after = await referenceReuseSnapshot(executionCaseId);
  expect(
    after.references.filter(
      (ref) =>
        ref.purpose === mailing.purpose && ref.is_repeatable_typed_reference,
    ),
  ).toHaveLength(3);
  expect(after.corrections.find((item) => item.kind === mailing.kind)?.n).toBe(
    3,
  );
});
