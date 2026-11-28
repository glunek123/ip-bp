import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LegacyAttachmentsSection from './LegacyAttachmentsSection.vue';

const api = vi.hoisted(() => ({
  listLegacyAttachments: vi.fn(),
  deleteLegacyAttachment: vi.fn(),
  legacyAttachmentContentUrl: (id: string, download = false) =>
    `/api/v1/legacy-attachments/${encodeURIComponent(id)}/content${download ? '?download=1' : ''}`,
}));

vi.mock('../api/legacy-attachments', () => api);

beforeEach(() => {
  vi.resetAllMocks();
  api.listLegacyAttachments.mockResolvedValue({
    items: [
      {
        id: 'att-1',
        legacyAttachmentId: '1001',
        ownerType: 'CASE',
        ownerId: 'case-1',
        categoryCode: 'CASE_JUDGEMENT_FILE',
        categoryLabel: '判决书',
        title: '民事判决书.pdf',
        filename: 'judgment.pdf',
        extname: '.pdf',
        sizeBytes: 2048,
        mimeType: 'application/pdf',
        ossUrl: 'https://bstfw-ip.oss-cn-hangzhou.aliyuncs.com/ipjiaofu/pro/judgment.pdf',
        createdAt: '2026-11-27T10:00:00Z',
      },
      {
        id: 'att-2',
        legacyAttachmentId: '1002',
        ownerType: 'CASE',
        ownerId: 'case-1',
        categoryCode: 'CASE_UNPACK_PHOTO',
        categoryLabel: '开箱照片',
        title: 'photo.jpg',
        filename: 'photo.jpg',
        extname: '.jpg',
        sizeBytes: 5120,
        mimeType: 'image/jpeg',
        ossUrl: 'https://bstfw-ip.oss-cn-hangzhou.aliyuncs.com/ipjiaofu/pro/photo.jpg',
        createdAt: '2026-11-27T10:00:00Z',
      },
    ],
  });
  api.deleteLegacyAttachment.mockResolvedValue({ id: 'att-1' });
});

describe('LegacyAttachmentsSection', () => {
  it('groups and renders legacy attachments with direct OSS links', async () => {
    const wrapper = mount(LegacyAttachmentsSection, {
      props: { ownerType: 'CASE', ownerId: 'case-1', canDelete: true },
    });
    await flushPromises();
    expect(api.listLegacyAttachments).toHaveBeenCalledWith(
      'CASE',
      'case-1',
      expect.any(Object),
    );
    expect(wrapper.text()).toContain('判决书（1）');
    expect(wrapper.text()).toContain('开箱照片（1）');
    expect(wrapper.text()).toContain('民事判决书.pdf');
    expect(
      wrapper.get('[data-test="legacy-attachment-open-att-1"]').attributes('href'),
    ).toBe('/api/v1/legacy-attachments/att-1/content?download=1');
    expect(wrapper.get('.legacy-attachment-thumb').attributes('src')).toBe(
      '/api/v1/legacy-attachments/att-2/content',
    );
  });

  it('requires reason before deleting a legacy attachment and reloads after delete', async () => {
    const wrapper = mount(LegacyAttachmentsSection, {
      props: { ownerType: 'CASE', ownerId: 'case-1', canDelete: true },
      global: { stubs: { teleport: true } },
    });
    await flushPromises();
    await wrapper.get('[data-test="legacy-attachment-delete-att-1"]').trigger('click');
    await wrapper.get('[data-test="legacy-attachment-delete-confirm"]').trigger('click');
    expect(wrapper.text()).toContain('请填写删除原因');
    expect(api.deleteLegacyAttachment).not.toHaveBeenCalled();

    const textarea = wrapper.get('[data-test="legacy-attachment-delete-reason"]');
    await textarea.setValue('重复上传旧附件');
    await wrapper.get('[data-test="legacy-attachment-delete-confirm"]').trigger('click');
    await flushPromises();
    expect(api.deleteLegacyAttachment).toHaveBeenCalledWith('att-1', '重复上传旧附件');
    expect(api.listLegacyAttachments).toHaveBeenCalledTimes(2);
  });
});
