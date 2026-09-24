import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import LeadDetailPage from './LeadDetailPage.vue';

const leadApi = vi.hoisted(() => ({
  getLead: vi.fn(),
  pushLead: vi.fn(),
  applyLeadWithdrawal: vi.fn(),
  decideLeadNoEvidence: vi.fn(),
}));
const customerApi = vi.hoisted(() => ({ getCustomer: vi.fn() }));
const holderApi = vi.hoisted(() => ({ getCustomerRightsHolder: vi.fn() }));
const materialApi = vi.hoisted(() => ({
  listOwnerMaterials: vi.fn(),
  downloadMaterialVersion: vi.fn(),
}));
const notaryApi = vi.hoisted(() => ({
  listNotaryOffices: vi.fn(),
  createNotaryOffice: vi.fn(),
  createNotaryMatter: vi.fn(),
}));
vi.mock('../../api/leads', () => leadApi);
vi.mock('../../api/customers', () => customerApi);
vi.mock('../../api/rights-holders', () => holderApi);
vi.mock('../../api/materials', () => materialApi);
vi.mock('../../api/notary', () => notaryApi);

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
  capabilities: {
    edit: true,
    push: true,
    withdrawApply: false,
    evidenceDecide: false,
    transferToNotary: false,
    createEvidenceBatch: false,
  },
  notaryMatters: [],
  pendingWithdrawalApplication: null,
  history: [],
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
  notaryApi.listNotaryOffices.mockResolvedValue({
    items: [{ id: 'office-1', name: '广州市南方公证处', status: 'ACTIVE' }],
    capabilities: { create: false },
  });
  notaryApi.createNotaryMatter.mockResolvedValue({
    id: 'matter-1',
    businessNo: 'NT-20260924-001',
    leadId: 'lead-1',
    leadStatus: 'TRANSFERRED_TO_NOTARY',
    leadVersion: 4,
    stage: 'PENDING_EVIDENCE',
    notaryOffice: { id: 'office-1', name: '广州市南方公证处' },
    selectedProductIds: ['p'],
    selectedContentVersionIds: ['version-1'],
    evidenceMode: 'ONLINE_PURCHASE',
    batchPurpose: '首批线上取证',
    createdAt: '2026-09-24T01:00:00.000Z',
  });
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
  it('creates the first notary matter from explicit goods, material, office and purpose selections', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    leadApi.getLead.mockResolvedValue({
      ...lead,
      status: 'WAITING_EVIDENCE_DECISION',
      version: 3,
      capabilities: {
        ...lead.capabilities,
        edit: false,
        push: false,
        evidenceDecide: true,
        transferToNotary: true,
      },
      reviewDecision: {
        result: 'INFRINGEMENT',
        reviewerDisplayName: '企业审核员',
        decidedAt: '2026-09-22T03:00:00Z',
      },
    });
    const transferred = {
      ...lead,
      status: 'TRANSFERRED_TO_NOTARY',
      version: 4,
      capabilities: { ...lead.capabilities, transferToNotary: false },
      notaryMatters: [
        {
          id: 'matter-1',
          businessNo: 'NT-20260924-001',
          stage: 'PENDING_EVIDENCE',
          notaryOfficeName: '广州市南方公证处',
          batchPurpose: '首批线上取证',
          createdAt: '2026-09-24T01:00:00.000Z',
        },
      ],
    };
    leadApi.getLead
      .mockReset()
      .mockResolvedValueOnce({
        ...lead,
        status: 'WAITING_EVIDENCE_DECISION',
        version: 3,
        capabilities: {
          ...lead.capabilities,
          edit: false,
          push: false,
          evidenceDecide: true,
          transferToNotary: true,
        },
        reviewDecision: {
          result: 'INFRINGEMENT',
          reviewerDisplayName: '企业审核员',
          decidedAt: '2026-09-22T03:00:00Z',
        },
      })
      .mockResolvedValueOnce(transferred);
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain(
      '确认侵权后，选择本次交给公证处的商品和截图',
    );
    await wrapper.get('[data-test="select-product-p"]').setValue(true);
    await wrapper.get('[data-test="select-evidence-version-1"]').setValue(true);
    await wrapper.get('[data-test="notary-office"]').setValue('office-1');
    await wrapper.get('[data-test="batch-purpose"]').setValue('首批线上取证');
    await wrapper.get('[data-test="transfer-to-notary"]').trigger('click');
    await flushPromises();
    expect(confirm).toHaveBeenCalled();
    expect(notaryApi.createNotaryMatter).toHaveBeenCalledWith(
      'lead-1',
      {
        selectedProductIds: ['p'],
        selectedContentVersionIds: ['version-1'],
        notaryOfficeId: 'office-1',
        evidenceMode: 'ONLINE_PURCHASE',
        batchPurpose: '首批线上取证',
        expectedVersion: 3,
      },
      expect.any(String),
    );
    expect(wrapper.text()).toContain('已移交公证');
    expect(
      wrapper.get('[data-test="matter-link-matter-1"]').attributes('href'),
    ).toBe('/notary-matters/matter-1');
    confirm.mockRestore();
  });

  it('lets a department office manager add and select a notary office in the workflow', async () => {
    leadApi.getLead.mockResolvedValue({
      ...lead,
      status: 'WAITING_EVIDENCE_DECISION',
      capabilities: {
        ...lead.capabilities,
        edit: false,
        push: false,
        evidenceDecide: true,
        transferToNotary: true,
      },
      reviewDecision: {
        result: 'INFRINGEMENT',
        reviewerDisplayName: '企业审核员',
        decidedAt: '2026-09-22T03:00:00Z',
      },
    });
    notaryApi.listNotaryOffices.mockResolvedValue({
      items: [],
      capabilities: { create: true },
    });
    notaryApi.createNotaryOffice.mockResolvedValue({
      id: 'office-new',
      name: '新公证处',
      status: 'ACTIVE',
    });
    const wrapper = await mountPage();
    await wrapper
      .get('[data-test="new-notary-office-name"]')
      .setValue(' 新公证处 ');
    await wrapper.get('[data-test="create-notary-office"]').trigger('click');
    await flushPromises();
    expect(notaryApi.createNotaryOffice).toHaveBeenCalledWith('新公证处');
    expect(
      (wrapper.get('[data-test="notary-office"]').element as HTMLSelectElement)
        .value,
    ).toBe('office-new');
  });

  it('freezes the full request and idempotency key after an uncertain failure', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const eligible = {
      ...lead,
      status: 'WAITING_EVIDENCE_DECISION',
      version: 3,
      capabilities: {
        ...lead.capabilities,
        edit: false,
        push: false,
        evidenceDecide: true,
        transferToNotary: true,
      },
      reviewDecision: {
        result: 'INFRINGEMENT',
        reviewerDisplayName: '企业审核员',
        decidedAt: '2026-09-22T03:00:00Z',
      },
    };
    leadApi.getLead.mockResolvedValue(eligible);
    notaryApi.createNotaryMatter
      .mockRejectedValueOnce(
        new ApiError('server error', 500, 'INTERNAL_SERVER_ERROR'),
      )
      .mockResolvedValueOnce({ id: 'matter-1' });
    const wrapper = await mountPage();
    await wrapper.get('[data-test="select-product-p"]').setValue(true);
    await wrapper.get('[data-test="notary-office"]').setValue('office-1');
    await wrapper.get('[data-test="batch-purpose"]').setValue('首批线上取证');
    await wrapper.get('[data-test="transfer-to-notary"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('选择和请求键已锁定');
    expect(
      wrapper.get('[data-test="batch-purpose"]').attributes('disabled'),
    ).toBeDefined();
    await wrapper.get('[data-test="transfer-to-notary"]').trigger('click');
    await flushPromises();
    expect(notaryApi.createNotaryMatter).toHaveBeenCalledTimes(2);
    const first = notaryApi.createNotaryMatter.mock.calls[0];
    const second = notaryApi.createNotaryMatter.mock.calls[1];
    expect(second).toEqual(first);
  });

  it('archives a waiting evidence decision with a required reason and shows its immutable record', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const waiting = {
      ...lead,
      status: 'WAITING_EVIDENCE_DECISION',
      version: 3,
      capabilities: {
        edit: false,
        push: false,
        withdrawApply: false,
        evidenceDecide: true,
      },
      evidenceDecision: null,
      reviewDecision: {
        result: 'INFRINGEMENT',
        reviewerDisplayName: '企业审核员',
        decidedAt: '2026-09-22T03:00:00Z',
      },
    };
    const archived = {
      ...waiting,
      status: 'ARCHIVED',
      version: 4,
      capabilities: { ...waiting.capabilities, evidenceDecide: false },
      evidenceDecision: {
        result: 'NO_EVIDENCE',
        reason: '现阶段不取证',
        decidedAt: '2026-09-22T04:00:00Z',
        decidedByDisplayName: '运营甲',
        archiveType: 'NO_EVIDENCE',
        archivedAt: '2026-09-22T04:00:00Z',
      },
    };
    leadApi.getLead
      .mockReset()
      .mockResolvedValueOnce(waiting)
      .mockResolvedValueOnce(archived);
    leadApi.decideLeadNoEvidence.mockResolvedValue({ status: 'ARCHIVED' });
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('提交后线索将立即归档');
    expect(
      wrapper
        .get('[data-test="archive-no-evidence"]')
        .attributes('aria-disabled'),
    ).toBe('true');
    await wrapper
      .get('[data-test="no-evidence-reason"]')
      .setValue('  现阶段不取证  ');
    await wrapper.get('[data-test="archive-no-evidence"]').trigger('click');
    await flushPromises();
    expect(confirm).toHaveBeenCalled();
    expect(leadApi.decideLeadNoEvidence).toHaveBeenCalledWith(
      'lead-1',
      '现阶段不取证',
      3,
      expect.any(String),
    );
    expect(
      wrapper.get('[data-test="evidence-decision-record"]').text(),
    ).toContain('运营甲');
    expect(
      wrapper.get('[data-test="evidence-decision-record"]').text(),
    ).toContain('现阶段不取证');
    expect(wrapper.text()).toContain('已判定不取证，线索已归档');
    confirm.mockRestore();
  });

  it('keeps the entered reason after a version conflict', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    leadApi.getLead.mockResolvedValue({
      ...lead,
      status: 'WAITING_EVIDENCE_DECISION',
      version: 3,
      evidenceDecision: null,
      reviewDecision: {
        result: 'INFRINGEMENT',
        reviewerDisplayName: '企业审核员',
        decidedAt: '2026-09-22T03:00:00Z',
      },
      capabilities: {
        edit: false,
        push: false,
        withdrawApply: false,
        evidenceDecide: true,
      },
    });
    leadApi.decideLeadNoEvidence.mockRejectedValue(
      new ApiError('conflict', 409, 'VERSION_CONFLICT'),
    );
    const wrapper = await mountPage();
    const reason = '版本变化时仍保留这段原因';
    await wrapper.get('[data-test="no-evidence-reason"]').setValue(reason);
    await wrapper.get('[data-test="archive-no-evidence"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('线索状态已变化，请刷新查看最新结果');
    expect(
      (
        wrapper.get('[data-test="no-evidence-reason"]')
          .element as HTMLTextAreaElement
      ).value,
    ).toBe(reason);
    expect(
      wrapper
        .get('[data-test="archive-no-evidence"]')
        .attributes('aria-disabled'),
    ).toBe('false');
    confirm.mockRestore();
  });
  it('shows a required withdrawal reason only when allowed and explains confirmation', async () => {
    leadApi.getLead.mockResolvedValueOnce({
      ...lead,
      status: 'ARCHIVED',
      version: 4,
      reviewDecision: {
        result: 'NO_INFRINGEMENT',
        reason: '旧结论',
        reviewerDisplayName: '客户审核员',
        decidedAt: '2026-09-22T03:00:00.000Z',
        archiveType: 'NO_INFRINGEMENT',
        archivedAt: '2026-09-22T03:00:00.000Z',
      },
      capabilities: { edit: false, push: false, withdrawApply: true },
      pendingWithdrawalApplication: null,
      history: [],
    });
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('申请撤回归档');
    expect(wrapper.text()).toContain('仍保持归档');
    expect(wrapper.text()).toContain('原客户企业确认');
    expect(wrapper.text()).toContain('必填');
    expect(wrapper.find('[data-test="apply-withdrawal"]').exists()).toBe(true);
  });

  it('submits a withdrawal application then reloads the retained history', async () => {
    const archived = {
      ...lead,
      status: 'ARCHIVED',
      version: 4,
      reviewDecision: {
        result: 'NO_INFRINGEMENT',
        reason: '旧结论',
        reviewerDisplayName: '客户审核员',
        decidedAt: '2026-09-22T03:00:00.000Z',
        archiveType: 'NO_INFRINGEMENT',
        archivedAt: '2026-09-22T03:00:00.000Z',
      },
      capabilities: { edit: false, push: false, withdrawApply: true },
      pendingWithdrawalApplication: null,
      history: [],
    };
    const pending = {
      ...archived,
      version: 5,
      capabilities: { ...archived.capabilities, withdrawApply: false },
      pendingWithdrawalApplication: {
        id: 'application-1',
        reason: '补充证据',
        applicantDisplayName: '运营甲',
        appliedAt: '2026-09-23T01:00:00.000Z',
      },
      history: [
        {
          kind: 'WITHDRAWAL_APPLICATION',
          id: 'application-1',
          fromVersion: 4,
          toVersion: 5,
          occurredAt: '2026-09-23T01:00:00.000Z',
          reason: '补充证据',
          applicantDisplayName: '运营甲',
        },
      ],
    };
    leadApi.getLead
      .mockReset()
      .mockResolvedValueOnce(archived)
      .mockResolvedValueOnce(pending);
    leadApi.applyLeadWithdrawal.mockResolvedValue({ version: 5 });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const wrapper = await mountPage();
    await wrapper.get('[data-test="withdrawal-reason"]').setValue('补充证据');
    await wrapper.get('[data-test="apply-withdrawal"]').trigger('click');
    await flushPromises();
    expect(leadApi.applyLeadWithdrawal).toHaveBeenCalledWith(
      'lead-1',
      '补充证据',
      4,
      expect.any(String),
    );
    expect(wrapper.get('[data-test="withdrawal-history"]').text()).toContain(
      '运营甲',
    );
    expect(wrapper.get('[data-test="withdrawal-history"]').text()).toContain(
      '补充证据',
    );
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('仍保持归档'));
    confirm.mockRestore();
  });

  it('retries an unknown application with the same frozen reason and key', async () => {
    const archived = {
      ...lead,
      status: 'ARCHIVED',
      version: 4,
      reviewDecision: {
        result: 'NO_INFRINGEMENT',
        reason: '旧结论',
        reviewerDisplayName: '客户审核员',
        decidedAt: '2026-09-22T03:00:00.000Z',
        archiveType: 'NO_INFRINGEMENT',
        archivedAt: '2026-09-22T03:00:00.000Z',
      },
      capabilities: { edit: false, push: false, withdrawApply: true },
      pendingWithdrawalApplication: null,
      history: [],
    };
    leadApi.getLead
      .mockReset()
      .mockResolvedValueOnce(archived)
      .mockResolvedValue({ ...archived, version: 5 });
    leadApi.applyLeadWithdrawal
      .mockRejectedValueOnce(new ApiError('unknown', 0, 'NETWORK_ERROR'))
      .mockRejectedValueOnce(new ApiError('unknown', 0, 'NETWORK_ERROR'));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const wrapper = await mountPage();
    const reason = wrapper.get('[data-test="withdrawal-reason"]');
    await reason.setValue('原因甲');
    await wrapper.get('[data-test="apply-withdrawal"]').trigger('click');
    await flushPromises();
    const first = leadApi.applyLeadWithdrawal.mock.calls[0];
    await wrapper.get('[data-test="refresh"]').trigger('click');
    await flushPromises();
    await reason.setValue('修改原因');
    await wrapper.get('[data-test="apply-withdrawal"]').trigger('click');
    await flushPromises();
    expect(leadApi.applyLeadWithdrawal.mock.calls[1]?.slice(1)).toEqual(
      first?.slice(1),
    );
    expect(wrapper.text()).toContain('结果暂时未知');
    confirm.mockRestore();
  });

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
