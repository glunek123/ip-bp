import { randomUUID } from 'node:crypto';
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
} from '@playwright/test';
import {
  disconnectCustomerTestDatabase,
  setCustomerDocumentBaseReadScope,
  setCustomerDocumentGrant,
  setCustomerDocumentTestState,
} from '../support/customer-database.mjs';
import {
  coreLeadFixtures,
  disconnectCoreLeadTestDatabase,
  resetCoreLeadE2eData,
} from '../support/core-lead-database.mjs';
import { createSubmittedCaseThroughApi } from '../support/case-complaint-confirmation-database.mjs';
import { createLawyerAccountThroughApi } from '../support/case-lawyer-account.mjs';
import {
  clearCaseFilingFixture,
  prepareCaseFilingFixture,
} from '../support/case-filing-database.mjs';
import { clearCaseComplaintMailingFixture } from '../support/case-complaint-mailing-database.mjs';
import {
  clearCaseAcceptanceFixture,
  prepareCaseAcceptanceFixture,
} from '../support/case-acceptance-database.mjs';
import {
  calendarCaseSourceIds,
  disconnectCalendarSourcesDatabase,
  probeSecondCalendarSource,
  replaceCalendarPrimaryLawyer,
  setCalendarCaseReadGrant,
  setCalendarUserActive,
} from '../support/calendar-sources-database.mjs';

const operator = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };
const self = { Authorization: `Bearer ${coreLeadFixtures.tokenSelf}` };
const pdf = Buffer.from('%PDF-1.4\ncalendar source acceptance\n%%EOF\n');

type Metric = {
  state: string;
  count: number | null;
  nearestDate: string | null;
};
type Event = {
  eventKey: string;
  sourceType: string;
  sourceId: string;
  date: string;
  type: string;
  caseId: string | null;
  customerId: string | null;
  courtDetails: { place: string | null; judge: string | null } | null;
  caseDetails: unknown;
};
type Summary = {
  today: string;
  timeZone: string;
  window: { from: string; through: string };
  metrics: Record<'next30' | 'court' | 'contract' | 'pay' | 'other', Metric>;
};
type Snapshot = Summary & { month: string; events: Event[] };

function day(offset = 0): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) =>
    parts.find((entry) => entry.type === type)!.value;
  const current = new Date(
    `${part('year')}-${part('month')}-${part('day')}T00:00:00Z`,
  );
  current.setUTCDate(current.getUTCDate() + offset);
  return current.toISOString().slice(0, 10);
}

async function status(
  response: { status(): number; text(): Promise<string> },
  expected: number,
) {
  expect(response.status(), await response.text()).toBe(expected);
}

async function upload(
  request: APIRequestContext,
  ownerType: 'CASE' | 'CUSTOMER',
  ownerId: string,
  category:
    | 'MAIL_RECEIPT'
    | 'FILING_EVIDENCE'
    | 'ACCEPTANCE_NOTICE'
    | 'CUSTOMER_AGREEMENT',
  headers = operator,
): Promise<string> {
  const draft = await request.post('/api/v1/materials/upload-drafts', {
    headers,
    data: {
      ownerType,
      ownerId,
      category,
      purpose: category,
      originalFilename: `${category}-${randomUUID()}.pdf`,
      declaredMimeType: 'application/pdf',
    },
  });
  await status(draft, 201);
  const { id } = (await draft.json()) as { id: string };
  const done = await request.put(
    `/api/v1/materials/upload-drafts/${id}/content`,
    {
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      data: pdf,
    },
  );
  await status(done, 200);
  return ((await done.json()) as { contentVersionId: string }).contentVersionId;
}

async function login(
  request: APIRequestContext,
  username: string,
  password: string,
) {
  const response = await request.post('/api/v1/auth/login', {
    headers: { Origin: 'http://127.0.0.1:5174' },
    data: { username, password },
  });
  await status(response, 200);
  return {
    Origin: 'http://127.0.0.1:5174',
    'X-CSRF-Token': ((await response.json()) as { csrfToken: string })
      .csrfToken,
  };
}

async function snapshot(
  request: APIRequestContext,
  month: string,
  headers: Record<string, string> = operator,
): Promise<Snapshot> {
  const response = await request.get(`/api/v1/calendar?month=${month}`, {
    headers,
  });
  await status(response, 200);
  return response.json() as Promise<Snapshot>;
}

async function summary(
  request: APIRequestContext,
  headers: Record<string, string> = operator,
): Promise<Summary> {
  const response = await request.get('/api/v1/calendar/summary', { headers });
  await status(response, 200);
  return response.json() as Promise<Summary>;
}

function assertStableCalendar(view: Snapshot) {
  expect(view.timeZone).toBe('Asia/Shanghai');
  expect(view.window.from).toBe(view.today);
  expect(view.window.through).toBe(day(30));
  expect(view.events).toEqual(
    [...view.events].sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.eventKey.localeCompare(b.eventKey),
    ),
  );
  expect(new Set(view.events.map((event) => event.eventKey)).size).toBe(
    view.events.length,
  );
  expect(
    view.events.every((event) => event.date.startsWith(`${view.month}-`)),
  ).toBe(true);
  for (const name of ['pay', 'other'] as const)
    expect(view.metrics[name]).toEqual({
      state: 'NOT_CONNECTED',
      count: null,
      nearestDate: null,
    });
}

test.beforeEach(async () => {
  await clearCaseAcceptanceFixture();
  await clearCaseFilingFixture();
  await clearCaseComplaintMailingFixture();
  await resetCoreLeadE2eData();
  await prepareCaseFilingFixture();
  await prepareCaseAcceptanceFixture();
});
test.afterEach(async () => {
  await clearCaseAcceptanceFixture();
  await clearCaseFilingFixture();
  await clearCaseComplaintMailingFixture();
  await resetCoreLeadE2eData();
});
test.afterAll(async () => {
  await disconnectCalendarSourcesDatabase();
  await disconnectCustomerTestDatabase();
  await disconnectCoreLeadTestDatabase();
});

test('calendar current first-instance source uses a complete case workflow and live case authorization', async ({
  request,
}) => {
  test.setTimeout(300_000);
  const source = await createSubmittedCaseThroughApi(request);
  const caseId = source.caseId;
  const before = await snapshot(request, day().slice(0, 7));
  expect(before.events.some((event) => event.caseId === caseId)).toBe(false);
  await status(
    await request.post(`/api/v1/cases/${caseId}/complaint-confirm`, {
      headers: operator,
      data: {
        expectedVersion: 3,
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
  const mailReceipt = await upload(request, 'CASE', caseId, 'MAIL_RECEIPT');
  await status(
    await request.post(`/api/v1/cases/${caseId}/complaint-mail`, {
      headers: operator,
      data: {
        expectedVersion: 4,
        idempotencyKey: randomUUID(),
        mailedAt: day(-2),
        mailReceiptContentVersionIds: [mailReceipt],
      },
    }),
    201,
  );
  const courtResponse = await request.post(
    `/api/v1/cases/${caseId}/filing-courts`,
    {
      headers: operator,
      data: { name: `Calendar court ${randomUUID()}` },
    },
  );
  await status(courtResponse, 201);
  const evidence = await upload(request, 'CASE', caseId, 'FILING_EVIDENCE');
  await status(
    await request.post(`/api/v1/cases/${caseId}/filing-submit`, {
      headers: operator,
      data: {
        expectedVersion: 5,
        idempotencyKey: randomUUID(),
        courtId: ((await courtResponse.json()) as { id: string }).id,
        submittedAt: day(-2),
        filingEvidenceContentVersionIds: [evidence],
      },
    }),
    201,
  );
  const notice = await upload(request, 'CASE', caseId, 'ACCEPTANCE_NOTICE');
  const detail = await request.get(`/api/v1/cases/${caseId}`, {
    headers: operator,
  });
  await status(detail, 200);
  await status(
    await request.post(`/api/v1/cases/${caseId}/acceptance-register`, {
      headers: operator,
      data: {
        expectedVersion: ((await detail.json()) as { version: number }).version,
        idempotencyKey: randomUUID(),
        acceptedAt: day(-1),
        courtCaseNo: `Calendar-${randomUUID().slice(0, 8)}`,
        acceptanceNoticeContentVersionIds: [notice],
      },
    }),
    201,
  );

  const lawyer = await playwrightRequest.newContext({
    baseURL: 'http://127.0.0.1:5174',
  });
  const client = await playwrightRequest.newContext({
    baseURL: 'http://127.0.0.1:5174',
  });
  const foreignClient = await playwrightRequest.newContext({
    baseURL: 'http://127.0.0.1:5174',
  });
  const replacementLawyer = await playwrightRequest.newContext({
    baseURL: 'http://127.0.0.1:5174',
  });
  const notary = await playwrightRequest.newContext({
    baseURL: 'http://127.0.0.1:5174',
  });
  try {
    const lawyerHeaders = await login(
      lawyer,
      source.lawyer.username,
      source.lawyer.password,
    );
    const clientHeaders = await login(
      client,
      source.clientSession.user.username,
      'client correct horse battery',
    );
    const lawyerDetail = await lawyer.get(`/api/v1/lawyer/cases/${caseId}`);
    await status(lawyerDetail, 200);
    const hearingDate = day(2);
    await status(
      await lawyer.post(`/api/v1/lawyer/cases/${caseId}/hearing-schedule`, {
        headers: lawyerHeaders,
        data: {
          expectedVersion: ((await lawyerDetail.json()) as { version: number })
            .version,
          idempotencyKey: randomUUID(),
          hearingAt: hearingDate,
        },
      }),
      201,
    );
    const ids = await calendarCaseSourceIds(caseId);
    expect(ids.first).toBeTruthy();
    const month = hearingDate.slice(0, 7);
    const internal = await snapshot(request, month);
    assertStableCalendar(internal);
    const event = internal.events.find((item) => item.sourceId === ids.first);
    expect(event).toMatchObject({
      eventKey: `FIRST_INSTANCE_HEARING:${ids.first}`,
      sourceType: 'FIRST_INSTANCE_HEARING',
      date: hearingDate,
      type: 'court',
      caseId,
      customerId: null,
      caseDetails: null,
    });
    expect(internal.metrics.court.count).toBeGreaterThanOrEqual(1);
    expect(internal.metrics.next30.count).toBeGreaterThanOrEqual(1);
    expect((await summary(request)).metrics).toEqual(internal.metrics);
    const lawyerView = await snapshot(lawyer, month, lawyerHeaders);
    expect(
      lawyerView.events.find((item) => item.sourceId === ids.first)?.caseId,
    ).toBe(caseId);
    expect(lawyerView.metrics.contract).toEqual({
      state: 'FORBIDDEN',
      count: null,
      nearestDate: null,
    });
    const clientView = await snapshot(client, month, clientHeaders);
    expect(
      clientView.events.find((item) => item.sourceId === ids.first),
    ).toMatchObject({
      caseId,
      customerId: null,
      courtDetails: { place: null, judge: null },
    });
    expect(clientView.metrics.contract.state).toBe('FORBIDDEN');
    expect(JSON.stringify(clientView)).not.toContain('Calendar agreement');

    const foreignUsername = `calendar-other-${randomUUID().slice(0, 8)}`;
    const foreignPassword = `Calendar-other-${randomUUID()}`;
    await status(
      await request.post(
        `/api/v1/customers/${coreLeadFixtures.selfCustomer}/client-accounts`,
        {
          headers: operator,
          data: {
            displayName: '其他企业日历用户',
            username: foreignUsername,
            password: foreignPassword,
          },
        },
      ),
      201,
    );
    const foreignHeaders = await login(
      foreignClient,
      foreignUsername,
      foreignPassword,
    );
    const foreignView = await snapshot(foreignClient, month, foreignHeaders);
    expect(foreignView.events.some((item) => item.caseId === caseId)).toBe(
      false,
    );
    expect(foreignView.metrics.court).toEqual({
      state: 'AVAILABLE',
      count: 0,
      nearestDate: null,
    });
    const notaryHeaders = await login(
      notary,
      source.notarySession.user.username,
      'notary correct horse battery',
    );
    await status(
      await notary.get(`/api/v1/calendar?month=${month}`, {
        headers: notaryHeaders,
      }),
      403,
    );
    await status(
      await notary.get('/api/v1/calendar/summary', { headers: notaryHeaders }),
      403,
    );

    const newLawyer = await createLawyerAccountThroughApi(request);
    await replaceCalendarPrimaryLawyer(caseId, source.lawyer.id, newLawyer.id);
    const oldLawyerView = await snapshot(lawyer, month, lawyerHeaders);
    expect(oldLawyerView.events.some((item) => item.caseId === caseId)).toBe(
      false,
    );
    expect(oldLawyerView.metrics.court).toEqual({
      state: 'AVAILABLE',
      count: 0,
      nearestDate: null,
    });
    const newLawyerHeaders = await login(
      replacementLawyer,
      newLawyer.username,
      newLawyer.password,
    );
    expect(
      (await snapshot(replacementLawyer, month, newLawyerHeaders)).events.some(
        (item) => item.caseId === caseId,
      ),
    ).toBe(true);

    await setCalendarCaseReadGrant(false);
    await status(
      await request.get(`/api/v1/calendar?month=${month}`, {
        headers: operator,
      }),
      403,
    );
    await status(
      await request.get('/api/v1/calendar/summary', { headers: operator }),
      403,
    );
    await setCalendarCaseReadGrant(true);
    expect(
      (await snapshot(request, month)).events.find(
        (item) => item.sourceId === ids.first,
      ),
    ).toBeTruthy();
    await setCalendarUserActive(coreLeadFixtures.userA, false);
    expect([401, 403]).toContain(
      (
        await request.get(`/api/v1/calendar?month=${month}`, {
          headers: operator,
        })
      ).status(),
    );
  } finally {
    await lawyer.dispose();
    await client.dispose();
    await foreignClient.dispose();
    await replacementLawyer.dispose();
    await notary.dispose();
  }
});

test('calendar agreement expiry is current FIXED version and respects intersected customer scopes', async ({
  request,
}) => {
  test.setTimeout(120_000);
  await setCustomerDocumentGrant(
    coreLeadFixtures.roleA,
    'CUSTOMER_AGREEMENT_READ',
    true,
    'DEPARTMENT',
  );
  await setCustomerDocumentGrant(
    coreLeadFixtures.roleA,
    'CUSTOMER_AGREEMENT_EDIT',
    true,
    'DEPARTMENT',
  );
  const customerId = coreLeadFixtures.admittedCustomer;
  const material = await upload(
    request,
    'CUSTOMER',
    customerId,
    'CUSTOMER_AGREEMENT',
  );
  const originalDate = day(4);
  const customerDetail = await request.get(`/api/v1/customers/${customerId}`, {
    headers: operator,
  });
  await status(customerDetail, 200);
  const customerVersion = ((await customerDetail.json()) as { version: number })
    .version;
  const create = await request.post(
    `/api/v1/customers/${customerId}/agreements`,
    {
      headers: { ...operator, 'Idempotency-Key': randomUUID() },
      data: {
        expectedCustomerVersion: customerVersion,
        title: 'Calendar agreement',
        validityMode: 'FIXED',
        effectiveTo: originalDate,
        contentVersionIds: [material],
      },
    },
  );
  await status(create, 201);
  const created = (await create.json()) as {
    customerVersion: number;
    agreement: { id: string; version: number; currentVersion: { id: string } };
  };
  const month = originalDate.slice(0, 7);
  const initial = await snapshot(request, month);
  assertStableCalendar(initial);
  expect(initial.events).toContainEqual(
    expect.objectContaining({
      eventKey: `CUSTOMER_AGREEMENT_EXPIRY:${created.agreement.currentVersion.id}`,
      sourceId: created.agreement.currentVersion.id,
      sourceType: 'CUSTOMER_AGREEMENT_EXPIRY',
      date: originalDate,
      type: 'contract',
      customerId,
      caseId: null,
      courtDetails: null,
      caseDetails: null,
    }),
  );
  expect(initial.metrics.contract.count).toBe(1);
  expect(initial.metrics.next30.count).toBe(1);
  const nextMonth = day(35).slice(0, 7);
  expect((await snapshot(request, nextMonth)).metrics).toEqual(initial.metrics);

  await setCustomerDocumentBaseReadScope('TEAM');
  await setCustomerDocumentTestState(customerId, {
    teamId: coreLeadFixtures.teamSelf,
  });
  const outOfIntersection = await snapshot(request, month);
  expect(outOfIntersection.metrics.contract).toEqual({
    state: 'AVAILABLE',
    count: 0,
    nearestDate: null,
  });
  expect(
    outOfIntersection.events.some((event) => event.customerId === customerId),
  ).toBe(false);
  await setCustomerDocumentBaseReadScope('DEPARTMENT');
  expect((await snapshot(request, month)).metrics.contract.count).toBe(1);
  await setCustomerDocumentGrant(
    coreLeadFixtures.roleA,
    'CUSTOMER_AGREEMENT_READ',
    false,
  );
  const forbidden = await snapshot(request, month);
  expect(forbidden.metrics.contract).toEqual({
    state: 'FORBIDDEN',
    count: null,
    nearestDate: null,
  });
  expect(forbidden.metrics.next30.count).toBe(0);
  expect(JSON.stringify(forbidden)).not.toContain(originalDate);
  await setCustomerDocumentGrant(
    coreLeadFixtures.roleA,
    'CUSTOMER_AGREEMENT_READ',
    true,
    'DEPARTMENT',
  );

  const revisedDate = day(6);
  const revision = await request.post(
    `/api/v1/customers/${customerId}/agreements/${created.agreement.id}/revisions`,
    {
      headers: { ...operator, 'Idempotency-Key': randomUUID() },
      data: {
        expectedCustomerVersion: created.customerVersion,
        expectedAgreementVersion: created.agreement.version,
        title: 'Calendar agreement revised',
        validityMode: 'FIXED',
        effectiveTo: revisedDate,
        contentVersionIds: [],
      },
    },
  );
  await status(revision, 200);
  const revised = (await revision.json()) as {
    customerVersion: number;
    agreement: { currentVersion: { id: string }; version: number };
  };
  const current = await snapshot(request, revisedDate.slice(0, 7));
  expect(
    current.events.filter((event) => event.customerId === customerId),
  ).toEqual([
    expect.objectContaining({
      sourceId: revised.agreement.currentVersion.id,
      date: revisedDate,
    }),
  ]);
  expect(
    current.events.some(
      (event) => event.sourceId === created.agreement.currentVersion.id,
    ),
  ).toBe(false);
  const cleared = await request.post(
    `/api/v1/customers/${customerId}/agreements/${created.agreement.id}/revisions`,
    {
      headers: { ...operator, 'Idempotency-Key': randomUUID() },
      data: {
        expectedCustomerVersion: revised.customerVersion,
        expectedAgreementVersion: revised.agreement.version,
        title: 'Calendar agreement indefinite',
        validityMode: 'LONG_TERM',
        effectiveTo: null,
        contentVersionIds: [],
      },
    },
  );
  await status(cleared, 200);
  const noExpiry = await snapshot(request, revisedDate.slice(0, 7));
  expect(noExpiry.events.some((event) => event.customerId === customerId)).toBe(
    false,
  );
  expect(noExpiry.metrics.contract).toEqual({
    state: 'AVAILABLE',
    count: 0,
    nearestDate: null,
  });
  for (const url of [
    '/api/v1/calendar',
    '/api/v1/calendar?month=2026-13',
    '/api/v1/calendar?month=2026-02&extra=1',
    '/api/v1/calendar/summary?extra=1',
  ])
    await status(await request.get(url, { headers: operator }), 400);
  expect((await snapshot(request, month, self)).metrics.contract.state).toBe(
    'FORBIDDEN',
  );
});

test('calendar second-instance source follows the current real progress after correction', async ({
  request,
}) => {
  test.setTimeout(180_000);
  const firstDate = day(3);
  const revisedDate = day(5);
  const result = await probeSecondCalendarSource(
    request,
    firstDate,
    revisedDate,
  );
  const before = result.before as Snapshot;
  const first = result.firstView as Snapshot;
  const current = result.currentView as Snapshot;
  const sourceEvents = (view: Snapshot) =>
    view.events.filter((event) => event.caseId === result.caseId);
  expect(
    sourceEvents(before).some(
      (event) => event.sourceType === 'SECOND_INSTANCE_HEARING',
    ),
  ).toBe(false);
  assertStableCalendar(first);
  expect(sourceEvents(first)).toContainEqual(
    expect.objectContaining({
      eventKey: `SECOND_INSTANCE_HEARING:${result.firstProgressId}`,
      sourceId: result.firstProgressId,
      sourceType: 'SECOND_INSTANCE_HEARING',
      date: firstDate,
      caseId: result.caseId,
      customerId: null,
      courtDetails: expect.objectContaining({
        place: '第二审第一法庭',
        judge: '测试法官',
      }),
    }),
  );
  assertStableCalendar(current);
  expect(
    sourceEvents(current).filter(
      (event) => event.sourceType === 'SECOND_INSTANCE_HEARING',
    ),
  ).toEqual([
    expect.objectContaining({
      eventKey: `SECOND_INSTANCE_HEARING:${result.currentProgressId}`,
      sourceId: result.currentProgressId,
      date: revisedDate,
    }),
  ]);
  expect(
    sourceEvents(current).some(
      (event) => event.sourceId === result.firstProgressId,
    ),
  ).toBe(false);
  expect((result.summary as Summary).metrics).toEqual(current.metrics);
});
