import { randomUUID } from 'node:crypto';
import { coreLeadFixtures } from './core-lead-database.mjs';
import { createSubmittedCaseThroughApi } from './case-complaint-confirmation-database.mjs';

const origin = 'http://127.0.0.1:5174';
const internalHeaders = {
  Authorization: `Bearer ${coreLeadFixtures.tokenA}`,
};
const testPdf = Buffer.from(
  '%PDF-1.7\nCA015 synthetic ordinary-source evidence\n%%EOF\n',
);

async function expectStatus(response, expected) {
  if (response.status() !== expected) {
    throw new Error(
      `CA-015 source-chain request failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

async function upload(
  request,
  caseId,
  category,
  label,
  headers = internalHeaders,
) {
  const draft = await expectStatus(
    await request.post('/api/v1/materials/upload-drafts', {
      headers,
      data: {
        ownerType: 'CASE',
        ownerId: caseId,
        category,
        purpose: category,
        originalFilename: `CA015-${label}-${randomUUID().slice(0, 8)}.pdf`,
        declaredMimeType: 'application/pdf',
      },
    }),
    201,
  );
  return expectStatus(
    await request.put(`/api/v1/materials/upload-drafts/${draft.id}/content`, {
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      data: testPdf,
    }),
    200,
  );
}

async function caseDetail(request, caseId) {
  return expectStatus(
    await request.get(`/api/v1/cases/${caseId}`, {
      headers: internalHeaders,
    }),
    200,
  );
}

async function waitForStage(request, caseId, expectedStage) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const detail = await caseDetail(request, caseId);
    if (detail.stage === expectedStage) return detail;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const detail = await caseDetail(request, caseId);
  throw new Error(
    `CA-015 source case did not reach ${expectedStage}; current stage is ${detail.stage}`,
  );
}

function shanghaiToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function pastShanghaiDate() {
  const date = new Date(`${shanghaiToday()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 2);
  return date.toISOString().slice(0, 10);
}

/**
 * Builds a real case through the public, ordinary command APIs until the
 * current execution filing is recorded and the case is EXECUTING.
 */
export async function createCaseExecutionFilingSourceThroughApi(request) {
  const source = await createSubmittedCaseThroughApi(request);
  const caseId = source.caseId;
  const prefix = `/api/v1/cases/${caseId}`;
  const pastDate = pastShanghaiDate();
  const today = shanghaiToday();

  let detail = await caseDetail(request, caseId);
  await expectStatus(
    await request.post(`${prefix}/complaint-confirm`, {
      headers: internalHeaders,
      data: {
        expectedVersion: detail.version,
        idempotencyKey: randomUUID(),
        confirmedComplaintContentVersionId: source.complaint.contentVersionId,
        amountState: 'KNOWN',
        amount: '123.45',
        pendingReason: null,
        confirmDisclose: true,
      },
    }),
    201,
  );

  const complaintReceipt = await upload(
    request,
    caseId,
    'MAIL_RECEIPT',
    'complaint-mail-receipt',
  );
  detail = await caseDetail(request, caseId);
  await expectStatus(
    await request.post(`${prefix}/complaint-mail`, {
      headers: internalHeaders,
      data: {
        expectedVersion: detail.version,
        idempotencyKey: randomUUID(),
        mailedAt: pastDate,
        mailReceiptContentVersionIds: [complaintReceipt.contentVersionId],
      },
    }),
    201,
  );

  const court = await expectStatus(
    await request.post(`${prefix}/filing-courts`, {
      headers: internalHeaders,
      data: { name: `CA015测试法院-${randomUUID().slice(0, 8)}` },
    }),
    201,
  );
  const filingEvidence = await upload(
    request,
    caseId,
    'FILING_EVIDENCE',
    'complaint-filing-evidence',
  );
  detail = await caseDetail(request, caseId);
  await expectStatus(
    await request.post(`${prefix}/filing-submit`, {
      headers: internalHeaders,
      data: {
        expectedVersion: detail.version,
        idempotencyKey: randomUUID(),
        courtId: court.id,
        submittedAt: pastDate,
        filingEvidenceContentVersionIds: [filingEvidence.contentVersionId],
      },
    }),
    201,
  );

  const acceptanceNotice = await upload(
    request,
    caseId,
    'ACCEPTANCE_NOTICE',
    'acceptance-notice',
  );
  detail = await caseDetail(request, caseId);
  await expectStatus(
    await request.post(`${prefix}/acceptance-register`, {
      headers: internalHeaders,
      data: {
        expectedVersion: detail.version,
        idempotencyKey: randomUUID(),
        acceptedAt: pastDate,
        courtCaseNo: `（2026）甲0101民初${randomUUID().slice(0, 6)}号`,
        acceptanceNoticeContentVersionIds: [acceptanceNotice.contentVersionId],
      },
    }),
    201,
  );

  const lawyerLogin = await expectStatus(
    await request.post('/api/v1/auth/login', {
      headers: { Origin: origin },
      data: {
        username: source.lawyer.username,
        password: source.lawyer.password,
      },
    }),
    200,
  );
  const lawyerHeaders = {
    Origin: origin,
    'X-CSRF-Token': lawyerLogin.csrfToken,
  };
  const lawyerDetail = await expectStatus(
    await request.get(`/api/v1/lawyer/cases/${caseId}`),
    200,
  );
  await expectStatus(
    await request.post(`/api/v1/lawyer/cases/${caseId}/hearing-schedule`, {
      headers: lawyerHeaders,
      data: {
        expectedVersion: lawyerDetail.version,
        idempotencyKey: randomUUID(),
        hearingAt: pastDate,
      },
    }),
    201,
  );
  detail = await waitForStage(request, caseId, 'WAITING_JUDGMENT');

  const judgmentFile = await upload(request, caseId, 'JUDGMENT', 'judgment');
  const judgment = await expectStatus(
    await request.post(`${prefix}/judgment-register`, {
      headers: internalHeaders,
      data: {
        expectedVersion: detail.version,
        idempotencyKey: randomUUID(),
        judgmentReceivedAt: pastDate,
        judgmentAmountState: 'PENDING',
        judgmentAmount: null,
        paidLitigationFeeState: 'KNOWN',
        paidLitigationFee: '0.00',
        judgmentContentVersionIds: [judgmentFile.contentVersionId],
      },
    }),
    201,
  );
  detail = await caseDetail(request, caseId);
  await expectStatus(
    await request.post(`${prefix}/judgment-next-step`, {
      headers: internalHeaders,
      data: {
        expectedVersion: detail.version,
        idempotencyKey: randomUUID(),
        judgmentId: judgment.judgmentId,
        next: 'EXECUTION',
        executionReadinessConfirmed: true,
      },
    }),
    201,
  );

  detail = await caseDetail(request, caseId);
  const executionApplication = await upload(
    request,
    caseId,
    'EXECUTION_APPLICATION',
    'execution-application',
  );
  const submission = await expectStatus(
    await request.post(`${prefix}/execution-submit`, {
      headers: internalHeaders,
      data: {
        expectedVersion: detail.version,
        idempotencyKey: randomUUID(),
        trialRoundId: detail.judgmentNextStep.current.trialRoundId,
        judgmentNextStepId: detail.judgmentNextStep.current.id,
        secondInstanceResultId: detail.secondInstance.currentResult?.id ?? null,
        expectedSubmissionId: null,
        executionApplicationContentVersionIds: [
          executionApplication.contentVersionId,
        ],
      },
    }),
    201,
  );
  const confirmation = await expectStatus(
    await request.post(`${prefix}/execution-confirm`, {
      headers: internalHeaders,
      data: {
        expectedVersion: submission.version,
        idempotencyKey: randomUUID(),
        expectedSubmissionId: submission.submissionId,
      },
    }),
    201,
  );

  const executionReceipt = await upload(
    request,
    caseId,
    'MAIL_RECEIPT',
    'execution-mail-receipt',
  );
  const mailing = await expectStatus(
    await request.post(`${prefix}/execution-mail`, {
      headers: internalHeaders,
      data: {
        expectedVersion: confirmation.version,
        idempotencyKey: randomUUID(),
        expectedConfirmationId: confirmation.confirmationId,
        mailedAt: today,
        mailReceiptContentVersionIds: [executionReceipt.contentVersionId],
      },
    }),
    201,
  );
  const executionFilingProof = await upload(
    request,
    caseId,
    'EXECUTION_FILING_PROOF',
    'execution-filing-proof',
  );
  await expectStatus(
    await request.post(`${prefix}/execution-filing-submit`, {
      headers: internalHeaders,
      data: {
        expectedVersion: mailing.version,
        idempotencyKey: randomUUID(),
        expectedMailingId: mailing.mailingId,
        submittedAt: today,
        executionFilingProofContentVersionIds: [
          executionFilingProof.contentVersionId,
        ],
      },
    }),
    201,
  );

  detail = await caseDetail(request, caseId);
  if (detail.stage !== 'EXECUTING' || !detail.executionFiling) {
    throw new Error(
      'CA-015 ordinary source chain did not reach a filed execution',
    );
  }
  return {
    caseId,
    client: source.client,
    lawyer: source.lawyer,
    source,
    stage: detail.stage,
  };
}
