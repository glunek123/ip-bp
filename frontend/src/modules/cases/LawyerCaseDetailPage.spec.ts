import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import type { CaseStage, LawyerCaseDetail } from '../../api/cases';
import { useAuthStore } from '../../stores/auth';
import LawyerCaseDetailPage from './LawyerCaseDetailPage.vue';
import { secondInstanceCommandState } from './case-second-instance-recovery';

const api = vi.hoisted(() => ({
  getLawyerCase: vi.fn(),
  submitComplaint: vi.fn(),
  listOwnerMaterials: vi.fn(),
  uploadMaterialFile: vi.fn(),
  downloadMaterialVersion: vi.fn(),
  saveSecondInstance: vi.fn(),
}));
vi.mock('../../api/cases', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/cases')>()),
  getLawyerCase: api.getLawyerCase,
  submitComplaint: api.submitComplaint,
  saveSecondInstance: api.saveSecondInstance,
}));
vi.mock('../../api/materials', () => ({
  listOwnerMaterials: api.listOwnerMaterials,
  uploadMaterialFile: api.uploadMaterialFile,
  downloadMaterialVersion: api.downloadMaterialVersion,
}));

function detail(
  id: string,
  businessNo: string,
  stage: CaseStage = 'WAITING_FORMAL_ACCEPTANCE',
): LawyerCaseDetail {
  return {
    id,
    businessNo,
    stage,
    version: 7,
    canMatch: false,
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
    canChooseJudgmentNextStep: false,
    canRevokeJudgmentNextStep: false,
    canSaveSecondInstance: false,
    canRegisterSecondInstanceResult: false,
    canRevokeSecondInstanceResult: false,
    canSubmitExecution: false,
    createdAt: '2026-10-01T00:00:00Z',
    matchedAt: '2026-10-01T00:00:00Z',
    matchedOn: '2026-10-01',
    defendants: [],
    lawyers: [],
    customer: { id: 'customer-1', name: '客户甲' },
    rightsHolder: { id: 'holder-1', name: '权利人甲' },
    certificate: {
      certificateNo: 'Z-44',
      certificateDate: '2026-10-01',
      issuedAt: '2026-10-01T00:00:00Z',
      needDisclose: false,
      files: [],
      disclosureFiles: [],
    },
    complaint: null,
    complaintConfirmation: null,
    complaintMailing: null,
    filingSubmission: null,
    courtCaseNo: null,
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
    executionConfirmation: null,
  };
}
function materials() {
  return {
    items: [
      {
        id: 'm-c',
        status: 'ACTIVE',
        category: 'COMPLAINT',
        currentVersionId: 'v-c',
        contentVersions: [
          {
            id: 'v-c',
            originalFilename: '诉状.pdf',
            mimeType: 'application/pdf',
          },
        ],
      },
      {
        id: 'm-a',
        status: 'ACTIVE',
        category: 'AUTHORIZATION',
        currentVersionId: 'v-a',
        contentVersions: [
          {
            id: 'v-a',
            originalFilename: '授权.pdf',
            mimeType: 'application/pdf',
          },
        ],
      },
    ],
  };
}

async function mountPage(path = '/lawyer/cases/case-a') {
  const pinia = createPinia();
  setActivePinia(pinia);
  const auth = useAuthStore(pinia);
  auth.session = {
    principalType: 'LAWYER',
    user: { id: 'lawyer-1', displayName: '律师甲', username: 'lawyer.a' },
    department: null,
    departments: [],
    customer: null,
    notaryOffice: null,
    authorizationRevision: 1,
    expiresAt: '2026-10-06T00:00:00Z',
    csrfToken: 'csrf',
  };
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/lawyer/cases', component: { template: '<div />' } },
      { path: '/lawyer/cases/:id', component: LawyerCaseDetailPage },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(LawyerCaseDetailPage, {
    global: { plugins: [pinia, router] },
  });
  await flushPromises();
  return { wrapper, router, auth };
}

beforeEach(() => {
  vi.resetAllMocks();
  api.listOwnerMaterials.mockResolvedValue(materials());
  api.submitComplaint.mockResolvedValue({
    id: 'case-a',
    stage: 'WAITING_COMPLAINT_CONFIRMATION',
    version: 8,
    submittedAt: '2026-10-06T02:00:00Z',
  });
});

describe('LawyerCaseDetailPage', () => {
  it('labels the execution confirmation stage on the lawyer case detail', async () => {
    api.getLawyerCase.mockResolvedValue(
      detail('case-a', 'CA-A', 'WAITING_EXECUTION_CONFIRMATION'),
    );
    const { wrapper } = await mountPage();
    expect(wrapper.text()).toContain('执行材料待确认');
  });

  it('keeps an unknown original command when detail becomes unavailable and returns for the same lawyer', async () => {
    const roundId = '70000000-0000-4000-8000-000000000081';
    const choiceId = '70000000-0000-4000-8000-000000000082';
    const current = {
      ...detail('case-a', 'CA-A', 'SECOND_INSTANCE'),
      canSaveSecondInstance: true,
      judgmentNextStep: {
        current: {
          id: choiceId,
          trialRoundId: roundId,
          judgmentId: 'judgment-1',
          next: 'APPEAL' as const,
        },
        history: [],
        revocations: [],
      },
      secondInstance: {
        currentTrialRoundId: roundId,
        currentProgress: null,
        currentResult: null,
        rounds: [
          { id: roundId, sequence: 1, sourceResultId: null, revokedAt: null },
        ],
        progresses: [],
        results: [],
        revocations: [],
      },
    };
    api.getLawyerCase
      .mockResolvedValueOnce(current)
      .mockRejectedValueOnce(new ApiError('Forbidden', 403, 'ACTION_FORBIDDEN'))
      .mockResolvedValueOnce(current);
    api.saveSecondInstance
      .mockRejectedValueOnce(new ApiError('unknown', 503, 'NETWORK_ERROR'))
      .mockResolvedValueOnce({});
    const { wrapper, auth } = await mountPage();
    await wrapper
      .get('[data-test="second-instance-progress-form"]')
      .trigger('submit');
    await flushPromises();
    const first = api.saveSecondInstance.mock.calls[0];
    expect(
      wrapper.find('[data-test="second-instance-result-retry"]').exists(),
    ).toBe(true);
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '刷新')!
      .trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-test="second-instance-panel"]').exists()).toBe(
      false,
    );
    auth.session = { ...auth.session!, authorizationRevision: 2 };
    await flushPromises();
    expect(
      wrapper.find('[data-test="second-instance-result-retry"]').exists(),
    ).toBe(true);
    await wrapper
      .get('[data-test="second-instance-result-retry"]')
      .trigger('click');
    expect(api.saveSecondInstance.mock.calls[1]).toEqual(first);
  });
  it.each(['old-first', 'retry-first'] as const)(
    'keeps a confirmed original receipt across overlapping same-key attempts (%s)',
    async (order) => {
      const roundId = '70000000-0000-4000-8000-000000000091';
      const caseId = `case-overlap-${order}`;
      const current = {
        ...detail(caseId, 'CA-OVERLAP', 'SECOND_INSTANCE'),
        canSaveSecondInstance: true,
        judgmentNextStep: {
          current: {
            id: 'choice-overlap',
            trialRoundId: roundId,
            judgmentId: 'judgment-overlap',
            next: 'APPEAL' as const,
          },
          history: [],
          revocations: [],
        },
        secondInstance: {
          currentTrialRoundId: roundId,
          currentProgress: null,
          currentResult: null,
          rounds: [
            { id: roundId, sequence: 1, sourceResultId: null, revokedAt: null },
          ],
          progresses: [],
          results: [],
          revocations: [],
        },
      };
      let resolveOld!: (value: unknown) => void;
      let rejectOld!: (reason: unknown) => void;
      let resolveRetry!: (value: unknown) => void;
      let rejectRetry!: (reason: unknown) => void;
      const old = new Promise((resolve, reject) => {
        resolveOld = resolve;
        rejectOld = reject;
      });
      const retry = new Promise((resolve, reject) => {
        resolveRetry = resolve;
        rejectRetry = reject;
      });
      api.getLawyerCase.mockResolvedValue(current);
      api.saveSecondInstance
        .mockReturnValueOnce(old)
        .mockReturnValueOnce(retry);
      const { wrapper, auth } = await mountPage(`/lawyer/cases/${caseId}`);
      await wrapper
        .get('[data-test="second-instance-progress-form"]')
        .trigger('submit');
      auth.session = { ...auth.session!, authorizationRevision: 2 };
      await flushPromises();
      expect(
        wrapper.find('[data-test="second-instance-result-retry"]').exists(),
      ).toBe(true);
      await wrapper
        .get('[data-test="second-instance-result-retry"]')
        .trigger('click');
      expect(api.saveSecondInstance.mock.calls[1]).toEqual(
        api.saveSecondInstance.mock.calls[0],
      );
      if (order === 'old-first') {
        resolveOld({});
        await flushPromises();
        rejectRetry(new ApiError('unknown', 503, 'NETWORK_ERROR'));
      } else {
        resolveRetry({});
        await flushPromises();
        rejectOld(new ApiError('unknown', 503, 'NETWORK_ERROR'));
      }
      await flushPromises();
      expect(wrapper.text()).toContain('原轮次请求已确认');
      expect(
        wrapper.find('[data-test="second-instance-result-retry"]').exists(),
      ).toBe(false);
      auth.session = { ...auth.session!, authorizationRevision: 3 };
      await flushPromises();
      expect(wrapper.text()).toContain('原轮次请求已确认');
      expect(
        wrapper.find('[data-test="second-instance-result-retry"]').exists(),
      ).toBe(false);
    },
  );
  it.each(['old-first', 'retry-first'] as const)(
    'does not let a sibling 403 erase a confirmed same-key receipt (%s)',
    async (order) => {
      const caseId = `case-definitive-${order}`;
      const roundId = '70000000-0000-4000-8000-000000000092';
      const current = {
        ...detail(caseId, 'CA-DEFINITE', 'SECOND_INSTANCE'),
        canSaveSecondInstance: true,
        judgmentNextStep: {
          current: {
            id: 'choice-definite',
            trialRoundId: roundId,
            judgmentId: 'judgment-definite',
            next: 'APPEAL' as const,
          },
          history: [],
          revocations: [],
        },
        secondInstance: {
          currentTrialRoundId: roundId,
          currentProgress: null,
          currentResult: null,
          rounds: [
            { id: roundId, sequence: 1, sourceResultId: null, revokedAt: null },
          ],
          progresses: [],
          results: [],
          revocations: [],
        },
      };
      let rejectOld!: (reason: unknown) => void;
      let resolveRetry!: (value: unknown) => void;
      const old = new Promise((_, reject) => {
        rejectOld = reject;
      });
      const retry = new Promise((resolve) => {
        resolveRetry = resolve;
      });
      api.getLawyerCase.mockResolvedValue(current);
      api.saveSecondInstance
        .mockReturnValueOnce(old)
        .mockReturnValueOnce(retry);
      const { wrapper, auth } = await mountPage(`/lawyer/cases/${caseId}`);
      await wrapper
        .get('[data-test="second-instance-progress-form"]')
        .trigger('submit');
      auth.session = { ...auth.session!, authorizationRevision: 2 };
      await flushPromises();
      await wrapper
        .get('[data-test="second-instance-result-retry"]')
        .trigger('click');
      if (order === 'old-first') {
        rejectOld(new ApiError('denied', 403, 'ACTION_FORBIDDEN'));
        await flushPromises();
        resolveRetry({});
      } else {
        resolveRetry({});
        await flushPromises();
        rejectOld(new ApiError('denied', 403, 'ACTION_FORBIDDEN'));
      }
      await flushPromises();
      expect(wrapper.text()).toContain('原轮次请求已确认');
      expect(
        wrapper.find('[data-test="second-instance-result-retry"]').exists(),
      ).toBe(false);
    },
  );
  it.each([403, 404] as const)(
    'hides sensitive second-instance details as soon as the current retry returns %s with the old attempt pending',
    async (status) => {
      const caseId = `case-current-denial-${status}`;
      const roundId = `70000000-0000-4000-8000-0000000000${status}`;
      const current = {
        ...detail(caseId, 'CA-DENIED', 'SECOND_INSTANCE'),
        canSaveSecondInstance: true,
        judgmentNextStep: {
          current: {
            id: 'choice-denied',
            trialRoundId: roundId,
            judgmentId: 'judgment-denied',
            next: 'APPEAL' as const,
          },
          history: [],
          revocations: [],
        },
        secondInstance: {
          currentTrialRoundId: roundId,
          currentProgress: null,
          currentResult: null,
          rounds: [
            { id: roundId, sequence: 1, sourceResultId: null, revokedAt: null },
          ],
          progresses: [
            {
              id: 'progress-history',
              trialRoundId: roundId,
              choiceId: 'choice-denied',
              hearingAt: null,
              hearingPlace: null,
              judgeName: null,
              documentFiles: [
                {
                  materialId: 'material-private',
                  contentVersionId: 'version-private',
                  originalFilename: '敏感文书.pdf',
                  mimeType: 'application/pdf',
                },
              ],
              serviceFiles: [],
            },
          ],
          results: [],
          revocations: [],
        },
      };
      let resolveOld!: (value: unknown) => void;
      let rejectRetry!: (reason: unknown) => void;
      const old = new Promise((resolve) => {
        resolveOld = resolve;
      });
      const retry = new Promise((_, reject) => {
        rejectRetry = reject;
      });
      api.getLawyerCase.mockResolvedValue(current);
      api.saveSecondInstance
        .mockReturnValueOnce(old)
        .mockReturnValueOnce(retry);
      const { wrapper, auth } = await mountPage(`/lawyer/cases/${caseId}`);
      await wrapper
        .get('[data-test="second-instance-progress-form"]')
        .trigger('submit');
      const original = api.saveSecondInstance.mock.calls[0];
      auth.session = { ...auth.session!, authorizationRevision: 2 };
      await flushPromises();
      await wrapper
        .get('[data-test="second-instance-hearing-at"]')
        .setValue('2026-10-09');
      await wrapper
        .get(
          '[data-test="second-instance-progress-form"] fieldset input[type="checkbox"]',
        )
        .setValue(true);
      expect(wrapper.text()).toContain('敏感文书.pdf');
      await wrapper
        .get('[data-test="second-instance-result-retry"]')
        .trigger('click');
      expect(api.saveSecondInstance.mock.calls[1]).toEqual(original);
      rejectRetry(
        new ApiError(
          'denied',
          status,
          status === 403 ? 'ACTION_FORBIDDEN' : 'RESOURCE_NOT_FOUND',
        ),
      );
      await flushPromises();
      const identity = { actor: 'LAWYER:lawyer-1:', caseId };
      expect(secondInstanceCommandState(identity)).toMatchObject({
        status: 'sending',
        command: { input: original[1] },
      });
      expect(
        wrapper.find('[data-test="second-instance-progress-form"]').exists(),
      ).toBe(false);
      expect(
        wrapper.find('[data-test="second-instance-round-1"]').exists(),
      ).toBe(false);
      expect(
        wrapper.find('[data-test="second-instance-result-retry"]').exists(),
      ).toBe(false);
      expect(wrapper.text()).not.toContain('敏感文书.pdf');
      resolveOld({});
      await flushPromises();
      expect(secondInstanceCommandState(identity)?.status).toBe('confirmed');
      expect(wrapper.text()).toContain('原轮次请求已确认');
      expect(
        wrapper.find('[data-test="second-instance-progress-form"]').exists(),
      ).toBe(false);
      expect(wrapper.text()).not.toContain('敏感文书.pdf');
      wrapper.unmount();
    },
  );
  it('shows second-instance history to the active lawyer without exposing revoke', async () => {
    const trialRoundId = '70000000-0000-4000-8000-000000000001';
    api.getLawyerCase.mockResolvedValueOnce({
      ...detail('case-second-instance', 'CA-2', 'SECOND_INSTANCE'),
      secondInstance: {
        currentTrialRoundId: null,
        currentProgress: null,
        currentResult: null,
        rounds: [
          {
            id: trialRoundId,
            sequence: 1,
            sourceResultId: null,
            revokedAt: null,
          },
        ],
        progresses: [],
        results: [],
        revocations: [],
      },
    });
    const { wrapper } = await mountPage('/lawyer/cases/case-second-instance');
    expect(wrapper.find('[data-test="second-instance-panel"]').exists()).toBe(
      true,
    );
    expect(wrapper.text()).toContain('第1轮办理');
    expect(wrapper.find('[data-test="second-instance-revoke"]').exists()).toBe(
      false,
    );
  });

  it('shows authorized lawyer registration and never shows internal correction', async () => {
    const caseDetail = detail('case-a', 'CA-A', 'WAITING_JUDGMENT');
    caseDetail.canRegisterJudgment = true;
    caseDetail.acceptance = {
      id: '70000000-0000-4000-8000-000000000031',
      trialRoundId: '70000000-0000-4000-8000-000000000032',
      acceptedAt: '2026-10-01',
      courtCaseNo: '甲0101民初1号',
      recordedAt: '2026-10-01T01:00:00Z',
      files: [
        {
          category: 'ACCEPTANCE_NOTICE',
          materialId: 'material-notice',
          contentVersionId: 'version-notice',
          originalFilename: '受理通知书.pdf',
          mimeType: 'application/pdf',
        },
      ],
    };
    api.getLawyerCase.mockResolvedValue(caseDetail);
    const { wrapper } = await mountPage();

    expect(wrapper.find('[data-test="case-judgment-panel"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-test="judgment-submit"]').exists()).toBe(true);
    expect(
      wrapper.find('[data-test="judgment-correction-form"]').exists(),
    ).toBe(false);
    expect(wrapper.text()).not.toContain('更正原因');
  });

  it('aborts pending attachment downloads when another lawyer signs in', async () => {
    const file = {
      materialId: 'certificate-material',
      contentVersionId: 'certificate-version',
      originalFilename: '证书.pdf',
      mimeType: 'application/pdf',
    };
    const caseDetail = detail('case-a', 'CA-A');
    api.getLawyerCase.mockResolvedValue({
      ...caseDetail,
      certificate: { ...caseDetail.certificate, files: [file] },
    });
    let finishDownload!: () => void;
    api.downloadMaterialVersion.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishDownload = resolve;
      }),
    );
    const { wrapper, auth } = await mountPage();

    await wrapper
      .findAll('button')
      .find((button) => button.text() === '下载')!
      .trigger('click');
    const oldSignal = api.downloadMaterialVersion.mock
      .calls[0]?.[2] as AbortSignal;
    expect(oldSignal).toBeInstanceOf(AbortSignal);
    expect(oldSignal.aborted).toBe(false);
    auth.session = {
      ...auth.session!,
      user: { ...auth.session!.user, id: 'lawyer-2' },
      authorizationRevision: 2,
    };
    await flushPromises();
    expect(oldSignal.aborted).toBe(true);
    finishDownload();
    await flushPromises();
    expect(wrapper.text()).not.toContain('附件下载失败');

    await wrapper
      .findAll('button')
      .find((button) => button.text() === '下载')!
      .trigger('click');
    expect(
      (api.downloadMaterialVersion.mock.calls[1]?.[2] as AbortSignal).aborted,
    ).toBe(false);
  });

  it('keeps parallel current downloads independent until the page unmounts', async () => {
    const caseDetail = detail('case-a', 'CA-A');
    api.getLawyerCase.mockResolvedValue({
      ...caseDetail,
      certificate: {
        ...caseDetail.certificate,
        files: [
          {
            materialId: 'm-1',
            contentVersionId: 'v-1',
            originalFilename: '甲.pdf',
            mimeType: 'application/pdf',
          },
          {
            materialId: 'm-2',
            contentVersionId: 'v-2',
            originalFilename: '乙.pdf',
            mimeType: 'application/pdf',
          },
        ],
      },
    });
    let finishFirst!: () => void;
    api.downloadMaterialVersion
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        }),
      )
      .mockReturnValueOnce(new Promise<void>(() => {}));
    const { wrapper } = await mountPage();
    const buttons = wrapper
      .findAll('button')
      .filter((button) => button.text() === '下载');
    await buttons[0]!.trigger('click');
    await buttons[1]!.trigger('click');
    const first = api.downloadMaterialVersion.mock.calls[0]?.[2] as AbortSignal;
    const second = api.downloadMaterialVersion.mock
      .calls[1]?.[2] as AbortSignal;
    expect(first).toBeInstanceOf(AbortSignal);
    expect(second).toBeInstanceOf(AbortSignal);
    expect(first).not.toBe(second);
    finishFirst();
    await flushPromises();
    expect(second.aborted).toBe(false);
    wrapper.unmount();
    expect(second.aborted).toBe(true);
  });

  it('clears case A when switching to case B and when the account identity changes', async () => {
    api.getLawyerCase
      .mockResolvedValueOnce(detail('case-a', 'CA-A'))
      .mockResolvedValueOnce(detail('case-b', 'CA-B'))
      .mockResolvedValueOnce(detail('case-b', 'CA-B'));
    const { wrapper, router, auth } = await mountPage();
    expect(wrapper.text()).toContain('CA-A');
    await router.push('/lawyer/cases/case-b');
    await flushPromises();
    expect(wrapper.text()).toContain('CA-B');
    expect(wrapper.text()).not.toContain('CA-A');
    auth.session = {
      ...auth.session!,
      user: { ...auth.session!.user, id: 'lawyer-2' },
      authorizationRevision: 2,
    };
    await flushPromises();
    expect(api.getLawyerCase).toHaveBeenCalledTimes(3);
    expect(wrapper.text()).toContain('CA-B');
  });

  it('clears the case when access is revoked during refresh', async () => {
    api.getLawyerCase
      .mockResolvedValueOnce(detail('case-a', 'CA-A'))
      .mockRejectedValueOnce(
        new ApiError('Forbidden', 403, 'ACTION_FORBIDDEN'),
      );
    const { wrapper } = await mountPage();
    expect(wrapper.text()).toContain('CA-A');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '刷新')!
      .trigger('click');
    await flushPromises();
    expect(wrapper.text()).not.toContain('CA-A');
    expect(wrapper.text()).toContain('当前账号已不能读取该案件');
  });

  it('shows the mediation number in the filing record', async () => {
    api.getLawyerCase.mockResolvedValueOnce({
      ...detail('case-a', 'CA-A'),
      filingSubmission: {
        court: { id: 'court-1', name: '杭州法院' },
        submittedAt: '2026-10-01',
        recordedAt: '2026-10-01T00:00:00Z',
        mediationNo: '律所调-20261001',
        evidenceFiles: [
          {
            materialId: 'filing-material',
            contentVersionId: 'filing-version',
            originalFilename: '立案材料.pdf',
            mimeType: 'application/pdf',
          },
        ],
        screenshotFiles: [],
      },
    });
    const { wrapper } = await mountPage();
    expect(wrapper.text()).toContain('诉调号：律所调-20261001');
  });

  it('shows the filing record fallback when the mediation number is empty', async () => {
    api.getLawyerCase.mockResolvedValueOnce({
      ...detail('case-a', 'CA-A'),
      filingSubmission: {
        court: { id: 'court-1', name: '杭州法院' },
        submittedAt: '2026-10-01',
        recordedAt: '2026-10-01T00:00:00Z',
        mediationNo: null,
        evidenceFiles: [
          {
            materialId: 'filing-material',
            contentVersionId: 'filing-version',
            originalFilename: '立案材料.pdf',
            mimeType: 'application/pdf',
          },
        ],
        screenshotFiles: [],
      },
    });
    const { wrapper } = await mountPage();
    expect(wrapper.text()).toContain('诉调号：未填写');
  });

  it('keeps a successful complaint POST locked when its follow-up GET fails', async () => {
    api.getLawyerCase
      .mockResolvedValueOnce({
        ...detail('case-a', 'CA-A', 'WAITING_COMPLAINT'),
        canSubmitComplaint: true,
        version: 3,
      })
      .mockRejectedValueOnce(new Error('refresh unavailable'));
    const { wrapper } = await mountPage();
    await wrapper.get('select').setValue('PENDING');
    await wrapper.findAll('input').at(2)!.setValue('等待金额凭证');
    await wrapper
      .get('[data-test="complaint-submit-form"] [data-test="submit-complaint"]')
      .trigger('click');
    await flushPromises();
    expect(api.submitComplaint).toHaveBeenCalledTimes(1);
    expect(api.submitComplaint).toHaveBeenCalledWith(
      'case-a',
      expect.objectContaining({
        idempotencyKey: expect.any(String),
        expectedVersion: 3,
      }),
      'lawyer',
    );
    expect(wrapper.text()).toContain('详情同步暂时失败');
    const submit = wrapper
      .findAll('button')
      .find((button) => button.text() === '确认提交');
    expect(submit?.attributes('disabled')).toBeDefined();
  });
});
