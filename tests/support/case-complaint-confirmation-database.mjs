import { randomUUID } from 'node:crypto';
import { coreLeadFixtures, getLead } from './core-lead-database.mjs';

const auth = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n');
const jpeg = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46,
]);

async function body(response, status) {
  if (response.status() !== status)
    throw new Error(
      `Source-chain request failed: ${response.status()} ${await response.text()}`,
    );
  return response.json();
}

export async function uploadCaseConfirmationFile(
  request,
  caseId,
  purpose = 'COMPLAINT',
  headers = auth,
) {
  const draft = await body(
    await request.post('/api/v1/materials/upload-drafts', {
      headers,
      data: {
        ownerType: 'CASE',
        ownerId: caseId,
        category: purpose,
        purpose,
        originalFilename: `${purpose}-${randomUUID().slice(0, 6)}.pdf`,
        declaredMimeType: 'application/pdf',
      },
    }),
    201,
  );
  return body(
    await request.put(`/api/v1/materials/upload-drafts/${draft.id}/content`, {
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      data: pdf,
    }),
    200,
  );
}

async function uploadNotary(
  request,
  matterId,
  purpose,
  bytes,
  mime,
  headers = auth,
) {
  const draft = await body(
    await request.post('/api/v1/materials/upload-drafts', {
      headers,
      data: {
        ownerType: 'NOTARY_MATTER',
        ownerId: matterId,
        category: purpose,
        purpose,
        originalFilename: `${purpose}-${randomUUID().slice(0, 6)}.${mime === 'image/jpeg' ? 'jpg' : 'pdf'}`,
        declaredMimeType: mime,
      },
    }),
    201,
  );
  return body(
    await request.put(`/api/v1/materials/upload-drafts/${draft.id}/content`, {
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      data: bytes,
    }),
    200,
  );
}

export async function createSubmittedCaseThroughApi(request) {
  const clientUsername = `ca003-client-${randomUUID().slice(0, 8)}`;
  const clientPassword = 'client correct horse battery';
  await body(
    await request.post(
      `/api/v1/customers/${coreLeadFixtures.admittedCustomer}/client-accounts`,
      {
        headers: auth,
        data: {
          displayName: '诉状确认客户',
          username: clientUsername,
          password: clientPassword,
        },
      },
    ),
    201,
  );
  const clientSession = await body(
    await request.post('/api/v1/auth/login', {
      headers: { Origin: 'http://127.0.0.1:5174' },
      data: { username: clientUsername, password: clientPassword },
    }),
    200,
  );
  const lead = await body(
    await request.post('/api/v1/leads', {
      headers: { ...auth, 'Idempotency-Key': randomUUID() },
      data: {
        customerId: coreLeadFixtures.admittedCustomer,
        rightsHolderId: coreLeadFixtures.holder,
        caseType: 'CIVIL',
        infringementTypes: ['TRADEMARK'],
        source: 'ONLINE',
        platform: 'TAOBAO',
        foundAt: '2026-09-21T02:30:00.000Z',
        shopName: `确认诉状店铺-${randomUUID().slice(0, 8)}`,
        needDisclose: false,
        products: [
          {
            title: '诉状确认商品',
            quantity: 1,
            unitPrice: '1.00',
            commentCount: 0,
          },
        ],
        leadScreenshotContentVersionIds: [],
      },
    }),
    201,
  );
  await body(
    await request.post(`/api/v1/leads/${lead.id}/push`, {
      headers: { ...auth, 'Idempotency-Key': randomUUID() },
      data: { expectedVersion: 1 },
    }),
    201,
  );
  await body(
    await request.post(`/api/v1/client/leads/${lead.id}/reviews`, {
      headers: {
        'X-CSRF-Token': clientSession.csrfToken,
        'Idempotency-Key': randomUUID(),
      },
      data: { result: 'INFRINGEMENT', expectedVersion: 2 },
    }),
    201,
  );
  const office = await body(
    await request.post('/api/v1/notary-offices', {
      headers: auth,
      data: { name: `诉状确认公证处-${randomUUID().slice(0, 8)}` },
    }),
    201,
  );
  const sourceLead = await getLead(lead.id);
  const matter = await body(
    await request.post(`/api/v1/leads/${lead.id}/notary-matters`, {
      headers: { ...auth, 'Idempotency-Key': randomUUID() },
      data: {
        selectedProductIds: [sourceLead.products[0].id],
        selectedContentVersionIds: [],
        notaryOfficeId: office.id,
        evidenceMode: 'ONLINE_PURCHASE',
        batchPurpose: '诉状确认测试',
        expectedVersion: 3,
      },
    }),
    201,
  );
  await body(
    await request.post(`/api/v1/notary-matters/${matter.id}/evidence`, {
      headers: { ...auth, 'Idempotency-Key': randomUUID() },
      data: {
        evidenceAt: '2026-09-24',
        sampleFeeState: 'PENDING',
        logistics: [{ companyState: 'NONE', trackingState: 'NONE' }],
        expectedVersion: 1,
      },
    }),
    201,
  );
  const photo = await uploadNotary(
    request,
    matter.id,
    'NOTARY_OPENING_PHOTO',
    jpeg,
    'image/jpeg',
  );
  await body(
    await request.post(`/api/v1/notary-matters/${matter.id}/opening`, {
      headers: { ...auth, 'Idempotency-Key': randomUUID() },
      data: { expectedVersion: 2, contentVersionIds: [photo.contentVersionId] },
    }),
    201,
  );
  await body(
    await request.post(`/api/v1/notary-matters/${matter.id}/opening-review`, {
      headers: { ...auth, 'Idempotency-Key': randomUUID() },
      data: { result: 'INFRINGEMENT', expectedVersion: 3 },
    }),
    201,
  );
  await body(
    await request.post(
      `/api/v1/notary-matters/${matter.id}/issuance-decision`,
      {
        headers: { ...auth, 'Idempotency-Key': randomUUID() },
        data: { decision: 'ISSUE', expectedVersion: 4 },
      },
    ),
    201,
  );
  const notaryUsername = `ca003-notary-${randomUUID().slice(0, 8)}`;
  const notaryPassword = 'notary correct horse battery';
  await body(
    await request.post(`/api/v1/notary-offices/${office.id}/accounts`, {
      headers: auth,
      data: {
        displayName: '诉状确认公证员',
        username: notaryUsername,
        password: notaryPassword,
      },
    }),
    201,
  );
  const notarySession = await body(
    await request.post('/api/v1/auth/login', {
      headers: { Origin: 'http://127.0.0.1:5174' },
      data: { username: notaryUsername, password: notaryPassword },
    }),
    200,
  );
  const notaryHeaders = { 'X-CSRF-Token': notarySession.csrfToken };
  const certificateFile = await uploadNotary(
    request,
    matter.id,
    'NOTARY_CERTIFICATE',
    pdf,
    'application/pdf',
    notaryHeaders,
  );
  const certificate = await body(
    await request.post(
      `/api/v1/notary-portal/matters/${matter.id}/certificate`,
      {
        headers: { ...notaryHeaders, 'Idempotency-Key': randomUUID() },
        data: {
          expectedVersion: 5,
          certificateNo: `（2026）诉证字${randomUUID().slice(0, 6)}号`,
          certificateDate: '2026-09-28',
          contentVersionIds: [certificateFile.contentVersionId],
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
  const caseId = certificate.case.id;
  const matchKey = randomUUID();
  await body(
    await request.post(`/api/v1/cases/${caseId}/match`, {
      headers: { ...auth, 'Idempotency-Key': matchKey },
      data: {
        expectedVersion: 1,
        idempotencyKey: matchKey,
        matchedOn: '2026-09-28',
        defendants: [{ kind: 'ORGANIZATION', name: '诉状确认被告公司' }],
        lawyer: { fullName: '诉状确认律师' },
      },
    }),
    201,
  );
  const complaint = await uploadCaseConfirmationFile(request, caseId);
  const authorization = await uploadCaseConfirmationFile(
    request,
    caseId,
    'AUTHORIZATION',
  );
  const submitInput = {
    expectedVersion: 2,
    idempotencyKey: randomUUID(),
    amountState: 'KNOWN',
    amount: '123.45',
    pendingReason: null,
    complaintContentVersionIds: [complaint.contentVersionId],
    authorizationContentVersionIds: [authorization.contentVersionId],
  };
  const submitted = await body(
    await request.post(`/api/v1/cases/${caseId}/complaint-submit`, {
      headers: { ...auth, 'Idempotency-Key': submitInput.idempotencyKey },
      data: submitInput,
    }),
    201,
  );
  return {
    caseId,
    complaint,
    authorization,
    submitted,
    submitInput,
    clientSession,
    notarySession,
  };
}
