import {
  expect,
  test,
  type Locator,
  type Page,
  type Route,
} from '@playwright/test';
import {
  createMinimalPageAcceptance,
  createPreservedEfRequestBudget,
  preservedEfCheckpoint,
  type MinimalPageWindow,
} from '../support/minimal-page-acceptance.mjs';

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
    mode: 'PRESERVED_EF_CHECKPOINT',
  });
  let budget: ReturnType<typeof createPreservedEfRequestBudget> | undefined;
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
        if (!budget) throw new Error('Preserved EF budget is not prepared');
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
    budget = createPreservedEfRequestBudget(
      prepared.runId,
      prepared.actor.username,
    );
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
    const request = page.context().request;
    await expect(page).toHaveURL(/\/cases$/u);
    await expect(
      page.getByRole('button', { name: '退出登录', exact: true }),
    ).toBeVisible();

    preparedCaseId = preservedEfCheckpoint.caseId;
    budget.admit(
      'GET',
      new URL(`/api/v1/cases/${preparedCaseId}`, origin).href,
    );
    const checkpointResponse = await request.get(
      `/api/v1/cases/${preparedCaseId}`,
    );
    expect(checkpointResponse.status()).toBe(200);
    const createdDetail = (await checkpointResponse.json()) as {
      id: string;
      businessNo: string;
      stage: string;
      version: number;
    };
    expect(createdDetail.id).toBe(preparedCaseId);
    expect(createdDetail.businessNo).toBe(preservedEfCheckpoint.businessNo);
    expect(createdDetail.stage).toBe('EXECUTING');
    expect(createdDetail.version).toBe(3);

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
    expect(afterFirst.executionFilingFollowups.filingId).toBe(
      preservedEfCheckpoint.filingId,
    );
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
      preservedEfCheckpoint.filingId,
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
        budget?.assertComplete();
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
              priorConsumed: budget?.priorConsumed,
              counts: budget?.counts(),
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
