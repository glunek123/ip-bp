import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/http';
import MaterialPreviewDialog from './MaterialPreviewDialog.vue';

const api = vi.hoisted(() => ({ getBlob: vi.fn() }));
vi.mock('../api/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/http')>()),
  getBlob: api.getBlob,
}));

const createUrl = vi.fn(() => 'blob:preview-one');
const revokeUrl = vi.fn();
vi.stubGlobal('URL', {
  ...URL,
  createObjectURL: createUrl,
  revokeObjectURL: revokeUrl,
});

function mountDialog(filename = '证件.pdf', attachTo?: HTMLElement) {
  return mount(MaterialPreviewDialog, {
    attachTo,
    props: {
      materialId: 'material-1',
      contentVersionId: 'version-1',
      filename,
      scopeKey: 'customer-1:user-1',
    },
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('MaterialPreviewDialog', () => {
  it('requests the authorized blob and revokes its PDF preview URL on close', async () => {
    api.getBlob.mockResolvedValue({
      blob: new Blob(['pdf'], { type: 'application/pdf' }),
      filename: '证件.pdf',
      mimeType: 'application/pdf',
    });
    const wrapper = mountDialog();
    await flushPromises();
    expect(api.getBlob).toHaveBeenCalledWith(
      '/materials/material-1/versions/version-1/content',
      { signal: expect.any(AbortSignal) },
    );
    expect(wrapper.get('iframe').attributes('src')).toBe('blob:preview-one');
    await wrapper.get('[data-test="material-preview-close"]').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
    expect(revokeUrl).toHaveBeenCalledWith('blob:preview-one');
    wrapper.unmount();
  });

  it('shows a download hint for unsafe formats without creating a URL', async () => {
    api.getBlob.mockResolvedValue({
      blob: new Blob(['html'], { type: 'text/html' }),
      filename: '未知.html',
      mimeType: 'text/html',
    });
    const wrapper = mountDialog();
    await flushPromises();
    expect(wrapper.text()).toContain('请关闭后使用下载入口查看');
    expect(createUrl).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('previews a WEBP screenshot as an image', async () => {
    api.getBlob.mockResolvedValue({
      blob: new Blob(['webp'], { type: 'image/webp' }),
      filename: '商品截图.webp',
      mimeType: 'image/webp',
    });
    const wrapper = mountDialog('商品截图.webp');
    await flushPromises();
    expect(wrapper.get('img').attributes('alt')).toBe('商品截图.webp');
    expect(wrapper.get('img').attributes('src')).toBe('blob:preview-one');
    wrapper.unmount();
  });

  it('aborts an in-flight request and clears a preview when scope changes', async () => {
    let firstSignal: AbortSignal | undefined;
    api.getBlob.mockImplementationOnce((_path, options) => {
      firstSignal = options.signal;
      return new Promise(() => undefined);
    });
    api.getBlob.mockResolvedValueOnce({
      blob: new Blob(['png'], { type: 'image/png' }),
      filename: '证件.png',
      mimeType: 'image/png',
    });
    const wrapper = mountDialog();
    await wrapper.setProps({ scopeKey: 'customer-2:user-1' });
    await flushPromises();
    expect(firstSignal?.aborted).toBe(true);
    expect(wrapper.get('img').attributes('src')).toBe('blob:preview-one');
    wrapper.unmount();
    expect(revokeUrl).toHaveBeenCalledWith('blob:preview-one');
  });

  it('reports forbidden content and closes without displaying private data', async () => {
    api.getBlob.mockRejectedValue(new ApiError('forbidden', 403, 'FORBIDDEN'));
    const wrapper = mountDialog();
    await flushPromises();
    expect(wrapper.emitted('unavailable')).toHaveLength(1);
    expect(wrapper.emitted('close')).toHaveLength(1);
    expect(wrapper.find('iframe').exists()).toBe(false);
    wrapper.unmount();
  });

  it('traps Tab, closes on Escape, and restores focus to the opener', async () => {
    api.getBlob.mockResolvedValue({
      blob: new Blob(['pdf'], { type: 'application/pdf' }),
      filename: '证件.pdf',
      mimeType: 'application/pdf',
    });
    const opener = document.createElement('button');
    opener.textContent = '打开预览';
    document.body.append(opener);
    opener.focus();

    const wrapper = mountDialog('证件.pdf', document.body);
    await flushPromises();
    expect(document.activeElement).toBe(
      wrapper.get('[data-test="material-preview-close"]').element,
    );

    await wrapper.get('[role="dialog"]').trigger('keydown', {
      key: 'Tab',
      shiftKey: true,
    });
    expect(document.activeElement).toBe(wrapper.get('iframe').element);
    await wrapper.get('[role="dialog"]').trigger('keydown', { key: 'Tab' });
    expect(document.activeElement).toBe(
      wrapper.get('[data-test="material-preview-close"]').element,
    );

    await wrapper.get('[role="dialog"]').trigger('keydown', { key: 'Escape' });
    expect(wrapper.emitted('close')).toHaveLength(1);
    expect(document.activeElement).toBe(opener);
    wrapper.unmount();
    opener.remove();
  });
});
