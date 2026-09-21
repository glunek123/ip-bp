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

afterEach(() => {
  vi.resetAllMocks();
  document.body.innerHTML = '';
});

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

  it('reuses the same idempotency key when an ordinary failure is retried', async () => {
    customerApi.admitCustomer
      .mockRejectedValueOnce(
        new ApiError('暂时失败', 503, 'STORAGE_UNAVAILABLE', 'request-1'),
      )
      .mockResolvedValueOnce({
        ...customer,
        profileStatus: 'admitted',
        admittedAt: '2026-09-21T03:00:00.000Z',
        version: 2,
      });
    const wrapper = await mountPanel([fullMaterial]);
    await fillEnterpriseAdmission(wrapper);

    await wrapper.get('form').trigger('submit');
    await flushPromises();
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(customerApi.admitCustomer).toHaveBeenCalledTimes(2);
    expect(customerApi.admitCustomer.mock.calls[1]?.[2]).toBe(
      customerApi.admitCustomer.mock.calls[0]?.[2],
    );
  });

  it('accepts its own successful admission version without showing an external-change warning', async () => {
    const admitted = {
      ...customer,
      customerType: 'ENTERPRISE',
      identityType: 'BUSINESS_LICENSE',
      identityNumber: '91310000ABC123',
      identityValidityMode: 'LONG_TERM' as const,
      profileStatus: 'admitted' as const,
      admittedAt: '2026-09-21T03:00:00.000Z',
      version: 2,
      capabilities: { editRoutine: true, admit: false },
    };
    customerApi.admitCustomer.mockResolvedValue(admitted);
    const wrapper = await mountPanel([fullMaterial]);
    await fillEnterpriseAdmission(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    await wrapper.setProps({ customer: admitted });
    await flushPromises();

    expect(wrapper.text()).not.toContain('客户资料已在其他区域更新');
    expect(wrapper.text()).toContain('客户材料');
    expect(
      wrapper.find('[data-test="reload-customer-snapshot"]').exists(),
    ).toBe(false);
  });

  it('blocks stale local input when the parent supplies a newer customer snapshot', async () => {
    const wrapper = await mountPanel([fullMaterial]);
    await fillEnterpriseAdmission(wrapper);
    await wrapper.get('input[name="identityNumber"]').setValue('LOCAL-DRAFT');

    await wrapper.setProps({
      customer: {
        ...customer,
        version: 2,
        identityNumber: 'SERVER-VALUE',
        updatedAt: '2026-09-21T02:00:00.000Z',
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain('客户资料已在其他区域更新');
    expect(
      (wrapper.get('input[name="identityNumber"]').element as HTMLInputElement)
        .value,
    ).toBe('LOCAL-DRAFT');
    expect(
      wrapper.get('button[data-test="admit-submit"]').attributes('disabled'),
    ).toBeDefined();
    await wrapper.get('form').trigger('submit');
    expect(customerApi.admitCustomer).not.toHaveBeenCalled();

    await wrapper
      .get('[data-test="reload-customer-snapshot"]')
      .trigger('click');
    expect(
      (wrapper.get('input[name="identityNumber"]').element as HTMLInputElement)
        .value,
    ).toBe('SERVER-VALUE');
  });

  it('keeps a deleted material recoverable when a later reload returns a newly uploaded active material', async () => {
    materialApi.deleteMaterial.mockResolvedValue({
      id: 'material-1',
      status: 'DELETED',
      version: 2,
    });
    materialApi.uploadMaterialFile.mockResolvedValue({
      materialId: 'material-2',
      contentVersionId: 'version-2',
      originalFilename: '新证件.pdf',
      purpose: 'IDENTITY_FULL',
      mimeType: 'application/pdf',
      sizeBytes: 3,
      sha256: 'b'.repeat(64),
    });
    const newMaterial = {
      ...fullMaterial,
      id: 'material-2',
      currentVersionId: 'version-2',
      contentVersions: [
        {
          ...fullMaterial.contentVersions[0],
          id: 'version-2',
          materialId: 'material-2',
          originalFilename: '新证件.pdf',
          sha256: 'b'.repeat(64),
        },
      ],
    };
    materialApi.listOwnerMaterials
      .mockResolvedValueOnce({ items: [fullMaterial], total: 1 })
      .mockResolvedValueOnce({ items: [newMaterial], total: 1 });
    const wrapper = mount(CustomerAdmissionPanel, { props: { customer } });
    await flushPromises();
    await fillEnterpriseAdmission(wrapper);

    await wrapper
      .get('[data-test="remove-material-material-1"]')
      .trigger('click');
    await setFile(
      wrapper,
      new File(['pdf'], '新证件.pdf', { type: 'application/pdf' }),
    );
    await flushPromises();

    expect(wrapper.text()).toContain('证件.pdf');
    expect(wrapper.text()).toContain('新证件.pdf');
    expect(
      wrapper.find('[data-test="restore-material-material-1"]').exists(),
    ).toBe(true);
  });

  it('renders customer materials read-only and still allows authorized download', async () => {
    materialApi.downloadMaterialVersion.mockResolvedValue(undefined);
    materialApi.listOwnerMaterials.mockResolvedValue({
      items: [fullMaterial],
      total: 1,
    });
    const wrapper = mount(CustomerAdmissionPanel, {
      props: {
        customer: {
          ...customer,
          profileStatus: 'admitted',
          admittedAt: '2026-09-21T03:00:00.000Z',
          capabilities: { editRoutine: false, admit: false },
        },
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain('客户材料');
    expect(wrapper.find('input[name="identityDocument"]').exists()).toBe(false);
    expect(
      wrapper.find('[data-test="remove-material-material-1"]').exists(),
    ).toBe(false);
    await wrapper
      .get('[data-test="download-material-material-1"]')
      .trigger('click');
    expect(materialApi.downloadMaterialVersion).toHaveBeenCalledWith(
      'material-1',
      'version-1',
    );
  });

  it.each([
    ['CUSTOMER_DOCUMENT_INVALID', '证件材料已失效或不符合准入要求'],
    ['MATERIAL_VERSION_INVALID', '请刷新后重新选择有效材料'],
    ['ACTION_FORBIDDEN', '当前账号无权执行客户准入'],
  ])('maps %s to an actionable admission message', async (code, message) => {
    customerApi.admitCustomer.mockRejectedValue(
      new ApiError('rejected', code === 'ACTION_FORBIDDEN' ? 403 : 409, code),
    );
    const wrapper = await mountPanel([fullMaterial]);
    await fillEnterpriseAdmission(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain(message);
  });

  it('locates an identity duplicate at the certificate number field', async () => {
    customerApi.admitCustomer.mockRejectedValue(
      new ApiError('duplicate', 409, 'CUSTOMER_IDENTITY_DUPLICATE'),
    );
    materialApi.listOwnerMaterials.mockResolvedValue({
      items: [fullMaterial],
      total: 1,
    });
    const wrapper = mount(CustomerAdmissionPanel, {
      attachTo: document.body,
      props: { customer },
    });
    await flushPromises();
    await fillEnterpriseAdmission(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.text()).toContain('该证件号码已用于其他客户');
    expect(
      wrapper.get('input[name="identityNumber"]').attributes('aria-invalid'),
    ).toBe('true');
    expect(document.activeElement).toBe(
      wrapper.get('input[name="identityNumber"]').element,
    );
  });

  it('reports inaccessible materials without exposing mutation actions', async () => {
    materialApi.listOwnerMaterials.mockRejectedValue(
      new ApiError('forbidden', 403, 'ACTION_FORBIDDEN'),
    );
    const wrapper = mount(CustomerAdmissionPanel, { props: { customer } });
    await flushPromises();
    expect(wrapper.text()).toContain('当前账号无权查看客户材料');
  });

  it('reports forbidden upload as a permission problem', async () => {
    materialApi.uploadMaterialFile.mockRejectedValue(
      new ApiError('forbidden', 403, 'ACTION_FORBIDDEN'),
    );
    const wrapper = await mountPanel();
    await fillEnterpriseAdmission(wrapper);
    await setFile(
      wrapper,
      new File(['pdf'], '营业执照.pdf', { type: 'application/pdf' }),
    );
    await flushPromises();
    expect(wrapper.text()).toContain('当前账号无权上传客户材料');
  });

  it.each([
    ['VALIDATION_ERROR', '文件格式、内容或数量不符合要求'],
    ['MATERIAL_VERSION_INVALID', '材料版本已失效，请刷新后重新选择文件'],
  ])(
    'maps upload %s to an actionable material message',
    async (code, message) => {
      materialApi.uploadMaterialFile.mockRejectedValue(
        new ApiError('invalid', 400, code),
      );
      const wrapper = await mountPanel();
      await fillEnterpriseAdmission(wrapper);
      await setFile(
        wrapper,
        new File(['pdf'], '营业执照.pdf', { type: 'application/pdf' }),
      );
      await flushPromises();
      expect(wrapper.text()).toContain(message);
    },
  );

  it('reports forbidden removal without dropping the material card', async () => {
    materialApi.deleteMaterial.mockRejectedValue(
      new ApiError('forbidden', 403, 'ACTION_FORBIDDEN'),
    );
    const wrapper = await mountPanel([fullMaterial]);
    await wrapper
      .get('[data-test="remove-material-material-1"]')
      .trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('当前账号无权移除客户材料');
    expect(
      wrapper.find('[data-test="download-material-material-1"]').exists(),
    ).toBe(true);
  });

  it('emits customer-not-found when admission loses access to the customer', async () => {
    customerApi.admitCustomer.mockRejectedValue(
      new ApiError('hidden', 404, 'RESOURCE_NOT_FOUND'),
    );
    const wrapper = await mountPanel([fullMaterial]);
    await fillEnterpriseAdmission(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.emitted('customer-not-found')).toHaveLength(1);
  });

  it('emits customer-not-found when the material owner becomes inaccessible', async () => {
    materialApi.listOwnerMaterials.mockRejectedValue(
      new ApiError('hidden', 404, 'RESOURCE_NOT_FOUND'),
    );
    const wrapper = mount(CustomerAdmissionPanel, { props: { customer } });
    await flushPromises();
    expect(wrapper.emitted('customer-not-found')).toHaveLength(1);
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
