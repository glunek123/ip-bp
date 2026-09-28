import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NotaryPortalListPage from './NotaryPortalListPage.vue';
import NotaryPortalDetailPage from './NotaryPortalDetailPage.vue';

const api = vi.hoisted(() => ({
  listNotaryPortalMatters: vi.fn(),
  getNotaryPortalMatter: vi.fn(),
  recordNotaryPortalOpening: vi.fn(),
  recordNotaryPortalCertificate: vi.fn(),
  listOwnerMaterials: vi.fn(),
  uploadMaterialFile: vi.fn(),
  downloadMaterialVersion: vi.fn(),
}));
vi.mock('../../api/notary-portal', () => ({
  listNotaryPortalMatters: api.listNotaryPortalMatters,
  getNotaryPortalMatter: api.getNotaryPortalMatter,
  recordNotaryPortalOpening: api.recordNotaryPortalOpening,
  recordNotaryPortalCertificate: api.recordNotaryPortalCertificate,
}));
vi.mock('../../api/materials', () => ({
  listOwnerMaterials: api.listOwnerMaterials,
  uploadMaterialFile: api.uploadMaterialFile,
  downloadMaterialVersion: api.downloadMaterialVersion,
}));

beforeEach(() => {
  vi.resetAllMocks();
  api.listNotaryPortalMatters.mockResolvedValue({
    items: [
      {
        id: 'matter-1',
        businessNo: 'NZ-001',
        stage: 'WAITING_UNBOX',
        version: 2,
        createdAt: '2026-09-28T00:00:00Z',
      },
    ],
    total: 1,
    page: 1,
    pageSize: 100,
  });
  api.getNotaryPortalMatter.mockResolvedValue({
    id: 'matter-1',
    businessNo: 'NZ-001',
    stage: 'UNBOX_REVIEW',
    version: 3,
    createdAt: '2026-09-28T00:00:00Z',
    evidence: { evidenceAt: '2026-09-27', logistics: [] },
    opening: {
      senderName: null,
      senderPhone: null,
      senderAddress: null,
      recordedAt: '2026-09-28T00:00:00Z',
      photos: [
        {
          materialId: 'material-1',
          contentVersionId: 'version-1',
          originalFilename: 'box.jpg',
          mimeType: 'image/jpeg',
        },
      ],
    },
    capabilities: { recordOpening: false },
  });
  api.listOwnerMaterials.mockResolvedValue({ items: [], total: 0 });
});
afterEach(() => vi.unstubAllGlobals());

async function mountRoute(
  path: string,
  component: typeof NotaryPortalListPage | typeof NotaryPortalDetailPage,
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/notary-portal/matters', component: NotaryPortalListPage },
      { path: '/notary-portal/matters/:id', component: NotaryPortalDetailPage },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(component, { global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

describe('notary portal pages', () => {
  it('lists only the current portal queue with a direct detail link', async () => {
    const wrapper = await mountRoute(
      '/notary-portal/matters',
      NotaryPortalListPage,
    );
    expect(wrapper.get('[data-test="notary-portal-row"]').text()).toBe(
      'NZ-001',
    );
    expect(wrapper.text()).not.toContain('客户');
    expect(
      wrapper.get('[data-test="notary-portal-row"]').attributes('href'),
    ).toBe('/notary-portal/matters/matter-1');
  });

  it('switches the portal queue to waiting certificate without exposing cases', async () => {
    const wrapper = await mountRoute(
      '/notary-portal/matters',
      NotaryPortalListPage,
    );
    await wrapper
      .get('[data-test="notary-segment-waiting_certificate"]')
      .trigger('click');
    await flushPromises();
    expect(api.listNotaryPortalMatters).toHaveBeenLastCalledWith(
      1,
      20,
      expect.objectContaining({ stage: 'WAITING_CERTIFICATE' }),
    );
    expect(wrapper.text()).not.toContain('案件管理');
  });

  it('shows the saved opening after reload without internal or future actions', async () => {
    const wrapper = await mountRoute(
      '/notary-portal/matters/matter-1',
      NotaryPortalDetailPage,
    );
    expect(wrapper.get('[data-test="notary-saved-opening"]').text()).toContain(
      'box.jpg',
    );
    expect(wrapper.text()).toContain('2026-09-27');
    expect(wrapper.text()).not.toContain('客户');
    expect(wrapper.text()).not.toContain('费用');
    expect(wrapper.find('[data-test="notary-opening-submit"]').exists()).toBe(
      false,
    );
    expect(wrapper.text()).not.toContain('出证');
    expect(api.getNotaryPortalMatter).toHaveBeenCalledWith(
      'matter-1',
      expect.any(Object),
    );
  });

  it('submits one selected certificate, keeps sample fee out of the command, and shows the archived result', async () => {
    const waitingCertificate = {
      id: 'matter-1',
      businessNo: 'NZ-001',
      stage: 'WAITING_CERTIFICATE',
      version: 5,
      createdAt: '2026-09-28T00:00:00Z',
      evidence: {
        evidenceAt: '2026-09-27',
        sampleFeeState: 'KNOWN',
        sampleFeeAmount: '12.00',
        logistics: [],
      },
      opening: null,
      issuanceDecision: {
        decision: 'ISSUE',
        actorDisplayName: '审核员',
        decidedAt: '2026-09-28T00:00:00Z',
      },
      certificate: null,
      capabilities: { recordOpening: false, issueCertificate: true },
    };
    const archived = {
      ...waitingCertificate,
      stage: 'ARCHIVED',
      version: 6,
      certificate: {
        certificateNo: 'Z-100',
        certificateDate: '2026-09-28',
        issuedAt: '2026-09-28T00:00:00Z',
        needDisclose: false,
        files: [
          {
            materialId: 'certificate-material',
            contentVersionId: 'certificate-version',
            originalFilename: 'certificate.pdf',
            mimeType: 'application/pdf',
          },
        ],
        disclosureFiles: [],
        caseId: 'case-1',
        caseBusinessNo: 'CA-1',
      },
      capabilities: { recordOpening: false, issueCertificate: false },
    };
    api.getNotaryPortalMatter
      .mockResolvedValueOnce(waitingCertificate)
      .mockResolvedValueOnce(archived);
    api.listOwnerMaterials.mockResolvedValue({
      items: [
        {
          id: 'certificate-material',
          ownerType: 'NOTARY_MATTER',
          ownerId: 'matter-1',
          category: 'NOTARY_CERTIFICATE',
          purpose: 'NOTARY_CERTIFICATE',
          currentVersionId: 'certificate-version',
          status: 'ACTIVE',
          contentVersions: [
            {
              id: 'certificate-version',
              materialId: 'certificate-material',
              originalFilename: 'certificate.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 8,
              sha256: 'a'.repeat(64),
              status: 'AVAILABLE',
              createdAt: '2026-09-28T00:00:00Z',
            },
          ],
        },
      ],
      total: 1,
    });
    api.recordNotaryPortalCertificate.mockResolvedValue({
      case: { businessNo: 'CA-1' },
    });
    vi.stubGlobal('crypto', {
      randomUUID: () => 'certificate-idempotency-key',
    });

    const wrapper = await mountRoute(
      '/notary-portal/matters/matter-1',
      NotaryPortalDetailPage,
    );
    expect(wrapper.get('[data-test="certificate-form"]').text()).toContain(
      '样品费',
    );
    expect(wrapper.get('[data-test="certificate-form"]').text()).toContain(
      '¥ 12.00',
    );
    await wrapper.get('[data-test="certificate-number"]').setValue('Z-100');
    await wrapper.get('[data-test="certificate-date"]').setValue('2026-09-28');
    await wrapper.get('[data-test="certificate-submit"]').trigger('click');
    await flushPromises();

    expect(api.recordNotaryPortalCertificate).toHaveBeenCalledWith(
      'matter-1',
      expect.objectContaining({
        contentVersionIds: ['certificate-version'],
        fees: expect.not.objectContaining({ sample: expect.anything() }),
      }),
      'certificate-idempotency-key',
    );
    expect(wrapper.get('[data-test="certificate-record"]').text()).toContain(
      'CA-1',
    );
    expect(wrapper.find('[data-test="certificate-form"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('/cases/case-1');
  });

  it('submits only selected pending photos and prevents an empty selection', async () => {
    const pendingMatter = {
      id: 'matter-1',
      businessNo: 'NZ-001',
      stage: 'WAITING_UNBOX',
      version: 2,
      createdAt: '2026-09-28T00:00:00Z',
      evidence: { evidenceAt: '2026-09-27', logistics: [] },
      opening: null,
      capabilities: { recordOpening: true },
    };
    api.getNotaryPortalMatter.mockResolvedValueOnce(pendingMatter);
    api.listOwnerMaterials.mockResolvedValue({
      items: ['version-1', 'version-2'].map((versionId, index) => ({
        id: `material-${index + 1}`,
        ownerType: 'NOTARY_MATTER',
        ownerId: 'matter-1',
        category: 'NOTARY_OPENING_PHOTO',
        purpose: 'NOTARY_OPENING_PHOTO',
        currentVersionId: versionId,
        status: 'ACTIVE',
        contentVersions: [
          {
            id: versionId,
            originalFilename: `photo-${index + 1}.jpg`,
            mimeType: 'image/jpeg',
          },
        ],
      })),
      total: 2,
    });
    api.recordNotaryPortalOpening.mockResolvedValue({});
    vi.stubGlobal('crypto', { randomUUID: () => 'idempotency-key' });

    const wrapper = await mountRoute(
      '/notary-portal/matters/matter-1',
      NotaryPortalDetailPage,
    );
    const firstPhoto = wrapper.get(
      '[data-test="notary-opening-photo-select-version-1"]',
    );
    const secondPhoto = wrapper.get(
      '[data-test="notary-opening-photo-select-version-2"]',
    );
    expect((firstPhoto.element as HTMLInputElement).checked).toBe(true);
    expect((secondPhoto.element as HTMLInputElement).checked).toBe(true);
    expect(wrapper.text()).toContain('未勾选照片不属于该记录');

    await firstPhoto.setValue(false);
    expect(
      wrapper.get('[data-test="notary-opening-submit"]').attributes('disabled'),
    ).toBeUndefined();
    await wrapper.get('[data-test="notary-opening-submit"]').trigger('click');
    await flushPromises();
    expect(api.recordNotaryPortalOpening).toHaveBeenCalledWith(
      'matter-1',
      expect.objectContaining({ contentVersionIds: ['version-2'] }),
      'idempotency-key',
    );

    api.getNotaryPortalMatter.mockResolvedValueOnce(pendingMatter);
    const emptySelection = await mountRoute(
      '/notary-portal/matters/matter-1',
      NotaryPortalDetailPage,
    );
    await emptySelection
      .get('[data-test="notary-opening-photo-select-version-1"]')
      .setValue(false);
    await emptySelection
      .get('[data-test="notary-opening-photo-select-version-2"]')
      .setValue(false);
    expect(
      emptySelection
        .get('[data-test="notary-opening-submit"]')
        .attributes('disabled'),
    ).toBeDefined();
  });
});
