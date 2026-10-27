import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LeadDetail } from '../../api/leads';
import { ApiError } from '../../api/http';
import { createListWorkflowContext } from '../../app/list-workflow-context';
import LeadListWorkflowPanel, {
  readPendingLeadCommands,
  sameLeadAttempt,
  type FrozenLeadCommand,
} from './LeadListWorkflowPanel.vue';
const api = vi.hoisted(() => ({
  getLead: vi.fn(),
  pushLead: vi.fn(),
  applyLeadWithdrawal: vi.fn(),
  decideLeadNoEvidence: vi.fn(),
}));
const notary = vi.hoisted(() => ({
  listNotaryOffices: vi.fn(),
  createNotaryMatter: vi.fn(),
  createNotaryOffice: vi.fn(),
}));
const materials = vi.hoisted(() => ({
  listOwnerMaterials: vi.fn(),
  downloadMaterialVersion: vi.fn(),
}));
const client = vi.hoisted(() => ({
  proxyReviewLead: vi.fn(),
  proxyConfirmLeadWithdrawal: vi.fn(),
}));
vi.mock('../../api/leads', () => api);
vi.mock('../../api/client-leads', () => client);
vi.mock('../../api/notary', () => notary);
vi.mock('../../api/materials', () => materials);
const lead = {
  id: 'lead-1',
  businessNo: 'LD-1',
  departmentId: 'department-1',
  customerId: 'customer-1',
  rightsHolderId: 'holder-1',
  responsibleUserId: 'operator-1',
  teamId: null,
  shopName: 'Test shop',
  status: 'WAITING_EVIDENCE_DECISION',
  caseType: 'CIVIL',
  infringementTypes: ['TRADEMARK'],
  source: 'ONLINE',
  platform: 'TAOBAO',
  needDisclose: false,
  remark: null,
  creationChannel: 'MANUAL',
  externalSourceRef: null,
  leadScreenshotContentVersionIds: ['version-1'],
  version: 2,
  pushedAt: null,
  pushedByUserId: null,
  pushedByDisplayName: null,
  reviewDecision: null,
  createdAt: '2026-10-15T00:00:00.000Z',
  updatedAt: '2026-10-15T00:00:00.000Z',
  foundAt: '2026-10-14T00:00:00.000Z',
  shopExternalId: null,
  displayNames: {
    customerName: 'Client',
    rightsHolderName: 'Holder',
    responsibleUserName: 'Operator',
  },
  products: [
    {
      id: 'product-1',
      position: 1,
      title: 'Product',
      url: null,
      quantity: 1,
      unitPrice: '2.00',
      commentCount: 0,
      estimatedAmount: '2.00',
    },
  ],
  capabilities: {
    edit: false,
    push: false,
    withdrawApply: false,
    evidenceDecide: true,
    transferToNotary: true,
    createEvidenceBatch: false,
  },
  evidenceDecision: null,
  pendingWithdrawalApplication: null,
  history: [],
  notaryMatters: [],
} satisfies LeadDetail;

const identity = 'operator-1:INTERNAL:department-1:1';
const cleanups: Array<() => void> = [];
async function mountPanel(detail: LeadDetail = lead, actorKey = identity) {
  const success = vi.fn();
  const workflow = createListWorkflowContext<LeadDetail>(async () => detail, {
    success,
  });
  await workflow.sync({
    recordId: detail.id,
    actorKey,
    actionKey: 'lead-workflow',
    title: '线索下一步',
  });
  const session = workflow.state.value.session;
  if (!session) throw new Error('Missing session');
  const wrapper = mount(LeadListWorkflowPanel, { props: { detail, session } });
  cleanups.push(() => {
    wrapper.unmount();
    workflow.dispose();
  });
  await flushPromises();
  return { wrapper, session, workflow, success };
}
async function fillTransfer(
  wrapper: Awaited<ReturnType<typeof mountPanel>>['wrapper'],
) {
  if (wrapper.find('[data-test="choose-transfer"]').exists())
    await wrapper.get('[data-test="choose-transfer"]').setValue();
  await wrapper.get('[data-test="select-product-product-1"]').setValue(true);
  await wrapper.get('[data-test="select-evidence-version-1"]').setValue(true);
  await wrapper.get('[data-test="notary-office"]').setValue('office-1');
  await wrapper
    .get('[data-test="batch-purpose"]')
    .setValue('  First purchase  ');
}
beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  api.getLead.mockResolvedValue(lead);
  notary.listNotaryOffices.mockResolvedValue({
    items: [{ id: 'office-1', name: 'Office', status: 'ACTIVE' }],
    capabilities: { create: false },
  });
  notary.createNotaryMatter.mockResolvedValue({
    id: 'matter-1',
    businessNo: 'NT-1',
  });
  api.decideLeadNoEvidence.mockResolvedValue({
    status: 'ARCHIVED',
    version: 3,
  });
  api.applyLeadWithdrawal.mockResolvedValue({ status: 'ARCHIVED', version: 3 });
  materials.listOwnerMaterials.mockResolvedValue({
    items: [
      {
        id: 'material-1',
        status: 'ACTIVE',
        currentVersionId: 'version-1',
        contentVersions: [
          { id: 'version-1', originalFilename: 'Exact screenshot' },
          { id: 'old-version', originalFilename: 'Old screenshot' },
        ],
      },
      {
        id: 'unrelated',
        status: 'ACTIVE',
        currentVersionId: 'unrelated-version',
        contentVersions: [
          { id: 'unrelated-version', originalFilename: 'Other lead' },
        ],
      },
    ],
  });
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
});
describe('LeadListWorkflowPanel', () => {
  it('does not treat the same key with a changed proxy conclusion as the original request', () => {
    const base = {
      identity,
      leadId: lead.id,
      expectedVersion: 2,
      idempotencyKey: 'same-key',
    };
    const first: FrozenLeadCommand = {
      ...base,
      action: 'proxy-review',
      body: { expectedVersion: 2, result: 'INFRINGEMENT' },
    };
    const changed: FrozenLeadCommand = {
      ...base,
      action: 'proxy-review',
      body: { expectedVersion: 2, result: 'NO_INFRINGEMENT', reason: '实情' },
    };
    expect(sameLeadAttempt(first, changed)).toBe(false);
  });
  it('keeps a conclusion form for operator proxy review and sends the original version', async () => {
    const detail = {
      ...lead,
      status: 'WAITING_REVIEW' as const,
      capabilities: { ...lead.capabilities, proxyReview: true },
    };
    api.getLead.mockResolvedValue(detail);
    client.proxyReviewLead.mockResolvedValue({});
    const { wrapper } = await mountPanel(detail);
    await wrapper.get('input[value="INFRINGEMENT"]').setValue(true);
    await wrapper.get('[data-test="submit-lead-workflow"]').trigger('click');
    await flushPromises();
    expect(client.proxyReviewLead).toHaveBeenCalledWith(
      lead.id,
      'INFRINGEMENT',
      lead.version,
      expect.any(String),
      undefined,
    );
  });
  it('requires an explicit customer intent check for operator withdrawal confirmation', async () => {
    const detail = {
      ...lead,
      status: 'ARCHIVED' as const,
      capabilities: { ...lead.capabilities, proxyConfirmWithdrawal: true },
      pendingWithdrawalApplication: { id: 'application-1' } as never,
    };
    api.getLead.mockResolvedValue(detail);
    client.proxyConfirmLeadWithdrawal.mockResolvedValue({});
    const { wrapper } = await mountPanel(detail);
    expect(
      wrapper.get('[data-test="submit-lead-workflow"]').attributes('disabled'),
    ).toBeDefined();
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await wrapper.get('[data-test="submit-lead-workflow"]').trigger('click');
    await flushPromises();
    expect(client.proxyConfirmLeadWithdrawal).toHaveBeenCalledWith(
      lead.id,
      'application-1',
      lead.version,
      expect.any(String),
    );
  });
  it('requires explicit direction even when only one legal branch exists', async () => {
    const { wrapper } = await mountPanel({
      ...lead,
      capabilities: { ...lead.capabilities, transferToNotary: false },
    });
    expect(wrapper.find('[data-test="choose-transfer"]').exists()).toBe(false);
    expect(
      wrapper.get('[data-test="choose-no-evidence"]').element,
    ).toHaveProperty('checked', false);
    expect(
      wrapper.get('[data-test="submit-lead-workflow"]').attributes('disabled'),
    ).toBeDefined();
    expect(wrapper.find('[data-test="no-evidence-reason"]').exists()).toBe(
      false,
    );
    expect(wrapper.text()).toContain('没有流程资料暂存');
    expect(api.decideLeadNoEvidence).not.toHaveBeenCalled();
  });
  it('validates transfer fields and sends only selected exact products/material versions', async () => {
    const { wrapper, success } = await mountPanel();
    await wrapper.get('[data-test="choose-transfer"]').setValue();
    expect(wrapper.get('[data-test="notary-office"]').element).toHaveProperty(
      'value',
      '',
    );
    expect(
      wrapper.get('[data-test="submit-lead-workflow"]').attributes('disabled'),
    ).toBeDefined();
    expect(wrapper.text()).not.toContain('Old screenshot');
    expect(wrapper.text()).not.toContain('Other lead');
    await fillTransfer(wrapper);
    await wrapper.get('[data-test="submit-lead-workflow"]').trigger('click');
    await flushPromises();
    expect(notary.createNotaryMatter).toHaveBeenCalledExactlyOnceWith(
      lead.id,
      {
        expectedVersion: 2,
        selectedProductIds: ['product-1'],
        selectedContentVersionIds: ['version-1'],
        notaryOfficeId: 'office-1',
        evidenceMode: 'ONLINE_PURCHASE',
        batchPurpose: 'First purchase',
      },
      expect.any(String),
    );
    expect(wrapper.emitted('completed')?.[0]?.[0]).toMatchObject({
      matter: { id: 'matter-1', businessNo: 'NT-1' },
    });
    expect(success).toHaveBeenCalledOnce();
    expect(readPendingLeadCommands()).toEqual({});
  });
  it('requires the branch-specific reason and sends no transfer on archive', async () => {
    const { wrapper } = await mountPanel();
    await wrapper.get('[data-test="choose-transfer"]').setValue();
    await wrapper
      .get('[data-test="batch-purpose"]')
      .setValue('Unsubmitted purpose');
    await wrapper.get('[data-test="choose-no-evidence"]').setValue();
    expect(wrapper.find('[data-test="batch-purpose"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="submit-lead-workflow"]').text()).toBe(
      '不取证并归档',
    );
    expect(
      wrapper.get('[data-test="submit-lead-workflow"]').attributes('disabled'),
    ).toBeDefined();
    await wrapper
      .get('[data-test="no-evidence-reason"]')
      .setValue('  Stop evidence  ');
    await wrapper.get('[data-test="submit-lead-workflow"]').trigger('click');
    await flushPromises();
    expect(api.decideLeadNoEvidence).toHaveBeenCalledExactlyOnceWith(
      lead.id,
      'Stop evidence',
      2,
      expect.any(String),
    );
    expect(notary.createNotaryMatter).not.toHaveBeenCalled();
  });
  it('validates Unicode reasons at the actual 5000-codepoint boundary', async () => {
    const { wrapper } = await mountPanel();
    await wrapper.get('[data-test="choose-no-evidence"]').setValue();
    await wrapper
      .get('[data-test="no-evidence-reason"]')
      .setValue('😀'.repeat(5001));
    expect(
      wrapper.get('[data-test="submit-lead-workflow"]').attributes('disabled'),
    ).toBeDefined();
    await wrapper
      .get('[data-test="no-evidence-reason"]')
      .setValue('😀'.repeat(5000));
    expect(
      wrapper.get('[data-test="submit-lead-workflow"]').attributes('disabled'),
    ).toBeUndefined();
  });
  it('keeps input after a definite validation failure and permits correction', async () => {
    api.decideLeadNoEvidence.mockRejectedValueOnce(
      new ApiError('invalid', 422, 'VALIDATION_ERROR'),
    );
    const { wrapper, session, success } = await mountPanel();
    await wrapper.get('[data-test="choose-no-evidence"]').setValue();
    await wrapper
      .get('[data-test="no-evidence-reason"]')
      .setValue('Keep input');
    await wrapper.get('[data-test="submit-lead-workflow"]').trigger('click');
    await flushPromises();
    expect(
      wrapper.get('[data-test="no-evidence-reason"]').element,
    ).toHaveProperty('value', 'Keep input');
    expect(session.isCurrent()).toBe(true);
    expect(success).not.toHaveBeenCalled();
    expect(readPendingLeadCommands()).toEqual({});
    await wrapper.get('[data-test="submit-lead-workflow"]').trigger('click');
    await flushPromises();
    expect(api.decideLeadNoEvidence).toHaveBeenCalledTimes(2);
    expect(api.decideLeadNoEvidence.mock.calls[0]![3]).not.toBe(
      api.decideLeadNoEvidence.mock.calls[1]![3],
    );
  });
  it.each([403, 409])(
    'preserves reason and stops resubmission after %s',
    async (status) => {
      api.decideLeadNoEvidence.mockRejectedValueOnce(
        new ApiError(
          'stopped',
          status,
          status === 403 ? 'ACTION_FORBIDDEN' : 'VERSION_CONFLICT',
        ),
      );
      const { wrapper, success } = await mountPanel();
      await wrapper.get('[data-test="choose-no-evidence"]').setValue();
      await wrapper
        .get('[data-test="no-evidence-reason"]')
        .setValue('Keep reason');
      await wrapper.get('[data-test="submit-lead-workflow"]').trigger('click');
      await flushPromises();
      expect(
        wrapper.get('[data-test="no-evidence-reason"]').element,
      ).toHaveProperty('value', 'Keep reason');
      expect(
        wrapper
          .get('[data-test="submit-lead-workflow"]')
          .attributes('disabled'),
      ).toBeDefined();
      expect(success).not.toHaveBeenCalled();
    },
  );
  it('refuses changed source version before transfer and keeps the filled form', async () => {
    api.getLead.mockResolvedValue({ ...lead, version: 3 });
    const { wrapper } = await mountPanel();
    await fillTransfer(wrapper);
    await wrapper.get('[data-test="submit-lead-workflow"]').trigger('click');
    await flushPromises();
    expect(notary.createNotaryMatter).not.toHaveBeenCalled();
    expect(wrapper.get('[data-test="batch-purpose"]').element).toHaveProperty(
      'value',
      '  First purchase  ',
    );
  });
  it('recovers resource failure without discarding input', async () => {
    notary.listNotaryOffices.mockRejectedValueOnce(new Error('offline'));
    const { wrapper } = await mountPanel();
    await wrapper.get('[data-test="choose-transfer"]').setValue();
    await wrapper.get('[data-test="batch-purpose"]').setValue('Keep purpose');
    expect(wrapper.text()).toContain('尚不能移交');
    await wrapper
      .findAll('.el-button')
      .find((button) => button.text() === '重新读取材料和公证处')!
      .trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-test="batch-purpose"]').element).toHaveProperty(
      'value',
      'Keep purpose',
    );
    expect(
      wrapper.find('[data-test="select-product-product-1"]').exists(),
    ).toBe(true);
  });
  it('reuses authorized office creation and selects the returned ID', async () => {
    notary.listNotaryOffices.mockResolvedValue({
      items: [],
      capabilities: { create: true },
    });
    notary.createNotaryOffice.mockResolvedValue({
      id: 'office-new',
      name: 'New office',
      status: 'ACTIVE',
    });
    const { wrapper } = await mountPanel();
    await wrapper.get('[data-test="choose-transfer"]').setValue();
    await wrapper
      .get('[data-test="new-notary-office-name"]')
      .setValue(' New office ');
    await wrapper.get('[data-test="create-notary-office"]').trigger('click');
    await flushPromises();
    expect(notary.createNotaryOffice).toHaveBeenCalledExactlyOnceWith(
      'New office',
    );
    expect(wrapper.get('[data-test="notary-office"]').element).toHaveProperty(
      'value',
      'office-new',
    );
  });
  it.each(['transfer', 'no-evidence', 'withdraw'] as const)(
    'restores original %s body/key after unknown with changed server capabilities',
    async (operation) => {
      const archived: LeadDetail = {
        ...lead,
        status: 'ARCHIVED',
        capabilities: {
          ...lead.capabilities,
          evidenceDecide: false,
          transferToNotary: false,
          withdrawApply: true,
        },
      };
      const detail = operation === 'withdraw' ? archived : lead;
      api.getLead.mockResolvedValue(detail);
      const service =
        operation === 'transfer'
          ? notary.createNotaryMatter
          : operation === 'withdraw'
            ? api.applyLeadWithdrawal
            : api.decideLeadNoEvidence;
      service
        .mockRejectedValueOnce(new ApiError('offline', 503, 'INTERNAL_ERROR'))
        .mockResolvedValue({ id: 'matter-1', businessNo: 'NT-1' });
      const first = await mountPanel(detail);
      if (operation === 'transfer') await fillTransfer(first.wrapper);
      else {
        if (operation === 'no-evidence')
          await first.wrapper
            .get('[data-test="choose-no-evidence"]')
            .setValue();
        await first.wrapper
          .get(
            `[data-test="${operation === 'withdraw' ? 'withdrawal-reason' : 'no-evidence-reason'}"]`,
          )
          .setValue(' Original reason ');
      }
      await first.wrapper
        .get('[data-test="submit-lead-workflow"]')
        .trigger('click');
      await flushPromises();
      const original = structuredClone(service.mock.calls[0]);
      expect(readPendingLeadCommands()![identity]!.action).toBe(operation);
      expect(first.workflow.canLeave()).toBe(false);
      first.wrapper.unmount();
      first.workflow.dispose();
      cleanups.pop();
      const second = await mountPanel({
        ...detail,
        version: 19,
        capabilities: {
          edit: false,
          push: false,
          evidenceDecide: false,
          transferToNotary: false,
          withdrawApply: false,
          createEvidenceBatch: false,
        },
      });
      const getCount = api.getLead.mock.calls.length;
      await second.wrapper
        .get('[data-test="retry-unknown-lead"]')
        .trigger('click');
      await flushPromises();
      expect(service.mock.calls[1]).toEqual(original);
      expect(api.getLead).toHaveBeenCalledTimes(getCount);
      expect(second.success).toHaveBeenCalledOnce();
      expect(readPendingLeadCommands()).toEqual({});
    },
  );
  it('creates an explicit new batch from a read-only transferred source', async () => {
    const detail: LeadDetail = {
      ...lead,
      status: 'TRANSFERRED_TO_NOTARY',
      capabilities: {
        ...lead.capabilities,
        transferToNotary: false,
        createEvidenceBatch: true,
      },
    };
    api.getLead.mockResolvedValue(detail);
    const { wrapper } = await mountPanel(detail);
    await fillTransfer(wrapper);
    await wrapper.get('[data-test="submit-lead-workflow"]').trigger('click');
    await flushPromises();
    expect(notary.createNotaryMatter.mock.calls[0]![1]).toMatchObject({
      createNewBatch: true,
      expectedVersion: 2,
    });
  });
  it('fails closed on corrupted pending storage', async () => {
    sessionStorage.setItem('dev-cor:lead-workflow:pending', 'corrupted');
    const { wrapper } = await mountPanel();
    expect(wrapper.text()).toContain('无法安全读取未决请求');
    expect(readPendingLeadCommands()).toBeNull();
    expect(api.decideLeadNoEvidence).not.toHaveBeenCalled();
  });
});
