import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import ClientLeadDetailPage from './ClientLeadDetailPage.vue';

const leadApi = vi.hoisted(() => ({
  getClientLead: vi.fn(),
  reviewClientLead: vi.fn(),
}));
const materialApi = vi.hoisted(() => ({
  listOwnerMaterials: vi.fn(),
  downloadMaterialVersion: vi.fn(),
}));
vi.mock('../../api/client-leads', () => leadApi);
vi.mock('../../api/materials', () => materialApi);

const lead = {
  id: 'lead-1',
  businessNo: 'LD-20260922-001',
  status: 'WAITING_REVIEW',
  version: 2,
  caseType: 'CIVIL',
  infringementTypes: ['TRADEMARK'],
  source: 'ONLINE',
  platform: 'TAOBAO',
  foundAt: '2026-09-22T01:00:00.000Z',
  shopName: '店铺甲',
  shopExternalId: null,
  rightsHolderName: '主体甲',
  products: [
    {
      id: 'p',
      position: 1,
      title: '商品甲',
      url: null,
      quantity: 1,
      unitPrice: '10.00',
      commentCount: 0,
      estimatedAmount: '10.00',
    },
  ],
  leadScreenshotContentVersionIds: ['version-current'],
  pushedAt: '2026-09-22T02:00:00.000Z',
  reviewDecision: null,
  capabilities: { review: true },
};

const processedLead = {
  ...lead,
  status: 'WAITING_EVIDENCE_DECISION',
  version: 3,
  reviewDecision: {
    result: 'INFRINGEMENT',
    reviewerDisplayName: '企业审核员',
    decidedAt: '2026-09-22T03:00:00.000Z',
  },
  capabilities: { review: false },
};

async function mountPage(path = '/client/leads/lead-1') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/client/leads/:id', component: ClientLeadDetailPage },
      { path: '/client/leads', component: { template: '<div />' } },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(ClientLeadDetailPage, {
    global: { plugins: [router] },
  });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.resetAllMocks();
  leadApi.getClientLead.mockResolvedValue(lead);
  leadApi.reviewClientLead.mockResolvedValue({
    id: lead.id,
    businessNo: lead.businessNo,
    status: processedLead.status,
    version: processedLead.version,
    reviewDecision: processedLead.reviewDecision,
  });
  materialApi.listOwnerMaterials.mockResolvedValue({
    items: [
      {
        id: 'material-1',
        status: 'ACTIVE',
        contentVersions: [
          { id: 'version-old', originalFilename: '旧截图.png' },
          { id: 'version-current', originalFilename: '当前截图.png' },
        ],
      },
    ],
    total: 1,
  });
  materialApi.downloadMaterialVersion.mockResolvedValue(undefined);
});

describe('ClientLeadDetailPage', () => {
  it('shows the redacted read-only detail and only current allowed attachments', async () => {
    const wrapper = await mountPage();
    expect(wrapper.get('[data-test="client-lead-facts"]').text()).toContain(
      '主体甲',
    );
    expect(wrapper.get('[data-test="client-lead-products"]').text()).toContain(
      '商品甲',
    );
    expect(
      wrapper.get('[data-test="client-lead-attachments"]').text(),
    ).toContain('当前截图.png');
    expect(wrapper.text()).not.toContain('旧截图.png');
    expect(wrapper.find('[data-test="confirm-infringement"]').exists()).toBe(
      true,
    );
    expect(wrapper.text()).not.toContain('备注');
    expect(wrapper.text()).toContain('当前可查看线索内容');
    expect(wrapper.text()).not.toContain('后续切片');

    await wrapper
      .get('[data-test="download-screenshot-version-current"]')
      .trigger('click');
    expect(materialApi.downloadMaterialVersion).toHaveBeenCalledWith(
      'material-1',
      'version-current',
    );
  });

  it('explains the consequence and cancellation does not submit', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('线索待确认');
    expect(wrapper.text()).toContain('运营决定是否取证');
    expect(wrapper.text()).toContain('当前入口不能撤回');
    await wrapper.get('[data-test="confirm-infringement"]').trigger('click');
    expect(confirm).toHaveBeenCalled();
    expect(leadApi.reviewClientLead).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('submits the current version with one key and reloads the persisted decision', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    leadApi.getClientLead
      .mockResolvedValueOnce(lead)
      .mockResolvedValueOnce(processedLead);
    const wrapper = await mountPage();
    await wrapper.get('[data-test="confirm-infringement"]').trigger('click');
    await flushPromises();
    expect(leadApi.reviewClientLead).toHaveBeenCalledTimes(1);
    expect(leadApi.reviewClientLead).toHaveBeenCalledWith(
      'lead-1',
      2,
      expect.any(String),
    );
    expect(wrapper.get('[data-test="client-review-record"]').text()).toContain(
      '企业审核员',
    );
    expect(wrapper.text()).toContain('已确认侵权，等待运营确认是否取证');
    confirm.mockRestore();
  });

  it('disables the action while submitting and reuses the key after an unknown result', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    let rejectRequest: (error: ApiError) => void = () => undefined;
    leadApi.reviewClientLead.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectRequest = reject;
      }),
    );
    const wrapper = await mountPage();
    const button = wrapper.get('[data-test="confirm-infringement"]');
    const firstAttempt = button.trigger('click');
    await flushPromises();
    expect(button.attributes('aria-disabled')).toBe('true');
    const firstKey = leadApi.reviewClientLead.mock.calls[0]?.[2];
    rejectRequest(new ApiError('network', 0, 'NETWORK_ERROR'));
    await firstAttempt;
    await flushPromises();
    expect(
      wrapper
        .get('[data-test="confirm-infringement"]')
        .attributes('aria-disabled'),
    ).toBe('false');
    await wrapper.get('[data-test="confirm-infringement"]').trigger('click');
    await flushPromises();
    expect(leadApi.reviewClientLead).toHaveBeenCalledTimes(2);
    expect(leadApi.reviewClientLead.mock.calls[1]?.[2]).toBe(firstKey);
    confirm.mockRestore();
  });

  it('uses a fresh key after an explicit idempotency conflict', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    leadApi.reviewClientLead.mockRejectedValueOnce(
      new ApiError('conflict', 409, 'IDEMPOTENCY_CONFLICT'),
    );
    const wrapper = await mountPage();
    await wrapper.get('[data-test="confirm-infringement"]').trigger('click');
    await flushPromises();
    const firstKey = leadApi.reviewClientLead.mock.calls[0]?.[2];
    await wrapper.get('[data-test="confirm-infringement"]').trigger('click');
    await flushPromises();
    expect(leadApi.reviewClientLead).toHaveBeenCalledTimes(2);
    expect(leadApi.reviewClientLead.mock.calls[1]?.[2]).not.toBe(firstKey);
    confirm.mockRestore();
  });

  it('preserves the originating queue and page in the back link', async () => {
    const wrapper = await mountPage('/client/leads/lead-1?view=pending&page=2');
    expect(wrapper.get('.back-link').attributes('href')).toBe(
      '/client/leads?view=pending&page=2',
    );
  });

  it('renders persisted processed decisions without a confirm action and keeps downloads', async () => {
    leadApi.getClientLead.mockResolvedValue(processedLead);
    const wrapper = await mountPage();
    const record = wrapper.get('[data-test="client-review-record"]');
    expect(record.text()).toContain('审核结论：确认侵权');
    expect(record.text()).toContain('审核人：企业审核员');
    expect(record.text()).toContain('2026/9/22 11:00:00');
    expect(record.text()).toContain('下一步：等待运营确认是否取证');
    expect(wrapper.find('[data-test="confirm-infringement"]').exists()).toBe(
      false,
    );
    expect(wrapper.get('.back-link').attributes('href')).toBe(
      '/client/leads?view=processed',
    );
    expect(
      wrapper.get('[data-test="client-lead-attachments"]').text(),
    ).toContain('当前截图.png');
  });

  it.each([
    ['VERSION_CONFLICT', '线索状态已变化，请刷新查看最新结果'],
    ['INVALID_STATE', '线索状态已变化，请刷新查看最新结果'],
    ['IDEMPOTENCY_CONFLICT', '本次操作未执行，请重新确认后重试'],
    ['ACTION_FORBIDDEN', '当前账号无权审核此线索，请刷新登录状态后重试'],
    ['NETWORK_ERROR', '提交结果暂时未知，请重试；系统会安全处理重复请求'],
  ])(
    'shows stable %s feedback while keeping the loaded facts',
    async (code, copy) => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
      leadApi.reviewClientLead.mockRejectedValue(
        new ApiError('error', 409, code),
      );
      const wrapper = await mountPage();
      await wrapper.get('[data-test="confirm-infringement"]').trigger('click');
      await flushPromises();
      expect(wrapper.text()).toContain(copy);
      expect(wrapper.get('[data-test="client-lead-facts"]').text()).toContain(
        '主体甲',
      );
      confirm.mockRestore();
    },
  );
});
