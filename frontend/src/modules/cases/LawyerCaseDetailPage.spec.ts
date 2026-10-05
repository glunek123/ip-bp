import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import { useAuthStore } from '../../stores/auth';
import LawyerCaseDetailPage from './LawyerCaseDetailPage.vue';

const api = vi.hoisted(() => ({
  getLawyerCase: vi.fn(),
  submitComplaint: vi.fn(),
  listOwnerMaterials: vi.fn(),
  uploadMaterialFile: vi.fn(),
  downloadMaterialVersion: vi.fn(),
}));
vi.mock('../../api/cases', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/cases')>()),
  getLawyerCase: api.getLawyerCase,
  submitComplaint: api.submitComplaint,
}));
vi.mock('../../api/materials', () => ({
  listOwnerMaterials: api.listOwnerMaterials,
  uploadMaterialFile: api.uploadMaterialFile,
  downloadMaterialVersion: api.downloadMaterialVersion,
}));

function detail(
  id: string,
  businessNo: string,
  stage: string = 'WAITING_FORMAL_ACCEPTANCE',
) {
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
