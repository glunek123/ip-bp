import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaseSummary } from '../../api/cases';
import { ApiError } from '../../api/http';
import CaseComplaintExportPanel from './CaseComplaintExportPanel.vue';
const api = vi.hoisted(() => ({
  previewComplaintExport: vi.fn(),
  downloadComplaintZip: vi.fn(),
}));
vi.mock('../../api/case-complaint-export', async (original) => ({
  ...(await original<typeof import('../../api/case-complaint-export')>()),
  ...api,
}));
const caseId = '11111111-1111-4111-8111-111111111111';
const materialId = '22222222-2222-4222-8222-222222222222';
const version1 = '33333333-3333-4333-8333-333333333333';
const version2 = '44444444-4444-4444-8444-444444444444';
const selectedCases = [{ id: caseId, businessNo: 'A-1' }] as CaseSummary[];
beforeEach(() => {
  vi.resetAllMocks();
  api.previewComplaintExport.mockResolvedValue({
    items: [
      {
        caseId,
        businessNo: 'A-1',
        status: 'READY',
        candidates: [
          {
            materialId,
            contentVersionId: version1,
            filename: '旧诉状.pdf',
            sizeBytes: 3,
            tags: ['UPLOADED'],
          },
          {
            materialId,
            contentVersionId: version2,
            filename: '确认诉状.pdf',
            sizeBytes: 3,
            tags: ['UPLOADED', 'SUBMITTED', 'CONFIRMED'],
          },
        ],
      },
    ],
    limits: { maxCases: 20, maxFiles: 100, maxBytes: 100 * 1024 * 1024 },
  });
  api.downloadComplaintZip.mockResolvedValue({
    blob: new Blob(['zip']),
    filename: 'complaints.zip',
    results: [{ caseId, successCount: 1, failCount: 0 }],
  });
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:zip'),
    revokeObjectURL: vi.fn(),
  });
});
describe('CaseComplaintExportPanel', () => {
  it('never guesses between versions and displays explicit download results', async () => {
    const wrapper = mount(CaseComplaintExportPanel, {
      props: { selectedCases, actorKey: 'u:INTERNAL:d:1' },
    });
    await wrapper
      .get('[data-test="complaint-export-preview"]')
      .trigger('click');
    await flushPromises();
    expect(
      wrapper.get('[data-test="complaint-export-ready"]').text(),
    ).toContain(version1);
    expect(
      wrapper.get('[data-test="complaint-export-ready"]').text(),
    ).toContain(version2);
    expect(
      wrapper.get('[data-test="complaint-export-unavailable"]').text(),
    ).toContain('无。');
    expect(
      (
        wrapper.get('[data-test="complaint-export-download"]')
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await wrapper.findAll('input[type="checkbox"]')[1]!.setValue(true);
    await wrapper
      .get('[data-test="complaint-export-download"]')
      .trigger('click');
    await flushPromises();
    expect(api.downloadComplaintZip).toHaveBeenCalledWith([
      { caseId, materialId, contentVersionId: version2 },
    ]);
    expect(
      wrapper.get('[data-test="complaint-export-results"]').text(),
    ).toContain('成功 1');
    wrapper.unmount();
  });
  it('sends two explicitly selected versions of one case', async () => {
    const wrapper = mount(CaseComplaintExportPanel, {
      props: { selectedCases, actorKey: 'u:INTERNAL:d:1' },
    });
    await wrapper
      .get('[data-test="complaint-export-preview"]')
      .trigger('click');
    await flushPromises();
    for (const checkbox of wrapper.findAll('input[type="checkbox"]'))
      await checkbox.setValue(true);
    await wrapper
      .get('[data-test="complaint-export-download"]')
      .trigger('click');
    await flushPromises();
    expect(api.downloadComplaintZip).toHaveBeenCalledWith([
      { caseId, materialId, contentVersionId: version1 },
      { caseId, materialId, contentVersionId: version2 },
    ]);
    wrapper.unmount();
  });
  it('clears old version choices when the actor changes', async () => {
    const wrapper = mount(CaseComplaintExportPanel, {
      props: { selectedCases, actorKey: 'u:INTERNAL:d:1' },
    });
    await wrapper
      .get('[data-test="complaint-export-preview"]')
      .trigger('click');
    await flushPromises();
    await wrapper.findAll('input[type="checkbox"]')[0]!.setValue(true);
    await wrapper.setProps({ actorKey: 'other:INTERNAL:d:1' });
    expect(
      wrapper.find('[data-test="complaint-export-candidates"]').exists(),
    ).toBe(false);
    wrapper.unmount();
  });
  it('puts missing and inaccessible cases in a separate section', async () => {
    const missingId = '55555555-5555-4555-8555-555555555555';
    const unavailableId = '66666666-6666-4666-8666-666666666666';
    api.previewComplaintExport.mockResolvedValueOnce({
      items: [
        { caseId, businessNo: 'A-1', status: 'READY', candidates: [] },
        {
          caseId: missingId,
          businessNo: 'A-2',
          status: 'MISSING',
          candidates: [],
        },
        { caseId: unavailableId, status: 'UNAVAILABLE', candidates: [] },
      ],
      limits: { maxCases: 20, maxFiles: 100, maxBytes: 100 * 1024 * 1024 },
    });
    const wrapper = mount(CaseComplaintExportPanel, {
      props: {
        selectedCases: [
          ...selectedCases,
          { id: missingId, businessNo: 'A-2' } as CaseSummary,
          { id: unavailableId, businessNo: 'A-3' } as CaseSummary,
        ],
        actorKey: 'u:INTERNAL:d:1',
      },
    });
    await wrapper
      .get('[data-test="complaint-export-preview"]')
      .trigger('click');
    await flushPromises();
    expect(
      wrapper.get('[data-test="complaint-export-ready"]').text(),
    ).toContain('A-1');
    expect(
      wrapper.get('[data-test="complaint-export-ready"]').text(),
    ).not.toContain('A-2');
    expect(
      wrapper.get('[data-test="complaint-export-unavailable"]').text(),
    ).toContain('A-2');
    expect(
      wrapper.get('[data-test="complaint-export-unavailable"]').text(),
    ).toContain('不可访问案件');
    wrapper.unmount();
  });
  it('shows exact per-file reasons when every selected version fails', async () => {
    const wrapper = mount(CaseComplaintExportPanel, {
      props: { selectedCases, actorKey: 'u:INTERNAL:d:1' },
    });
    await wrapper
      .get('[data-test="complaint-export-preview"]')
      .trigger('click');
    await flushPromises();
    await wrapper.findAll('input[type="checkbox"]')[0]!.setValue(true);
    await wrapper.findAll('input[type="checkbox"]')[1]!.setValue(true);
    api.downloadComplaintZip.mockRejectedValueOnce(
      new ApiError('failed', 409, 'CASE_EXPORT_EMPTY', 'request-1', {
        files: [version1, version2].map((contentVersionId) => ({
          caseId,
          materialId,
          contentVersionId,
          filename: '诉状.pdf',
          reason:
            contentVersionId === version1
              ? 'FILE_UNAVAILABLE'
              : 'VERSION_UNAVAILABLE',
        })),
      }),
    );
    await wrapper
      .get('[data-test="complaint-export-download"]')
      .trigger('click');
    await flushPromises();
    const failureText = wrapper
      .get('[data-test="complaint-export-failures"]')
      .text();
    expect(failureText).toContain(version1);
    expect(failureText).toContain(version2);
    expect(failureText).toContain('所选材料版本不可用');
    expect(failureText).toContain('文件读取失败');
    expect(
      wrapper.find('[data-test="complaint-export-results"]').exists(),
    ).toBe(false);
    wrapper.unmount();
  });
});
