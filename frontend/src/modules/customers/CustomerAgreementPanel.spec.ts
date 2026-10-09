import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CustomerAgreementPanel from './CustomerAgreementPanel.vue';

const api = vi.hoisted(() => ({
  createCustomerAgreement: vi.fn(),
  getCustomerAgreement: vi.fn(),
  listCustomerAgreementVersions: vi.fn(),
  reviseCustomerAgreement: vi.fn(),
}));
const materialApi = vi.hoisted(() => ({
  downloadMaterialVersion: vi.fn(),
  listOwnerMaterials: vi.fn(),
  uploadMaterialFile: vi.fn(),
}));
vi.mock('../../api/customer-agreements-invoice', () => api);
vi.mock('../../api/materials', () => materialApi);

afterEach(() => {
  vi.resetAllMocks();
  globalThis.sessionStorage.clear();
});

const baseVersion = {
  id: 'agreement-version-3',
  agreementId: 'agreement-1',
  customerId: 'customer-1',
  departmentId: 'department-1',
  version: 3,
  title: '当前协议第三版',
  model: null,
  settlementMethod: null,
  validityMode: 'UNKNOWN',
  effectiveFrom: null,
  effectiveTo: null,
  contentVersionIds: ['content-current'],
  files: [
    {
      materialId: 'material-current',
      contentVersionId: 'content-current',
      originalFilename: '当前协议.pdf',
      mimeType: 'application/pdf',
    },
  ],
  recordedByUserId: 'user-1',
  recordedAt: '2026-10-09T00:00:00.000Z',
  auditEventId: 'audit-current',
};

const currentAgreement = {
  agreement: { id: 'agreement-1', version: 3, currentVersion: baseVersion },
  canEdit: true,
  customerVersion: 4,
};

function mountPanel(overrides: Record<string, unknown> = {}) {
  return mount(CustomerAgreementPanel, {
    props: {
      customerId: 'customer-1',
      customerVersion: 4,
      canRead: true,
      canEdit: true,
      actor: { userId: 'user-1', departmentId: 'department-1' },
      actorKey: 'user-1:department-1:8',
      blockedByOtherMaintenance: false,
      ...overrides,
    },
  });
}

describe('CustomerAgreementPanel', () => {
  it('does not fetch or render agreement data without the read capability', async () => {
    const wrapper = mountPanel({ canRead: false });
    await flushPromises();

    expect(api.getCustomerAgreement).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('当前没有协议读取权限');
    expect(wrapper.text()).not.toContain('当前协议第三版');
  });

  it('shows a receipt snapshot as a submission result and refreshes the actual current version', async () => {
    const receiptVersion = {
      ...baseVersion,
      id: 'agreement-version-1',
      version: 1,
      title: '提交时第一版',
    };
    const receipt = {
      agreement: {
        id: 'agreement-1',
        version: 1,
        currentVersion: receiptVersion,
      },
      canEdit: true,
      customerVersion: 2,
    };
    api.getCustomerAgreement
      .mockResolvedValueOnce({
        agreement: null,
        canEdit: true,
        customerVersion: 1,
      })
      .mockResolvedValueOnce(currentAgreement);
    api.createCustomerAgreement.mockResolvedValue(receipt);
    const wrapper = mountPanel({ customerVersion: 1 });
    await flushPromises();

    await wrapper.get('[data-test="agreement-edit"]').trigger('click');
    await wrapper.get('input[required]').setValue('提交时第一版');
    await wrapper.get('[data-test="agreement-form"]').trigger('submit');
    await flushPromises();

    expect(api.createCustomerAgreement).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('当前协议第三版');
    expect(wrapper.text()).not.toContain('提交时第一版</h3>');
    expect(wrapper.text()).toContain('当前第 3 版');
  });

  it('retries an unknown write with the original body and key', async () => {
    api.getCustomerAgreement.mockResolvedValue({
      agreement: null,
      canEdit: true,
      customerVersion: 1,
    });
    api.createCustomerAgreement
      .mockRejectedValueOnce(new Error('network lost'))
      .mockResolvedValueOnce({
        agreement: null,
        canEdit: true,
        customerVersion: 2,
      });
    const wrapper = mountPanel({ customerVersion: 1 });
    await flushPromises();
    vi.stubGlobal('crypto', {
      ...globalThis.crypto,
      randomUUID: () => 'original-key',
    });

    await wrapper.get('[data-test="agreement-edit"]').trigger('click');
    await wrapper.get('input[required]').setValue('待恢复协议');
    await wrapper.get('[data-test="agreement-form"]').trigger('submit');
    await flushPromises();
    const originalBody = api.createCustomerAgreement.mock.calls[0]?.[1];
    expect(wrapper.text()).toContain('协议请求结果未知');
    expect(globalThis.sessionStorage.length).toBe(1);

    await wrapper.get('[data-test="agreement-form"]').trigger('submit');
    await flushPromises();
    expect(api.createCustomerAgreement).toHaveBeenNthCalledWith(
      2,
      'customer-1',
      originalBody,
      'original-key',
    );
  });

  it('downloads historical agreement files by their exact material and content version ids', async () => {
    const historicalVersion = {
      ...baseVersion,
      id: 'agreement-version-2',
      version: 2,
      contentVersionIds: ['content-history'],
      files: [
        {
          materialId: 'material-history',
          contentVersionId: 'content-history',
          originalFilename: '历史协议.pdf',
          mimeType: 'application/pdf',
        },
      ],
    };
    api.getCustomerAgreement.mockResolvedValue(currentAgreement);
    api.listCustomerAgreementVersions.mockResolvedValue({
      items: [historicalVersion],
      total: 3,
      page: 1,
      pageSize: 20,
    });
    materialApi.downloadMaterialVersion.mockResolvedValue(undefined);
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper
      .get('[data-test="agreement-history-toggle"]')
      .trigger('click');
    await flushPromises();
    await wrapper
      .get('[data-test="history-download-content-history"]')
      .trigger('click');
    await flushPromises();

    expect(materialApi.downloadMaterialVersion).toHaveBeenCalledWith(
      'material-history',
      'content-history',
    );
  });

  it('requires a download and explicit selection to recover an unknown upload', async () => {
    api.getCustomerAgreement.mockResolvedValue(currentAgreement);
    materialApi.uploadMaterialFile.mockRejectedValue(new Error('network lost'));
    materialApi.listOwnerMaterials.mockResolvedValue({
      items: [
        {
          id: 'material-recovery',
          ownerType: 'CUSTOMER',
          ownerId: 'customer-1',
          category: 'CUSTOMER_AGREEMENT',
          purpose: 'CUSTOMER_AGREEMENT',
          currentVersionId: 'content-recovery',
          status: 'ACTIVE',
          version: 1,
          deletedAt: null,
          createdAt: '2026-10-09T00:00:00.000Z',
          updatedAt: '2026-10-09T00:00:00.000Z',
          contentVersions: [
            {
              id: 'content-recovery',
              materialId: 'material-recovery',
              originalFilename: '待核对.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 9,
              sha256: 'a'.repeat(64),
              status: 'AVAILABLE',
              createdAt: '2026-10-09T00:00:00.000Z',
            },
          ],
        },
      ],
      total: 1,
    });
    materialApi.downloadMaterialVersion.mockResolvedValue(undefined);
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.get('[data-test="agreement-edit"]').trigger('click');
    const fileInput = wrapper.get('input[type="file"]');
    Object.defineProperty(fileInput.element, 'files', {
      configurable: true,
      value: [new File(['pdf'], 'unknown.pdf', { type: 'application/pdf' })],
    });
    await fileInput.trigger('change');
    await flushPromises();
    expect(globalThis.sessionStorage.length).toBe(1);
    expect(wrapper.text()).toContain('不能再次上传');
    expect(materialApi.uploadMaterialFile).toHaveBeenCalledTimes(1);

    await wrapper
      .get('[data-test="agreement-recovery-refresh"]')
      .trigger('click');
    await flushPromises();
    await wrapper
      .get('[data-test="recovery-download-content-recovery"]')
      .trigger('click');
    await flushPromises();
    await wrapper
      .get('[data-test="recovery-adopt-content-recovery"]')
      .trigger('click');

    expect(materialApi.downloadMaterialVersion).toHaveBeenCalledWith(
      'material-recovery',
      'content-recovery',
    );
    expect(globalThis.sessionStorage.length).toBe(0);
    expect(materialApi.uploadMaterialFile).toHaveBeenCalledTimes(1);
  });
});
