import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import CaseExecutionMailingPanel from './CaseExecutionMailingPanel.vue';

const api = vi.hoisted(() => ({
  mailCaseExecution: vi.fn(),
  mailClientCaseExecution: vi.fn(),
  listOwnerMaterials: vi.fn(),
  uploadMaterialFile: vi.fn(),
  downloadMaterialVersion: vi.fn(),
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
vi.mock('../../api/materials', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/materials')>()),
  listOwnerMaterials: api.listOwnerMaterials,
  uploadMaterialFile: api.uploadMaterialFile,
  downloadMaterialVersion: api.downloadMaterialVersion,
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
  api.listOwnerMaterials.mockResolvedValue({ items: [], total: 0 });
  api.uploadMaterialFile.mockImplementation(async ({ file }) => ({
    materialId: `m-${file.name}`,
    contentVersionId: `v-${file.name}`,
    originalFilename: file.name,
    mimeType: file.type,
  }));
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
async function addReceipt(wrapper: ReturnType<typeof mount>) {
  const input = wrapper.get('[data-test="execution-mailing-file-input"]');
  Object.defineProperty(input.element, 'files', {
    configurable: true,
    value: [new File(['proof'], 'receipt.pdf', { type: 'application/pdf' })],
  });
  await input.trigger('change');
  await flushPromises();
}
describe('case execution mailing panel', () => {
  it('keeps the mailing fact read-only for accounts without permission', () => {
    const wrapper = mountPanel({ ...item, canMailExecution: false });
    expect(
      wrapper.find('[data-test="execution-mailing-read-only"]').exists(),
    ).toBe(true);
    expect(
      wrapper.find('[data-test="execution-mailing-file-input"]').exists(),
    ).toBe(false);
  });
  it('does not load receipt candidates when the mailing fact is already recorded', async () => {
    const wrapper = mountPanel({
      ...item,
      executionMailing: {
        id: 'mailing-1',
        mailedAt: '2026-10-03',
        recordedAt: '2026-10-03T01:00:00Z',
        files: [],
      },
    });
    await flushPromises();
    expect(api.listOwnerMaterials).not.toHaveBeenCalled();
    expect(
      wrapper.find('[data-test="execution-mailing-file-input"]').exists(),
    ).toBe(false);
  });
  it('excludes frozen complaint receipts and leaves multiple current drafts unselected', async () => {
    const frozenReceipt = {
      materialId: 'receipt-material',
      contentVersionId: 'frozen-version',
      originalFilename: 'frozen-receipt.pdf',
      mimeType: 'application/pdf',
    };
    api.listOwnerMaterials.mockResolvedValueOnce({
      items: [
        {
          id: 'receipt-material',
          category: 'MAIL_RECEIPT',
          status: 'ACTIVE',
          contentVersions: [
            {
              id: 'frozen-version',
              status: 'AVAILABLE',
              originalFilename: 'frozen-receipt.pdf',
              mimeType: 'application/pdf',
            },
            {
              id: 'current-version-a',
              status: 'AVAILABLE',
              originalFilename: 'current-a.pdf',
              mimeType: 'application/pdf',
            },
            {
              id: 'current-version-b',
              status: 'AVAILABLE',
              originalFilename: 'current-b.pdf',
              mimeType: 'application/pdf',
            },
          ],
        },
      ],
      total: 1,
    });
    const wrapper = mountPanel({
      ...item,
      complaintMailing: { receiptFiles: [frozenReceipt] },
    });
    await flushPromises();
    const choices = wrapper.findAll<HTMLInputElement>(
      '[data-test="execution-mailing-choice"]',
    );
    expect(choices).toHaveLength(2);
    expect(choices.filter((choice) => choice.element.checked)).toHaveLength(0);
    expect(wrapper.text()).not.toContain('frozen-receipt.pdf');
    expect(wrapper.text()).toContain('current-a.pdf');
    expect(wrapper.text()).toContain('current-b.pdf');
  });
  it('shows refreshed client receipt drafts for an explicit version choice', async () => {
    const clientItem: MailingPanelItem = {
      id: item.id,
      stage: item.stage,
      version: item.version,
      canMailExecution: item.canMailExecution,
      executionConfirmationId: 'confirmation-1',
      pendingReceiptFiles: [],
      executionMailing: null,
    };
    const wrapper = mountPanel(clientItem, {
      client: true,
      contextKey: 'CLIENT:client-1:1',
    });
    await flushPromises();
    await wrapper.setProps({
      item: {
        ...clientItem,
        pendingReceiptFiles: [
          {
            materialId: 'material-a',
            contentVersionId: 'version-a',
            originalFilename: 'draft-a.pdf',
            mimeType: 'application/pdf',
          },
          {
            materialId: 'material-b',
            contentVersionId: 'version-b',
            originalFilename: 'draft-b.pdf',
            mimeType: 'application/pdf',
          },
        ],
      },
    });
    await flushPromises();
    const choices = wrapper.findAll<HTMLInputElement>(
      '[data-test="execution-mailing-choice"]',
    );
    expect(choices).toHaveLength(2);
    expect(choices.filter((choice) => choice.element.checked)).toHaveLength(0);
    expect(api.listOwnerMaterials).not.toHaveBeenCalled();
    await choices[1]!.setValue(true);
    await wrapper
      .get('[data-test="execution-mailing-review"]')
      .trigger('click');
    await wrapper
      .get('[data-test="execution-mailing-submit"]')
      .trigger('click');
    await flushPromises();
    expect(api.mailClientCaseExecution).toHaveBeenCalledWith(
      'case-1',
      expect.objectContaining({
        expectedConfirmationId: 'confirmation-1',
        mailReceiptContentVersionIds: ['version-b'],
      }),
    );
  });
  it('requires a real receipt and accepts a valid past date before confirmation', async () => {
    const wrapper = mountPanel();
    await flushPromises();
    const date = wrapper.get('[data-test="execution-mailed-at"]');
    expect((date.element as HTMLInputElement).min).toBe('');
    expect((date.element as HTMLInputElement).max).toBe('2026-10-03');
    expect(
      (
        wrapper.get('[data-test="execution-mailing-review"]')
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await addReceipt(wrapper);
    await date.setValue('2026-10-01');
    expect(
      (
        wrapper.get('[data-test="execution-mailing-review"]')
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    await date.setValue('2026-10-04');
    expect(
      (
        wrapper.get('[data-test="execution-mailing-review"]')
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
  it('sends the chosen material version and confirmation anchor after explicit review', async () => {
    const wrapper = mountPanel();
    await flushPromises();
    await addReceipt(wrapper);
    await wrapper
      .get('[data-test="execution-mailed-at"]')
      .setValue('2026-10-01');
    await wrapper
      .get('[data-test="execution-mailing-review"]')
      .trigger('click');
    await wrapper
      .get('[data-test="execution-mailing-submit"]')
      .trigger('click');
    await flushPromises();
    expect(api.uploadMaterialFile).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'MAIL_RECEIPT',
        purpose: 'MAIL_RECEIPT',
      }),
    );
    expect(api.mailCaseExecution).toHaveBeenCalledWith(
      'case-1',
      expect.objectContaining({
        expectedVersion: 7,
        expectedConfirmationId: 'confirmation-1',
        mailedAt: '2026-10-01',
        mailReceiptContentVersionIds: ['v-receipt.pdf'],
        idempotencyKey: expect.any(String),
      }),
      undefined,
    );
    expect(wrapper.emitted('changed')).toHaveLength(1);
  });
  it('retries an unknown result with the exact original request body and key', async () => {
    api.mailCaseExecution
      .mockRejectedValueOnce(new ApiError('timeout', 0, 'TIMEOUT'))
      .mockResolvedValueOnce({});
    const wrapper = mountPanel();
    await flushPromises();
    await addReceipt(wrapper);
    await wrapper
      .get('[data-test="execution-mailing-review"]')
      .trigger('click');
    await wrapper
      .get('[data-test="execution-mailing-submit"]')
      .trigger('click');
    await flushPromises();
    const original = api.mailCaseExecution.mock.calls[0];
    expect(wrapper.text()).toContain('提交结果暂时未知');
    await wrapper.setProps({
      item: {
        ...item,
        version: 8,
        stage: 'WAITING_EXECUTION_FILING',
        canMailExecution: false,
      },
    });
    expect(wrapper.find('[data-test="execution-mailing-retry"]').exists()).toBe(
      true,
    );
    await wrapper.get('[data-test="execution-mailing-retry"]').trigger('click');
    await flushPromises();
    expect(api.mailCaseExecution.mock.calls[1]).toEqual(original);
  });
  it('does not expose a late response after changing the case', async () => {
    let finish!: () => void;
    api.mailCaseExecution.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const wrapper = mountPanel();
    await flushPromises();
    await addReceipt(wrapper);
    await wrapper
      .get('[data-test="execution-mailing-review"]')
      .trigger('click');
    await wrapper
      .get('[data-test="execution-mailing-submit"]')
      .trigger('click');
    await wrapper.setProps({ item: { ...item, id: 'case-2', version: 1 } });
    finish();
    await flushPromises();
    expect(wrapper.emitted('changed')).toBeUndefined();
    expect(wrapper.text()).not.toContain('邮寄登记已完成');
  });
});
