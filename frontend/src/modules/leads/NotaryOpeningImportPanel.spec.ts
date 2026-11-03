import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import NotaryOpeningImportPanel from './NotaryOpeningImportPanel.vue';

const item = {
  id: 'item-1',
  folderName: '店铺订单 001',
  revision: 1,
  status: 'READY' as const,
  trackingCandidate: 'SF123',
  trackingNo: null,
  recognitionStatus: 'SUCCEEDED' as const,
  senderCandidate: { name: '候选寄件人', phone: null, address: null },
  matchStatus: 'SUGGESTED' as const,
  suggestedMatterId: 'matter-1',
  selectedMatterId: null,
  photos: [
    {
      id: 'photo-1',
      filename: '面单.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
    },
  ],
};

describe('NotaryOpeningImportPanel', () => {
  it('labels mock recognition and never selects its suggested matter automatically', () => {
    const wrapper = mount(NotaryOpeningImportPanel, {
      props: {
        batch: {
          id: 'batch-1',
          status: 'READY',
          expiresAt: '2026-11-04T00:00:00.000Z',
          recognitionMode: 'MOCK',
          items: [item],
        },
        uploadState: 'IDLE',
        eligibleMatterPages: {
          'item-1': {
            items: [
              {
                id: 'matter-1',
                businessNo: 'NT-001',
                version: 2,
                trackingNo: null,
              },
            ],
            total: 1,
            page: 1,
            pageSize: 20,
          },
        },
      },
    });

    expect(
      wrapper.get('[data-test="opening-import-mock-warning"]').text(),
    ).toContain('模拟识别');
    expect(wrapper.html()).not.toContain(
      'data-test="opening-import-manual-only"',
    );
    expect(
      (
        wrapper.get('[data-test="opening-import-select-matter-matter-1"]')
          .element as HTMLInputElement
      ).checked,
    ).toBe(false);
    expect(
      (
        wrapper.get('[data-test="opening-import-confirm-item"]')
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(wrapper.text()).toContain('系统建议候选：NT-001');
    expect(wrapper.text()).not.toContain('matter-1');
    expect(wrapper.text()).toContain('该建议尚未选择或绑定');
  });

  it('does not expose an internal suggestion ID when the candidate is outside the current result page', () => {
    const wrapper = mount(NotaryOpeningImportPanel, {
      props: {
        batch: {
          id: 'batch-1',
          status: 'READY',
          expiresAt: '2026-11-04T00:00:00.000Z',
          recognitionMode: 'MOCK',
          items: [item],
        },
        uploadState: 'IDLE',
        eligibleMatterPages: {
          'item-1': {
            items: [
              {
                id: 'another-matter',
                businessNo: 'NT-002',
                version: 2,
                trackingNo: null,
              },
            ],
            total: 1,
            page: 1,
            pageSize: 20,
          },
        },
      },
    });

    expect(wrapper.text()).toContain('系统有建议，请按当前单号检索核对');
    expect(wrapper.text()).not.toContain('matter-1');
  });

  it('keeps manual work available when recognition is disabled', () => {
    const wrapper = mount(NotaryOpeningImportPanel, {
      props: {
        batch: {
          id: 'batch-2',
          status: 'READY',
          expiresAt: '2026-11-04T00:00:00.000Z',
          recognitionMode: 'DISABLED',
          items: [
            { ...item, recognitionStatus: 'DISABLED', senderCandidate: null },
          ],
        },
        uploadState: 'IDLE',
      },
    });

    expect(
      wrapper.get('[data-test="opening-import-manual-only"]').text(),
    ).toContain('仍可手工填写');
    expect(
      (
        wrapper.get('[data-test="opening-import-tracking-item-1"]')
          .element as HTMLInputElement
      ).disabled,
    ).toBe(false);
    expect(
      (
        wrapper.get('[data-test="opening-import-search-item-1"]')
          .element as HTMLInputElement
      ).disabled,
    ).toBe(false);
  });

  it('blocks a new upload while the original upload result is unknown', async () => {
    const wrapper = mount(NotaryOpeningImportPanel, {
      props: { batch: null, uploadState: 'UNKNOWN' },
    });

    expect(wrapper.html()).toContain(
      'data-test="opening-import-upload-unknown"',
    );
    expect(wrapper.html()).toContain(
      'data-test="opening-import-recover-upload"',
    );
    expect(wrapper.html()).not.toContain('data-test="opening-import-start"');
    expect(
      (wrapper.vm as unknown as { canLeave: () => boolean }).canLeave(),
    ).toBe(true);
  });

  it('does not allow abandoning an unknown confirmation request', () => {
    const wrapper = mount(NotaryOpeningImportPanel, {
      props: {
        batch: {
          id: 'batch-3',
          status: 'READY',
          expiresAt: '2026-11-04T00:00:00.000Z',
          recognitionMode: 'DISABLED',
          items: [item],
        },
        uploadState: 'IDLE',
        unknownConfirmItemIds: ['item-1'],
      },
    });

    expect(
      (
        wrapper.get('[data-test="opening-import-close"]')
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (wrapper.vm as unknown as { canLeave: () => boolean }).canLeave(),
    ).toBe(false);
  });
});
