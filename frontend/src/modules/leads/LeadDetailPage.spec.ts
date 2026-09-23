import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LeadDetailPage from './LeadDetailPage.vue';

const leadApi = vi.hoisted(() => ({ getLead: vi.fn(), pushLead: vi.fn() }));
const customerApi = vi.hoisted(() => ({ getCustomer: vi.fn() }));
const holderApi = vi.hoisted(() => ({ getCustomerRightsHolder: vi.fn() }));
const materialApi = vi.hoisted(() => ({
  listOwnerMaterials: vi.fn(),
  downloadMaterialVersion: vi.fn(),
}));
vi.mock('../../api/leads', () => leadApi);
vi.mock('../../api/customers', () => customerApi);
vi.mock('../../api/rights-holders', () => holderApi);
vi.mock('../../api/materials', () => materialApi);

const lead = {
  id: 'lead-1',
  businessNo: 'LD-20260921-001',
  customerId: 'customer-1',
  rightsHolderId: 'holder-1',
  status: 'WAITING_PUSH',
  caseType: 'CIVIL',
  infringementTypes: ['TRADEMARK'],
  source: 'ONLINE',
  platform: 'TAOBAO',
  foundAt: '2026-09-21T04:00:00Z',
  shopName: '测试店铺',
  shopExternalId: null,
  needDisclose: true,
  remark: '备注',
  products: [
    {
      id: 'p',
      position: 1,
      title: '商品甲',
      url: null,
      quantity: 2,
      unitPrice: '3.00',
      commentCount: 0,
      estimatedAmount: '6.00',
    },
  ],
  leadScreenshotContentVersionIds: ['version-1'],
  version: 1,
  pushedAt: null,
  pushedByUserId: null,
  pushedByDisplayName: null,
  reviewDecision: null,
  createdAt: '2026-09-21T04:00:00Z',
  updatedAt: '2026-09-21T04:00:00Z',
  capabilities: { edit: true, push: true },
  departmentId: 'd',
  responsibleUserId: 'u',
  teamId: null,
  creationChannel: 'MANUAL',
  externalSourceRef: null,
};

async function mountPage() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/leads/:id', component: LeadDetailPage },
      { path: '/leads/:id/edit', component: { template: '<div />' } },
      { path: '/leads', component: { template: '<div />' } },
    ],
  });
  await router.push('/leads/lead-1');
  await router.isReady();
  const wrapper = mount(LeadDetailPage, { global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.resetAllMocks();
  leadApi.getLead.mockResolvedValue(lead);
  customerApi.getCustomer.mockResolvedValue({
    id: 'customer-1',
    name: '客户甲',
  });
  holderApi.getCustomerRightsHolder.mockResolvedValue({
    id: 'holder-1',
    name: '主体甲',
  });
  materialApi.listOwnerMaterials.mockResolvedValue({
    items: [
      {
        id: 'material-1',
        status: 'ACTIVE',
        currentVersionId: 'version-1',
        contentVersions: [
          { id: 'version-1', originalFilename: '侵权截图.png' },
        ],
      },
    ],
    total: 1,
  });
  materialApi.downloadMaterialVersion.mockResolvedValue(undefined);
  leadApi.pushLead.mockResolvedValue({
    id: lead.id,
    businessNo: lead.businessNo,
    status: 'WAITING_REVIEW',
    version: 2,
    pushedAt: '2026-09-22T02:00:00.000Z',
    pushedByUserId: 'u',
    pushedByDisplayName: '运营甲',
  });
});

describe('LeadDetailPage', () => {
  it('requires confirmation before pushing and does nothing when cancelled', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const wrapper = await mountPage();

    await wrapper.get('[data-test="push-lead"]').trigger('click');

    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining('状态将变为“线索待审核”'),
    );
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('客户甲'));
    expect(leadApi.pushLead).not.toHaveBeenCalled();
  });

  it('uses the Demo detail grid, product table and attachment section', async () => {
    const wrapper = await mountPage();

    expect(wrapper.get('[data-test="lead-facts"]').classes()).toContain(
      'demo-detail-grid',
    );
    expect(
      wrapper.get('[data-test="lead-products-table"]').find('table').exists(),
    ).toBe(true);
    expect(wrapper.get('[data-test="lead-attachments"]').text()).toContain(
      '侵权截图.png',
    );
  });

  it('renders real detail fields, record information and push action', async () => {
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('权利人');
    expect(wrapper.text()).toContain('拟办理业务类型');
    expect(wrapper.text()).not.toContain('权利主体');
    expect(wrapper.text()).not.toContain('案件类型');
    expect(wrapper.text()).toContain('客户甲');
    expect(wrapper.text()).toContain('主体甲');
    expect(wrapper.text()).toContain('测试店铺');
    expect(wrapper.text()).toContain('商品甲');
    expect(wrapper.text()).toContain('6.00');
    expect(wrapper.text()).toContain('侵权截图.png');
    expect(wrapper.text()).toContain('版本 1');
    expect(wrapper.find('[data-test="push-lead"]').exists()).toBe(true);
    expect(materialApi.listOwnerMaterials).toHaveBeenCalledWith(
      'LEAD',
      'lead-1',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    await wrapper
      .get('[data-test="download-screenshot-version-1"]')
      .trigger('click');
    expect(materialApi.downloadMaterialVersion).toHaveBeenCalledWith(
      'material-1',
      'version-1',
    );
  });

  it('shows edit only from the server capability and supports refresh', async () => {
    const wrapper = await mountPage();
    expect(wrapper.find('[data-test="edit-lead"]').exists()).toBe(true);
    leadApi.getLead.mockResolvedValueOnce({
      ...lead,
      capabilities: { edit: false, push: false },
    });
    await wrapper.get('[data-test="refresh"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-test="edit-lead"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="push-lead"]').exists()).toBe(false);
  });

  it('pushes once with the current version, shows success and reloads', async () => {
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'push-uuid') });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const wrapper = await mountPage();
    await wrapper.get('[data-test="push-lead"]').trigger('click');
    await flushPromises();

    expect(leadApi.pushLead).toHaveBeenCalledWith('lead-1', 1, 'push-uuid');
    expect(leadApi.getLead).toHaveBeenCalledTimes(2);
    expect(wrapper.get('[data-test="push-success"]').text()).toContain(
      '已推送给客户审核',
    );
  });

  it('maps a stable push failure without hiding the loaded detail', async () => {
    const { ApiError } = await import('../../api/http');
    leadApi.pushLead.mockRejectedValue(
      new ApiError('客户账号不可用', 409, 'CLIENT_ACCOUNT_UNAVAILABLE'),
    );
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const wrapper = await mountPage();
    await wrapper.get('[data-test="push-lead"]').trigger('click');
    await flushPromises();

    expect(wrapper.get('[data-test="push-error"]').text()).toContain(
      '客户账号不可用',
    );
    expect(wrapper.text()).toContain('测试店铺');
  });

  it('shows a human operator name in the push record', async () => {
    leadApi.getLead.mockResolvedValue({
      ...lead,
      status: 'WAITING_REVIEW',
      pushedAt: '2026-09-22T02:00:00.000Z',
      pushedByUserId: 'user-uuid',
      pushedByDisplayName: '运营甲',
      capabilities: { edit: false, push: false },
    });

    const wrapper = await mountPage();

    expect(wrapper.get('[data-test="push-record"]').text()).toContain('运营甲');
    expect(wrapper.get('[data-test="push-record"]').text()).not.toContain(
      'user-uuid',
    );
  });

  it('shows the formal client decision read-only using the reviewer snapshot', async () => {
    leadApi.getLead.mockResolvedValue({
      ...lead,
      status: 'WAITING_EVIDENCE_DECISION',
      version: 3,
      pushedAt: '2026-09-22T02:00:00.000Z',
      pushedByUserId: 'operator-uuid',
      pushedByDisplayName: '运营甲',
      reviewDecision: {
        result: 'INFRINGEMENT',
        reviewerDisplayName: '企业审核员',
        decidedAt: '2026-09-22T03:00:00.000Z',
      },
      capabilities: { edit: false, push: false },
    });
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('线索待确认');
    const record = wrapper.get('[data-test="client-review-record"]');
    expect(record.text()).toContain('客户审核记录');
    expect(record.text()).toContain('确认侵权');
    expect(record.text()).toContain('企业审核员');
    expect(record.text()).toContain('2026');
    expect(record.text()).not.toContain('reviewer-uuid');
    expect(wrapper.text()).not.toContain('确认取证');
    expect(wrapper.text()).not.toContain('不取证');
    expect(wrapper.text()).not.toContain('移交公证');
    expect(wrapper.find('[data-test="push-lead"]').exists()).toBe(false);
  });

  it('shows archived no-infringement reason and archive time without an operator review action', async () => {
    leadApi.getLead.mockResolvedValue({
      ...lead,
      status: 'ARCHIVED',
      version: 3,
      pushedAt: '2026-09-22T02:00:00.000Z',
      pushedByUserId: 'operator-uuid',
      pushedByDisplayName: '运营甲',
      reviewDecision: {
        result: 'NO_INFRINGEMENT',
        reason: '经核对未使用我司标识',
        reviewerDisplayName: '企业审核员',
        decidedAt: '2026-09-22T03:00:00.000Z',
        archiveType: 'NO_INFRINGEMENT',
        archivedAt: '2026-09-22T03:00:00.000Z',
      },
      capabilities: { edit: false, push: false },
    });
    const wrapper = await mountPage();
    const record = wrapper.get('[data-test="client-review-record"]');
    expect(record.text()).toContain('判定不侵权并归档');
    expect(record.text()).toContain('经核对未使用我司标识');
    expect(record.text()).toContain('归档时间');
    expect(wrapper.find('[data-test="push-lead"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="push-lead"]').exists()).toBe(false);
  });

  it('does not infer a client decision from the lead status alone', async () => {
    leadApi.getLead.mockResolvedValue({
      ...lead,
      status: 'WAITING_EVIDENCE_DECISION',
      reviewDecision: null,
      capabilities: { edit: false, push: false },
    });
    const wrapper = await mountPage();
    expect(wrapper.find('[data-test="client-review-record"]').exists()).toBe(
      false,
    );
  });

  it('shows only the exact screenshot versions referenced by the Lead', async () => {
    leadApi.getLead.mockResolvedValue({
      ...lead,
      leadScreenshotContentVersionIds: ['version-b'],
    });
    materialApi.listOwnerMaterials.mockResolvedValue({
      items: [
        {
          id: 'material-a',
          status: 'ACTIVE',
          currentVersionId: 'version-a',
          contentVersions: [
            { id: 'version-a', originalFilename: '旧截图.png' },
          ],
        },
        {
          id: 'material-b',
          status: 'ACTIVE',
          currentVersionId: 'version-b',
          contentVersions: [
            { id: 'version-b', originalFilename: '当前截图.png' },
          ],
        },
      ],
      total: 2,
    });

    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('当前截图.png');
    expect(wrapper.text()).not.toContain('旧截图.png');
    expect(
      wrapper.find('[data-test="download-screenshot-version-a"]').exists(),
    ).toBe(false);
    expect(
      wrapper.find('[data-test="download-screenshot-version-b"]').exists(),
    ).toBe(true);
  });
});
