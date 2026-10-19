import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
  type Route,
} from '@playwright/test';
import {
  createMinimalPageAcceptance,
  createMinimalPageRequestBudget,
  type MinimalPageWindow,
} from '../support/minimal-page-acceptance.mjs';

const pdf = Buffer.from('%PDF-1.7\nEF001 exact synthetic bytes\n%%EOF\n');

function dayShanghai(offset: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const date = new Date(`${parts}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

async function expectStatus(
  response: Awaited<ReturnType<APIRequestContext['post']>>,
  expected: number,
): Promise<Record<string, unknown>> {
  expect(response.status()).toBe(expected);
  return (await response.json()) as Record<string, unknown>;
}

async function uploadProof(
  request: APIRequestContext,
  headers: Record<string, string>,
  caseId: string,
  category: 'MAIL_RECEIPT' | 'EXECUTION_FILING_PROOF',
  budget: ReturnType<typeof createMinimalPageRequestBudget>,
  origin: string,
): Promise<string> {
  const draftBody = {
    ownerType: 'CASE',
    ownerId: caseId,
    category,
    purpose: category,
    originalFilename: `${randomUUID()}.pdf`,
    declaredMimeType: 'application/pdf',
  };
  budget.admit(
    'POST',
    new URL('/api/v1/materials/upload-drafts', origin).href,
    draftBody,
  );
  const draftResponse = await request.post('/api/v1/materials/upload-drafts', {
    headers,
    data: draftBody,
  });
  const draft = await expectStatus(draftResponse, 201);
  expect(typeof draft.id).toBe('string');
  budget.setDraft(String(draft.id));
  budget.admit(
    'PUT',
    new URL(
      `/api/v1/materials/upload-drafts/${String(draft.id)}/content`,
      origin,
    ).href,
    pdf,
  );
  const uploadResponse = await request.put(
    `/api/v1/materials/upload-drafts/${String(draft.id)}/content`,
    {
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      data: pdf,
    },
  );
  const uploaded = await expectStatus(uploadResponse, 200);
  expect(uploaded.sizeBytes).toBe(43);
  expect(uploaded.sha256).toBe(
    'a920a7cdb0a855fa2f00a0991f9fde35c8db481f204e97dec56f07c917ebe29e',
  );
  expect(typeof uploaded.contentVersionId).toBe('string');
  budget.setProof(category, String(uploaded.contentVersionId));
  return String(uploaded.contentVersionId);
}

async function loginThroughUi(
  page: Page,
  username: string,
  password: string,
  onLogin200: () => Promise<void>,
) {
  await page.goto('/cases');
  await expect(page).toHaveURL(/\/login\?returnTo=/u);
  await page.getByLabel('用户名', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  const loginResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/v1/auth/login',
  );
  await page.getByRole('button', { name: '登录', exact: true }).click();
  const loginResponse = await loginResponsePromise;
  expect(loginResponse.status()).toBe(200);
  await onLogin200();
  const sessionView = (await loginResponse.json()) as { csrfToken: string };
  return sessionView.csrfToken;
}

function captureFeedbackRequest(route: Route) {
  const request = route.request();
  return {
    method: request.method(),
    path: new URL(request.url()).pathname,
    rawBody: request.postData(),
    delivery: 'continued' as 'continued' | 'blocked_before_dispatch',
    responseStatus: null as number | null,
  };
}

async function refreshCasesAndFindBusinessNo(
  page: Page,
  businessNo: string,
  expectVisible: (locator: Locator) => Promise<void>,
) {
  const caseLink = page.getByTestId('case-list').getByRole('link', {
    name: businessNo,
    exact: true,
  });
  const refreshedCases = page.waitForRequest(
    (request) =>
      request.method() === 'GET' &&
      new URL(request.url()).pathname === '/api/v1/cases',
  );
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  const request = await refreshedCases;
  const response = await request.response();
  if (!response)
    throw new Error('Refreshing the case list returned no response');
  if (response.status() !== 200)
    throw new Error(`Refreshing the case list returned ${response.status()}`);
  await expectVisible(caseLink);
  return caseLink;
}

function hasMinimalPageWindow(value: unknown): value is MinimalPageWindow {
  return (
    typeof value === 'object' &&
    value !== null &&
    'runId' in value &&
    typeof value.runId === 'string' &&
    'deadlineIso' in value &&
    typeof value.deadlineIso === 'string'
  );
}

test('records and corrects execution court feedback through the real case page', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const metadata: unknown = testInfo.config.metadata;
  if (
    typeof metadata !== 'object' ||
    metadata === null ||
    !('minimalPageWindow' in metadata)
  )
    throw new Error('Missing managed minimal-page deadline metadata');
  const window = metadata.minimalPageWindow;
  if (!hasMinimalPageWindow(window))
    throw new Error('Malformed managed minimal-page deadline metadata');
  const acceptance = createMinimalPageAcceptance('EF_FEEDBACK', {
    window,
  });
  const budget = createMinimalPageRequestBudget('EF_FEEDBACK');
  let loggedIn = false;
  let preparedCaseId: string | undefined;
  let flowCompleted = false;
  let budgetGuardError: string | undefined;
  let completed = false;
  let primaryError: unknown;
  let cleanupError: unknown;
  const feedbackRequests: ReturnType<typeof captureFeedbackRequest>[] = [];

  await page.context().route(
    (url) => url.pathname.startsWith('/api/v1/'),
    async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      const isFeedbackPost =
        request.method() === 'POST' &&
        /^\/api\/v1\/cases\/[^/]+\/execution-filings\/[^/]+\/feedbacks(?:\/[^/]+\/corrections)?$/u.test(
          pathname,
        );
      const captured = isFeedbackPost
        ? captureFeedbackRequest(route)
        : undefined;
      try {
        budget.admit(
          request.method(),
          request.url(),
          request.postData() ?? undefined,
        );
      } catch (cause) {
        budgetGuardError =
          cause instanceof Error ? cause.message : 'request budget rejected';
        if (captured) {
          captured.delivery = 'blocked_before_dispatch';
          feedbackRequests.push(captured);
        }
        await route.abort('blockedbyclient');
        return;
      }
      if (!captured) {
        await route.continue();
        return;
      }
      feedbackRequests.push(captured);
      await route.continue();
    },
  );

  try {
    const prepared = await acceptance.prepare();
    budget.setRunId(prepared.runId, prepared.actor.username);
    await acceptance.beforeLogin();
    let origin = '';
    const csrfToken = await loginThroughUi(
      page,
      prepared.actor.username,
      prepared.actor.password,
      async () => {
        loggedIn = true;
        origin = new URL(page.url()).origin;
        const cookies = await page.context().cookies(origin);
        const sessionCookie = cookies.find(
          (cookie) => cookie.name === 'dev_cor_session',
        );
        if (!sessionCookie)
          throw new Error('UI login returned without the session cookie');
        await acceptance.bindSession(sessionCookie.value);
      },
    );

    expect(origin).toBeTruthy();
    expect(csrfToken).toBeTruthy();
    expect(csrfToken).toBeTruthy();
    await expect(page).toHaveURL(/\/cases$/u);
    await expect(
      page.getByRole('button', { name: '退出登录', exact: true }),
    ).toBeVisible();

    // The page context's request client shares the UI login cookies. All source
    // setup is ordinary authenticated HTTP and uses the same CSRF token.
    const request = page.context().request;
    const headers = { Origin: origin, 'X-CSRF-Token': csrfToken };
    const source = `minimal-page:${prepared.runId}:${prepared.actor.userId}`;
    const externalEntryBody = {
      idempotencyKey: randomUUID(),
      entryKind: 'HISTORICAL_BACKFILL',
      initialStage: 'WAITING_EXECUTION_STAMP',
      stageReachedOn: dayShanghai(-6),
      source,
      reason: '独立EF页面验收来源',
      customerId: prepared.fixture.customerId,
      rightsHolderId: prepared.fixture.rightsHolderId,
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
    };
    budget.admit(
      'POST',
      new URL('/api/v1/cases/external-entries', origin).href,
      externalEntryBody,
    );
    const createdResponse = await request.post(
      '/api/v1/cases/external-entries',
      {
        headers,
        data: externalEntryBody,
      },
    );
    const created = await expectStatus(createdResponse, 201);
    expect(typeof created.id).toBe('string');
    expect(typeof created.version).toBe('number');
    preparedCaseId = String(created.id);
    budget.setCase(preparedCaseId);
    await acceptance.registerCase(preparedCaseId);
    budget.admit(
      'GET',
      new URL(`/api/v1/cases/${preparedCaseId}`, origin).href,
    );
    const createdDetailResponse = await request.get(
      `/api/v1/cases/${preparedCaseId}`,
    );
    expect(createdDetailResponse.status()).toBe(200);
    const createdDetail = (await createdDetailResponse.json()) as {
      businessNo: string;
      stage: string;
      version: number;
    };
    expect(createdDetail.stage).toBe('WAITING_EXECUTION_STAMP');
    expect(createdDetail.version).toBe(created.version);
    expect(createdDetail.businessNo).toBeTruthy();

    const mailProofId = await uploadProof(
      request,
      headers,
      preparedCaseId,
      'MAIL_RECEIPT',
      budget,
      origin,
    );
    const mailPath = `/api/v1/cases/${preparedCaseId}/execution-mail`;
    const mailBody = {
      expectedVersion: created.version,
      idempotencyKey: randomUUID(),
      expectedConfirmationId: null,
      mailedAt: dayShanghai(-5),
      mailReceiptContentVersionIds: [mailProofId],
    };
    budget.admit('POST', new URL(mailPath, origin).href, mailBody);
    const mailedResponse = await request.post(mailPath, {
      headers,
      data: mailBody,
    });
    const mailed = await expectStatus(mailedResponse, 201);
    expect(typeof mailed.mailingId).toBe('string');
    expect(typeof mailed.version).toBe('number');
    budget.setMailing(String(mailed.mailingId));

    const filingProofId = await uploadProof(
      request,
      headers,
      preparedCaseId,
      'EXECUTION_FILING_PROOF',
      budget,
      origin,
    );
    const filingPath = `/api/v1/cases/${preparedCaseId}/execution-filing-submit`;
    const filingBody = {
      expectedVersion: mailed.version,
      idempotencyKey: randomUUID(),
      expectedMailingId: mailed.mailingId,
      submittedAt: dayShanghai(-4),
      executionFilingProofContentVersionIds: [filingProofId],
    };
    budget.admit('POST', new URL(filingPath, origin).href, filingBody);
    const filedResponse = await request.post(filingPath, {
      headers,
      data: filingBody,
    });
    const filed = await expectStatus(filedResponse, 201);
    expect(typeof filed.filingId).toBe('string');
    expect(filed.version).toBe(3);
    budget.setFiling(String(filed.filingId));

    const caseLink = await refreshCasesAndFindBusinessNo(
      page,
      createdDetail.businessNo,
      (link) => expect(link).toBeVisible(),
    );
    await caseLink.click();

    const panel = page.getByTestId('execution-filing-followup-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId('followup-feedback-date')).toHaveValue('');
    await expect(panel.getByTestId('followup-court-no')).toHaveValue('');
    const firstContent = `合成执行反馈初始记录 ${prepared.runId}`;
    await panel.getByTestId('followup-content').fill(firstContent);
    const firstWriteResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        /\/feedbacks$/u.test(new URL(response.url()).pathname),
    );
    await panel.getByTestId('followup-submit').click();
    const firstResponse = await firstWriteResponse;
    const firstCaptured = feedbackRequests.find(
      (entry) =>
        entry.delivery === 'continued' &&
        entry.path === new URL(firstResponse.url()).pathname &&
        entry.rawBody === firstResponse.request().postData(),
    );
    expect(firstCaptured).toBeDefined();
    firstCaptured!.responseStatus = firstResponse.status();
    expect(firstResponse.status()).toBe(201);
    const firstResult = (await firstResponse.json()) as {
      feedbackId: string;
      revision: number;
    };
    expect(firstResult.revision).toBe(1);
    budget.setFeedbackRoot(firstResult.feedbackId);
    await expect(panel.getByText(firstContent, { exact: true })).toBeVisible();

    budget.admit(
      'GET',
      new URL(`/api/v1/cases/${preparedCaseId}`, origin).href,
    );
    const afterFirstResponse = await request.get(
      `/api/v1/cases/${preparedCaseId}`,
    );
    expect(afterFirstResponse.status()).toBe(200);
    const afterFirst = (await afterFirstResponse.json()) as {
      executionFilingFollowups: {
        filingId: string;
        feedbacks: Array<{ feedbackId: string; current: { revision: number } }>;
      };
    };
    expect(afterFirst.executionFilingFollowups.filingId).toBe(filed.filingId);
    expect(afterFirst.executionFilingFollowups.feedbacks).toEqual([
      expect.objectContaining({
        feedbackId: firstResult.feedbackId,
        current: expect.objectContaining({ revision: 1 }),
      }),
    ]);

    await panel
      .getByRole('button', { name: '更正这条反馈', exact: true })
      .click();
    const secondContent = `合成执行反馈更正记录 ${prepared.runId}`;
    const correctionReason = '补充核对后的反馈内容';
    await panel.getByTestId('followup-content').fill(secondContent);
    await panel.getByTestId('followup-reason').fill(correctionReason);
    const correctionResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        /\/feedbacks\/[^/]+\/corrections$/u.test(
          new URL(response.url()).pathname,
        ),
    );
    await panel.getByTestId('followup-submit').click();
    const correctionResponse = await correctionResponsePromise;
    const correctionCaptured = feedbackRequests.find(
      (entry) =>
        entry.delivery === 'continued' &&
        entry.path === new URL(correctionResponse.url()).pathname &&
        entry.rawBody === correctionResponse.request().postData(),
    );
    expect(correctionCaptured).toBeDefined();
    correctionCaptured!.responseStatus = correctionResponse.status();
    expect(correctionResponse.status()).toBe(201);
    const corrected = (await correctionResponse.json()) as {
      feedbackId: string;
      revision: number;
    };
    expect(corrected.feedbackId).toBe(firstResult.feedbackId);
    expect(corrected.revision).toBe(2);
    await expect(panel.getByText(secondContent, { exact: true })).toBeVisible();

    const history = panel.locator('details').filter({
      has: page.getByText(/查看登记与更正历史/u),
    });
    await history.locator('summary').click();
    await expect(
      history.getByText(correctionReason, { exact: false }),
    ).toBeVisible();

    await acceptance.verifyEfResult(
      preparedCaseId,
      firstResult.feedbackId,
      String(filed.filingId),
    );

    await page.reload();
    const refreshedPanel = page.getByTestId('execution-filing-followup-panel');
    await expect(
      refreshedPanel.getByText(secondContent, { exact: true }),
    ).toBeVisible();
    const refreshedHistory = refreshedPanel.locator('details').filter({
      has: page.getByText(/查看登记与更正历史/u),
    });
    await refreshedHistory.locator('summary').click();
    await expect(refreshedHistory.getByText(/第\s*1\s*版/u)).toBeVisible();
    await expect(refreshedHistory.getByText(/第\s*2\s*版/u)).toBeVisible();
    await expect(
      refreshedHistory.getByText(correctionReason, { exact: false }),
    ).toBeVisible();
    expect(budgetGuardError).toBeUndefined();
    flowCompleted = true;
    completed = true;
  } catch (cause) {
    primaryError = cause;
  } finally {
    try {
      const closed = await acceptance.closeSession(async () => {
        if (!loggedIn) return;
        const logout = page.getByRole('button', {
          name: '退出登录',
          exact: true,
        });
        if (!(await logout.isVisible().catch(() => false)))
          throw new Error('UI logout button is unavailable');
        const logoutResponse = page.waitForResponse(
          (response) =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname === '/api/v1/auth/logout',
        );
        await logout.click();
        expect((await logoutResponse).status()).toBe(204);
        await expect(page).toHaveURL(/\/login$/u);
        await expect(page.getByLabel('用户名', { exact: true })).toBeVisible();
      });
      if (flowCompleted) {
        expect(closed.revoked).toBe(true);
        expect(closed.fallback).toBe(false);
        expect(closed.logoutSucceeded).toBe(true);
        budget.assertComplete();
      }
    } catch (cause) {
      cleanupError = cause;
    }
    if (!completed || cleanupError !== undefined) {
      try {
        await testInfo.attach('execution-feedback-write-requests.json', {
          contentType: 'application/json',
          body: Buffer.from(
            JSON.stringify({
              counts: budget.counts(),
              budgetGuardError,
              requests: feedbackRequests,
            }),
          ),
        });
      } catch (cause) {
        cleanupError ??= cause;
      }
    }
    try {
      await acceptance.dispose();
    } catch (cause) {
      cleanupError ??= cause;
    }
  }
  if (primaryError !== undefined && cleanupError !== undefined)
    throw new AggregateError(
      [primaryError, cleanupError],
      'EF page flow and session cleanup both failed',
    );
  if (primaryError !== undefined) throw primaryError;
  if (cleanupError !== undefined) throw cleanupError;
});
