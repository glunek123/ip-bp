import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import Panel from './CaseLitigationRefundPanel.vue';
import { ApiError } from '../../api/http';
import type {
  RefundRecordInput,
  RefundRow,
  RefundSourceOption,
  RefundWorkspace,
} from '../../api/litigation-refunds';

const api = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  getRequest: vi.fn(),
  record: vi.fn(),
  correct: vi.fn(),
}));
vi.mock('../../api/litigation-refunds', () => ({
  getLitigationRefundWorkspace: api.getWorkspace,
  getLitigationRefundRequest: api.getRequest,
  recordLitigationRefund: api.record,
  correctLitigationRefund: api.correct,
}));

const source: RefundSourceOption = {
  type: 'JUDGMENT' as const,
  id: 'judgment-1',
  trialRoundId: 'round-1',
  label: '一审判决 2026-10-01',
  courtNo: '（2026）知民初1号',
};
const row: RefundRow = {
  caseId: 'case-1',
  itemId: 'refund-1',
  inventoryVersionId: 'inventory-1',
  caseNo: '（2026）知民初1号',
  plaintiff: '原告',
  defendant: '被告',
  courtNo: null,
  lawyer: null,
  party: 'COURT' as const,
  amount: '20.00',
  status: 'PENDING' as const,
  description: '一审诉讼费退费',
  remark: null,
  archived: false,
  archiveStatus: null,
  canFollow: false,
  canRecord: true,
  source: {
    type: source.type,
    id: source.id,
    trialRoundId: source.trialRoundId,
    label: source.label,
    valid: true,
  },
};
const workspace: RefundWorkspace = {
  caseId: 'case-1',
  inventoryVersionId: 'inventory-1',
  canRecord: true,
  canFollow: false,
  sources: [source],
  items: [row],
};
const command = (item: RefundRow = row, inventoryVersionId = 'inventory-2') => ({
  commandId: 'command-1',
  inventoryVersionId,
  item,
});

beforeEach(() => {
  vi.clearAllMocks();
  api.getWorkspace.mockResolvedValue(structuredClone(workspace));
  api.getRequest.mockResolvedValue(command());
});
afterEach(() => {
  vi.restoreAllMocks();
  globalThis.sessionStorage.clear();
});

async function setup(initialWorkspace = workspace) {
  api.getWorkspace.mockResolvedValue(structuredClone(initialWorkspace));
  const wrapper = mount(Panel, {
    props: { actorKey: 'internal:user-1:department-1:1', caseId: 'case-1', refreshKey: '1' },
  });
  await flushPromises();
  return wrapper;
}

it('does not invent a source when the server has no valid source options', async () => {
  const wrapper = await setup({ ...workspace, sources: [], items: [{ ...row, source: null }] });
  expect(wrapper.get('[data-test="refund-no-source"]').text()).toContain('没有可登记的有效判决或二审结果来源');
  expect(wrapper.find('[data-test="refund-register-open"]').exists()).toBe(false);
  expect(wrapper.text()).toContain('来源关联暂缺，不能据其他记录推断。');
});

it('registers a separate item against the selected current source and keeps a blank amount null', async () => {
  const created = {
    ...row,
    itemId: '00000000-0000-4000-8000-000000000002',
    amount: null,
    description: '待核金额事项',
  };
  api.getWorkspace
    .mockResolvedValueOnce(structuredClone(workspace))
    .mockResolvedValueOnce({ ...workspace, inventoryVersionId: 'inventory-2', items: [created, row] });
  api.record.mockResolvedValue(command(created));
  vi.spyOn(globalThis.crypto, 'randomUUID')
    .mockReturnValueOnce('00000000-0000-4000-8000-000000000002')
    .mockReturnValueOnce('00000000-0000-4000-8000-000000000003');
  const wrapper = await setup();
  await wrapper.get('[data-test="refund-register-open"]').trigger('click');
  await wrapper.get('[data-test="refund-source"]').setValue(JSON.stringify([source.type, source.id]));
  await wrapper.get('[data-test="refund-description"]').setValue('待核金额事项');
  await wrapper.get('[data-test="refund-reason"]').setValue('判决后明确提出退费');
  await wrapper.get('[data-test="refund-save"]').trigger('click');
  await flushPromises();

  expect(api.record).toHaveBeenCalledWith('case-1', {
    itemId: '00000000-0000-4000-8000-000000000002',
    expectedInventoryVersionId: 'inventory-1',
    sourceType: 'JUDGMENT',
    sourceId: 'judgment-1',
    party: 'COURT',
    amount: null,
    description: '待核金额事项',
    reason: '判决后明确提出退费',
    idempotencyKey: '00000000-0000-4000-8000-000000000003',
  });
  expect(wrapper.text()).toContain('退费事项已登记。');
  expect(wrapper.text()).toContain('金额待定');
});

it('corrects an existing item with a required reason and its authoritative source', async () => {
  api.correct.mockResolvedValue(command({ ...row, amount: '18.00' }));
  const wrapper = await setup();
  await wrapper.get('[data-test="refund-correct"]').trigger('click');
  await wrapper.get('[data-test="refund-amount"]').setValue('18');
  await wrapper.get('[data-test="refund-reason"]').setValue('原金额录入错误');
  await wrapper.get('[data-test="refund-save"]').trigger('click');
  await flushPromises();
  expect(api.correct).toHaveBeenCalledWith('case-1', 'refund-1', expect.objectContaining({
    expectedInventoryVersionId: 'inventory-1',
    sourceType: 'JUDGMENT',
    sourceId: 'judgment-1',
    amount: '18.00',
    description: '一审诉讼费退费',
    reason: '原金额录入错误',
  }));
  expect(api.correct).toHaveBeenCalledWith(
    'case-1',
    'refund-1',
    expect.not.objectContaining({ status: expect.anything() }),
  );
  expect(wrapper.text()).toContain('退费事项资料已更正，原记录保留。');
});

it('checks the receipt before replaying the original request after an unknown result', async () => {
  const itemId = '00000000-0000-4000-8000-000000000012';
  const requestKey = '00000000-0000-4000-8000-000000000013';
  api.record.mockRejectedValueOnce(new ApiError('unknown', 500, 'INTERNAL_ERROR'));
  api.getRequest.mockResolvedValue(
    command({ ...row, itemId, amount: null, description: '法院退费事项' }),
  );
  vi.spyOn(globalThis.crypto, 'randomUUID')
    .mockReturnValueOnce(itemId)
    .mockReturnValueOnce(requestKey);
  const wrapper = await setup({ ...workspace, items: [] });
  await wrapper.get('[data-test="refund-register-open"]').trigger('click');
  await wrapper.get('[data-test="refund-source"]').setValue(JSON.stringify([source.type, source.id]));
  await wrapper.get('[data-test="refund-description"]').setValue('法院退费事项');
  await wrapper.get('[data-test="refund-reason"]').setValue('判决后登记');
  await wrapper.get('[data-test="refund-save"]').trigger('click');
  await flushPromises();
  const originalBody = api.record.mock.calls[0]![1] as RefundRecordInput;
  expect(wrapper.find('[data-test="refund-pending-request"]').exists()).toBe(true);
  expect(globalThis.sessionStorage.length).toBe(1);
  const storedValue: unknown = JSON.parse(
    globalThis.sessionStorage.getItem(globalThis.sessionStorage.key(0)!)!,
  );
  expect(storedValue).toMatchObject({ requestKey, body: originalBody });

  await wrapper.setProps({ actorKey: 'INTERNAL:other-user:department-1' });
  await flushPromises();
  expect(wrapper.find('[data-test="refund-pending-request"]').exists()).toBe(false);
  await wrapper.setProps({ actorKey: 'internal:user-1:department-1:1' });
  await flushPromises();
  expect(wrapper.find('[data-test="refund-pending-request"]').exists()).toBe(true);

  await wrapper.get('[data-test="refund-request-recover"]').trigger('click');
  await flushPromises();
  expect(api.getRequest).toHaveBeenCalledWith('case-1', originalBody.idempotencyKey);
  expect(api.record).toHaveBeenCalledTimes(1);
  expect(wrapper.text()).toContain('退费事项已登记。');
  expect(globalThis.sessionStorage.length).toBe(0);
});
