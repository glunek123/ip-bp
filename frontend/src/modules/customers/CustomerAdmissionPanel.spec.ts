import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import CustomerAdmissionPanel from './CustomerAdmissionPanel.vue';

const customerApi = vi.hoisted(() => ({
  admitCustomer: vi.fn(),
  getCustomer: vi.fn(),
}));
const materialApi = vi.hoisted(() => ({
  uploadMaterialFile: vi.fn(),
  listOwnerMaterials: vi.fn(),
  downloadMaterialVersion: vi.fn(),
  deleteMaterial: vi.fn(),
  restoreMaterial: vi.fn(),
}));
vi.mock('../../api/customers', () => customerApi);
vi.mock('../../api/materials', () => materialApi);

const customer = {
  id: 'customer-1',
  name: '客户甲',
  customerType: null,
  identityType: null,
  identityNumber: null,
  issuingCountryOrRegion: null,
  identityValidFrom: null,
  identityValidTo: null,
  identityValidityMode: null,
  admittedAt: null,
  category: null,
  region: null,
  admissionContactName: '张三',
  admissionContactPhone: '13800138000',
  admissionContactEmail: null,
  profileStatus: 'draft' as const,
  departmentId: 'department-1',
  responsibleUserId: 'user-1',
  version: 1,
  updatedAt: '2026-09-21T01:00:00.000Z',
  capabilities: { editRoutine: true, admit: true },
  history: [],
};

const fullMaterial = {
  id: 'material-1',
  ownerType: 'CUSTOMER',
  ownerId: 'customer-1',
  category: 'CUSTOMER_IDENTITY',
  purpose: 'IDENTITY_FULL',
  currentVersionId: 'version-1',
  status: 'ACTIVE',
  version: 1,
  deletedAt: null,
  createdAt: '2026-09-21T01:00:00.000Z',
  updatedAt: '2026-09-21T01:00:00.000Z',
  contentVersions: [
    {
      id: 'version-1',
      materialId: 'material-1',
      originalFilename: '证件.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      sha256: 'a'.repeat(64),
      status: 'AVAILABLE',
      createdAt: '2026-09-21T01:00:00.000Z',
    },
  ],
};

afterEach(() => vi.resetAllMocks());

async function mountPanel(items: object[] = []) {
  materialApi.listOwnerMaterials.mockResolvedValue({
    items,
    total: items.length,
  });
  const wrapper = mount(CustomerAdmissionPanel, { props: { customer } });
  await flushPromises();
  return wrapper;
}

async function setFile(wrapper: ReturnType<typeof mount>, file: File) {
  const input = wrapper.get('input[name="identityDocument"]');
  Object.defineProperty(input.element, 'files', {
    configurable: true,
    value: [file],
  });
  await input.trigger('change');
}

async function fillEnterpriseAdmission(wrapper: ReturnType<typeof mount>) {
  await wrapper.get('select[name="customerType"]').setValue('ENTERPRISE');
  await wrapper.get('select[name="identityType"]').setValue('BUSINESS_LICENSE');
  await wrapper.get('input[name="identityNumber"]').setValue('91310000ABC123');
  await wrapper
    .get('select[name="identityValidityMode"]')
    .setValue('LONG_TERM');
}

describe('CustomerAdmissionPanel', () => {
  it('links identity choices to the selected subject type', async () => {
    const wrapper = await mountPanel();

    await wrapper.get('select[name="customerType"]').setValue('NATURAL_PERSON');

    const identityOptions = wrapper
      .get('select[name="identityType"]')
      .findAll('option')
      .map((option) => option.attributes('value'));
    expect(identityOptions).toEqual([
      '',
      'NATIONAL_ID',
      'PASSPORT',
      'OTHER_VALID_ID',
    ]);

    await wrapper.get('select[name="identityType"]').setValue('NATIONAL_ID');
    expect(wrapper.text()).toContain('正反面合并 PDF');
    expect(wrapper.text()).toContain('人像面');
    expect(wrapper.text()).toContain('国徽面');
  });

  it('rejects unsupported, oversized, and over-count file selections before upload', async () => {
    const wrapper = await mountPanel();
    await fillEnterpriseAdmission(wrapper);

    await setFile(
      wrapper,
      new File(['plain text'], '证件.txt', { type: 'text/plain' }),
    );
    expect(wrapper.text()).toContain('仅支持 PDF、JPG/JPEG、PNG');
    expect(materialApi.uploadMaterialFile).not.toHaveBeenCalled();

    const oversized = new File(['x'], '过大.pdf', { type: 'application/pdf' });
    Object.defineProperty(oversized, 'size', { value: 20 * 1024 * 1024 + 1 });
    await setFile(wrapper, oversized);
    expect(wrapper.text()).toContain('不能超过 20MB');

    materialApi.listOwnerMaterials.mockResolvedValue({
      items: Array.from({ length: 10 }, (_, index) => ({
        ...fullMaterial,
        id: `material-${index}`,
        currentVersionId: `version-${index}`,
      })),
      total: 10,
    });
    await wrapper.get('[data-test="reload-materials"]').trigger('click');
    await flushPromises();
    await setFile(
      wrapper,
      new File(['pdf'], '第11份.pdf', { type: 'application/pdf' }),
    );
    expect(wrapper.text()).toContain('最多保留 10 份');
  });

  it('shows upload progress without losing the admission draft', async () => {
    let resolveUpload: ((value: unknown) => void) | undefined;
    materialApi.uploadMaterialFile.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve;
        }),
    );
    const wrapper = await mountPanel();
    await fillEnterpriseAdmission(wrapper);
    await wrapper.get('input[name="identityNumber"]').setValue('MY-DRAFT');

    const uploadPromise = setFile(
      wrapper,
      new File(['pdf'], '营业执照.pdf', { type: 'application/pdf' }),
    );
    await flushPromises();

    expect(wrapper.text()).toContain('正在上传营业执照.pdf');
    expect(
      wrapper.get('button[data-test="admit-submit"]').attributes('disabled'),
    ).toBeDefined();
    resolveUpload?.({
      materialId: 'material-1',
      contentVersionId: 'version-1',
      originalFilename: '营业执照.pdf',
      purpose: 'IDENTITY_FULL',
      mimeType: 'application/pdf',
      sizeBytes: 3,
      sha256: 'a'.repeat(64),
    });
    materialApi.listOwnerMaterials.mockResolvedValue({
      items: [fullMaterial],
      total: 1,
    });
    await uploadPromise;
    await flushPromises();
    expect(
      (wrapper.get('input[name="identityNumber"]').element as HTMLInputElement)
        .value,
    ).toBe('MY-DRAFT');
    expect(wrapper.text()).toContain('证件.pdf');
  });

  it('validates contact, fixed validity, and both sides of a national ID', async () => {
    const frontOnly = {
      ...fullMaterial,
      purpose: 'IDENTITY_FRONT',
      contentVersions: [
        {
          ...fullMaterial.contentVersions[0],
          originalFilename: '身份证人像面.png',
          mimeType: 'image/png',
        },
      ],
    };
    const wrapper = await mountPanel([frontOnly]);
    await wrapper.get('select[name="customerType"]').setValue('NATURAL_PERSON');
    await wrapper.get('select[name="identityType"]').setValue('NATIONAL_ID');
    await wrapper
      .get('input[name="identityNumber"]')
      .setValue('310101199001010000');
    await wrapper.get('select[name="identityValidityMode"]').setValue('FIXED');
    await wrapper.get('input[name="admissionContactPhone"]').setValue('');
    await wrapper.get('form').trigger('submit');

    expect(wrapper.text()).toContain('联系人至少填写电话或邮箱');
    expect(wrapper.text()).toContain('固定有效期请填写截止日期');
    expect(wrapper.text()).toContain(
      '身份证需要合并 PDF，或同时上传人像面和国徽面',
    );
    expect(customerApi.admitCustomer).not.toHaveBeenCalled();
  });

  it('preserves the form on failure and prevents duplicate admission requests', async () => {
    let rejectAdmission: ((reason?: unknown) => void) | undefined;
    customerApi.admitCustomer.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectAdmission = reject;
        }),
    );
    const wrapper = await mountPanel([fullMaterial]);
    await fillEnterpriseAdmission(wrapper);
    await wrapper.get('form').trigger('submit');
    await wrapper.get('form').trigger('submit');

    expect(customerApi.admitCustomer).toHaveBeenCalledTimes(1);
    rejectAdmission?.(
      new ApiError('暂时失败', 503, 'STORAGE_UNAVAILABLE', 'request-1'),
    );
    await flushPromises();
    expect(wrapper.text()).toContain('准入没有完成');
    expect(
      (wrapper.get('input[name="identityNumber"]').element as HTMLInputElement)
        .value,
    ).toBe('91310000ABC123');
  });

  it('reloads stale data, preserves input, and retries only after review', async () => {
    customerApi.admitCustomer
      .mockRejectedValueOnce(
        new ApiError('版本冲突', 409, 'CUSTOMER_VERSION_CONFLICT'),
      )
      .mockResolvedValueOnce({
        ...customer,
        profileStatus: 'admitted',
        admittedAt: '2026-09-21T03:00:00.000Z',
        version: 3,
      });
    customerApi.getCustomer.mockResolvedValue({ ...customer, version: 2 });
    const wrapper = await mountPanel([fullMaterial]);
    await fillEnterpriseAdmission(wrapper);
    await wrapper.get('input[name="identityNumber"]').setValue('MY-DRAFT');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(customerApi.getCustomer).toHaveBeenCalledWith('customer-1');
    expect(materialApi.listOwnerMaterials).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain('已读取最新版本 2');
    expect(
      (wrapper.get('input[name="identityNumber"]').element as HTMLInputElement)
        .value,
    ).toBe('MY-DRAFT');
    expect(customerApi.admitCustomer).toHaveBeenCalledTimes(1);

    await wrapper.get('button[data-test="retry-admission"]').trigger('click');
    await flushPromises();
    expect(customerApi.admitCustomer).toHaveBeenLastCalledWith(
      'customer-1',
      expect.objectContaining({
        expectedVersion: 2,
        identityNumber: 'MY-DRAFT',
      }),
      expect.any(String),
    );
    expect(wrapper.emitted('admitted')).toHaveLength(1);
  });
});
