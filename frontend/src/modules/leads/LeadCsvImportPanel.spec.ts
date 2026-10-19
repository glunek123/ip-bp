import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { isVNode, type VNode } from 'vue';
import type { CreateLeadInput } from '../../api/leads';
import type { LeadCsvParsedRow } from './lead-csv-preview';
import LeadCsvImportPanel from './LeadCsvImportPanel.vue';
import LeadCsvPreviewPanel from './LeadCsvPreviewPanel.vue';

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

function validRows(): readonly LeadCsvParsedRow[] {
  return [
    {
      rowNumber: 2,
      status: 'valid',
      input: leadInput(),
      suspectedDuplicates: [],
    },
  ];
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
  const file = new globalThis.File(['row'], name, { type: 'text/csv' });
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
    const wrapper = mount(LeadCsvImportPanel, {
      props: { open: true, contextKey: 'scope-a', parseFile },
    });

    await chooseFile(wrapper, 'A.csv');

    expect(parseFile).toHaveBeenCalledOnce();
    expect(parseFile.mock.calls[0]?.[0].name).toBe('A.csv');
    expect(parseFile.mock.calls[0]?.[1].aborted).toBe(false);
    expect(wrapper.find('[data-test="csv-row-2"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="csv-intent-sent"]').exists()).toBe(false);
  });

  it('clears the input value so the same file can be selected again', async () => {
    const parseFile = vi.fn().mockResolvedValue(validRows());
    const wrapper = mount(LeadCsvImportPanel, {
      props: { open: true, contextKey: 'scope-a', parseFile },
    });

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
    const wrapper = mount(LeadCsvImportPanel, {
      props: { open: true, contextKey: 'scope-a', parseFile },
    });

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
    const wrapper = mount(LeadCsvImportPanel, {
      props: { open: true, contextKey: 'scope-a', parseFile },
    });
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
    const wrapper = mount(LeadCsvImportPanel, {
      props: { open: true, contextKey: 'scope-a', parseFile },
    });
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
    oldConfirmHandler({ generation: oldGeneration });
    expect(wrapper.emitted('confirmRequest')).toHaveLength(1);

    const confirmEvents = wrapper.emitted('confirmRequest');
    if (!confirmEvents)
      throw new Error('Expected the confirmed selection event');
    const staleConfirmCount = confirmEvents.length;
    const update = wrapper.setProps({ contextKey: 'scope-b' });
    await invokeFileHandler(oldFileInput, 'stale-context.csv');
    oldConfirmHandler({
      generation: oldGeneration,
    });
    expect(parseFile).toHaveBeenCalledTimes(2);
    expect(wrapper.emitted('confirmRequest')).toHaveLength(staleConfirmCount);
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
    const wrapper = mount(LeadCsvImportPanel, {
      props: { open: true, contextKey: 'scope-a', parseFile },
    });
    await chooseFile(wrapper, 'A.csv');
    await chooseFile(wrapper, 'B.csv');

    expect(wrapper.find('[data-test="csv-error"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="csv-row-2"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="csv-intent-sent"]').exists()).toBe(false);
  });

  it('emits one current immutable selection intent without claiming success', async () => {
    const wrapper = mount(LeadCsvImportPanel, {
      props: {
        open: true,
        contextKey: 'scope-a',
        parseFile: vi.fn().mockResolvedValue(validRows()),
      },
    });
    await chooseFile(wrapper, 'A.csv');
    await wrapper.get('[data-test="csv-row-2"] input').setValue(true);
    const confirm = wrapper.get('[data-test="csv-confirm-request"]');
    await confirm.trigger('click');
    await confirm.trigger('click');

    const [selection] = wrapper.emitted('confirmRequest')?.[0] ?? [];
    expect(wrapper.emitted('confirmRequest')).toHaveLength(1);
    expect(selection).toMatchObject({
      generation: expect.any(Number),
      selectionRevision: expect.any(Number),
      rows: [{ rowNumber: 2, input: leadInput() }],
    });
    expect(Object.isFrozen(selection)).toBe(true);
    expect(wrapper.get('[data-test="csv-intent-sent"]').text()).toContain(
      '当前选择已确认',
    );
    expect(wrapper.text()).not.toContain('导入成功');
    expect(wrapper.emitted('closeRequest')).toBeUndefined();
  });

  it('emits close intent and invalidates the active selection', async () => {
    const wrapper = mount(LeadCsvImportPanel, {
      props: {
        open: true,
        contextKey: 'scope-a',
        parseFile: vi.fn().mockResolvedValue(validRows()),
      },
    });
    await chooseFile(wrapper, 'A.csv');
    await wrapper.get('[data-test="csv-cancel-request"]').trigger('click');

    expect(wrapper.emitted('closeRequest')).toHaveLength(1);
    expect(wrapper.emitted('confirmRequest')).toBeUndefined();
    expect(wrapper.text()).toContain('预览已关闭。');
  });
});
