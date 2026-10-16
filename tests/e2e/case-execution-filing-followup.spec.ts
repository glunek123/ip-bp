import { createHash, randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequest,
  type APIRequestContext,
  type APIResponse,
} from '@playwright/test';
import {
  createExecutionFilingFollowupActor,
  executionFilingFollowupSource,
  ownExecutionFilingFollowupCase,
  executionFilingFollowupSnapshot,
  executionFilingFollowupSafetySnapshot,
  revokeExecutionFilingFollowupActor,
  contendExecutionFilingFollowupRequests,
  withExecutionFilingFollowupFault,
  type ExecutionFilingFollowupActor,
  type ExecutionFilingFollowupRow,
  type ExecutionFilingFollowupSnapshot,
} from '../support/case-execution-filing-followup-database.mjs';

// Source preparation only. The helper refuses the current 157-source tree.
// Runner admission additionally requires approved public 158+159 and fresh fixture authorization.
// PRIMARY positive/redaction tests await a lawful fresh identity/binding source; no old credentials are used.
const origin = 'http://127.0.0.1:3101';
const pdf = Buffer.from('%PDF-1.7\nEF001 exact synthetic bytes\n%%EOF\n');
type Session = {
  actor: ExecutionFilingFollowupActor;
  request: APIRequestContext;
  headers: Record<string, string>;
};
type File = {
  materialId: string;
  contentVersionId: string;
  sha256: string;
  sizeBytes: number;
};
type Command = {
  route: string;
  input: Record<string, unknown>;
  kind: 'feedback' | 'supplement';
  rootId: string;
  revision: number;
  event: string;
  command: string;
  file?: File;
};
type Result = {
  id: string;
  filingId: string;
  feedbackId?: string;
  supplementId?: string;
  revision: number;
  recordedAt: string;
};
type Detail = {
  id: string;
  stage: string;
  version: number;
  executionFiling: { id: string } | null;
  executionFilingFollowups: null | {
    filingId: string;
    canRecordFeedback: boolean;
    canSubmitSupplement: boolean;
    feedbacks: Array<{
      feedbackId: string;
      canCorrect: boolean;
      current: {
        id: string;
        revision: number;
        feedbackOn: string | null;
        courtCaseNo: string | null;
        content: string;
      };
      history: Array<{
        id: string;
        revision: number;
        correctionReason?: string | null;
      }>;
    }>;
    supplements: Array<{
      supplementId: string;
      canCorrect: boolean;
      current: {
        id: string;
        revision: number;
        submittedOn: string | null;
        note: string | null;
        files: Array<{ materialId: string; contentVersionId: string }>;
      };
      history: Array<{
        id: string;
        revision: number;
        correctionReason?: string | null;
        files: Array<{ materialId: string; contentVersionId: string }>;
      }>;
    }>;
  };
};
type Filing = {
  caseId: string;
  filingId: string;
  version: number;
  prefix: string;
  mailInput: Record<string, unknown>;
  filingInput: Record<string, unknown>;
  filingResult: { filingId: string; version: number };
};

const day = (offset: number) => {
  const value = new Date(
    `${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())}T00:00:00.000Z`,
  );
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
};
async function body<T>(response: APIResponse, status = 201): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);
  return response.json() as Promise<T>;
}
async function session(
  factory: APIRequest,
  kind: 'source' | 'operator' | 'readOnly' | 'foreign',
): Promise<Session> {
  const actor = await createExecutionFilingFollowupActor(kind);
  return login(factory, actor);
}
async function login(
  factory: APIRequest,
  actor: ExecutionFilingFollowupActor,
): Promise<Session> {
  const request = await factory.newContext({ baseURL: origin });
  try {
    const login = await body<{ csrfToken: string }>(
      await request.post('/api/v1/auth/login', {
        headers: { Origin: origin },
        data: { username: actor.username, password: actor.password },
      }),
      200,
    );
    return {
      actor,
      request,
      headers: { Origin: origin, 'X-CSRF-Token': login.csrfToken },
    };
  } catch (cause) {
    await request.dispose();
    throw cause;
  }
}
async function scenario(
  factory: APIRequest,
  operation: (
    source: Session,
    connect: (kind?: 'operator' | 'readOnly' | 'foreign') => Promise<Session>,
  ) => Promise<void>,
) {
  const sessions: Session[] = [];
  const connect = async (
    kind: 'source' | 'operator' | 'readOnly' | 'foreign' = 'operator',
  ) => {
    const value = await session(factory, kind);
    sessions.push(value);
    return value;
  };
  try {
    await operation(await connect('source'), connect);
  } finally {
    for (const value of sessions) await value.request.dispose();
  }
}
async function externalCase(
  s: Session,
  initialStage: 'WAITING_EXECUTION_STAMP' | 'EXECUTING',
) {
  const created = await body<{ id: string; version: number }>(
    await s.request.post('/api/v1/cases/external-entries', {
      headers: s.headers,
      data: {
        idempotencyKey: randomUUID(),
        entryKind: 'HISTORICAL_BACKFILL',
        initialStage,
        stageReachedOn: day(-6),
        source: executionFilingFollowupSource(s.actor.userId),
        reason: '独立 EF001 验收来源',
        customerId: s.actor.customerId,
        rightsHolderId: s.actor.rightsHolderId,
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
  await ownExecutionFilingFollowupCase(created.id, s.actor.userId);
  return created;
}
async function nativeFile(
  s: Session,
  caseId: string,
  category: 'MAIL_RECEIPT' | 'EXECUTION_FILING_PROOF',
) {
  const draft = await body<{ id: string }>(
    await s.request.post('/api/v1/materials/upload-drafts', {
      headers: s.headers,
      data: {
        ownerType: 'CASE',
        ownerId: caseId,
        category,
        purpose: category,
        originalFilename: `${randomUUID()}.pdf`,
        declaredMimeType: 'application/pdf',
      },
    }),
  );
  return body<File>(
    await s.request.put(`/api/v1/materials/upload-drafts/${draft.id}/content`, {
      headers: { ...s.headers, 'Content-Type': 'application/octet-stream' },
      data: pdf,
    }),
    200,
  );
}
async function filing(s: Session): Promise<Filing> {
  const created = await externalCase(s, 'WAITING_EXECUTION_STAMP');
  const prefix = `/api/v1/cases/${created.id}`;
  const mail = await nativeFile(s, created.id, 'MAIL_RECEIPT');
  const mailInput = {
    expectedVersion: created.version,
    idempotencyKey: randomUUID(),
    expectedConfirmationId: null,
    mailedAt: day(-5),
    mailReceiptContentVersionIds: [mail.contentVersionId],
  };
  const mailed = await body<{ mailingId: string; version: number }>(
    await s.request.post(`${prefix}/execution-mail`, {
      headers: s.headers,
      data: mailInput,
    }),
  );
  const proof = await nativeFile(s, created.id, 'EXECUTION_FILING_PROOF');
  const filingInput = {
    expectedVersion: mailed.version,
    idempotencyKey: randomUUID(),
    expectedMailingId: mailed.mailingId,
    submittedAt: day(-4),
    executionFilingProofContentVersionIds: [proof.contentVersionId],
  };
  const filed = await body<{ filingId: string; version: number }>(
    await s.request.post(`${prefix}/execution-filing-submit`, {
      headers: s.headers,
      data: filingInput,
    }),
  );
  return {
    caseId: created.id,
    filingId: filed.filingId,
    version: filed.version,
    prefix,
    mailInput,
    filingInput,
    filingResult: filed,
  };
}
function feedback(
  f: Filing,
  rootId: string = randomUUID(),
  revision = 0,
): Command {
  return {
    kind: 'feedback',
    rootId,
    revision,
    command: revision === 0 ? 'FEEDBACK_RECORD' : 'FEEDBACK_CORRECT',
    event: `case.execution.feedback.${revision === 0 ? 'recorded' : 'corrected'}`,
    route: `${f.prefix}/execution-filings/${f.filingId}/feedbacks${revision === 0 ? '' : `/${rootId}/corrections`}`,
    input: {
      ...(revision === 0
        ? { feedbackId: rootId }
        : { correctionReason: '更正真实反馈' }),
      expectedRevision: revision,
      idempotencyKey: randomUUID(),
      feedbackOn: null,
      courtCaseNo: null,
      content: `真实反馈 ${randomUUID()}`,
    },
  };
}
function supplement(
  f: Filing,
  rootId: string,
  file: File,
  revision = 0,
): Command {
  return {
    kind: 'supplement',
    rootId,
    revision,
    file,
    command: revision === 0 ? 'SUPPLEMENT_SUBMIT' : 'SUPPLEMENT_CORRECT',
    event: `case.execution.supplement.${revision === 0 ? 'submitted' : 'corrected'}`,
    route: `${f.prefix}/execution-filings/${f.filingId}/supplements${revision === 0 ? '' : `/${rootId}/corrections`}`,
    input: {
      ...(revision === 0
        ? { supplementId: rootId }
        : { correctionReason: '更正真实补交' }),
      expectedRevision: revision,
      idempotencyKey: randomUUID(),
      submittedOn: null,
      note: null,
      contentVersionIds: [file.contentVersionId],
    },
  };
}
type Draft = {
  id: string;
  ownerType: string;
  ownerId: string;
  category: string;
  purpose: string;
  expiresAt: string;
  executionSupplement: {
    filingId: string;
    supplementId: string;
    expectedRevision: number;
  };
};
async function draft(
  s: Session,
  f: Filing,
  supplementId: string,
  expectedRevision = 0,
  declaredMimeType = 'application/pdf',
) {
  const started = Date.now();
  const value = await body<Draft>(
    await s.request.post(
      `${f.prefix}/execution-filings/${f.filingId}/supplements/${supplementId}/upload-drafts`,
      {
        headers: s.headers,
        data: {
          expectedRevision,
          originalFilename: `${randomUUID()}.pdf`,
          declaredMimeType,
        },
      },
    ),
  );
  expect(value).toMatchObject({
    ownerType: 'CASE',
    ownerId: f.caseId,
    category: 'EXECUTION_SUPPLEMENT',
    purpose: 'EXECUTION_SUPPLEMENT',
    executionSupplement: {
      filingId: f.filingId,
      supplementId,
      expectedRevision,
    },
  });
  expect(Date.parse(value.expiresAt)).toBeGreaterThanOrEqual(
    started + 24 * 60 * 60 * 1000 - 1000,
  );
  expect(Date.parse(value.expiresAt)).toBeLessThanOrEqual(
    Date.now() + 24 * 60 * 60 * 1000 + 1000,
  );
  return value;
}
async function put(s: Session, value: Draft, bytes = pdf) {
  return s.request.put(`/api/v1/materials/upload-drafts/${value.id}/content`, {
    headers: { ...s.headers, 'Content-Type': 'application/octet-stream' },
    data: bytes,
  });
}
async function supplementFile(
  s: Session,
  f: Filing,
  rootId: string,
  revision = 0,
  bytes = pdf,
) {
  const value = await draft(s, f, rootId, revision);
  const file = await body<File & Pick<Draft, 'executionSupplement'>>(
    await put(s, value, bytes),
    200,
  );
  expect(file.executionSupplement).toEqual(value.executionSupplement);
  expect(file.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  expect(file.sizeBytes).toBe(bytes.length);
  return file;
}
async function post(s: Session, c: Command, input = c.input) {
  return s.request.post(c.route, { headers: s.headers, data: input });
}
async function saved(s: Session, f: Filing, c: Command) {
  const value = await body<Result>(await post(s, c));
  expect(Object.keys(value).sort()).toEqual(
    ['id', 'filingId', `${c.kind}Id`, 'revision', 'recordedAt'].sort(),
  );
  expect(value).toMatchObject({
    filingId: f.filingId,
    [`${c.kind}Id`]: c.rootId,
    revision: c.revision + 1,
  });
  if (c.revision === 0) expect(value.id).toBe(c.rootId);
  else expect(value.id).not.toBe(c.rootId);
  expect(new Date(value.recordedAt).toISOString()).toBe(value.recordedAt);
  return value;
}
function assertFact(
  snapshot: ExecutionFilingFollowupSnapshot,
  s: Session,
  f: Filing,
  c: Command,
  result: Result,
) {
  const table =
    c.kind === 'feedback'
      ? 'case_execution_filing_feedbacks'
      : 'case_execution_filing_supplements';
  const row = snapshot.facts[table]!.find((r) => r.id === result.id);
  expect(row).toMatchObject({
    id: result.id,
    [`${c.kind}_id`]: c.rootId,
    filing_id: f.filingId,
    case_id: f.caseId,
    department_id: s.actor.departmentId,
    from_revision: c.revision,
    to_revision: result.revision,
    actor_type: 'INTERNAL',
    recorded_by_user_id: s.actor.userId,
    internal_actor_user_id: s.actor.userId,
    lawyer_account_binding_id: null,
    correction_reason: c.revision === 0 ? null : c.input.correctionReason,
  });
  const audit = snapshot.facts.audit!.find((r) => r.id === row?.audit_event_id);
  const prior = snapshot.facts[table]!.find(
    (r) => r.id === row?.prior_version_id,
  );
  if (c.revision !== 0) expect(prior).toBeDefined();
  expect(row?.prior_version_id).toBe(c.revision === 0 ? null : prior?.id);
  const before =
    c.revision === 0
      ? null
      : c.kind === 'feedback'
        ? {
            feedbackOn: prior?.feedback_on,
            courtCaseNo: prior?.court_case_no,
            content: prior?.content,
          }
        : {
            submittedOn: prior?.submitted_on,
            note: prior?.note,
            contentVersionIds: snapshot.facts
              .case_execution_filing_supplement_documents!.filter(
                (d) => d.version_id === prior?.id,
              )
              .map((d) => d.content_version_id)
              .sort(),
          };
  const after =
    c.kind === 'feedback'
      ? {
          feedbackOn: c.input.feedbackOn,
          courtCaseNo: c.input.courtCaseNo,
          content: c.input.content,
        }
      : {
          submittedOn: c.input.submittedOn,
          note: c.input.note,
          contentVersionIds: [c.file!.contentVersionId],
        };
  expect(audit).toMatchObject({
    action: c.event,
    actor_user_id: s.actor.userId,
    resource_type: 'CASE',
    resource_id: f.caseId,
    details: expect.objectContaining({
      versionId: result.id,
      filingId: f.filingId,
      [`${c.kind}Id`]: c.rootId,
      fromRevision: c.revision,
      toRevision: result.revision,
      correctionReason: c.revision === 0 ? null : c.input.correctionReason,
      before,
      after,
    }),
  });
  const receipt =
    snapshot.facts.case_execution_filing_followup_receipts!.filter(
      (r) => r.idempotency_key === c.input.idempotencyKey,
    );
  expect(receipt).toHaveLength(1);
  expect(receipt[0]).toMatchObject({
    command: c.command,
    actor_user_id: s.actor.userId,
    filing_id: f.filingId,
    department_id: s.actor.departmentId,
    case_id: f.caseId,
    request_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
    feedback_version_id: c.kind === 'feedback' ? result.id : null,
    supplement_version_id: c.kind === 'supplement' ? result.id : null,
    result_snapshot: result,
  });
  if (c.file) {
    const docs =
      snapshot.facts.case_execution_filing_supplement_documents!.filter(
        (r) => r.version_id === result.id,
      );
    expect(docs).toEqual([
      expect.objectContaining({
        supplement_id: c.rootId,
        filing_id: f.filingId,
        material_id: c.file.materialId,
        content_version_id: c.file.contentVersionId,
      }),
    ]);
    expect(
      snapshot.facts.references!.filter((r) => r.action_event_id === audit?.id),
    ).toEqual([
      expect.objectContaining({
        resource_type: 'case',
        resource_id: f.caseId,
        material_id: c.file.materialId,
        content_version_id: c.file.contentVersionId,
      }),
    ]);
  }
}
async function finish(s: Session, f: Filing) {
  return body<{ version: number; stage: string }>(
    await s.request.post(`${f.prefix}/execution-finish`, {
      headers: s.headers,
      data: {
        expectedVersion: f.version,
        idempotencyKey: randomUUID(),
        expectedFilingId: f.filingId,
        finishedAt: day(-1),
        reason: '正常原执行结束办理',
        basisNote: null,
        basisContentVersionIds: [],
      },
    }),
  );
}

test.describe('EF001 domain acceptance source', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 });
  let securityBefore: Record<string, ExecutionFilingFollowupRow[]> | undefined;
  test.beforeAll(async () => {
    securityBefore = await executionFilingFollowupSafetySnapshot();
  });
  test.afterAll(async () => {
    if (!securityBefore) return;
    const after = await executionFilingFollowupSafetySnapshot();
    for (const [table, rows] of Object.entries(securityBefore))
      for (const row of rows)
        expect(
          after[table]!.find((candidate) => candidate.id === row.id),
          `old security ${table}`,
        ).toEqual(row);
  });

  test('two internal operators append all four facts, preserve original filing/workflow and recover exact old keys after finish', async ({
    playwright,
  }) => {
    await scenario(playwright.request, async (s, connect) => {
      const f = await filing(s),
        other = await connect();
      const initial = await executionFilingFollowupSnapshot(f.caseId);
      // No feedback is manufactured as a prerequisite to this actual supplement.
      const root = randomUUID();
      const oldFile = await supplementFile(s, f, root);
      const first = supplement(f, root, oldFile);
      const firstResult = await saved(s, f, first);
      const feedbackCommand = feedback(f);
      const feedbackResult = await saved(other, f, feedbackCommand);
      const correctedFeedback = feedback(f, feedbackCommand.rootId, 1);
      correctedFeedback.input.feedbackOn = '2099-01-01';
      correctedFeedback.input.courtCaseNo = '(synthetic) exact court number';
      const correctedFeedbackResult = await saved(s, f, correctedFeedback);
      const newFile = await supplementFile(
        s,
        f,
        root,
        1,
        Buffer.from('%PDF-1.7\nEF001 replacement bytes\n%%EOF\n'),
      );
      const correctedSupplement = supplement(f, root, newFile, 1);
      correctedSupplement.input.submittedOn = '2020-01-01';
      const correctedSupplementResult = await saved(s, f, correctedSupplement);
      const commands = [
        [s, first, firstResult],
        [other, feedbackCommand, feedbackResult],
        [s, correctedFeedback, correctedFeedbackResult],
        [s, correctedSupplement, correctedSupplementResult],
      ] as const;
      const snapshot = await executionFilingFollowupSnapshot(f.caseId);
      expect(snapshot.original).toEqual(initial.original);
      for (const [actor, command, result] of commands) {
        assertFact(snapshot, actor, f, command, result);
        const originalBody = structuredClone(command.input);
        // Treat the first result as lost to the caller; retry exactly the saved body/key.
        expect(
          await body<Result>(await post(actor, command, originalBody)),
        ).toEqual(result);
        expect(command.input).toEqual(originalBody);
        await body(
          await post(actor, command, {
            ...originalBody,
            ...(command.kind === 'feedback'
              ? { content: 'changed' }
              : { note: 'changed' }),
          }),
          409,
        );
      }
      const detail = await body<Detail>(await s.request.get(f.prefix), 200);
      expect(detail.stage).toBe('EXECUTING');
      expect(detail.version).toBe(f.version);
      expect(detail.executionFiling?.id).toBe(f.filingId);
      expect(detail.executionFilingFollowups).toMatchObject({
        filingId: f.filingId,
        canRecordFeedback: true,
        canSubmitSupplement: true,
        feedbacks: [
          expect.objectContaining({
            feedbackId: feedbackCommand.rootId,
            current: expect.objectContaining({
              id: correctedFeedbackResult.id,
              revision: 2,
              feedbackOn: '2099-01-01',
            }),
            history: [
              expect.objectContaining({
                id: feedbackResult.id,
                revision: 1,
                correctionReason: null,
              }),
              expect.objectContaining({
                id: correctedFeedbackResult.id,
                revision: 2,
                correctionReason: correctedFeedback.input.correctionReason,
              }),
            ],
          }),
        ],
        supplements: [
          expect.objectContaining({
            supplementId: root,
            current: expect.objectContaining({
              id: correctedSupplementResult.id,
              revision: 2,
              submittedOn: '2020-01-01',
            }),
            history: [
              expect.objectContaining({ id: firstResult.id }),
              expect.objectContaining({ id: correctedSupplementResult.id }),
            ],
          }),
        ],
      });
      const relogged = await login(playwright.request, s.actor);
      try {
        const refreshed = await body<Detail>(
          await relogged.request.get(f.prefix),
          200,
        );
        expect(refreshed.executionFilingFollowups).toEqual(
          detail.executionFilingFollowups,
        );
        expect(refreshed.stage).toBe('EXECUTING');
        expect(refreshed.version).toBe(f.version);
      } finally {
        await relogged.request.dispose();
      }
      for (const file of [oldFile, newFile]) {
        const download = await s.request.get(
          `/api/v1/materials/${file.materialId}/versions/${file.contentVersionId}/content`,
        );
        expect(download.status()).toBe(200);
        expect(
          createHash('sha256')
            .update(await download.body())
            .digest('hex'),
        ).toBe(file.sha256);
      }
      expect(
        await body(
          await s.request.post(`${f.prefix}/execution-filing-submit`, {
            headers: s.headers,
            data: f.filingInput,
          }),
        ),
      ).toEqual(f.filingResult);
      await finish(s, f);
      const finished = await executionFilingFollowupSnapshot(f.caseId);
      for (const [actor, command, result] of commands) {
        expect(await body(await post(actor, command))).toEqual(result);
        await body(
          await post(actor, command, {
            ...command.input,
            idempotencyKey: randomUUID(),
          }),
          409,
        );
      }
      expect(await executionFilingFollowupSnapshot(f.caseId)).toEqual(finished);
    });
  });

  test('a pure external EXECUTING source remains readable without a fabricated local filing', async ({
    playwright,
  }) => {
    await scenario(playwright.request, async (s) => {
      const external = await externalCase(s, 'EXECUTING');
      const prefix = `/api/v1/cases/${external.id}`;
      const before = await executionFilingFollowupSnapshot(external.id);
      const detail = await body<Detail>(await s.request.get(prefix), 200);
      expect(detail.executionFiling).toBeNull();
      expect(detail.executionFilingFollowups).toBeNull();
      await body(
        await s.request.post(
          `${prefix}/execution-filings/${randomUUID()}/feedbacks`,
          {
            headers: s.headers,
            data: {
              feedbackId: randomUUID(),
              expectedRevision: 0,
              idempotencyKey: randomUUID(),
              feedbackOn: null,
              courtCaseNo: null,
              content: 'must not invent filing',
            },
          },
        ),
        409,
      );
      expect(await executionFilingFollowupSnapshot(external.id)).toEqual(
        before,
      );
    });
  });

  test('normal execution finish needs no manufactured feedback and fresh EF writes then stop', async ({
    playwright,
  }) => {
    await scenario(playwright.request, async (s) => {
      const f = await filing(s);
      const detail = await body<Detail>(await s.request.get(f.prefix), 200);
      expect(detail.executionFilingFollowups).toMatchObject({
        feedbacks: [],
        supplements: [],
      });
      await finish(s, f);
      const before = await executionFilingFollowupSnapshot(f.caseId);
      await body(await post(s, feedback(f)), 409);
      expect(await executionFilingFollowupSnapshot(f.caseId)).toEqual(before);
    });
  });

  test('independent revision, shared-key namespace, route anchors and strict nullable date DTOs reject without writes', async ({
    playwright,
  }) => {
    await scenario(playwright.request, async (s) => {
      const f = await filing(s),
        c = feedback(f),
        result = await saved(s, f, c);
      const before = await executionFilingFollowupSnapshot(f.caseId);
      const correction = feedback(f, c.rootId, 1);
      const afterFirst = await saved(s, f, correction);
      const stable = await executionFilingFollowupSnapshot(f.caseId);
      await body(
        await post(s, correction, {
          ...correction.input,
          idempotencyKey: randomUUID(),
        }),
        409,
      );
      await body(
        await post(s, {
          ...correction,
          route: correction.route.replace(
            c.rootId,
            result.id === c.rootId ? afterFirst.id : result.id,
          ),
        }),
        409,
      );
      for (const patch of [
        { feedbackOn: '2026-02-30' },
        { feedbackOn: '2026-01-01T00:00:00Z' },
        { feedbackOn: undefined },
        { courtCaseNo: undefined },
        { feedbackId: randomUUID() },
        { expectedRevision: 1.5 },
      ])
        await body(
          await post(s, correction, {
            ...correction.input,
            idempotencyKey: randomUUID(),
            ...patch,
          }),
          400,
        );
      const next = feedback(f);
      next.input.idempotencyKey = c.input.idempotencyKey;
      await body(await post(s, next), 409);
      const supplementRoot = randomUUID();
      const file = await supplementFile(s, f, supplementRoot);
      const sharedKey = supplement(f, supplementRoot, file);
      sharedKey.input.idempotencyKey = c.input.idempotencyKey;
      await body(await post(s, sharedKey), 409);
      const fakeFiling = {
        ...c,
        route: c.route.replace(f.filingId, randomUUID()),
      };
      await body(await post(s, fakeFiling), 409);
      expect(await executionFilingFollowupSnapshot(f.caseId)).toEqual(stable);
      expect(before.original).toEqual(stable.original);
    });
  });

  test('foreign/read-only/revoked actors cannot write or replay; current permissions are checked before a receipt', async ({
    playwright,
  }) => {
    await scenario(playwright.request, async (s, connect) => {
      const f = await filing(s),
        other = await connect(),
        readOnly = await connect('readOnly'),
        foreign = await connect('foreign');
      const c = feedback(f),
        result = await saved(other, f, c);
      const before = await executionFilingFollowupSnapshot(f.caseId);
      await body(
        await post(readOnly, {
          ...c,
          input: {
            ...c.input,
            feedbackId: randomUUID(),
            idempotencyKey: randomUUID(),
          },
        }),
        403,
      );
      await body(await post(foreign, c), 404);
      // An internal session cannot use the lawyer prefix to bypass its role/scope.
      await body(
        await post(s, {
          ...c,
          route: c.route.replace('/api/v1/cases/', '/api/v1/lawyer/cases/'),
        }),
        403,
      );
      const detail = await body<Detail>(
        await readOnly.request.get(f.prefix),
        200,
      );
      expect(detail.executionFilingFollowups).toMatchObject({
        canRecordFeedback: false,
        canSubmitSupplement: false,
        feedbacks: [expect.objectContaining({ canCorrect: false })],
      });
      await revokeExecutionFilingFollowupActor(other.actor.userId);
      expect(result.id).toBe(c.rootId);
      await body(await post(other, c), 403);
      expect(await executionFilingFollowupSnapshot(f.caseId)).toEqual(before);
    });
  });

  test('root UUIDs cannot reuse another case, feedback, supplement, correction version or foreign draft reservation', async ({
    playwright,
  }) => {
    await scenario(playwright.request, async (s, connect) => {
      const a = await filing(s),
        b = await filing(s);
      const c = feedback(a),
        initial = await saved(s, a, c),
        correction = await saved(s, a, feedback(a, c.rootId, 1));
      const sr = randomUUID(),
        sf = await supplementFile(s, a, sr),
        sc = supplement(a, sr, sf);
      await saved(s, a, sc);
      const reserved = randomUUID();
      await draft(await connect(), a, reserved);
      const beforeA = await executionFilingFollowupSnapshot(a.caseId),
        beforeB = await executionFilingFollowupSnapshot(b.caseId);
      for (const occupied of [initial.id, correction.id, sr, reserved])
        for (const target of [a, b]) {
          const command = feedback(target, occupied.toUpperCase());
          await body(await post(s, command), 409);
          await body(
            await post(s, {
              ...sc,
              route: `${target.prefix}/execution-filings/${target.filingId}/supplements`,
              input: {
                ...sc.input,
                supplementId: occupied,
                idempotencyKey: randomUUID(),
              },
            }),
            409,
          );
        }
      expect(await executionFilingFollowupSnapshot(a.caseId)).toEqual(beforeA);
      expect(await executionFilingFollowupSnapshot(b.caseId)).toEqual(beforeB);
    });
  });

  test('simultaneous first claims and corrections have a single winner with observed case-lock contention', async ({
    playwright,
  }) => {
    await scenario(playwright.request, async (s, connect) => {
      const f = await filing(s),
        other = await connect();
      const first = feedback(f),
        rival = {
          ...first,
          input: {
            ...first.input,
            idempotencyKey: randomUUID(),
            content: 'competing first claim',
          },
        };
      const initialRace = await contendExecutionFilingFollowupRequests(
        f.caseId,
        () => Promise.all([post(s, first), post(other, rival)]),
      );
      expect(initialRace.blockedPids.length).toBeGreaterThanOrEqual(2);
      expect(initialRace.result.map((r) => r.status()).sort()).toEqual([
        201, 409,
      ]);
      const c1 = feedback(f, first.rootId, 1),
        c2 = feedback(f, first.rootId, 1);
      const revisionRace = await contendExecutionFilingFollowupRequests(
        f.caseId,
        () => Promise.all([post(s, c1), post(other, c2)]),
      );
      expect(revisionRace.result.map((r) => r.status()).sort()).toEqual([
        201, 409,
      ]);
      const after = await executionFilingFollowupSnapshot(f.caseId);
      expect(after.facts.case_execution_filing_feedbacks).toHaveLength(2);
      expect(after.facts.case_execution_filing_followup_receipts).toHaveLength(
        2,
      );
      await test.info().attach('actual-case-lock-contention', {
        contentType: 'application/json',
        body: Buffer.from(
          JSON.stringify({
            initial: initialRace.blockedPids,
            revision: revisionRace.blockedPids,
          }),
        ),
      });
    });
  });

  for (const kind of ['feedback', 'supplement'] as const)
    for (const correcting of [false, true])
      test(`${kind} ${correcting ? 'correction' : 'initial'} rolls back every actual write point and permits original-key retry`, async ({
        playwright,
      }) => {
        await scenario(playwright.request, async (s) => {
          const f = await filing(s);
          const phases =
            kind === 'feedback'
              ? (['audit', 'version', 'receipt'] as const)
              : ([
                  'audit',
                  'version',
                  'document',
                  'reference',
                  'receipt',
                ] as const);
          for (const phase of phases) {
            const root = randomUUID();
            const file =
              kind === 'supplement'
                ? await supplementFile(s, f, root)
                : undefined;
            const initial = file
              ? supplement(f, root, file)
              : feedback(f, root);
            if (correcting) await saved(s, f, initial);
            const command = correcting
              ? file
                ? supplement(f, root, file, 1)
                : feedback(f, root, 1)
              : initial;
            if (kind === 'supplement' && correcting)
              command.input.note = '真实补交说明更正';
            const frozen = structuredClone(command.input);
            const before = await executionFilingFollowupSnapshot(f.caseId);
            await withExecutionFilingFollowupFault(
              f.caseId,
              kind,
              phase,
              async () => {
                await body(await post(s, command, frozen), 500);
              },
            );
            expect(await executionFilingFollowupSnapshot(f.caseId)).toEqual(
              before,
            );
            const result = await saved(s, f, command);
            assertFact(
              await executionFilingFollowupSnapshot(f.caseId),
              s,
              f,
              command,
              result,
            );
            expect(await body(await post(s, command, frozen))).toEqual(result);
          }
        });
      });

  test('upload/save are separate, exact consumed versions can be reused, and stale target/revoked upload cannot finalize', async ({
    playwright,
  }) => {
    await scenario(playwright.request, async (s, connect) => {
      const f = await filing(s),
        root = randomUUID(),
        file = await supplementFile(s, f, root);
      expect(
        (await executionFilingFollowupSnapshot(f.caseId)).facts
          .case_execution_filing_supplements,
      ).toEqual([]);
      // Unconsumed target-scoped bytes cannot be laundered into a different root.
      const wrongTarget = supplement(f, randomUUID(), file);
      await body(await post(s, wrongTarget), 400);
      const first = supplement(f, root, file);
      await saved(s, f, first);
      const pending = await draft(s, f, root, 1);
      const correction = supplement(f, root, file, 1);
      correction.input.note = 'same exact committed bytes';
      await saved(s, f, correction);
      await body(await put(s, pending), 409);
      const another = supplement(f, randomUUID(), file);
      await saved(s, f, another);
      const otherCase = await filing(s);
      await body(await post(s, supplement(otherCase, randomUUID(), file)), 400);
      const alternate = await connect(),
        revokedDraft = await draft(alternate, f, randomUUID());
      await revokeExecutionFilingFollowupActor(alternate.actor.userId);
      await body(await put(alternate, revokedDraft), 403);
      const ordinary = await s.request.post('/api/v1/materials/upload-drafts', {
        headers: s.headers,
        data: {
          ownerType: 'CASE',
          ownerId: f.caseId,
          category: 'EXECUTION_SUPPLEMENT',
          purpose: 'EXECUTION_SUPPLEMENT',
          originalFilename: 'bypass.pdf',
          declaredMimeType: 'application/pdf',
        },
      });
      await body(ordinary, 400);
      await body(
        await post(s, first, {
          ...first.input,
          contentVersionIds: [
            file.contentVersionId,
            file.contentVersionId.toUpperCase(),
          ],
          idempotencyKey: randomUUID(),
        }),
        400,
      );
      await body(
        await post(s, first, {
          ...first.input,
          contentVersionIds: Array.from({ length: 11 }, () => randomUUID()),
          idempotencyKey: randomUUID(),
        }),
        400,
      );
    });
  });

  test('dedicated uploads accept PDF/JPG/PNG, reject MIME spoofing and enforce the 50MiB boundary', async ({
    playwright,
  }) => {
    await scenario(playwright.request, async (s) => {
      const f = await filing(s);
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5b8AAAAASUVORK5CYII=',
        'base64',
      );
      const jpg = Buffer.from(
        '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=',
        'base64',
      );
      for (const [mime, bytes] of [
        ['application/pdf', pdf],
        ['image/png', png],
        ['image/jpeg', jpg],
      ] as const) {
        const target = randomUUID(),
          d = await draft(s, f, target, 0, mime);
        const file = await body<File & { mimeType: string }>(
          await put(s, d, bytes),
          200,
        );
        expect(file.mimeType).toBe(mime);
        expect(file.sha256).toBe(
          createHash('sha256').update(bytes).digest('hex'),
        );
        await body(await put(s, d, bytes), 409);
      }
      const spoof = await draft(s, f, randomUUID(), 0, 'image/png');
      await body(await put(s, spoof, pdf), 400);
      // These buffers are allocated only inside this explicitly selected future runner case.
      // Its persisted synthetic-file budget is 50MiB plus the three tiny files above.
      const limit = 50 * 1024 * 1024;
      const exact = Buffer.alloc(limit, 0x20);
      pdf.copy(exact);
      const exactDraft = await draft(s, f, randomUUID());
      const file = await body<File>(await put(s, exactDraft, exact), 200);
      expect(file.sizeBytes).toBe(limit);
      expect(file.sha256).toBe(
        createHash('sha256').update(exact).digest('hex'),
      );
      const excessive = Buffer.alloc(limit + 1, 0x20);
      pdf.copy(excessive);
      const oversizedDraft = await draft(s, f, randomUUID());
      await body(await put(s, oversizedDraft, excessive), 400);
      expect(
        (await executionFilingFollowupSnapshot(f.caseId)).facts
          .case_execution_filing_supplements,
      ).toEqual([]);
    });
  });

  test('ten pending exact files can be consumed together and release pending-pool capacity', async ({
    playwright,
  }) => {
    await scenario(playwright.request, async (s) => {
      const f = await filing(s),
        root = randomUUID();
      const files: File[] = [];
      for (let index = 0; index < 10; index++)
        files.push(await supplementFile(s, f, root));
      const overflow = await s.request.post(
        `${f.prefix}/execution-filings/${f.filingId}/supplements/${root}/upload-drafts`,
        {
          headers: s.headers,
          data: {
            expectedRevision: 0,
            originalFilename: 'overflow.pdf',
            declaredMimeType: 'application/pdf',
          },
        },
      );
      // Both reservation-time and final-consumption quota checks must prevent an eleventh candidate.
      if (overflow.status() === 201)
        await body(await put(s, (await overflow.json()) as Draft), 400);
      else await body(overflow, 400);
      const c = supplement(f, root, files[0]!);
      c.input.contentVersionIds = files.map((file) => file.contentVersionId);
      const result = await saved(s, f, c);
      const snapshot = await executionFilingFollowupSnapshot(f.caseId);
      const docs =
        snapshot.facts.case_execution_filing_supplement_documents!.filter(
          (row) => row.version_id === result.id,
        );
      expect(docs.map((row) => row.content_version_id).sort()).toEqual(
        files.map((file) => file.contentVersionId).sort(),
      );
      const version = snapshot.facts.case_execution_filing_supplements!.find(
        (row) => row.id === result.id,
      )!;
      expect(
        snapshot.facts.references!.filter(
          (row) => row.action_event_id === version.audit_event_id,
        ),
      ).toHaveLength(10);
      await supplementFile(s, f, root, 1);
    });
  });
});
