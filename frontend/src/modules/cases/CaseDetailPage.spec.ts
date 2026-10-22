import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia } from 'pinia';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AuthSession } from '../../api/auth';
import type { CaseDetail } from '../../api/cases';
import {
  ApiError,
  onUnauthorized,
  setCsrfToken,
  setSessionIdentity,
} from '../../api/http';
import { useAuthStore } from '../../stores/auth';
import { pinia } from '../../app/pinia';
import { router } from '../../app/router';
import App from '../../app/App.vue';
import * as http from '../../api/http';

const api = vi.hoisted(() => ({
  getCase: vi.fn(),
  login: vi.fn(),
  getSession: vi.fn(),
}));
vi.mock('../../api/cases', async (original) => ({
  ...(await original<typeof import('../../api/cases')>()),
  getCase: api.getCase,
  listCases: vi.fn(async () => ({ items: [], counts: {}, total: 0 })),
  listLawyerCases: vi.fn(async () => ({ items: [], counts: {}, total: 0 })),
}));
vi.mock('../../api/auth', async (original) => ({
  ...(await original<typeof import('../../api/auth')>()),
  login: api.login,
  getSession: api.getSession,
}));
vi.mock('../../api/leads', async (original) => ({
  ...(await original<typeof import('../../api/leads')>()),
  getLead: vi.fn(async () => {
    throw new ApiError('来源不可读', 403, 'FORBIDDEN');
  }),
  listLeads: vi.fn(async () => ({ items: [], counts: {}, total: 0 })),
}));
vi.mock('../../api/materials', async (original) => ({
  ...(await original<typeof import('../../api/materials')>()),
  listOwnerMaterials: vi.fn(async () => ({ items: [], total: 0 })),
}));
vi.mock('../../api/calendar', () => ({
  getCalendarSummary: vi.fn(async () => ({
    metrics: { next30: { count: 0 } },
  })),
}));
vi.mock('../../api/organization', () => ({
  getOrganizationManagementContext: vi.fn(async () => ({})),
}));
vi.mock('../../api/lawyer-accounts', () => ({
  listLawyerAccounts: vi.fn(async () => ({ items: [], total: 0 })),
}));
vi.mock('../../api/notary', async (original) => ({
  ...(await original<typeof import('../../api/notary')>()),
  listNotaryOffices: vi.fn(async () => []),
  listNotaryMatters: vi.fn(async () => ({ items: [], counts: {}, total: 0 })),
}));
vi.mock('../../api/settlements', async (original) => ({
  ...(await original<typeof import('../../api/settlements')>()),
  getSettlementContext: vi.fn(async () => ({ read: false, feeRead: false })),
  getCaseSettlement: vi.fn(async () => null),
  listFees: vi.fn(async () => ({ items: [], total: 0 })),
}));
vi.mock('../../api/evidence', () => ({
  listEvidence: vi.fn(async () => ({ items: [], total: 0 })),
}));
vi.mock('../../api/reports', () => ({
  getReportsCapability: vi.fn(async () => ({ canRead: false })),
}));
const session: AuthSession = {
  principalType: 'INTERNAL',
  user: { id: 'user-1', displayName: '操作人员', username: 'reader' },
  department: { id: 'department-1', name: '知产部' },
  departments: [{ id: 'department-1', name: '知产部' }],
  customer: null,
  notaryOffice: null,
  authorizationRevision: 1,
  expiresAt: '2099-01-01T00:00:00.000Z',
  csrfToken: 'synthetic-csrf',
};
let wrapper: ReturnType<typeof mount> | undefined,
  unsubscribe: (() => void) | undefined;
const fetchMock = vi.fn<typeof fetch>();
beforeEach(async () => {
  vi.clearAllMocks();
  setActivePinia(pinia);
  const auth = useAuthStore(pinia);
  auth.$reset();
  auth.session = structuredClone(session);
  auth.restored = true;
  setCsrfToken(session.csrfToken);
  setSessionIdentity(session.user.id);
  api.getCase.mockResolvedValue(structuredClone(detail));
  api.getSession.mockRejectedValue(
    new ApiError('会话已失效', 401, 'UNAUTHORIZED'),
  );
  api.login.mockResolvedValue(structuredClone(session));
  fetchMock.mockImplementation(async (url) => {
    expect(String(url)).toContain('/auth/logout');
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal('fetch', fetchMock);
  // Same unauthorized policy as main.ts; the real HTTP client raises this event.
  unsubscribe = onUnauthorized(() => {
    auth.clear();
    if (router.currentRoute.value.path !== '/login')
      void router.replace({
        path: '/login',
        query: { returnTo: router.currentRoute.value.fullPath },
      });
  });
  await router.push('/health');
  await router.push('/cases/case-1');
  await router.isReady();
  wrapper = mount(App, {
    global: { plugins: [pinia, router], stubs: { ElDrawer: true } },
  });
  await flushPromises();
  expect(wrapper.text()).toContain(detail.businessNo);
  expect(api.getCase).toHaveBeenCalledTimes(1);
});
afterEach(async () => {
  wrapper?.unmount();
  wrapper = undefined;
  unsubscribe?.();
  unsubscribe = undefined;
  useAuthStore(pinia).clear();
  await router.push('/health');
  await flushPromises();
  vi.unstubAllGlobals();
});

it('logout UI clears the case and reaches login without any new unauthenticated case read', async () => {
  await wrapper!.get('[data-test="logout"]').trigger('click');
  await flushPromises();
  expect(router.currentRoute.value.path).toBe('/login');
  expect(useAuthStore(pinia).session).toBeNull();
  expect(wrapper!.text()).not.toContain(detail.businessNo);
  expect(wrapper!.find('.case-workspace').exists()).toBe(false);
  expect(wrapper!.find('#username').exists()).toBe(true);
  expect(api.getCase).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it('logout UI retains the signed-in case and actionable error on a failed logout then allows retry', async () => {
  fetchMock.mockResolvedValueOnce(
    new Response(
      JSON.stringify({ code: 'HTTP_ERROR', message: '退出暂不可用' }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    ),
  );
  await wrapper!.get('[data-test="logout"]').trigger('click');
  await flushPromises();
  expect(router.currentRoute.value.path).toBe('/cases/case-1');
  expect(useAuthStore(pinia).session?.user.id).toBe(session.user.id);
  expect(wrapper!.text()).toContain(detail.businessNo);
  expect(wrapper!.get('[data-test="logout-error"]').text()).toContain(
    '退出暂不可用',
  );
  await wrapper!.get('[data-test="logout"]').trigger('click');
  await flushPromises();
  expect(router.currentRoute.value.path).toBe('/login');
  expect(wrapper!.text()).not.toContain(detail.businessNo);
});
it('logout UI handles a real HTTP401 through unauthorized policy without residual case or error overlay', async () => {
  fetchMock.mockResolvedValueOnce(
    new Response(
      JSON.stringify({ code: 'UNAUTHORIZED', message: '会话已失效' }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    ),
  );
  await wrapper!.get('[data-test="logout"]').trigger('click');
  await flushPromises();
  expect(router.currentRoute.value.path).toBe('/login');
  expect(useAuthStore(pinia).session).toBeNull();
  expect(wrapper!.text()).not.toContain(detail.businessNo);
  expect(wrapper!.find('[data-test="logout-error"]').exists()).toBe(false);
  expect(api.getCase).toHaveBeenCalledTimes(1);
});
it('logout UI protects back and refresh destinations and supports actual LoginPage return navigation', async () => {
  await router.push('/cases/case-1?tab=files');
  await flushPromises();
  await wrapper!.get('[data-test="logout"]').trigger('click');
  await flushPromises();
  const count = api.getCase.mock.calls.length;
  router.back();
  await flushPromises();
  expect(router.currentRoute.value.path).toBe('/login');
  expect(wrapper!.text()).not.toContain(detail.businessNo);
  useAuthStore(pinia).restored = false;
  await router.push('/cases/case-1?tab=details');
  await flushPromises();
  expect(api.getSession).toHaveBeenCalledTimes(1);
  expect(router.currentRoute.value.path).toBe('/login');
  expect(router.currentRoute.value.query.returnTo).toBe(
    '/cases/case-1?tab=details',
  );
  expect(api.getCase).toHaveBeenCalledTimes(count);
  api.getCase.mockResolvedValue({
    ...structuredClone(detail),
    businessNo: 'CA-RELOGIN',
  });
  await wrapper!.get('#username').setValue('reader');
  await wrapper!.get('#password').setValue('synthetic-password-123');
  await wrapper!.get('form').trigger('submit');
  await flushPromises();
  expect(api.login).toHaveBeenCalledTimes(1);
  expect(router.currentRoute.value.path).toBe('/cases/case-1');
  expect(wrapper!.text()).toContain('CA-RELOGIN');
  expect(wrapper!.text()).not.toContain(detail.businessNo);
});
it('logout UI aborts a pending old case read and cannot restore its content after login redirect', async () => {
  let finishRead: ((value: CaseDetail) => void) | undefined;
  let readSignal: AbortSignal | undefined;
  api.getCase.mockImplementationOnce(
    (_id: string, options: { signal: AbortSignal }) => {
      readSignal = options.signal;
      return new Promise<CaseDetail>((resolve) => {
        finishRead = resolve;
      });
    },
  );
  await router.push('/cases/case-1?action=match');
  await flushPromises();
  expect(api.getCase).toHaveBeenCalledTimes(2);
  await wrapper!.get('[data-test="logout"]').trigger('click');
  await flushPromises();
  expect(router.currentRoute.value.path).toBe('/login');
  expect(readSignal?.aborted).toBe(true);
  finishRead!(structuredClone(detail));
  await flushPromises();
  expect(router.currentRoute.value.path).toBe('/login');
  expect(wrapper!.text()).not.toContain(detail.businessNo);
  expect(api.getCase).toHaveBeenCalledTimes(2);
});

it.each([401, 503])(
  'logout UI ignores late %s from an old request after same-account session replacement',
  async (status) => {
    let finishLogout: ((response: Response) => void) | undefined;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finishLogout = resolve;
        }),
    );
    await wrapper!.get('[data-test="logout"]').trigger('click');
    const auth = useAuthStore(pinia);
    auth.session = {
      ...structuredClone(session),
      csrfToken: 'new-session-csrf',
    };
    setCsrfToken('new-session-csrf');
    setSessionIdentity(session.user.id);
    const resetIdentity = vi.spyOn(http, 'setSessionIdentity');
    try {
      finishLogout!(
        new Response(
          JSON.stringify({
            code: status === 401 ? 'UNAUTHORIZED' : 'HTTP_ERROR',
            message: 'old-request-error',
          }),
          { status, headers: { 'content-type': 'application/json' } },
        ),
      );
      await flushPromises();
      expect(auth.session?.csrfToken).toBe('new-session-csrf');
      expect(router.currentRoute.value.path).toBe('/cases/case-1');
      expect(wrapper!.text()).toContain(detail.businessNo);
      expect(wrapper!.find('[data-test="logout-error"]').exists()).toBe(false);
      expect(resetIdentity).not.toHaveBeenCalled();
    } finally {
      resetIdentity.mockRestore();
    }
  },
);

const detail: CaseDetail = {
  id: 'case-1',
  businessNo: 'CA-1',
  stage: 'PENDING_MATCH',
  createdAt: '2026-09-28T00:00:00Z',
  version: 1,
  canMatch: false,
  canRecordClosure: false,
  canCorrectClosure: false,
  canArchive: false,
  canCorrectArchive: false,
  closure: null,
  archive: null,
  courtCaseNo: null,
  department: { id: 'department-1', name: '知产部' },
  customer: { id: 'customer-1', name: '客户甲' },
  rightsHolder: { id: 'holder-1', name: '权利人甲' },
  owner: { id: 'user-1', displayName: '负责人' },
  sourceLead: { id: 'lead-1', businessNo: 'LD-1' },
  sourceNotaryMatter: { id: 'matter-1', businessNo: 'NZ-1' },
  certificate: {
    certificateNo: 'Z-100',
    certificateDate: '2026-09-28',
    issuedAt: '2026-09-28T00:00:00Z',
    needDisclose: false,
    files: [],
    disclosureFiles: [],
  },
  fees: [
    {
      category: 'SAMPLE',
      state: 'KNOWN',
      amount: '12.00',
      sourceType: 'NOTARY_MATTER_EVIDENCE',
      sourceId: 'evidence-1',
    },
  ],
  defendants: [],
  lawyers: [],
  matchedAt: null,
  matchedOn: null,
  canSubmitComplaint: false,
  canConfirmComplaint: false,
  canMailComplaint: false,
  canSubmitFiling: false,
  canRegisterAcceptance: false,
  canUploadAcceptanceMaterials: false,
  canScheduleHearing: false,
  canCorrectHearing: false,
  canRegisterJudgment: false,
  canCorrectJudgment: false,
  canSaveSecondInstance: false,
  canRegisterSecondInstanceResult: false,
  canRevokeSecondInstanceResult: false,
  canSubmitExecution: false,
  canChooseJudgmentNextStep: false,
  canRevokeJudgmentNextStep: false,
  complaint: null,
  complaintConfirmation: null,
  complaintMailing: null,
  filingSubmission: null,
  acceptance: null,
  acceptanceMaterials: {
    ACCEPTANCE_NOTICE: { available: [], frozen: [], later: [] },
    PAYMENT_LIST: { available: [], frozen: [], later: [] },
    SERVICE_DOCUMENT: { available: [], frozen: [], later: [] },
  },
  hearing: {
    currentArrangement: null,
    currentAdvance: null,
    arrangements: [],
    advances: [],
    corrections: [],
  },
  judgment: { current: null, history: [], availableFiles: [] },
  judgmentNextStep: { current: null, history: [], revocations: [] },
  acceptances: [],
  secondInstance: {
    currentTrialRoundId: null,
    currentProgress: null,
    currentResult: null,
    rounds: [],
    progresses: [],
    results: [],
    revocations: [],
  },
  executionSubmission: { current: null, submissions: [], availableFiles: [] },
  canConfirmExecution: false,
  canMailExecution: false,
  canSubmitExecutionFiling: false,
  canFinishExecution: false,
  executionConfirmation: null,
  executionMailing: null,
  executionFiling: null,
  executionFinish: null,
};
