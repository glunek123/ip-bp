import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import CaseExecutionMailingPanel from './CaseExecutionMailingPanel.vue';

const api = vi.hoisted(() => ({
  mailCaseExecution: vi.fn(),
  mailClientCaseExecution: vi.fn(),
  todayShanghai: vi.fn(() => '2026-10-03'),
}));
vi.mock('../../api/cases', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/cases')>()),
  mailCaseExecution: api.mailCaseExecution,
  todayShanghai: api.todayShanghai,
}));
vi.mock('../../api/client-cases', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client-cases')>()),
  mailClientCaseExecution: api.mailClientCaseExecution,
}));

type MailingPanelItem = InstanceType<
  typeof CaseExecutionMailingPanel
>['$props']['item'];

const item: MailingPanelItem = {
  id: 'case-1',
  stage: 'WAITING_EXECUTION_STAMP',
  version: 7,
  canMailExecution: true,
  executionConfirmation: {
    id: 'confirmation-1',
    confirmedAt: '2026-10-02T08:00:00Z',
  },
  executionMailing: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  setActivePinia(createPinia());
  api.todayShanghai.mockReturnValue('2026-10-03');
  api.mailCaseExecution.mockResolvedValue({
    id: 'case-1',
    mailingId: 'mail-1',
    confirmationId: 'confirmation-1',
    stage: 'WAITING_EXECUTION_FILING',
    version: 8,
    mailedAt: '2026-10-03',
    recordedAt: '2026-10-03T01:00:00Z',
  });
  api.mailClientCaseExecution.mockResolvedValue({});
});
function mountPanel(
  value: MailingPanelItem = item,
  extra: Record<string, unknown> = {},
) {
  return mount(CaseExecutionMailingPanel, {
    props: { item: value, contextKey: 'INTERNAL:user-1:1', ...extra },
    global: { plugins: [createPinia()] },
  });
}
async function submitWith(
  wrapper: ReturnType<typeof mountPanel>,
  remark?: string,
) {
  if (remark !== undefined)
    await wrapper
      .get('[data-test="execution-mailing-remark"]')
      .setValue(remark);
  await wrapper.get('[data-test="execution-mailing-review"]').trigger('click');
  await flushPromises();
  await wrapper.get('[data-test="execution-mailing-submit"]').trigger('click');
  await flushPromises();
}

describe('case execution mailing panel', () => {
  it('keeps the mailing fact read-only for accounts without permission', () => {
    const wrapper = mountPanel({ ...item, canMailExecution: false });
    expect(
      wrapper.find('[data-test="execution-mailing-read-only"]').exists(),
    ).toBe(true);
    expect(
      wrapper.find('[data-test="execution-mailing-submit"]').exists(),
    ).toBe(false);
  });

  it('shows the recorded mailing date and remark without upload controls', () => {
    const wrapper = mountPanel({
      ...item,
      executionMailing: {
        id: 'mail-1',
        confirmationId: 'confirmation-1',
        mailedAt: '2026-10-01',
        recordedAt: '2026-10-01T02:00:00Z',
        remark: '顺丰 SF123',
      },
    });
    const text = wrapper.text();
    expect(text).toContain('邮寄日期：2026-10-01');
    expect(text).toContain('备注：顺丰 SF123');
    expect(text).not.toContain('实际邮寄日期');
    expect(
      wrapper.find('[data-test="execution-mailing-file-input"]').exists(),
    ).toBe(false);
  });

  it('allows an empty remark and still records the mailing', async () => {
    const wrapper = mountPanel();
    await submitWith(wrapper);
    expect(api.mailCaseExecution).toHaveBeenCalledTimes(1);
    const input = api.mailCaseExecution.mock.calls[0]![1];
    expect(input.remark).toBeNull();
    expect(input.mailReceiptContentVersionIds).toBeUndefined();
    expect(input.mailedAt).toBe('2026-10-03');
    expect(input.expectedConfirmationId).toBe('confirmation-1');
  });

  it('trims the remark and sends it with the request', async () => {
    const wrapper = mountPanel();
    await submitWith(wrapper, '  法院专递 EMS  ');
    const input = api.mailCaseExecution.mock.calls[0]![1];
    expect(input.remark).toBe('法院专递 EMS');
  });

  it('refuses a future mailing date before confirmation', async () => {
    const wrapper = mountPanel();
    await wrapper
      .get('[data-test="execution-mailed-at"]')
      .setValue('2026-10-04');
    await flushPromises();
    expect(
      wrapper
        .get('[data-test="execution-mailing-review"]')
        .attributes('disabled'),
    ).toBeDefined();
  });

  it('records direct-stage mailing with a null confirmation anchor', async () => {
    const wrapper = mountPanel({
      ...item,
      origin: {
        kind: 'EXTERNAL_ENTRY',
        initialStage: 'WAITING_EXECUTION_STAMP',
      },
      executionConfirmation: null,
    });
    await submitWith(wrapper, '直接入口');
    const input = api.mailCaseExecution.mock.calls[0]![1];
    expect(input.expectedConfirmationId).toBeNull();
    expect(input.remark).toBe('直接入口');
  });

  it('retries an unknown result with the exact original request body and key', async () => {
    api.mailCaseExecution
      .mockRejectedValueOnce(new ApiError('网络中断', 0, 'NETWORK_ERROR'))
      .mockResolvedValueOnce({});
    const wrapper = mountPanel();
    await submitWith(wrapper, '重试备注');
    expect(wrapper.text()).toContain('提交结果暂时未知');
    const first = api.mailCaseExecution.mock.calls[0]![1];
    await wrapper.get('[data-test="execution-mailing-retry"]').trigger('click');
    await flushPromises();
    const second = api.mailCaseExecution.mock.calls[1]![1];
    expect(second).toEqual(first);
  });
});
