import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { isVNode, type VNode } from 'vue';
import type {
  CreateLeadInput,
  LeadBusinessResult,
  LeadFormContext,
} from '../../api/leads';
import type { LeadCsvParsedRow } from './lead-csv-preview';
import type {
  LeadCsvImportAttempt,
  LeadCsvImportSubmissionContext,
  LeadCsvImportSubmitOutcome,
} from './lead-csv-import-recovery';
import LeadCsvImportPanel from './LeadCsvImportPanel.vue';
import LeadCsvPreviewPanel from './LeadCsvPreviewPanel.vue';

const formContext: LeadFormContext = {
  customers: [
    {
      id: 'customer-a',
      name: '客户甲',
      rightsHolders: [{ id: 'holder-a', name: '主体甲' }],
    },
  ],
  dictionaries: {
    caseTypes: [{ value: 'CIVIL', label: '民事' }],
    infringementTypes: [{ value: 'TRADEMARK', label: '商标侵权' }],
    sources: [{ value: 'ONLINE', label: '线上' }],
    platforms: {
      ONLINE: [{ value: 'TAOBAO', label: '淘宝' }],
      OFFLINE: [],
    },
  },
};

type PanelProps = {
  open: boolean;
  contextKey: string;
  formContext: LeadFormContext;
  operatorDisplayName: string;
  actorIdentity: string;
  authorizationGeneration: string;
  submitAttempt: (
    attempt: LeadCsvImportAttempt,
    context: LeadCsvImportSubmissionContext,
  ) => Promise<LeadCsvImportSubmitOutcome>;
  parseFile?: (
    file: File,
    signal: AbortSignal,
    context: { formContext: LeadFormContext; operatorDisplayName: string },
  ) => Promise<readonly LeadCsvParsedRow[]>;
};

function panelProps(overrides: Partial<PanelProps> = {}): PanelProps {
  return {
    open: true,
    contextKey: 'scope-a:1:1',
    formContext,
    operatorDisplayName: '运营甲',
    actorIdentity: 'operator-1:INTERNAL:department-1',
    authorizationGeneration: '1',
    submitAttempt: vi.fn().mockResolvedValue({
      kind: 'rejected',
      message: '测试业务拒绝',
    }),
    ...overrides,
  };
}

function mountPanel(overrides: Partial<PanelProps> = {}) {
  return mount(LeadCsvImportPanel, { props: panelProps(overrides) });
}

function leadInput(): CreateLeadInput {
  return {
    customerId: 'customer-a',
    rightsHolderId: 'holder-a',
    caseType: 'CIVIL',
    infringementTypes: ['TRADEMARK'],
    source: 'ONLINE',
    platform: 'TAOBAO',
    foundAt: '2026-10-19T02:00:00.000Z',
    shopName: '合成店铺',
    needDisclose: false,
    products: [
      { title: '合成商品', quantity: 1, commentCount: 0, unitPrice: '1.00' },
    ],
    leadScreenshotContentVersionIds: [],
  };
}

function importResult(): {
  items: Array<{ rowNumber: number; lead: LeadBusinessResult }>;
} {
  return {
    items: [
      {
        rowNumber: 2,
        lead: {
          id: 'lead-created-1',
          businessNo: 'LD-20261019-001',
          departmentId: 'department-1',
          customerId: 'customer-a',
          rightsHolderId: 'holder-a',
          responsibleUserId: 'operator-1',
          teamId: null,
          status: 'WAITING_PUSH',
          caseType: 'CIVIL',
          infringementTypes: ['TRADEMARK'],
          source: 'ONLINE',
          platform: 'TAOBAO',
          foundAt: '2026-10-19T02:00:00.000Z',
          shopName: '合成店铺',
          shopExternalId: null,
          needDisclose: false,
          remark: null,
          creationChannel: 'CSV',
          externalSourceRef: null,
          products: [],
          leadScreenshotContentVersionIds: [],
          version: 1,
          pushedAt: null,
          pushedByUserId: null,
          pushedByDisplayName: null,
          reviewDecision: null,
          createdAt: '2026-10-19T02:00:00.000Z',
          updatedAt: '2026-10-19T02:00:00.000Z',
        },
      },
    ],
  };
}

function validRows(count = 1): readonly LeadCsvParsedRow[] {
  return Array.from({ length: count }, (_, index) => ({
    rowNumber: index + 2,
    status: 'valid' as const,
    input: leadInput(),
    suspectedDuplicates: [],
  }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function chooseFile(
  wrapper: ReturnType<typeof mount>,
  name: string,
): Promise<void> {
  await chooseFileObject(
    wrapper,
    new globalThis.File(['row'], name, { type: 'text/csv' }),
  );
}

async function chooseFileObject(
  wrapper: ReturnType<typeof mount>,
  file: File,
): Promise<void> {
  const input = wrapper.get('[data-test="csv-file-input"]');
  Object.defineProperty(input.element, 'files', {
    configurable: true,
    value: [file],
  });
  await input.trigger('change');
  await flushPromises();
}

type CapturedFileInputHandler = {
  element: HTMLInputElement;
  handler: (event: Event) => unknown;
};

function captureFileInputHandler(wrapper: ReturnType<typeof mount>): {
  element: HTMLInputElement;
  handler: (event: Event) => unknown;
} {
  const visit = (node: VNode): CapturedFileInputHandler | undefined => {
    if (
      node.type === 'input' &&
      node.props?.['data-test'] === 'csv-file-input' &&
      node.el instanceof globalThis.HTMLInputElement
    ) {
      const handler = node.props.onChange;
      if (typeof handler !== 'function')
        throw new Error('Expected the file input change handler');
      return {
        element: node.el,
        handler: handler as (event: Event) => unknown,
      };
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        if (!isVNode(child)) continue;
        const found = visit(child);
        if (found) return found;
      }
    }
    return undefined;
  };
  const captured = visit(wrapper.vm.$.subTree);
  if (!captured) throw new Error('Expected a rendered CSV file input');
  return captured;
}

async function invokeFileHandler(
  captured: CapturedFileInputHandler,
  name: string,
): Promise<void> {
  const file = new globalThis.File(['row'], name, { type: 'text/csv' });
  Object.defineProperty(captured.element, 'files', {
    configurable: true,
    value: [file],
  });
  const event = new globalThis.Event('change');
  Object.defineProperty(event, 'target', { value: captured.element });
  await captured.handler(event);
}

describe('LeadCsvImportPanel', () => {
  it('opens a session, parses an injected file and exposes the preview', async () => {
    const parseFile = vi.fn().mockResolvedValue(validRows());
    const wrapper = mountPanel({ parseFile });

    await chooseFile(wrapper, 'A.csv');

    expect(parseFile).toHaveBeenCalledOnce();
    expect(parseFile.mock.calls[0]?.[0].name).toBe('A.csv');
    expect(parseFile.mock.calls[0]?.[1].aborted).toBe(false);
    expect(parseFile.mock.calls[0]?.[2]).toEqual({
      formContext,
      operatorDisplayName: '运营甲',
    });
    expect(wrapper.find('[data-test="csv-row-2"]').exists()).toBe(true);
    const preview = wrapper.findComponent(LeadCsvPreviewPanel);
    expect(preview.props('formContext')).toEqual(formContext);
    expect(wrapper.get('[data-test="csv-row-2"]').text()).toContain('客户甲');
    expect(wrapper.get('[data-test="csv-row-2"]').text()).toContain('主体甲');
    expect(wrapper.get('[data-test="csv-row-2"]').text()).not.toContain(
      'customer-a',
    );
    expect(wrapper.text()).toContain('90 KiB');
  });

  it('clears the input value so the same file can be selected again', async () => {
    const parseFile = vi.fn().mockResolvedValue(validRows());
    const wrapper = mountPanel({ parseFile });

    await chooseFile(wrapper, 'A.csv');
    await chooseFile(wrapper, 'A.csv');

    expect(parseFile).toHaveBeenCalledTimes(2);
    expect(wrapper.get('[data-test="csv-file-name"]').text()).toContain(
      'A.csv',
    );
  });

  it('does not let a late parser result replace a newer file preview', async () => {
    const first = deferred<readonly LeadCsvParsedRow[]>();
    const parseFile = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(validRows());
    const wrapper = mountPanel({ parseFile });

    await chooseFile(wrapper, 'A.csv');
    const firstSignal = parseFile.mock.calls[0]?.[1] as AbortSignal;
    await chooseFile(wrapper, 'B.csv');
    expect(firstSignal.aborted).toBe(true);
    first.resolve([
      {
        rowNumber: 2,
        status: 'valid',
        input: { ...leadInput(), shopName: '旧文件店铺' },
        suspectedDuplicates: [],
      },
    ]);
    await Promise.resolve();
    await Promise.resolve();

    expect(wrapper.get('[data-test="csv-file-name"]').text()).toContain(
      'B.csv',
    );
    expect(wrapper.get('[data-test="csv-row-2"]').text()).toContain('合成店铺');
    expect(wrapper.get('[data-test="csv-row-2"]').text()).not.toContain(
      '旧文件店铺',
    );
  });

  it('invalidates pending work on context change, close and unmount', async () => {
    const pending = deferred<readonly LeadCsvParsedRow[]>();
    const parseFile = vi.fn().mockReturnValue(pending.promise);
    const wrapper = mountPanel({ parseFile });
    await chooseFile(wrapper, 'A.csv');
    const signal = parseFile.mock.calls[0]?.[1] as AbortSignal;

    await wrapper.setProps({ contextKey: 'scope-b' });
    expect(signal.aborted).toBe(true);
    expect(wrapper.find('[data-test="csv-file-name"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('尚未选择 CSV 文件。');

    await chooseFile(wrapper, 'B.csv');
    const secondSignal = parseFile.mock.calls[1]?.[1] as AbortSignal;
    await wrapper.setProps({ open: false });
    expect(secondSignal.aborted).toBe(true);
    expect(wrapper.find('[data-test="csv-import-panel"]').exists()).toBe(false);

    await wrapper.setProps({ open: true });
    await chooseFile(wrapper, 'C.csv');
    const thirdSignal = parseFile.mock.calls[2]?.[1] as AbortSignal;
    wrapper.unmount();
    expect(thirdSignal.aborted).toBe(true);
    pending.resolve(validRows());
  });

  it('rejects old file and confirm handlers as soon as the session boundary changes', async () => {
    const parseFile = vi.fn().mockResolvedValue(validRows());
    const submitAttempt = vi.fn().mockResolvedValue({
      kind: 'rejected',
      message: '测试业务拒绝',
    });
    const wrapper = mountPanel({ parseFile, submitAttempt });
    const oldFileInput = captureFileInputHandler(wrapper);
    await invokeFileHandler(oldFileInput, 'A.csv');

    const fileAHandler = captureFileInputHandler(wrapper);
    await invokeFileHandler(fileAHandler, 'B.csv');
    await invokeFileHandler(fileAHandler, 'stale-same-session.csv');
    expect(parseFile).toHaveBeenCalledTimes(2);
    expect(wrapper.get('[data-test="csv-file-name"]').text()).toContain(
      'B.csv',
    );
    await wrapper.get('[data-test="csv-row-2"] input').setValue(true);

    const preview = wrapper.findComponent(LeadCsvPreviewPanel);
    const oldConfirmHandler = preview.vm.$.vnode.props?.onConfirmRequest;
    if (typeof oldConfirmHandler !== 'function')
      throw new Error('Expected the preview confirm handler');
    const oldSnapshot = preview.props('snapshot');
    if (!oldSnapshot || typeof oldSnapshot.generation !== 'number')
      throw new Error('Expected the previous preview generation');
    const oldGeneration = oldSnapshot.generation;
    expect(wrapper.get('[data-test="csv-file-name"]').text()).toContain(
      'B.csv',
    );
    await oldConfirmHandler({ generation: oldGeneration });
    await flushPromises();
    expect(submitAttempt).toHaveBeenCalledTimes(1);
    const submittedCount = submitAttempt.mock.calls.length;
    const update = wrapper.setProps({ contextKey: 'scope-b' });
    await invokeFileHandler(oldFileInput, 'stale-context.csv');
    await oldConfirmHandler({
      generation: oldGeneration,
    });
    await flushPromises();
    expect(parseFile).toHaveBeenCalledTimes(2);
    expect(submitAttempt).toHaveBeenCalledTimes(submittedCount);
    await update;
    expect(wrapper.text()).toContain('尚未选择 CSV 文件。');

    const currentFileInput = captureFileInputHandler(wrapper);
    await invokeFileHandler(currentFileInput, 'C.csv');
    expect(parseFile).toHaveBeenCalledTimes(3);
    const handlerBeforeClose = captureFileInputHandler(wrapper);
    await wrapper.get('[data-test="csv-cancel-request"]').trigger('click');
    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    await invokeFileHandler(handlerBeforeClose, 'stale-reopen.csv');
    expect(parseFile).toHaveBeenCalledTimes(3);
  });

  it('clears the current preview after a parser rejection', async () => {
    const parseFile = vi
      .fn()
      .mockResolvedValueOnce(validRows())
      .mockRejectedValueOnce(new Error('invalid CSV'));
    const wrapper = mountPanel({ parseFile });
    await chooseFile(wrapper, 'A.csv');
    await chooseFile(wrapper, 'B.csv');

    expect(wrapper.find('[data-test="csv-error"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="csv-file-error"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="csv-row-2"]').exists()).toBe(false);
  });

  it('rejects files over 2 MiB before parsing', async () => {
    const parseFile = vi.fn().mockResolvedValue(validRows());
    const wrapper = mountPanel({ parseFile });

    await chooseFileObject(
      wrapper,
      new globalThis.File(
        [new Uint8Array(2 * 1024 * 1024 + 1)],
        'too-large.csv',
        { type: 'text/csv' },
      ),
    );

    expect(parseFile).not.toHaveBeenCalled();
    expect(wrapper.get('[data-test="csv-file-error"]').text()).toContain(
      '2 MiB',
    );
  });

  it('does not start a FileReader read for an oversized file', async () => {
    const read = vi.spyOn(FileReader.prototype, 'readAsArrayBuffer');
    const wrapper = mountPanel();
    const file = new globalThis.File(['x'], 'large.csv', {
      type: 'text/csv',
    });
    Object.defineProperty(file, 'size', {
      configurable: true,
      value: 2 * 1024 * 1024 + 1,
    });
    await chooseFileObject(wrapper, file);
    expect(read).not.toHaveBeenCalled();
    wrapper.unmount();
    read.mockRestore();
  });

  it('allows at most twenty rows in one submission', async () => {
    const submitAttempt = vi.fn().mockResolvedValue({
      kind: 'rejected',
      message: '测试业务拒绝',
    });
    const wrapper = mountPanel({
      parseFile: vi.fn().mockResolvedValue(validRows(21)),
      submitAttempt,
    });
    await chooseFile(wrapper, 'twenty-one.csv');

    for (let rowNumber = 2; rowNumber <= 22; rowNumber += 1)
      await wrapper
        .get(`[data-test="csv-row-${rowNumber}"] input`)
        .setValue(true);

    expect(wrapper.get('[data-test="csv-selection-error"]').text()).toContain(
      '20',
    );
    await wrapper.get('[data-test="csv-confirm-request"]').trigger('click');
    await flushPromises();
    expect(submitAttempt).toHaveBeenCalledOnce();
    expect(submitAttempt.mock.calls[0]?.[0].items).toHaveLength(20);
  });

  it('submits one current frozen selection and emits imported only for created results', async () => {
    const submitAttempt = vi.fn().mockResolvedValue({
      kind: 'created',
      result: importResult(),
    });
    const wrapper = mountPanel({
      parseFile: vi.fn().mockResolvedValue(validRows()),
      submitAttempt,
    });
    await chooseFile(wrapper, 'A.csv');
    await wrapper.get('[data-test="csv-row-2"] input').setValue(true);
    const confirm = wrapper.get('[data-test="csv-confirm-request"]');
    await confirm.trigger('click');
    await confirm.trigger('click');

    expect(submitAttempt).toHaveBeenCalledOnce();
    const [attempt, context] = submitAttempt.mock.calls[0] ?? [];
    expect(attempt).toMatchObject({
      actorIdentity: 'operator-1:INTERNAL:department-1',
      idempotencyKey: expect.any(String),
      items: [{ rowNumber: 2, input: leadInput() }],
    });
    expect(Object.isFrozen(attempt)).toBe(true);
    expect(Object.isFrozen(attempt.items)).toBe(true);
    expect(Object.isFrozen(attempt.items[0]?.input)).toBe(true);
    expect(context).toMatchObject({
      contextKey: 'scope-a:1:1',
      authorizationGeneration: '1',
      signal: expect.any(AbortSignal),
    });
    expect(wrapper.emitted('imported')).toHaveLength(1);
    expect(wrapper.text()).not.toContain('导入成功');
    expect(wrapper.emitted('closeRequest')).toBeUndefined();
  });

  it('keeps selection after a known rejection and uses a fresh key for the next explicit submit', async () => {
    const submitAttempt = vi
      .fn()
      .mockResolvedValueOnce({
        kind: 'rejected',
        message: '每次请求不能超过 90 KiB',
      })
      .mockResolvedValueOnce({
        kind: 'created',
        result: importResult(),
      });
    const wrapper = mountPanel({
      parseFile: vi.fn().mockResolvedValue(validRows()),
      submitAttempt,
    });
    await chooseFile(wrapper, 'A.csv');
    await wrapper.get('[data-test="csv-row-2"] input').setValue(true);
    await wrapper.get('[data-test="csv-confirm-request"]').trigger('click');
    await flushPromises();

    expect(wrapper.get('[data-test="csv-submit-error"]').text()).toContain(
      '90 KiB',
    );
    expect(wrapper.get('[data-test="csv-row-2"] input').element).toHaveProperty(
      'checked',
      true,
    );
    await wrapper.get('[data-test="csv-confirm-request"]').trigger('click');
    await flushPromises();

    expect(submitAttempt).toHaveBeenCalledTimes(2);
    expect(submitAttempt.mock.calls[0]?.[0].idempotencyKey).not.toBe(
      submitAttempt.mock.calls[1]?.[0].idempotencyKey,
    );
    expect(wrapper.emitted('imported')).toHaveLength(1);
  });

  it('keeps an unknown attempt locked for explicit recovery', async () => {
    const submitAttempt = vi.fn().mockResolvedValue({
      kind: 'unknown',
      message: '请求结果待核对，请使用原请求恢复。',
    });
    const wrapper = mountPanel({
      parseFile: vi.fn().mockResolvedValue(validRows()),
      submitAttempt,
    });
    await chooseFile(wrapper, 'A.csv');
    await wrapper.get('[data-test="csv-row-2"] input').setValue(true);
    await wrapper.get('[data-test="csv-confirm-request"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="csv-confirm-request"]').trigger('click');

    expect(submitAttempt).toHaveBeenCalledOnce();
    expect(wrapper.get('[data-test="csv-unknown"]').text()).toContain(
      '原请求恢复',
    );
    expect(
      wrapper.get('[data-test="csv-file-input"]').attributes('disabled'),
    ).toBeDefined();
    expect(wrapper.emitted('imported')).toBeUndefined();
  });

  it('emits close intent and invalidates the active selection', async () => {
    const submitAttempt = vi.fn();
    const wrapper = mountPanel({
      parseFile: vi.fn().mockResolvedValue(validRows()),
      submitAttempt,
    });
    await chooseFile(wrapper, 'A.csv');
    await wrapper.get('[data-test="csv-cancel-request"]').trigger('click');

    expect(wrapper.emitted('closeRequest')).toHaveLength(1);
    expect(submitAttempt).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('预览已关闭。');
  });
});
