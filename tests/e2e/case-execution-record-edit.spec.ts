import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
} from '@playwright/test';
import {
  createExecutionRecordEditActor,
  ownExecutionRecordEditCase,
  executionRecordEditSnapshot,
  revokeExecutionRecordEditActor,
  raceExecutionRecordEditRequests,
  withExecutionRecordEditFault,
  type ExecutionRecordEditActor,
} from '../support/case-execution-record-edit-database.mjs';

const origin = 'http://127.0.0.1:5174';
const bytes = Buffer.from(
  '%PDF-1.7\nE execution correction exact original bytes\n%%EOF\n',
);
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
async function body<T>(response: APIResponse, status = 201): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);
  return response.json() as Promise<T>;
}
async function login(
  request: APIRequestContext,
  actor: ExecutionRecordEditActor,
) {
  const session = await body<{ csrfToken: string }>(
    await request.post('/api/v1/auth/login', {
      headers: { Origin: origin },
      data: { username: actor.username, password: actor.password },
    }),
    200,
  );
  return { Origin: origin, 'X-CSRF-Token': session.csrfToken };
}
type File = { materialId: string; contentVersionId: string };
async function upload(
  request: APIRequestContext,
  headers: Record<string, string>,
  caseId: string,
  category: string,
): Promise<File> {
  const draft = await body<{ id: string }>(
    await request.post('/api/v1/materials/upload-drafts', {
      headers,
      data: {
        ownerType: 'CASE',
        ownerId: caseId,
        category,
        purpose: category,
        originalFilename: `execution-record-edit-${randomUUID()}.pdf`,
        declaredMimeType: 'application/pdf',
      },
    }),
  );
  return body<File>(
    await request.put(`/api/v1/materials/upload-drafts/${draft.id}/content`, {
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      data: bytes,
    }),
    200,
  );
}
type Detail = {
  id: string;
  stage: string;
  version: number;
  recordEdits: {
    executionMailings: Array<{
      mailingId: string;
      mailingRevision: number;
      effective: { mailedAt: string };
    }>;
    executionFilings: Array<{
      filingId: string;
      filingRevision: number;
      effective: { submittedAt: string };
    }>;
    executionFinishes: Array<{
      finishId: string;
      finishRevision: number;
      effective: { finishedAt: string; reason: string };
    }>;
  };
};
type Correction = {
  caseId: string;
  correctionId: string;
  recordedAt: string;
  mailingRevision?: number;
  filingRevision?: number;
  finishRevision?: number;
};

test('execution corrections preserve archived workflow, exact evidence and old receipts; reject scope/CAS and roll back every write phase', async ({
  request,
  playwright,
  baseURL,
}) => {
  test.setTimeout(180_000);
  // The dedicated support reuses exact managed-container admission for 15437.
  // It appends fresh actors/cases only and has no reset, seed, clear or trigger-disabling path.
  const operator = await createExecutionRecordEditActor();
  const headers = await login(request, operator);
  const created = await body<{ id: string; version: number }>(
    await request.post('/api/v1/cases/external-entries', {
      headers,
      data: {
        idempotencyKey: randomUUID(),
        entryKind: 'HISTORICAL_BACKFILL',
        initialStage: 'WAITING_EXECUTION_STAMP',
        stageReachedOn: date(-6),
        source: `execution-record-edit:${randomUUID()}`,
        reason: '独立隔离验收：只追加真实后续事实',
        customerId: operator.customerId,
        rightsHolderId: operator.rightsHolderId,
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
  const caseId = created.id;
  await ownExecutionRecordEditCase(caseId, operator.userId);
  const prefix = `/api/v1/cases/${caseId}`;
  const mailFile = await upload(request, headers, caseId, 'MAIL_RECEIPT');
  const mailReplacement = await upload(
    request,
    headers,
    caseId,
    'MAIL_RECEIPT',
  );
  const mailInput = {
    expectedVersion: created.version,
    idempotencyKey: randomUUID(),
    expectedConfirmationId: null,
    mailedAt: date(-5),
    mailReceiptContentVersionIds: [mailFile.contentVersionId],
  };
  const mailed = await body<{ mailingId: string; version: number }>(
    await request.post(`${prefix}/execution-mail`, {
      headers,
      data: mailInput,
    }),
  );
  const filingFile = await upload(
    request,
    headers,
    caseId,
    'EXECUTION_FILING_PROOF',
  );
  const filingReplacement = await upload(
    request,
    headers,
    caseId,
    'EXECUTION_FILING_PROOF',
  );
  const filingInput = {
    expectedVersion: mailed.version,
    idempotencyKey: randomUUID(),
    expectedMailingId: mailed.mailingId,
    submittedAt: date(-4),
    executionFilingProofContentVersionIds: [filingFile.contentVersionId],
  };
  const filed = await body<{ filingId: string; version: number }>(
    await request.post(`${prefix}/execution-filing-submit`, {
      headers,
      data: filingInput,
    }),
  );
  const basis = await upload(
    request,
    headers,
    caseId,
    'EXECUTION_FINISH_BASIS',
  );
  const basisReplacement = await upload(
    request,
    headers,
    caseId,
    'EXECUTION_FINISH_BASIS',
  );
  const finishInput = {
    expectedVersion: filed.version,
    idempotencyKey: randomUUID(),
    expectedFilingId: filed.filingId,
    finishedAt: date(-3),
    reason: '真实结束原原因',
    basisNote: '原执行依据',
    basisContentVersionIds: [basis.contentVersionId],
  };
  const finished = await body<{ finishId: string; version: number }>(
    await request.post(`${prefix}/execution-finish`, {
      headers,
      data: finishInput,
    }),
  );
  const closed = await body<{ closureVersionId: string; version: number }>(
    await request.post(`${prefix}/closure`, {
      headers,
      data: {
        expectedVersion: finished.version,
        idempotencyKey: randomUUID(),
        expectedFinishId: finished.finishId,
        // Existing closure contract permits this date; correction must not invent a new ordering gate.
        closeAt: date(-6),
        closeAmountState: 'PENDING',
        closeAmt: null,
        note: null,
        closeContentVersionIds: [],
      },
    }),
  );
  await body(
    await request.post(`${prefix}/archive`, {
      headers,
      data: {
        expectedVersion: closed.version,
        idempotencyKey: randomUUID(),
        expectedClosureVersionId: closed.closureVersionId,
        archiveAt: date(-6),
        archiveType: 'EXECUTION_CLOSED',
        archiveReason: '隔离验收真实归档',
      },
    }),
  );
  const before = await executionRecordEditSnapshot(caseId);
  const detailBefore = await body<Detail>(await request.get(prefix), 200);
  expect(detailBefore.stage).toBe('ARCHIVED');
  const commands = [
    {
      route: 'execution-mailing-correction',
      input: {
        mailingId: mailed.mailingId,
        expectedMailingRevision: 0,
        idempotencyKey: randomUUID(),
        mailedAt: date(-5),
        reason: '更正邮寄凭证',
        mailReceiptContentVersionIds: [mailReplacement.contentVersionId],
      },
    },
    {
      route: 'execution-filing-correction',
      input: {
        filingId: filed.filingId,
        expectedFilingRevision: 0,
        idempotencyKey: randomUUID(),
        submittedAt: date(-4),
        reason: '更正申请凭证',
        executionFilingProofContentVersionIds: [
          filingReplacement.contentVersionId,
        ],
      },
    },
    // Deliberately earlier than filing, but after the actual imported source date:
    // finish>=filing is not an approved rule in this slice.
    {
      route: 'execution-finish-correction',
      input: {
        finishId: finished.finishId,
        expectedFinishRevision: 0,
        idempotencyKey: randomUUID(),
        finishedAt: date(-5),
        reason: '订正后的真实结束原因',
        basisNote: null,
        correctionReason: '纠正已登记结束资料',
        basisContentVersionIds: [basisReplacement.contentVersionId],
      },
    },
  ];
  const successes: Correction[] = [];
  for (const command of commands) {
    const frozen = structuredClone(command.input);
    const success = await body<Correction>(
      await request.post(`${prefix}/${command.route}`, {
        headers,
        data: frozen,
      }),
    );
    successes.push(success);
    // Ignore the first response from the recovery caller's perspective, then send the exact original body/key.
    const replay = await body<Correction>(
      await request.post(`${prefix}/${command.route}`, {
        headers,
        data: frozen,
      }),
    );
    expect(replay).toEqual(success);
    expect(Object.keys(success).sort()).toEqual(
      [
        'caseId',
        'correctionId',
        'recordedAt',
        ...Object.keys(command.input).filter((key) =>
          [
            'mailingId',
            'filingId',
            'finishId',
            'mailedAt',
            'submittedAt',
            'finishedAt',
          ].includes(key),
        ),
        ...(command.route.includes('mailing')
          ? ['mailingRevision']
          : command.route.includes('filing')
            ? ['filingRevision']
            : ['finishRevision']),
      ].sort(),
    );
    expect(
      (
        await request.post(`${prefix}/${command.route}`, {
          headers,
          data: {
            ...frozen,
            idempotencyKey: frozen.idempotencyKey,
            reason: 'changed',
          },
        })
      ).status(),
    ).toBe(409);
    const targetKey = Object.keys(frozen).find((key) =>
      ['mailingId', 'filingId', 'finishId'].includes(key),
    )!;
    expect(
      (
        await request.post(`${prefix}/${command.route}`, {
          headers,
          data: {
            ...frozen,
            [targetKey]: randomUUID(),
            idempotencyKey: randomUUID(),
          },
        })
      ).status(),
    ).toBe(409);
    const expectedKey = Object.keys(frozen).find((key) =>
      key.startsWith('expected'),
    )!;
    expect(
      (
        await request.post(`${prefix}/${command.route}`, {
          headers,
          data: { ...frozen, [expectedKey]: 1, idempotencyKey: randomUUID() },
        })
      ).status(),
    ).toBe(400);
  }
  const after = await executionRecordEditSnapshot(caseId);
  expect(after.original).toEqual(before.original);
  for (const table of [
    'case_execution_mailing_record_corrections',
    'case_execution_filing_record_corrections',
    'case_execution_finish_record_corrections',
  ])
    expect(after.corrections[table]).toHaveLength(1);
  expect(after.corrections.case_section_record_edit_receipts).toHaveLength(3);
  expect(after.corrections.audit).toHaveLength(3);
  expect(after.corrections.references).toHaveLength(
    before.corrections.references.length + 3,
  );
  const joins = [
    { table: 'case_execution_mailing_record_documents', file: mailReplacement },
    {
      table: 'case_execution_filing_record_documents',
      file: filingReplacement,
    },
    { table: 'case_execution_finish_record_documents', file: basisReplacement },
  ];
  for (const [index, join] of joins.entries()) {
    const correctionId = successes[index]!.correctionId;
    expect(after.corrections[join.table]).toEqual([
      {
        row: expect.objectContaining({
          correction_id: correctionId,
          case_id: caseId,
          department_id: operator.departmentId,
          material_id: join.file.materialId,
          content_version_id: join.file.contentVersionId,
        }),
      },
    ]);
    const audit = after.corrections.audit.find(({ row }) => {
      const details = row.details;
      return (
        details !== null &&
        typeof details === 'object' &&
        'correctionId' in details &&
        details.correctionId === correctionId
      );
    });
    expect(audit).toBeDefined();
    expect(
      after.corrections.references.filter(
        ({ row }) => row.action_event_id === audit!.row.id,
      ),
    ).toEqual([
      {
        row: expect.objectContaining({
          resource_type: 'case',
          resource_id: caseId,
          material_id: join.file.materialId,
          content_version_id: join.file.contentVersionId,
        }),
      },
    ]);
  }
  const detail = await body<Detail>(await request.get(prefix), 200);
  expect({ stage: detail.stage, version: detail.version }).toEqual({
    stage: detailBefore.stage,
    version: detailBefore.version,
  });
  expect(
    detail.recordEdits.executionMailings.find(
      (row) => row.mailingId === mailed.mailingId,
    )?.mailingRevision,
  ).toBe(1);
  expect(
    detail.recordEdits.executionFilings.find(
      (row) => row.filingId === filed.filingId,
    )?.filingRevision,
  ).toBe(1);
  expect(
    detail.recordEdits.executionFinishes.find(
      (row) => row.finishId === finished.finishId,
    )?.effective.reason,
  ).toBe('订正后的真实结束原因');
  for (const file of [
    mailFile,
    filingFile,
    basis,
    mailReplacement,
    filingReplacement,
    basisReplacement,
  ]) {
    const response = await request.get(
      `/api/v1/materials/${file.materialId}/versions/${file.contentVersionId}/content`,
    );
    expect(response.status()).toBe(200);
    expect(await response.body()).toEqual(bytes);
  }
  // Old workflow receipt order/body remains valid after correction and archive.
  expect(
    await body(
      await request.post(`${prefix}/execution-mail`, {
        headers,
        data: mailInput,
      }),
    ),
  ).toEqual(mailed);
  expect(
    await body(
      await request.post(`${prefix}/execution-filing-submit`, {
        headers,
        data: filingInput,
      }),
    ),
  ).toEqual(filed);
  expect(
    await body(
      await request.post(`${prefix}/execution-finish`, {
        headers,
        data: finishInput,
      }),
    ),
  ).toEqual(finished);
  const mailing = {
    mailingId: mailed.mailingId,
    expectedMailingRevision: 1,
    idempotencyKey: randomUUID(),
    mailedAt: date(-4),
    reason: '并发精确目标',
    mailReceiptContentVersionIds: [mailReplacement.contentVersionId],
  };
  const race = await raceExecutionRecordEditRequests(caseId, () =>
    Promise.all([
      request.post(`${prefix}/execution-mailing-correction`, {
        headers,
        data: mailing,
      }),
      request.post(`${prefix}/execution-mailing-correction`, {
        headers,
        data: { ...mailing, idempotencyKey: randomUUID() },
      }),
    ]),
  );
  expect(race.map((response) => response.status()).sort()).toEqual([201, 409]);
  const rollbackInput = {
    ...mailing,
    expectedMailingRevision: 2,
    idempotencyKey: randomUUID(),
    mailedAt: date(-3),
    reason: '失败整体回滚后的原键重试',
  };
  for (const phase of [
    'audit',
    'correction',
    'document',
    'reference',
    'receipt',
  ] as const) {
    const snapshot = await executionRecordEditSnapshot(caseId);
    await withExecutionRecordEditFault(caseId, phase, async () => {
      expect(
        (
          await request.post(`${prefix}/execution-mailing-correction`, {
            headers,
            data: rollbackInput,
          })
        ).status(),
      ).toBeGreaterThanOrEqual(500);
    });
    expect(await executionRecordEditSnapshot(caseId)).toEqual(snapshot);
  }
  const saved = await body<Correction>(
    await request.post(`${prefix}/execution-mailing-correction`, {
      headers,
      data: rollbackInput,
    }),
  );
  expect(saved.mailingRevision).toBe(3);
  expect(
    await body(
      await request.post(`${prefix}/execution-mailing-correction`, {
        headers,
        data: rollbackInput,
      }),
    ),
  ).toEqual(saved);
  const foreignActor = await createExecutionRecordEditActor({ foreign: true });
  const readOnly = await createExecutionRecordEditActor({ readOnly: true });
  for (const [identity, statuses] of [
    [foreignActor, [403, 404]],
    [readOnly, [403]],
  ] as const) {
    const context = await playwright.request.newContext({ baseURL });
    try {
      const identityHeaders = await login(context, identity);
      const response = await context.post(
        `${prefix}/execution-mailing-correction`,
        { headers: identityHeaders, data: rollbackInput },
      );
      expect(statuses).toContain(response.status());
    } finally {
      await context.dispose();
    }
  }
  const finalSnapshot = await executionRecordEditSnapshot(caseId);
  await revokeExecutionRecordEditActor(operator.userId);
  expect(
    (
      await request.post(`${prefix}/execution-mailing-correction`, {
        headers,
        data: rollbackInput,
      })
    ).status(),
  ).toBe(403);
  expect(await executionRecordEditSnapshot(caseId)).toEqual(finalSnapshot);
});
