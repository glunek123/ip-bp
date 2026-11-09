import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import { createPinia, setActivePinia } from 'pinia';
import { useAuthStore } from '../../stores/auth';
import CaseComplaintMailingPanel from './CaseComplaintMailingPanel.vue';
import { workflowChangedEvent } from '../../app/workflow-events';
const api = vi.hoisted(() => ({
  mailCaseComplaint: vi.fn(),
  mailClientCaseComplaint: vi.fn(),
  downloadMaterialVersion: vi.fn(),
  todayShanghai: vi.fn(() => '2026-10-03'),
}));
vi.mock('../../api/cases', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/cases')>()),
  mailCaseComplaint: api.mailCaseComplaint,
  todayShanghai: api.todayShanghai,
}));
vi.mock('../../api/client-cases', () => ({
  mailClientCaseComplaint: api.mailClientCaseComplaint,
}));
vi.mock('../../api/materials', () => ({
  downloadMaterialVersion: api.downloadMaterialVersion,
}));
const item = {
  id: 'case-1',
  stage: 'WAITING_COMPLAINT_STAMP',
  version: 4,
  canMailComplaint: true,
  complaintMailing: null,
};
let testPinia = createPinia();
beforeEach(() => {
  vi.resetAllMocks();
  testPinia = createPinia();
  setActivePinia(testPinia);
  api.todayShanghai.mockReturnValue('2026-10-03');
  api.mailCaseComplaint.mockResolvedValue({});
});
function mountPanel(
  props: InstanceType<typeof CaseComplaintMailingPanel>['$props'],
) {
  return mount(CaseComplaintMailingPanel, {
    props,
    global: { plugins: [testPinia] },
  });
}
describe('complaint mailing panel', () => {
  it('aborts a client download when its shared panel unmounts', async () => {
    const receipt = {
      materialId: 'receipt-material',
      contentVersionId: 'receipt-version',
      originalFilename: '回执.pdf',
      mimeType: 'application/pdf',
    };
    let finishDownload!: () => void;
    api.downloadMaterialVersion.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishDownload = resolve;
      }),
    );
    const wrapper = mountPanel({
      client: true,
      item: {
        ...item,
        complaintMailing: {
          mailedAt: '2026-10-02',
          remark: null,
          recordedAt: '2026-10-03T01:00:00Z',
          receiptFiles: [receipt],
        },
      },
    });
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '下载')!
      .trigger('click');
    const signal = api.downloadMaterialVersion.mock
      .calls[0]?.[2] as AbortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
    wrapper.unmount();
    expect(signal.aborted).toBe(true);
    finishDownload();
    await flushPromises();
  });

  it('accepts an optional remark without requiring a receipt, but rejects a future date', async () => {
    const wrapper = mountPanel({ item });
    expect(wrapper.find('input[type="file"]').exists()).toBe(false);
    const review = wrapper.get('button');
    expect((review.element as HTMLButtonElement).disabled).toBe(false);
    await wrapper.get('input[type="date"]').setValue('2026-10-04');
    expect((review.element as HTMLButtonElement).disabled).toBe(true);
    await wrapper.get('input[type="date"]').setValue('2026-10-03');
    await wrapper.get('[data-test="complaint-mail-remark"]').setValue('寄出');
    expect((review.element as HTMLButtonElement).disabled).toBe(false);
  });
  it('keeps the exact request key and contents after an unknown result', async () => {
    api.mailCaseComplaint
      .mockRejectedValueOnce(new ApiError('timeout', 0, 'TIMEOUT'))
      .mockResolvedValueOnce({});
    const wrapper = mountPanel({ item });
    await wrapper
      .get('[data-test="complaint-mail-remark"]')
      .setValue('寄出说明');
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('核对邮寄信息'))!
      .trigger('click');
    await wrapper.get('[data-test="mailing-submit"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('提交结果暂时未知');
    const first = api.mailCaseComplaint.mock.calls[0];
    await wrapper.setProps({
      item: {
        ...item,
        version: 5,
        stage: 'WAITING_FILING',
        canMailComplaint: false,
      },
    });
    expect(wrapper.find('[data-test="mailing-submit"]').exists()).toBe(true);
    await wrapper.get('[data-test="mailing-submit"]').trigger('click');
    await flushPromises();
    expect(api.mailCaseComplaint).toHaveBeenCalledTimes(2);
    expect(api.mailCaseComplaint.mock.calls[1]).toEqual(first);
  });
  it('renders completed mailing as read-only facts without an upload control', () => {
    const wrapper = mountPanel({
      item: {
        ...item,
        stage: 'WAITING_FILING',
        canMailComplaint: false,
        complaintMailing: {
          mailedAt: '2026-10-02',
          remark: null,
          recordedAt: '2026-10-03T01:00:00Z',
          receiptFiles: [
            {
              materialId: 'm-1',
              contentVersionId: 'v-1',
              originalFilename: 'mail.pdf',
              mimeType: 'application/pdf',
            },
          ],
        },
      },
    });
    expect(wrapper.text()).toContain('2026-10-02');
    expect(wrapper.find('input[type="file"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="mailing-submit"]').exists()).toBe(false);
  });
  it('does not expose a late download error in the next case context', async () => {
    let rejectDownload!: (reason: Error) => void;
    api.downloadMaterialVersion.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectDownload = reject;
      }),
    );
    const wrapper = mountPanel({
      item: {
        ...item,
        complaintMailing: {
          mailedAt: '2026-10-02',
          remark: null,
          recordedAt: '2026-10-03T01:00:00Z',
          receiptFiles: [
            {
              materialId: 'm-1',
              contentVersionId: 'v-1',
              originalFilename: 'receipt.pdf',
              mimeType: 'application/pdf',
            },
          ],
        },
      },
    });
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '下载')!
      .trigger('click');
    await wrapper.setProps({ item: { ...item, id: 'case-2', version: 1 } });
    rejectDownload(new Error('late download rejection'));
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });
  it('does not notify after a mailing request finishes after unmount', async () => {
    let finishMailing!: () => void;
    api.mailClientCaseComplaint.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishMailing = resolve;
      }),
    );
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    const wrapper = mountPanel({
      client: true,
      item,
    });
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('核对邮寄信息'))!
      .trigger('click');
    await wrapper.get('[data-test="mailing-submit"]').trigger('click');
    wrapper.unmount();
    finishMailing();
    await flushPromises();
    expect(
      dispatch.mock.calls.some(
        ([event]) => event.type === workflowChangedEvent,
      ),
    ).toBe(false);
  });
  it('does not show a late mailing result after the authenticated account changes', async () => {
    let finish!: () => void;
    api.mailClientCaseComplaint.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const auth = useAuthStore(testPinia);
    auth.session = {
      principalType: 'CLIENT',
      authorizationRevision: 1,
      user: { id: 'client-a' },
    } as never;
    const wrapper = mountPanel({
      client: true,
      item,
    });
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('核对邮寄信息'))!
      .trigger('click');
    await wrapper.get('[data-test="mailing-submit"]').trigger('click');
    await flushPromises();
    auth.session = {
      principalType: 'CLIENT',
      authorizationRevision: 2,
      user: { id: 'client-b' },
    } as never;
    await flushPromises();
    finish();
    await flushPromises();
    expect(wrapper.emitted('changed')).toBeUndefined();
    expect(wrapper.text()).not.toContain('邮寄登记已完成');
  });
});
