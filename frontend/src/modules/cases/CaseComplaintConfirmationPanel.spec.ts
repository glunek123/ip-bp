import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaseDetail } from '../../api/cases';
import { useAuthStore } from '../../stores/auth';
import CaseComplaintConfirmationPanel from './CaseComplaintConfirmationPanel.vue';

const api = vi.hoisted(() => ({
  confirmCaseComplaint: vi.fn(),
  listOwnerMaterials: vi.fn(),
  uploadMaterialFile: vi.fn(),
  downloadMaterialVersion: vi.fn(),
}));
vi.mock('../../api/cases', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/cases')>()),
  confirmCaseComplaint: api.confirmCaseComplaint,
}));
vi.mock('../../api/materials', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/materials')>()),
  listOwnerMaterials: api.listOwnerMaterials,
  uploadMaterialFile: api.uploadMaterialFile,
  downloadMaterialVersion: api.downloadMaterialVersion,
}));

const file = {
  materialId: 'material-complaint',
  contentVersionId: 'complaint-v1',
  originalFilename: '原提交诉状.pdf',
  mimeType: 'application/pdf',
};
const detail = {
  id: 'case-1',
  businessNo: 'CA-1',
  stage: 'WAITING_COMPLAINT_CONFIRMATION',
  createdAt: '2026-10-01T00:00:00Z',
  version: 3,
  owner: { id: 'user-1', displayName: '负责人' },
  canMatch: false,
  canSubmitComplaint: false,
  canSubmitFiling: false,
  canRegisterAcceptance: false,
  canUploadAcceptanceMaterials: false,
  canScheduleHearing: false,
  canCorrectHearing: false,
  canConfirmComplaint: true,
  canMailComplaint: false,
  sourceLead: { id: 'lead-1', businessNo: 'LD-1' },
  sourceNotaryMatter: { id: 'matter-1', businessNo: 'NZ-1' },
  courtCaseNo: null,
  department: { id: 'department-1', name: '知产部' },
  customer: { id: 'customer-1', name: '客户甲' },
  rightsHolder: { id: 'holder-1', name: '权利人甲' },
  certificate: {
    certificateNo: 'Z-100',
    certificateDate: '2026-10-01',
    issuedAt: '2026-10-01T00:00:00Z',
    needDisclose: false,
    files: [],
    disclosureFiles: [],
  },
  fees: [],
  defendants: [],
  lawyers: [],
  matchedAt: null,
  matchedOn: null,
  complaint: {
    amountState: 'KNOWN',
    amount: '123.45',
    pendingReason: null,
    submittedAt: '2026-10-01T01:00:00Z',
    submittedByUserId: 'user-1',
    complaintFiles: [file],
    authorizationFiles: [],
  },
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
} as CaseDetail;

function material(contentVersions = [file]) {
  return {
    id: 'material-complaint',
    ownerType: 'CASE',
    ownerId: 'case-1',
    category: 'COMPLAINT',
    purpose: 'COMPLAINT',
    currentVersionId: contentVersions.at(-1)?.contentVersionId ?? null,
    status: 'ACTIVE',
    version: contentVersions.length,
    deletedAt: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    contentVersions: contentVersions.map((entry, index) => ({
      id: entry.contentVersionId,
      materialId: entry.materialId,
      originalFilename: entry.originalFilename,
      mimeType: entry.mimeType,
      sizeBytes: 20,
      sha256: 'a'.repeat(64),
      status: 'AVAILABLE',
      createdAt: `2026-10-0${index + 1}T00:00:00Z`,
    })),
  };
}

async function mountPanel(item: CaseDetail = detail) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const auth = useAuthStore(pinia);
  auth.session = {
    principalType: 'INTERNAL',
    user: { id: 'user-1', displayName: '负责人', username: 'owner' },
    department: { id: 'department-1', name: '知产部' },
    departments: [{ id: 'department-1', name: '知产部' }],
    customer: null,
    notaryOffice: null,
    authorizationRevision: 1,
    expiresAt: '2099-01-01T00:00:00Z',
    csrfToken: 'csrf',
  };
  auth.restored = true;
  const wrapper = mount(CaseComplaintConfirmationPanel, {
    props: { item },
    global: { plugins: [pinia] },
  });
  await flushPromises();
  return { wrapper, auth };
}

beforeEach(() => {
  vi.resetAllMocks();
  api.listOwnerMaterials.mockResolvedValue({ items: [material()], total: 1 });
  api.confirmCaseComplaint.mockResolvedValue({
    id: 'case-1',
    stage: 'WAITING_COMPLAINT_STAMP',
    version: 4,
    confirmedAt: '2026-10-02T02:00:00Z',
  });
});

describe('CaseComplaintConfirmationPanel', () => {
  it('aborts a pending download on an account change while preserving the current case download', async () => {
    let finishDownload!: () => void;
    api.downloadMaterialVersion.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishDownload = resolve;
      }),
    );
    const { wrapper, auth } = await mountPanel();
    await wrapper.get('.confirmation-version button').trigger('click');
    const oldSignal = api.downloadMaterialVersion.mock
      .calls[0]?.[2] as AbortSignal;
    expect(oldSignal).toBeInstanceOf(AbortSignal);
    expect(oldSignal.aborted).toBe(false);

    await wrapper.setProps({ item: { ...detail, version: 4 } });
    expect(oldSignal.aborted).toBe(false);
    auth.session = {
      ...auth.session!,
      user: { ...auth.session!.user, id: 'user-2' },
      authorizationRevision: 2,
    };
    await flushPromises();
    expect(oldSignal.aborted).toBe(true);
    finishDownload();
    await flushPromises();
    expect(
      wrapper.find('[data-test="confirmation-download-error"]').exists(),
    ).toBe(false);
  });

  it('marks non-confirmers read-only without confirmation or upload controls', async () => {
    const readOnlyCase = {
      ...detail,
      canConfirmComplaint: false,
    } as CaseDetail;
    const { wrapper } = await mountPanel(readOnlyCase);

    expect(wrapper.get('[data-test="case-read-only"]').text()).toContain(
      '当前账号对此案只读',
    );
    expect(wrapper.find('[data-test="confirmation-review"]').exists()).toBe(
      false,
    );
    expect(
      wrapper.find('[data-test="complaint-revision-upload"]').exists(),
    ).toBe(false);
    expect(api.confirmCaseComplaint).not.toHaveBeenCalled();
    expect(api.uploadMaterialFile).not.toHaveBeenCalled();
  });

  it('auto-selects one exact version and starts from the submitted amount', async () => {
    const { wrapper } = await mountPanel();
    expect(
      wrapper.get('[data-test="complaint-version-complaint-v1"]').element,
    ).toHaveProperty('checked', true);
    expect(
      wrapper.get('[data-test="confirmation-amount"]').element,
    ).toHaveProperty('value', '123.45');
    expect(wrapper.text()).toContain('诉状待确认→诉状待盖章');
    expect(wrapper.text()).toContain('原提交版本、金额和回执不会覆盖');
  });

  it('shows a pending-stage download failure and clears it after a successful retry', async () => {
    api.downloadMaterialVersion
      .mockRejectedValueOnce(new Error('download failed'))
      .mockResolvedValueOnce(undefined);
    const { wrapper } = await mountPanel();

    await wrapper.get('.confirmation-version button').trigger('click');
    await flushPromises();
    expect(
      wrapper.get('[data-test="confirmation-download-error"]').text(),
    ).toContain('附件下载失败');

    await wrapper.get('.confirmation-version button').trigger('click');
    await flushPromises();
    expect(
      wrapper.find('[data-test="confirmation-download-error"]').exists(),
    ).toBe(false);
  });

  it('requires an explicit version when more than one exact version is available', async () => {
    api.listOwnerMaterials.mockResolvedValueOnce({
      items: [
        material([
          file,
          {
            ...file,
            contentVersionId: 'complaint-v2',
            originalFilename: '修订诉状.pdf',
          },
        ]),
      ],
      total: 1,
    });
    const { wrapper } = await mountPanel();
    expect(
      wrapper.get('[data-test="complaint-version-complaint-v1"]').element,
    ).toHaveProperty('checked', false);
    expect(
      wrapper.get('[data-test="complaint-version-complaint-v2"]').element,
    ).toHaveProperty('checked', false);
    expect(wrapper.text()).toContain('请选择本次确认的诉状版本');
  });

  it('requires a change note for revised version and amount and records disclose choice', async () => {
    api.listOwnerMaterials.mockResolvedValueOnce({
      items: [
        material([
          file,
          {
            ...file,
            contentVersionId: 'complaint-v2',
            originalFilename: '修订诉状.pdf',
          },
        ]),
      ],
      total: 1,
    });
    const { wrapper } = await mountPanel();
    await wrapper
      .get('[data-test="complaint-version-complaint-v2"]')
      .setValue(true);
    await wrapper.get('[data-test="confirmation-amount"]').setValue('200.00');
    await wrapper.get('[data-test="confirm-disclose-false"]').setValue(true);
    expect(
      wrapper.get('[data-test="change-note"]').attributes('required'),
    ).toBeDefined();
    await wrapper
      .get('[data-test="change-note"]')
      .setValue('按客户修订版及补充金额确认');
    await wrapper.get('[data-test="confirmation-review"]').trigger('click');
    await wrapper.get('[data-test="confirmation-submit"]').trigger('click');
    await flushPromises();
    expect(api.confirmCaseComplaint).toHaveBeenCalledWith(
      'case-1',
      expect.objectContaining({
        expectedVersion: 3,
        confirmedComplaintContentVersionId: 'complaint-v2',
        amountState: 'KNOWN',
        amount: '200.00',
        changeNote: '按客户修订版及补充金额确认',
        confirmDisclose: false,
      }),
    );
  });

  it('does not replace a pending amount with a fake zero', async () => {
    const pending = {
      ...detail,
      complaint: {
        ...detail.complaint!,
        amountState: 'PENDING',
        amount: null,
        pendingReason: '客户尚未提供金额资料',
      },
    } as CaseDetail;
    const { wrapper } = await mountPanel(pending);
    expect(wrapper.find('[data-test="confirmation-amount"]').exists()).toBe(
      false,
    );
    expect(wrapper.get('[data-test="pending-reason"]').element).toHaveProperty(
      'value',
      '客户尚未提供金额资料',
    );
  });

  it('retries an unknown confirmation with the original body and idempotency key', async () => {
    api.confirmCaseComplaint
      .mockRejectedValueOnce({ code: 'NETWORK_ERROR' })
      .mockResolvedValueOnce({
        id: 'case-1',
        stage: 'WAITING_COMPLAINT_STAMP',
        version: 4,
        confirmedAt: '2026-10-02T02:00:00Z',
      });
    const { wrapper } = await mountPanel();
    await wrapper.get('[data-test="confirm-disclose-false"]').setValue(true);
    await wrapper.get('[data-test="confirmation-review"]').trigger('click');
    await wrapper.get('[data-test="confirmation-submit"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('结果暂时未知');
    expect(
      wrapper.get('[data-test="confirmation-amount"]').element,
    ).toHaveProperty('disabled', true);
    await wrapper.get('[data-test="confirmation-retry"]').trigger('click');
    await flushPromises();
    const first = api.confirmCaseComplaint.mock.calls[0];
    const second = api.confirmCaseComplaint.mock.calls[1];
    expect(second).toEqual(first);
  });

  it('does not emit a late confirmation result after unmount', async () => {
    let resolveRequest!: (value: unknown) => void;
    api.confirmCaseComplaint.mockReturnValueOnce(
      new Promise((resolve) => (resolveRequest = resolve)),
    );
    const { wrapper } = await mountPanel();
    await wrapper.get('[data-test="confirm-disclose-false"]').setValue(true);
    await wrapper.get('[data-test="confirmation-review"]').trigger('click');
    await wrapper.get('[data-test="confirmation-submit"]').trigger('click');
    wrapper.unmount();
    resolveRequest({
      id: 'case-1',
      stage: 'WAITING_COMPLAINT_STAMP',
      version: 4,
      confirmedAt: '2026-10-02T02:00:00Z',
    });
    await flushPromises();
    expect(wrapper.emitted('changed')).toBeUndefined();
  });

  it('ignores a late confirmation after switching to another case', async () => {
    let resolveRequest!: (value: unknown) => void;
    api.confirmCaseComplaint.mockReturnValueOnce(
      new Promise((resolve) => (resolveRequest = resolve)),
    );
    const { wrapper } = await mountPanel();
    await wrapper.get('[data-test="confirm-disclose-false"]').setValue(true);
    await wrapper.get('[data-test="confirmation-review"]').trigger('click');
    await wrapper.get('[data-test="confirmation-submit"]').trigger('click');
    await wrapper.setProps({ item: { ...detail, id: 'case-2' } as CaseDetail });
    resolveRequest({
      id: 'case-1',
      stage: 'WAITING_COMPLAINT_STAMP',
      version: 4,
      confirmedAt: '2026-10-02T02:00:00Z',
    });
    await flushPromises();
    expect(wrapper.emitted('changed')).toBeUndefined();
    expect(wrapper.text()).not.toContain('诉状已确认');
  });

  it('ignores a late confirmation after switching authenticated users', async () => {
    let resolveRequest!: (value: unknown) => void;
    api.confirmCaseComplaint.mockReturnValueOnce(
      new Promise((resolve) => (resolveRequest = resolve)),
    );
    const { wrapper, auth } = await mountPanel();
    await wrapper.get('[data-test="confirm-disclose-false"]').setValue(true);
    await wrapper.get('[data-test="confirmation-review"]').trigger('click');
    await wrapper.get('[data-test="confirmation-submit"]').trigger('click');
    auth.session = {
      ...auth.session!,
      user: { ...auth.session!.user, id: 'user-2', username: 'other' },
      authorizationRevision: 2,
    };
    resolveRequest({
      id: 'case-1',
      stage: 'WAITING_COMPLAINT_STAMP',
      version: 4,
      confirmedAt: '2026-10-02T02:00:00Z',
    });
    await flushPromises();
    expect(wrapper.emitted('changed')).toBeUndefined();
    expect(wrapper.text()).not.toContain('诉状已确认');
  });
});
