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
  uploadMaterialFile: vi.fn(),
  downloadMaterialVersion: vi.fn(),
  listOwnerMaterials: vi.fn(),
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
  uploadMaterialFile: api.uploadMaterialFile,
  downloadMaterialVersion: api.downloadMaterialVersion,
  listOwnerMaterials: api.listOwnerMaterials,
}));
const item = {
  id: 'case-1',
  stage: 'WAITING_COMPLAINT_STAMP',
  version: 4,
  canMailComplaint: true,
  complaintMailing: null,
  pendingReceiptFiles: [],
};
let testPinia = createPinia();
beforeEach(() => {
  vi.resetAllMocks();
  testPinia = createPinia();
  setActivePinia(testPinia);
  api.todayShanghai.mockReturnValue('2026-10-03');
  api.uploadMaterialFile.mockImplementation(
    async ({ file }: { file: File }) => ({
      materialId: `material-${file.name}`,
      contentVersionId: `version-${file.name}`,
      originalFilename: file.name,
      mimeType: file.type,
    }),
  );
  api.mailCaseComplaint.mockResolvedValue({});
  api.listOwnerMaterials.mockResolvedValue({ items: [], total: 0 });
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

  it('requires an explicitly uploaded receipt and valid non-future date before review', async () => {
    const wrapper = mountPanel({ item });
    const review = wrapper.get('button');
    expect((review.element as HTMLButtonElement).disabled).toBe(true);
    await wrapper.get('input[type="date"]').setValue('2026-10-04');
    await wrapper.get('input[type="file"]').setValue('');
    expect((review.element as HTMLButtonElement).disabled).toBe(true);
    await wrapper.get('input[type="date"]').setValue('2026-10-03');
    await wrapper.get('input[type="file"]').setValue('');
    expect((review.element as HTMLButtonElement).disabled).toBe(true);
  });
  it('keeps the exact request key and contents after an unknown result', async () => {
    api.mailCaseComplaint
      .mockRejectedValueOnce(new ApiError('timeout', 0, 'TIMEOUT'))
      .mockResolvedValueOnce({});
    const wrapper = mountPanel({ item });
    const input = wrapper.get('input[type="file"]');
    const file = new File(['pdf'], 'receipt.pdf', { type: 'application/pdf' });
    await wrapper.get('input[type="date"]').setValue('2026-10-03');
    // Use the native file input setter so the upload path receives a real browser File object.
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [file],
    });
    await input.trigger('change');
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('核对邮寄信息'))!
      .trigger('click');
    await wrapper.get('[data-test="mailing-submit"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('提交结果暂时未知');
    const first = api.mailCaseComplaint.mock.calls[0];
    await wrapper.get('[data-test="mailing-submit"]').trigger('click');
    await flushPromises();
    expect(api.mailCaseComplaint).toHaveBeenCalledTimes(2);
    expect(api.mailCaseComplaint.mock.calls[1]).toEqual(first);
  });
  it('keeps an uploaded reviewed snapshot retryable when same-case lookup finishes late', async () => {
    let finishLookup!: (value: {
      items: Array<Record<string, unknown>>;
      total: number;
    }) => void;
    api.listOwnerMaterials.mockReturnValueOnce(
      new Promise((resolve) => {
        finishLookup = resolve;
      }),
    );
    api.mailCaseComplaint
      .mockRejectedValueOnce(new ApiError('timeout', 0, 'TIMEOUT'))
      .mockResolvedValueOnce({});
    const wrapper = mountPanel({ item });
    const input = wrapper.get('input[type="file"]');
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [new File(['pdf'], 'reviewed.pdf', { type: 'application/pdf' })],
    });
    await input.trigger('change');
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('核对邮寄信息'))!
      .trigger('click');
    await wrapper.get('[data-test="mailing-submit"]').trigger('click');
    await flushPromises();
    const originalRequest = api.mailCaseComplaint.mock.calls[0];

    finishLookup({ items: [], total: 0 });
    await flushPromises();

    expect(wrapper.text()).toContain('reviewed.pdf');
    expect(wrapper.get('[data-test="mailing-submit"]').element).toMatchObject({
      disabled: false,
    });
    await wrapper.get('[data-test="mailing-submit"]').trigger('click');
    await flushPromises();
    expect(api.mailCaseComplaint.mock.calls[1]).toEqual(originalRequest);
  });
  it('does not replace a receipt selected for review when same-case lookup finishes late', async () => {
    let finishLookup!: (value: {
      items: Array<Record<string, unknown>>;
      total: number;
    }) => void;
    api.listOwnerMaterials.mockReturnValueOnce(
      new Promise((resolve) => {
        finishLookup = resolve;
      }),
    );
    const wrapper = mountPanel({ item });
    const input = wrapper.get('input[type="file"]');
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [new File(['pdf'], 'reviewed.pdf', { type: 'application/pdf' })],
    });
    await input.trigger('change');
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('核对邮寄信息'))!
      .trigger('click');
    finishLookup({
      items: [
        {
          id: 'saved-material',
          category: 'MAIL_RECEIPT',
          status: 'ACTIVE',
          contentVersions: [
            {
              id: 'saved-version',
              status: 'AVAILABLE',
              originalFilename: 'later.pdf',
              mimeType: 'application/pdf',
            },
          ],
        },
      ],
      total: 1,
    });
    await flushPromises();
    await wrapper.get('[data-test="mailing-submit"]').trigger('click');
    await flushPromises();

    expect(api.mailCaseComplaint.mock.calls[0]?.[1]).toMatchObject({
      mailReceiptContentVersionIds: ['version-reviewed.pdf'],
    });
  });
  it('renders completed mailing as read-only facts without an upload control', () => {
    const wrapper = mountPanel({
      item: {
        ...item,
        stage: 'WAITING_FILING',
        canMailComplaint: false,
        complaintMailing: {
          mailedAt: '2026-10-02',
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
  it('requires an explicit choice when multiple saved receipt versions are available', () => {
    const wrapper = mountPanel({
      client: true,
      item: {
        ...item,
        pendingReceiptFiles: [
          {
            materialId: 'm-1',
            contentVersionId: 'v-1',
            originalFilename: 'a.pdf',
            mimeType: 'application/pdf',
          },
          {
            materialId: 'm-2',
            contentVersionId: 'v-2',
            originalFilename: 'b.pdf',
            mimeType: 'application/pdf',
          },
        ],
      },
    });
    expect(wrapper.findAll('[data-test="receipt-choice"]')).toHaveLength(2);
    expect(
      wrapper.findAll<HTMLInputElement>('[data-test="receipt-choice"]:checked'),
    ).toHaveLength(0);
  });
  it('automatically selects the only saved receipt version', () => {
    const wrapper = mountPanel({
      client: true,
      item: {
        ...item,
        pendingReceiptFiles: [
          {
            materialId: 'm-1',
            contentVersionId: 'v-1',
            originalFilename: 'only.pdf',
            mimeType: 'application/pdf',
          },
        ],
      },
    });
    expect(wrapper.findAll('[data-test="receipt-choice"]')).toHaveLength(0);
    expect(
      (
        wrapper
          .findAll('button')
          .find((button) => button.text().includes('核对邮寄信息'))!
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });
  it('ignores a saved-file lookup that finishes after switching cases', async () => {
    let finish!: (value: {
      items: Array<Record<string, unknown>>;
      total: number;
    }) => void;
    api.listOwnerMaterials.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const wrapper = mountPanel({ item });
    await wrapper.setProps({ item: { ...item, id: 'case-2', version: 1 } });
    await flushPromises();
    finish({
      items: [
        {
          id: 'm-old',
          category: 'MAIL_RECEIPT',
          status: 'ACTIVE',
          contentVersions: [
            {
              id: 'v-old',
              status: 'AVAILABLE',
              originalFilename: 'old-case.pdf',
              mimeType: 'application/pdf',
            },
          ],
        },
      ],
      total: 1,
    });
    await flushPromises();
    expect(wrapper.text()).not.toContain('old-case.pdf');
  });
  it('does not attach an upload result to the next case after switching cases', async () => {
    let finish!: (value: {
      materialId: string;
      contentVersionId: string;
      originalFilename: string;
      mimeType: string;
    }) => void;
    api.uploadMaterialFile.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const wrapper = mountPanel({ item });
    const input = wrapper.get('input[type="file"]');
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [new File(['pdf'], 'old-upload.pdf', { type: 'application/pdf' })],
    });
    await input.trigger('change');
    await wrapper.setProps({ item: { ...item, id: 'case-2', version: 1 } });
    finish({
      materialId: 'm-old',
      contentVersionId: 'v-old',
      originalFilename: 'old-upload.pdf',
      mimeType: 'application/pdf',
    });
    await flushPromises();
    expect(wrapper.text()).not.toContain('old-upload.pdf');
  });
  it('resets upload busy state and ignores an old upload rejection after switching cases', async () => {
    let rejectUpload!: (reason: Error) => void;
    api.uploadMaterialFile.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectUpload = reject;
      }),
    );
    const wrapper = mountPanel({ item });
    const input = wrapper.get('input[type="file"]');
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [new File(['pdf'], 'old-upload.pdf', { type: 'application/pdf' })],
    });
    await input.trigger('change');
    await wrapper.setProps({ item: { ...item, id: 'case-2', version: 1 } });
    expect(
      (wrapper.get('input[type="file"]').element as HTMLInputElement).disabled,
    ).toBe(false);
    rejectUpload(new Error('old request rejected'));
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('正在上传凭证');
  });
  it('does not start remaining uploads or emit after unmount during a multi-file upload', async () => {
    let finishFirst!: (value: {
      materialId: string;
      contentVersionId: string;
      originalFilename: string;
      mimeType: string;
    }) => void;
    api.uploadMaterialFile.mockReturnValueOnce(
      new Promise((resolve) => {
        finishFirst = resolve;
      }),
    );
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    const wrapper = mountPanel({ item });
    const input = wrapper.get('input[type="file"]');
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [
        new File(['one'], 'one.pdf', { type: 'application/pdf' }),
        new File(['two'], 'two.pdf', { type: 'application/pdf' }),
      ],
    });
    await input.trigger('change');
    expect(api.uploadMaterialFile).toHaveBeenCalledTimes(1);
    wrapper.unmount();
    finishFirst({
      materialId: 'm-1',
      contentVersionId: 'v-1',
      originalFilename: 'one.pdf',
      mimeType: 'application/pdf',
    });
    await flushPromises();
    expect(api.uploadMaterialFile).toHaveBeenCalledTimes(1);
    expect(
      dispatch.mock.calls.some(
        ([event]) => event.type === workflowChangedEvent,
      ),
    ).toBe(false);
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
      item: {
        ...item,
        pendingReceiptFiles: [
          {
            materialId: 'm-1',
            contentVersionId: 'v-1',
            originalFilename: 'receipt.pdf',
            mimeType: 'application/pdf',
          },
        ],
      },
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
      item: {
        ...item,
        pendingReceiptFiles: [
          {
            materialId: 'm-1',
            contentVersionId: 'v-1',
            originalFilename: 'receipt.pdf',
            mimeType: 'application/pdf',
          },
        ],
      },
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
