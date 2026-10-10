import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import CustomerRightAssetsPanel from './CustomerRightAssetsPanel.vue';
import type { RightAssetRecoverySnapshot } from './customer-right-assets-recovery';

const api = vi.hoisted(() => ({
  listRightAssets: vi.fn(),
  getRightAsset: vi.fn(),
  createRightAsset: vi.fn(),
  reviseRightAsset: vi.fn(),
  withdrawRightAsset: vi.fn(),
}));
const holders = vi.hoisted(() => ({ listCustomerRightsHolders: vi.fn() }));
const customers = vi.hoisted(() => ({ getCustomer: vi.fn() }));
const materials = vi.hoisted(() => ({
  listOwnerMaterials: vi.fn(),
  uploadMaterialFile: vi.fn(),
  downloadMaterialVersion: vi.fn(),
}));
vi.mock('../../api/right-assets', () => api);
vi.mock('../../api/rights-holders', () => holders);
vi.mock('../../api/customers', () => customers);
vi.mock('../../api/materials', () => materials);

const holder = { id: 'holder-1', name: '主体甲' };
const fields = {
  id: 'version-1',
  version: 1,
  action: 'CREATE',
  type: 'TRADEMARK',
  name: '测试商标',
  number: null,
  category: '商标权',
  holderId: holder.id,
  ownerText: null,
  trademarkClass: null,
  validFrom: null,
  validTo: null,
  validityMode: 'UNKNOWN',
  withdrawReason: null,
  recordedByUserId: 'user-1',
  recordedAt: '2026-10-08T01:00:00.000Z',
  evidence: [],
};
const asset = {
  assetId: 'asset-1',
  customerId: 'customer-1',
  departmentId: 'department-1',
  version: 1,
  withdrawn: false,
  fields,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function setup(items = [asset], recoverySnapshot?: RightAssetRecoverySnapshot) {
  materials.listOwnerMaterials.mockResolvedValue({ items: [], total: 0 });
  customers.getCustomer.mockResolvedValue({
    version: 2,
    capabilities: { editRoutine: true },
  });
  api.listRightAssets.mockResolvedValue({
    items,
    total: items.length,
    page: 1,
    pageSize: 20,
    capabilities: { create: true },
  });
  api.getRightAsset.mockResolvedValue({
    ...asset,
    history: [fields],
    capabilities: { revise: true, withdraw: true },
  });
  holders.listCustomerRightsHolders.mockResolvedValue({
    items: [holder],
    total: 1,
    page: 1,
    pageSize: 100,
  });
  return mount(CustomerRightAssetsPanel, {
    props: {
      customerId: 'customer-1',
      customerVersion: 2,
      canEdit: true,
      actorUserId: 'user-1',
      actorDepartmentId: 'department-1',
      actorKey: 'user-1:department-1:1',
      blockedByOtherMaintenance: false,
      recoverySnapshot,
    },
  });
}
afterEach(() => vi.resetAllMocks());

describe('CustomerRightAssetsPanel', () => {
  it('restores the exact unknown command after an authorized remount', async () => {
    const first = setup([]);
    await flushPromises();
    await first.get('.right-assets-panel__header button').trigger('click');
    await first.get('input[required]').setValue('原始商标');
    await first.findAll('input')[2]!.setValue('商标权');
    await first.get('select[required]').setValue(holder.id);
    api.createRightAsset.mockRejectedValueOnce(new Error('response lost'));
    await first.get('form').trigger('submit');
    await flushPromises();
    const original = api.createRightAsset.mock.calls[0];
    const snapshot = first
      .emitted('recovery-snapshot')
      ?.at(-1)?.[2] as RightAssetRecoverySnapshot;
    expect(snapshot.command?.key).toBe(original[2]);
    first.unmount();
    const restored = setup([], snapshot);
    await flushPromises();
    expect(
      restored
        .findAll('button')
        .some((button) => button.text().includes('原请求重试')),
    ).toBe(true);
    api.createRightAsset.mockResolvedValueOnce({
      ...asset,
      customerVersion: 3,
    });
    await restored
      .findAll('button')
      .find((button) => button.text().includes('原请求重试'))!
      .trigger('click');
    await flushPromises();
    expect(api.createRightAsset.mock.calls[1][1]).toEqual(original[1]);
    expect(api.createRightAsset.mock.calls[1][2]).toBe(original[2]);
  });

  it('keeps a single uncertain upload frozen until a refreshed exact proof is downloaded and adopted', async () => {
    const wrapper = setup([]);
    await flushPromises();
    await wrapper.get('.right-assets-panel__header button').trigger('click');
    const file = wrapper.get('input[aria-label="选择权属证明文件"]');
    Object.defineProperty(file.element, 'files', {
      configurable: true,
      value: [
        new File(['proof'], 'uncertain.pdf', { type: 'application/pdf' }),
      ],
    });
    await file.trigger('change');
    materials.uploadMaterialFile.mockRejectedValueOnce(
      new Error('response lost'),
    );
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '上传证明')!
      .trigger('click');
    await flushPromises();
    expect(materials.uploadMaterialFile).toHaveBeenCalledTimes(1);
    expect(
      wrapper.get('form button[type="submit"]').attributes('disabled'),
    ).toBeDefined();
    expect(
      wrapper.get('.right-assets-panel__header button').attributes('disabled'),
    ).toBeDefined();
    expect(
      wrapper
        .findAll('button')
        .find((button) => button.text() === '取消')!
        .attributes('disabled'),
    ).toBeDefined();
    const proof = {
      id: 'version-recovered',
      materialId: 'material-recovered',
      originalFilename: 'uncertain.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 5,
      sha256: 'a'.repeat(64),
      status: 'AVAILABLE',
      createdAt: '2026-10-08T01:00:00Z',
    };
    materials.listOwnerMaterials.mockResolvedValueOnce({
      items: [
        {
          id: proof.materialId,
          ownerType: 'CUSTOMER',
          ownerId: 'customer-1',
          category: 'CUSTOMER_RIGHT_EVIDENCE',
          purpose: 'CUSTOMER_RIGHT_EVIDENCE',
          status: 'ACTIVE',
          contentVersions: [proof],
        },
      ],
      total: 1,
    });
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '刷新证明池')!
      .trigger('click');
    await flushPromises();
    expect(
      wrapper
        .findAll('button')
        .find((button) => button.text() === '选用此证明')!
        .attributes('disabled'),
    ).toBeDefined();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '下载核对')!
      .trigger('click');
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '选用此证明')!
      .trigger('click');
    await flushPromises();
    expect(materials.downloadMaterialVersion).toHaveBeenCalledWith(
      proof.materialId,
      proof.id,
    );
    expect(materials.uploadMaterialFile).toHaveBeenCalledTimes(1);
    expect(
      wrapper.get('.right-assets-panel__header button').attributes('disabled'),
    ).toBeUndefined();
  });

  it('clears uncertain upload state on customer and actor changes and ignores late old uploads', async () => {
    const wrapper = setup([]);
    await flushPromises();
    await wrapper.get('.right-assets-panel__header button').trigger('click');
    const file = wrapper.get('input[aria-label="选择权属证明文件"]');
    Object.defineProperty(file.element, 'files', {
      configurable: true,
      value: [new File(['proof'], 'late.pdf', { type: 'application/pdf' })],
    });
    await file.trigger('change');
    const late = deferred<unknown>();
    materials.uploadMaterialFile.mockReturnValueOnce(late.promise);
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '上传证明')!
      .trigger('click');
    await wrapper.setProps({
      actorUserId: 'user-2',
      actorKey: 'user-2:department-1:2',
    });
    late.reject(new Error('old response lost'));
    await flushPromises();
    expect(wrapper.emitted('maintenance-pending')?.at(-1)).toEqual([
      'customer-1',
      'user-2:department-1:2',
      false,
    ]);
    expect(wrapper.find('form').exists()).toBe(false);
    await wrapper.setProps({ customerId: 'customer-2' });
    await flushPromises();
    expect(wrapper.emitted('maintenance-pending')?.at(-1)).toEqual([
      'customer-2',
      'user-2:department-1:2',
      false,
    ]);
  });

  it('keeps an original unknown command across an authorization revision while rejecting the old response', async () => {
    const wrapper = setup([]);
    await flushPromises();
    await wrapper.get('.right-assets-panel__header button').trigger('click');
    await wrapper.get('input[required]').setValue('原始商标');
    await wrapper.findAll('input')[2]!.setValue('商标权');
    await wrapper.get('select[required]').setValue(holder.id);
    api.createRightAsset.mockRejectedValueOnce(new Error('response lost'));
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    const original = api.createRightAsset.mock.calls[0];
    await wrapper.setProps({ actorKey: 'user-1:department-1:2' });
    await flushPromises();
    expect(wrapper.emitted('maintenance-pending')?.at(-1)).toEqual([
      'customer-1',
      'user-1:department-1:2',
      true,
    ]);
    api.createRightAsset.mockResolvedValueOnce({
      ...asset,
      customerVersion: 3,
    });
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('原请求重试'))!
      .trigger('click');
    await flushPromises();
    expect(api.createRightAsset.mock.calls[1][1]).toEqual(original[1]);
    expect(api.createRightAsset.mock.calls[1][2]).toBe(original[2]);
  });

  it('visibly freezes an open batch when another maintenance command is unknown', async () => {
    const wrapper = setup([]);
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '批量上传权属')!
      .trigger('click');
    await wrapper.setProps({ blockedByOtherMaintenance: true });
    const batch = wrapper.get('section[aria-label="批量上传权属"]');
    expect(batch.get('fieldset').attributes('disabled')).toBeDefined();
    expect(
      batch.get('input[type="checkbox"]').attributes('disabled'),
    ).toBeDefined();
    expect(
      batch
        .findAll('button')
        .find((button) => button.text() === '确认登记')!
        .attributes('disabled'),
    ).toBeDefined();
    await batch
      .findAll('button')
      .find((button) => button.text() === '确认登记')!
      .trigger('click');
    expect(api.createRightAsset).not.toHaveBeenCalled();
  });

  it('keeps the panel mounted while another maintenance request blocks writes', async () => {
    const wrapper = setup([]);
    await wrapper.setProps({ blockedByOtherMaintenance: true });
    await flushPromises();
    expect(wrapper.find('[data-test="right-assets-frozen"]').exists()).toBe(
      true,
    );
    expect(wrapper.get('button').attributes('disabled')).toBeDefined();
    expect(api.createRightAsset).not.toHaveBeenCalled();
  });

  it('starts an eleventh registration after ten successful rows', async () => {
    const wrapper = setup([]);
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '批量上传权属')!
      .trigger('click');
    const batch = () => wrapper.get('section[aria-label="批量上传权属"]');
    const rows = () => batch().findAll('.right-assets-panel__batch-row');
    materials.uploadMaterialFile.mockImplementation(
      async ({ file }: { file: File }) => ({
        materialId: `material-${file.name}`,
        contentVersionId: `version-${file.name}`,
        originalFilename: file.name,
        mimeType: 'application/pdf',
        sizeBytes: 8,
        sha256: 'a'.repeat(64),
        purpose: 'CUSTOMER_RIGHT_EVIDENCE',
      }),
    );
    api.createRightAsset.mockImplementation(
      async (_id: string, body: { expectedCustomerVersion: number }) => ({
        ...asset,
        customerVersion: body.expectedCustomerVersion + 1,
      }),
    );
    for (let index = 1; index < 10; index++)
      await batch()
        .findAll('button')
        .find((button) => button.text() === '添加一行')!
        .trigger('click');
    for (let index = 0; index < 10; index++) {
      const row = rows()[index]!;
      await row
        .findAll('input[maxlength="200"]')[0]!
        .setValue(`成功行 ${index}`);
      await row.findAll('input[maxlength="200"]')[1]!.setValue('商标权');
      await row.findAll('select')[1]!.setValue(holder.id);
      const input = row.get('input[type="file"]');
      Object.defineProperty(input.element, 'files', {
        configurable: true,
        value: [
          new File(['%PDF-1.4'], `proof-${index}.pdf`, {
            type: 'application/pdf',
          }),
        ],
      });
      await input.trigger('change');
      await row
        .findAll('button')
        .find((button) => button.text() === '上传此行证明')!
        .trigger('click');
      await flushPromises();
      await row.get('input[type="checkbox"]').setValue(true);
      await batch()
        .findAll('button')
        .find((button) => button.text() === '确认登记')!
        .trigger('click');
      await flushPromises();
    }
    expect(rows()[0]!.text()).toContain('已上传并登记');
    expect(rows()[0]!.text()).not.toContain('尚未登记');
    await batch()
      .findAll('button')
      .find((button) => button.text().includes('下一批'))!
      .trigger('click');
    expect(rows().length).toBe(1);
    const eleventh = rows()[0]!;
    await eleventh.findAll('input[maxlength="200"]')[0]!.setValue('第十一行');
    await eleventh.findAll('input[maxlength="200"]')[1]!.setValue('商标权');
    await eleventh.findAll('select')[1]!.setValue(holder.id);
    const input = eleventh.get('input[type="file"]');
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [
        new File(['%PDF-1.4'], 'proof-11.pdf', { type: 'application/pdf' }),
      ],
    });
    await input.trigger('change');
    await eleventh
      .findAll('button')
      .find((button) => button.text() === '上传此行证明')!
      .trigger('click');
    await flushPromises();
    await eleventh.get('input[type="checkbox"]').setValue(true);
    await batch()
      .findAll('button')
      .find((button) => button.text() === '确认登记')!
      .trigger('click');
    await flushPromises();
    expect(api.createRightAsset).toHaveBeenCalledTimes(11);
    expect(api.createRightAsset.mock.calls[10][1]).toMatchObject({
      name: '第十一行',
      expectedCustomerVersion: 12,
      contentVersionIds: ['version-proof-11.pdf'],
    });
  });

  it('keeps a failed draft when starting another batch', async () => {
    const wrapper = setup([]);
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '批量上传权属')!
      .trigger('click');
    const batch = () => wrapper.get('section[aria-label="批量上传权属"]');
    await batch()
      .findAll('button')
      .find((button) => button.text() === '添加一行')!
      .trigger('click');
    const rows = () => batch().findAll('.right-assets-panel__batch-row');
    const first = rows()[0]!;
    await first.findAll('input[maxlength="200"]')[0]!.setValue('成功草稿');
    await first.findAll('input[maxlength="200"]')[1]!.setValue('商标权');
    await first.findAll('select')[1]!.setValue(holder.id);
    const input = first.get('input[type="file"]');
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [new File(['proof'], 'proof.pdf', { type: 'application/pdf' })],
    });
    await input.trigger('change');
    materials.uploadMaterialFile.mockResolvedValueOnce({
      materialId: 'material-1',
      contentVersionId: 'version-1',
      originalFilename: 'proof.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 5,
      sha256: 'a'.repeat(64),
      purpose: 'CUSTOMER_RIGHT_EVIDENCE',
    });
    await first
      .findAll('button')
      .find((button) => button.text() === '上传此行证明')!
      .trigger('click');
    await flushPromises();
    await first.get('input[type="checkbox"]').setValue(true);
    const failed = rows()[1]!;
    await failed.findAll('input[maxlength="200"]')[0]!.setValue('失败草稿');
    await failed.get('input[type="checkbox"]').setValue(true);
    api.createRightAsset.mockResolvedValueOnce({
      ...asset,
      customerVersion: 3,
    });
    await batch()
      .findAll('button')
      .find((button) => button.text() === '确认登记')!
      .trigger('click');
    await flushPromises();
    expect(rows()[1]!.text()).toContain('登记失败');
    await batch()
      .findAll('button')
      .find((button) => button.text().includes('下一批'))!
      .trigger('click');
    expect(rows().length).toBe(2);
    expect(
      (
        rows()[0]!.findAll('input[maxlength="200"]')[0]!
          .element as HTMLInputElement
      ).value,
    ).toBe('失败草稿');
    expect(rows()[0]!.text()).toContain('登记失败');
    expect(api.createRightAsset).toHaveBeenCalledTimes(1);
  });

  it('keeps an uploaded batch proof through repeat upload and file changes', async () => {
    const wrapper = setup([]);
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '批量上传权属')!
      .trigger('click');
    const row = wrapper.get('.right-assets-panel__batch-row');
    const input = row.get('input[type="file"]');
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [new File(['first'], 'first.pdf', { type: 'application/pdf' })],
    });
    await input.trigger('change');
    const inFlight = deferred<unknown>();
    materials.uploadMaterialFile.mockReturnValueOnce(inFlight.promise);
    const upload = () =>
      row.findAll('button').find((button) => button.text() === '上传此行证明')!;
    await upload().trigger('click');
    expect(input.attributes('disabled')).toBeDefined();
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [new File(['second'], 'second.pdf', { type: 'application/pdf' })],
    });
    await input.trigger('change');
    inFlight.resolve({
      materialId: 'material-first',
      contentVersionId: 'version-first',
      originalFilename: 'first.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 5,
      sha256: 'a'.repeat(64),
      purpose: 'CUSTOMER_RIGHT_EVIDENCE',
    });
    await flushPromises();
    expect(input.attributes('disabled')).toBeDefined();
    await upload().trigger('click');
    expect(materials.uploadMaterialFile).toHaveBeenCalledTimes(1);
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [new File(['third'], 'third.pdf', { type: 'application/pdf' })],
    });
    await input.trigger('change');
    await row.findAll('input[maxlength="200"]')[0]!.setValue('登记证明');
    await row.findAll('input[maxlength="200"]')[1]!.setValue('商标权');
    await row.findAll('select')[1]!.setValue(holder.id);
    await row.get('input[type="checkbox"]').setValue(true);
    api.createRightAsset.mockResolvedValueOnce({
      ...asset,
      customerVersion: 3,
    });
    await wrapper
      .get('section[aria-label="批量上传权属"]')
      .findAll('button')
      .find((button) => button.text() === '确认登记')!
      .trigger('click');
    await flushPromises();
    expect(api.createRightAsset.mock.calls[0][1].contentVersionIds).toEqual([
      'version-first',
    ]);
  });

  it('recovers an unknown upload by explicit pool selection without a second upload', async () => {
    const wrapper = setup([]);
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '批量上传权属')!
      .trigger('click');
    const row = wrapper.get('.right-assets-panel__batch-row');
    const input = row.get('input[type="file"]');
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [
        new File(['proof'], 'uncertain.pdf', { type: 'application/pdf' }),
      ],
    });
    await input.trigger('change');
    materials.uploadMaterialFile.mockRejectedValueOnce(
      new Error('response lost'),
    );
    await row
      .findAll('button')
      .find((button) => button.text() === '上传此行证明')!
      .trigger('click');
    await flushPromises();
    expect(row.text()).toContain('上传结果未知');
    expect(input.attributes('disabled')).toBeDefined();
    await row
      .findAll('button')
      .find((button) => button.text() === '上传此行证明')!
      .trigger('click');
    expect(materials.uploadMaterialFile).toHaveBeenCalledTimes(1);
    materials.listOwnerMaterials.mockResolvedValueOnce({
      items: [
        {
          id: 'material-recovered',
          ownerType: 'CUSTOMER',
          ownerId: 'customer-1',
          category: 'CUSTOMER_RIGHT_EVIDENCE',
          purpose: 'CUSTOMER_RIGHT_EVIDENCE',
          currentVersionId: 'version-recovered',
          status: 'ACTIVE',
          version: 1,
          deletedAt: null,
          createdAt: '2026-10-08T01:00:00Z',
          updatedAt: '2026-10-08T01:00:00Z',
          contentVersions: [
            {
              id: 'version-recovered',
              materialId: 'material-recovered',
              originalFilename: 'uncertain.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 5,
              sha256: 'a'.repeat(64),
              status: 'AVAILABLE',
              createdAt: '2026-10-08T01:00:00Z',
            },
          ],
        },
      ],
      total: 1,
    });
    await row
      .findAll('button')
      .find((button) => button.text().includes('刷新证明池'))!
      .trigger('click');
    await flushPromises();
    await row
      .findAll('button')
      .find((button) => button.text().includes('下载核对'))!
      .trigger('click');
    expect(materials.downloadMaterialVersion).toHaveBeenCalledWith(
      'material-recovered',
      'version-recovered',
    );
    await row
      .findAll('button')
      .find((button) => button.text().includes('选用此证明'))!
      .trigger('click');
    await row.findAll('input[maxlength="200"]')[0]!.setValue('恢复登记');
    await row.findAll('input[maxlength="200"]')[1]!.setValue('商标权');
    await row.findAll('select')[1]!.setValue(holder.id);
    await row.get('input[type="checkbox"]').setValue(true);
    api.createRightAsset.mockResolvedValueOnce({
      ...asset,
      customerVersion: 3,
    });
    await wrapper
      .get('section[aria-label="批量上传权属"]')
      .findAll('button')
      .find((button) => button.text() === '确认登记')!
      .trigger('click');
    await flushPromises();
    expect(materials.uploadMaterialFile).toHaveBeenCalledTimes(1);
    expect(api.createRightAsset.mock.calls[0][1].contentVersionIds).toEqual([
      'version-recovered',
    ]);
  });
  it('shows unknown term without claiming present legal validity and retains history', async () => {
    const wrapper = setup();
    await flushPromises();
    await wrapper.get('.right-assets-panel__list button').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('截止日期未知，未核验法律效力');
    expect(wrapper.text()).toContain('历史版本 · 1 条');
  });

  it('keeps the exact command key and body after unknown outcome', async () => {
    const wrapper = setup();
    await flushPromises();
    api.createRightAsset
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ...asset, customerVersion: 3 });
    await wrapper.get('.right-assets-panel__header button').trigger('click');
    await wrapper.get('input[required]').setValue('新商标');
    await wrapper.findAll('input')[2]!.setValue('商标权');
    await wrapper.get('select[required]').setValue(holder.id);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('请求结果未知');
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('原请求重试'))!
      .trigger('click');
    await flushPromises();
    expect(api.createRightAsset.mock.calls[1][1]).toEqual(
      api.createRightAsset.mock.calls[0][1],
    );
    expect(api.createRightAsset.mock.calls[1][2]).toBe(
      api.createRightAsset.mock.calls[0][2],
    );
    expect(wrapper.emitted('version-updated')?.[0]).toEqual(['customer-1', 3]);
  });

  it('keeps an already submitted command locked when retry is temporarily forbidden', async () => {
    const wrapper = setup();
    await flushPromises();
    let serverCommitted = false;
    api.createRightAsset
      .mockImplementationOnce(async () => {
        serverCommitted = true;
        throw new Error('response lost');
      })
      .mockRejectedValueOnce(
        new ApiError('权限暂不可用', 403, 'ACTION_FORBIDDEN'),
      )
      .mockImplementationOnce(async () => {
        expect(serverCommitted).toBe(true);
        return { ...asset, customerVersion: 3 };
      });
    await wrapper.get('.right-assets-panel__header button').trigger('click');
    await wrapper.get('input[required]').setValue('已提交商标');
    await wrapper.findAll('input')[2]!.setValue('商标权');
    await wrapper.get('select[required]').setValue(holder.id);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    const retry = () =>
      wrapper
        .findAll('button')
        .find((button) => button.text().includes('原请求重试'))!;
    await retry().trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('原请求结果仍未知');
    expect(
      wrapper.get('form button[type="submit"]').attributes('disabled'),
    ).toBeDefined();
    expect(api.createRightAsset).toHaveBeenCalledTimes(2);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.createRightAsset).toHaveBeenCalledTimes(2);
    await retry().trigger('click');
    await flushPromises();
    expect(api.createRightAsset).toHaveBeenCalledTimes(3);
    expect(
      api.createRightAsset.mock.calls.map((call) => [call[1], call[2]]),
    ).toEqual([
      [
        api.createRightAsset.mock.calls[0][1],
        api.createRightAsset.mock.calls[0][2],
      ],
      [
        api.createRightAsset.mock.calls[0][1],
        api.createRightAsset.mock.calls[0][2],
      ],
      [
        api.createRightAsset.mock.calls[0][1],
        api.createRightAsset.mock.calls[0][2],
      ],
    ]);
    expect(wrapper.emitted('version-updated')?.[0]).toEqual(['customer-1', 3]);
  });

  it('halts later batch rows until an unknown first row resolves after a forbidden retry', async () => {
    const wrapper = setup([]);
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '批量上传权属')!
      .trigger('click');
    const batch = () => wrapper.get('section[aria-label="批量上传权属"]');
    await batch()
      .findAll('button')
      .find((button) => button.text() === '添加一行')!
      .trigger('click');
    const rows = () => batch().findAll('.right-assets-panel__batch-row');
    for (let index = 0; index < 2; index++) {
      const row = rows()[index]!;
      await row.find('input[maxlength="200"]').setValue(`批量资产 ${index}`);
      await row.findAll('input[maxlength="200"]')[1]!.setValue('商标权');
      await row.find('select').setValue('TRADEMARK');
      await row.findAll('select')[1]!.setValue(holder.id);
      const input = row.get('input[type="file"]');
      Object.defineProperty(input.element, 'files', {
        configurable: true,
        value: [
          new File(['%PDF-1.4'], `proof-${index}.pdf`, {
            type: 'application/pdf',
          }),
        ],
      });
      await input.trigger('change');
      materials.uploadMaterialFile.mockResolvedValueOnce({
        materialId: `material-${index}`,
        contentVersionId: `version-${index}`,
        originalFilename: `proof-${index}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 8,
        sha256: 'a'.repeat(64),
        purpose: 'CUSTOMER_RIGHT_EVIDENCE',
      });
      await row
        .findAll('button')
        .find((button) => button.text() === '上传此行证明')!
        .trigger('click');
      await flushPromises();
      await row.get('input[type="checkbox"]').setValue(true);
    }
    api.createRightAsset
      .mockRejectedValueOnce(new Error('response lost'))
      .mockRejectedValueOnce(
        new ApiError('权限暂不可用', 403, 'ACTION_FORBIDDEN'),
      )
      .mockResolvedValueOnce({ ...asset, customerVersion: 3 })
      .mockResolvedValueOnce({ ...asset, customerVersion: 4 });
    await batch()
      .findAll('button')
      .find((button) => button.text() === '确认登记')!
      .trigger('click');
    await flushPromises();
    expect(api.createRightAsset).toHaveBeenCalledTimes(1);
    const unknownFile = rows()[0]!.get('input[type="file"]');
    expect(unknownFile.attributes('disabled')).toBeDefined();
    Object.defineProperty(unknownFile.element, 'files', {
      configurable: true,
      value: [
        new File(['replacement'], 'replacement.pdf', {
          type: 'application/pdf',
        }),
      ],
    });
    await unknownFile.trigger('change');
    await rows()[0]!
      .findAll('button')
      .find((button) => button.text() === '上传此行证明')!
      .trigger('click');
    expect(materials.uploadMaterialFile).toHaveBeenCalledTimes(2);
    await batch()
      .findAll('button')
      .find((button) => button.text().includes('原内容和幂等键重试'))!
      .trigger('click');
    await flushPromises();
    expect(api.createRightAsset).toHaveBeenCalledTimes(2);
    expect(batch().text()).toContain('原请求结果仍未知');
    expect(
      batch()
        .findAll('button')
        .find((button) => button.text() === '确认登记')!
        .attributes('disabled'),
    ).toBeDefined();
    await batch()
      .findAll('button')
      .find((button) => button.text().includes('原内容和幂等键重试'))!
      .trigger('click');
    await flushPromises();
    expect(api.createRightAsset).toHaveBeenCalledTimes(3);
    await batch()
      .findAll('button')
      .find((button) => button.text() === '确认登记')!
      .trigger('click');
    await flushPromises();
    expect(api.createRightAsset).toHaveBeenCalledTimes(4);
    expect(api.createRightAsset.mock.calls[1].slice(0, 3)).toEqual(
      api.createRightAsset.mock.calls[0].slice(0, 3),
    );
    expect(api.createRightAsset.mock.calls[2].slice(0, 3)).toEqual(
      api.createRightAsset.mock.calls[0].slice(0, 3),
    );
    expect(api.createRightAsset.mock.calls[3][1].expectedCustomerVersion).toBe(
      3,
    );
  });

  it('stops batch on 409 and waits for an explicit refresh before the next row', async () => {
    const wrapper = setup([]);
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '批量上传权属')!
      .trigger('click');
    const batch = () => wrapper.get('section[aria-label="批量上传权属"]');
    await batch()
      .findAll('button')
      .find((button) => button.text() === '添加一行')!
      .trigger('click');
    const rows = () => batch().findAll('.right-assets-panel__batch-row');
    for (let index = 0; index < 2; index++) {
      const row = rows()[index]!;
      await row
        .findAll('input[maxlength="200"]')[0]!
        .setValue(`冲突行 ${index}`);
      await row.findAll('input[maxlength="200"]')[1]!.setValue('商标权');
      await row.findAll('select')[1]!.setValue(holder.id);
      const input = row.get('input[type="file"]');
      Object.defineProperty(input.element, 'files', {
        configurable: true,
        value: [
          new File(['%PDF-1.4'], `proof-${index}.pdf`, {
            type: 'application/pdf',
          }),
        ],
      });
      await input.trigger('change');
      materials.uploadMaterialFile.mockResolvedValueOnce({
        materialId: `material-${index}`,
        contentVersionId: `version-${index}`,
        originalFilename: `proof-${index}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 8,
        sha256: 'a'.repeat(64),
        purpose: 'CUSTOMER_RIGHT_EVIDENCE',
      });
      await row
        .findAll('button')
        .find((button) => button.text() === '上传此行证明')!
        .trigger('click');
      await flushPromises();
      await row.get('input[type="checkbox"]').setValue(true);
    }
    api.createRightAsset.mockRejectedValueOnce(
      new ApiError('版本冲突', 409, 'CUSTOMER_VERSION_CONFLICT'),
    );
    await batch()
      .findAll('button')
      .find((button) => button.text() === '确认登记')!
      .trigger('click');
    await flushPromises();
    expect(api.createRightAsset).toHaveBeenCalledTimes(1);
    expect(batch().text()).toContain('剩余草稿已保留');
    customers.getCustomer.mockResolvedValueOnce({
      version: 7,
      capabilities: { editRoutine: true },
    });
    await batch()
      .findAll('button')
      .find((button) => button.text().includes('明确刷新版本'))!
      .trigger('click');
    await flushPromises();
    expect(api.createRightAsset).toHaveBeenCalledTimes(1);
    api.createRightAsset
      .mockResolvedValueOnce({ ...asset, customerVersion: 8 })
      .mockResolvedValueOnce({ ...asset, customerVersion: 9 });
    await batch()
      .findAll('button')
      .find((button) => button.text() === '确认登记')!
      .trigger('click');
    await flushPromises();
    expect(api.createRightAsset).toHaveBeenCalledTimes(3);
    expect(api.createRightAsset.mock.calls[1][1].expectedCustomerVersion).toBe(
      7,
    );
    expect(api.createRightAsset.mock.calls[2][1].expectedCustomerVersion).toBe(
      8,
    );
  });

  it('keeps a conflict draft until the user explicitly refreshes', async () => {
    const wrapper = setup();
    await flushPromises();
    api.createRightAsset.mockRejectedValue(
      new ApiError('版本冲突', 409, 'CUSTOMER_VERSION_CONFLICT'),
    );
    await wrapper.get('.right-assets-panel__header button').trigger('click');
    await wrapper.get('input[required]').setValue('新商标');
    await wrapper.findAll('input')[2]!.setValue('商标权');
    await wrapper.get('select[required]').setValue(holder.id);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('input[required]').element).toHaveProperty(
      'value',
      '新商标',
    );
    expect(
      wrapper.get('form button[type="submit"]').attributes('disabled'),
    ).toBeDefined();
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('明确刷新版本'))!
      .trigger('click');
    expect(wrapper.emitted('refresh-requested')?.[0]).toEqual(['customer-1']);
  });

  it('keeps revised fields through a completed 409 refresh and retries only after an explicit submit', async () => {
    const wrapper = setup();
    await flushPromises();
    await wrapper.get('.right-assets-panel__list button').trigger('click');
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '修订字段')!
      .trigger('click');
    await wrapper.get('input[placeholder="未知可留空"]').setValue('草稿号码');
    api.reviseRightAsset.mockRejectedValueOnce(
      new ApiError('版本冲突', 409, 'RIGHT_ASSET_VERSION_CONFLICT'),
    );
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    const latest = {
      ...asset,
      version: 2,
      fields: { ...fields, id: 'version-2', version: 2, number: '他人号码' },
      history: [fields],
      capabilities: { revise: true, withdraw: true },
    };
    api.getRightAsset.mockResolvedValueOnce(latest);
    customers.getCustomer.mockResolvedValueOnce({
      version: 4,
      capabilities: { editRoutine: true },
    });
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('明确刷新版本'))!
      .trigger('click');
    await flushPromises();
    expect(
      wrapper.get('input[placeholder="未知可留空"]').element,
    ).toHaveProperty('value', '草稿号码');
    expect(wrapper.text()).toContain('他人号码');
    expect(wrapper.text()).toContain('草稿来源');
    expect(api.reviseRightAsset).toHaveBeenCalledTimes(1);
    expect(
      wrapper.get('form button[type="submit"]').attributes('disabled'),
    ).toBeUndefined();
    await wrapper.setProps({ customerVersion: 4 });
    expect(
      wrapper.get('form button[type="submit"]').attributes('disabled'),
    ).toBeUndefined();
    api.reviseRightAsset.mockResolvedValueOnce({
      ...latest,
      customerVersion: 5,
    });
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.reviseRightAsset.mock.calls[1][2]).toMatchObject({
      number: '草稿号码',
      expectedCustomerVersion: 4,
      expectedAssetVersion: 2,
    });
  });

  it('unlocks a refreshed asset conflict when the authoritative customer version stays the same', async () => {
    const wrapper = setup();
    await flushPromises();
    await wrapper.get('.right-assets-panel__list button').trigger('click');
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '修订字段')!
      .trigger('click');
    await wrapper.get('input[placeholder="未知可留空"]').setValue('新号码');
    api.reviseRightAsset.mockRejectedValueOnce(
      new ApiError('资产版本冲突', 409, 'RIGHT_ASSET_VERSION_CONFLICT'),
    );
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    api.getRightAsset.mockResolvedValueOnce({
      ...asset,
      version: 2,
      fields: { ...fields, version: 2 },
      history: [fields],
      capabilities: { revise: true, withdraw: true },
    });
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('明确刷新版本'))!
      .trigger('click');
    await flushPromises();
    expect(customers.getCustomer).toHaveBeenCalledTimes(1);
    expect(
      wrapper.get('form button[type="submit"]').attributes('disabled'),
    ).toBeUndefined();
    api.reviseRightAsset.mockResolvedValueOnce({
      ...asset,
      customerVersion: 3,
    });
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.reviseRightAsset.mock.calls[1][2]).toMatchObject({
      expectedCustomerVersion: 2,
      expectedAssetVersion: 2,
      number: '新号码',
    });
  });

  it('keeps a new create draft when an older detail request resolves late', async () => {
    const wrapper = setup();
    const slow = deferred<unknown>();
    api.getRightAsset.mockReturnValueOnce(slow.promise);
    await flushPromises();
    await wrapper.get('.right-assets-panel__list button').trigger('click');
    await wrapper.get('.right-assets-panel__header button').trigger('click');
    await wrapper.get('input[required]').setValue('新登记草稿');
    slow.resolve({
      ...asset,
      history: [fields],
      capabilities: { revise: true, withdraw: true },
    });
    await flushPromises();
    expect(wrapper.get('input[required]').element).toHaveProperty(
      'value',
      '新登记草稿',
    );
    expect(wrapper.find('.right-assets-panel__detail').exists()).toBe(false);
  });

  it.each([
    new ApiError('服务暂时不可用', 500, 'HTTP_ERROR'),
    new ApiError('数据无效', 200, 'INVALID_RESPONSE'),
  ])(
    'freezes an unknown create request through edits, parent version changes and retry: %s',
    async (failure) => {
      const wrapper = setup();
      await flushPromises();
      api.createRightAsset
        .mockRejectedValueOnce(failure)
        .mockResolvedValueOnce({ ...asset, customerVersion: 3 });
      await wrapper.get('.right-assets-panel__header button').trigger('click');
      await wrapper.get('input[required]').setValue('原始商标');
      await wrapper.findAll('input')[2]!.setValue('商标权');
      await wrapper.get('select[required]').setValue(holder.id);
      await wrapper.get('form').trigger('submit');
      await flushPromises();
      await wrapper.setProps({ customerVersion: 9 });
      expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined();
      expect(
        wrapper
          .get('.right-assets-panel__header button')
          .attributes('disabled'),
      ).toBeDefined();
      await wrapper
        .findAll('button')
        .find((button) => button.text() === '取消')!
        .trigger('click');
      expect(wrapper.find('form').exists()).toBe(true);
      expect(
        wrapper
          .findAll('button')
          .some((button) => button.text().includes('原请求重试')),
      ).toBe(true);
      await wrapper
        .findAll('button')
        .find((button) => button.text().includes('原请求重试'))!
        .trigger('click');
      await flushPromises();
      expect(api.createRightAsset.mock.calls[1][1]).toEqual(
        api.createRightAsset.mock.calls[0][1],
      );
      expect(api.createRightAsset.mock.calls[1][2]).toBe(
        api.createRightAsset.mock.calls[0][2],
      );
    },
  );

  it('keeps the latest detail selection when an earlier detail resolves late', async () => {
    const another = {
      ...asset,
      assetId: 'asset-2',
      fields: { ...fields, name: '商标 B' },
    };
    const wrapper = setup([asset, another]);
    const slowA = deferred<unknown>();
    const fastB = deferred<unknown>();
    api.getRightAsset
      .mockReset()
      .mockReturnValueOnce(slowA.promise)
      .mockReturnValueOnce(fastB.promise);
    await flushPromises();
    const buttons = wrapper.findAll('.right-assets-panel__list button');
    await buttons[0]!.trigger('click');
    await buttons[1]!.trigger('click');
    fastB.resolve({
      ...another,
      history: [another.fields],
      capabilities: { revise: true, withdraw: true },
    });
    await flushPromises();
    slowA.resolve({
      ...asset,
      history: [fields],
      capabilities: { revise: true, withdraw: true },
    });
    await flushPromises();
    expect(wrapper.get('.right-assets-panel__detail h3').text()).toContain(
      '商标 B',
    );
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '修订字段')!
      .trigger('click');
    api.reviseRightAsset.mockResolvedValueOnce({
      ...another,
      customerVersion: 3,
    });
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.reviseRightAsset.mock.calls[0][1]).toBe('asset-2');
  });

  it('retries an unknown revision with its frozen body after the parent version changes', async () => {
    const wrapper = setup();
    await flushPromises();
    await wrapper.get('.right-assets-panel__list button').trigger('click');
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '修订字段')!
      .trigger('click');
    await wrapper.get('input[placeholder="未知可留空"]').setValue('原始修订号');
    api.reviseRightAsset
      .mockRejectedValueOnce(new ApiError('无效响应', 200, 'INVALID_RESPONSE'))
      .mockResolvedValueOnce({ ...asset, customerVersion: 3 });
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    await wrapper.setProps({ customerVersion: 10 });
    expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined();
    expect(
      wrapper.get('.right-assets-panel__list button').attributes('disabled'),
    ).toBeDefined();
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('原请求重试'))!
      .trigger('click');
    await flushPromises();
    expect(api.reviseRightAsset.mock.calls[1].slice(0, 4)).toEqual(
      api.reviseRightAsset.mock.calls[0].slice(0, 4),
    );
  });

  it('holds an unknown withdrawal even when its same-key retry is forbidden', async () => {
    const wrapper = setup();
    await flushPromises();
    await wrapper.get('.right-assets-panel__list button').trigger('click');
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '撤下资产')!
      .trigger('click');
    await wrapper.get('input[maxlength="500"]').setValue('原始撤下原因');
    api.withdrawRightAsset
      .mockRejectedValueOnce(new ApiError('服务错误', 500, 'HTTP_ERROR'))
      .mockRejectedValueOnce(new ApiError('已撤权', 403, 'FORBIDDEN'));
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '确认撤下')!
      .trigger('click');
    await flushPromises();
    await wrapper.setProps({ customerVersion: 9 });
    expect(
      wrapper.get('input[maxlength="500"]').attributes('disabled'),
    ).toBeDefined();
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('原请求重试'))!
      .trigger('click');
    await flushPromises();
    expect(api.withdrawRightAsset.mock.calls[1].slice(0, 4)).toEqual(
      api.withdrawRightAsset.mock.calls[0].slice(0, 4),
    );
    expect(
      wrapper
        .findAll('button')
        .some((button) => button.text().includes('原请求重试')),
    ).toBe(true);
    expect(wrapper.text()).toContain('已撤权');
    expect(wrapper.text()).toContain('原请求结果仍未知');
  });

  it('treats a successful command as committed even if the following read refresh fails', async () => {
    const wrapper = setup();
    await flushPromises();
    await wrapper.get('.right-assets-panel__header button').trigger('click');
    await wrapper.get('input[required]').setValue('已登记商标');
    await wrapper.findAll('input')[2]!.setValue('商标权');
    await wrapper.get('select[required]').setValue(holder.id);
    api.createRightAsset.mockResolvedValueOnce({
      ...asset,
      customerVersion: 3,
    });
    api.listRightAssets.mockRejectedValueOnce(
      new ApiError('读取失败', 500, 'HTTP_ERROR'),
    );
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.emitted('version-updated')?.[0]).toEqual(['customer-1', 3]);
    expect(api.createRightAsset).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('登记已成功，但列表刷新失败');
    expect(
      wrapper
        .findAll('button')
        .some((button) => button.text().includes('原请求重试')),
    ).toBe(false);
  });

  it('keeps a withdrawn latest revision draft inspectable but blocks resubmit', async () => {
    const wrapper = setup();
    await flushPromises();
    await wrapper.get('.right-assets-panel__list button').trigger('click');
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '修订字段')!
      .trigger('click');
    await wrapper.get('input[placeholder="未知可留空"]').setValue('保留的草稿');
    api.reviseRightAsset.mockRejectedValueOnce(
      new ApiError('版本冲突', 409, 'RIGHT_ASSET_VERSION_CONFLICT'),
    );
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    api.getRightAsset.mockResolvedValueOnce({
      ...asset,
      version: 2,
      withdrawn: true,
      history: [fields],
      capabilities: { revise: false, withdraw: false },
    });
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('明确刷新版本'))!
      .trigger('click');
    await flushPromises();
    expect(
      wrapper.get('input[placeholder="未知可留空"]').element,
    ).toHaveProperty('value', '保留的草稿');
    expect(
      wrapper.get('form button[type="submit"]').attributes('disabled'),
    ).toBeDefined();
    expect(api.reviseRightAsset).toHaveBeenCalledTimes(1);
  });
});
