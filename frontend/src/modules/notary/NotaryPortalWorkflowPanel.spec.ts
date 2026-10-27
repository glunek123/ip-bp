import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { createListWorkflowContext } from '../../app/list-workflow-context';
import { ApiError } from '../../api/http';
import type { NotaryPortalMatter } from '../../api/notary-portal';
import NotaryPortalWorkflowPanel from './NotaryPortalWorkflowPanel.vue';
import NotaryPortalListPage from './NotaryPortalListPage.vue';
const api = vi.hoisted(() => ({
  getNotaryPortalMatter: vi.fn(),
  listNotaryPortalMatters: vi.fn(),
  recordNotaryPortalCertificate: vi.fn(),
  recordProxyNotaryCertificate: vi.fn(),
  recordNotaryPortalOpening: vi.fn(),
}));
const materials = vi.hoisted(() => ({
  downloadMaterialVersion: vi.fn(),
  listOwnerMaterials: vi.fn(),
  uploadMaterialFile: vi.fn(),
}));
vi.mock('../../api/notary-portal', () => api);
vi.mock('../../api/materials', () => materials);
const current: NotaryPortalMatter = {
  id: 'matter-1',
  businessNo: 'NT-1',
  stage: 'WAITING_UNBOX',
  version: 2,
  createdAt: '2026-10-15T00:00:00Z',
  evidence: null,
  opening: null,
  issuanceDecision: null,
  certificate: null,
  disclosureRequired: false,
  capabilities: { recordOpening: true, issueCertificate: false },
};
const photo = {
  id: 'material-1',
  ownerType: 'NOTARY_MATTER',
  ownerId: 'matter-1',
  category: 'NOTARY_OPENING_PHOTO',
  purpose: 'NOTARY_OPENING_PHOTO',
  status: 'ACTIVE',
  currentVersionId: 'photo-v1',
  contentVersions: [
    { id: 'photo-v1', originalFilename: 'box.jpg', mimeType: 'image/jpeg' },
  ],
};
beforeEach(() => {
  vi.resetAllMocks();
  globalThis.sessionStorage.clear();
  setActivePinia(createPinia());
  materials.listOwnerMaterials.mockResolvedValue({ items: [photo] });
  api.getNotaryPortalMatter.mockResolvedValue(current);
});
async function open() {
  const success = vi.fn();
  const workflow = createListWorkflowContext(async () => current, { success });
  await workflow.sync({
    recordId: current.id,
    actorKey: 'user-1:NOTARY::2',
    actionKey: 'opening',
    title: '登记开箱',
  });
  const session = workflow.state.value.session;
  if (!session) throw new Error('Missing session');
  const wrapper = mount(NotaryPortalWorkflowPanel, {
    props: { detail: current, session },
  });
  await flushPromises();
  return { wrapper, workflow, success };
}
describe('NotaryPortalWorkflowPanel', () => {
  it('submits a scoped internal proxy certificate with its own frozen request key', async () => {
    const detail = {
      ...current,
      stage: 'WAITING_CERTIFICATE',
      version: 5,
      capabilities: { recordOpening: false, proxyIssueCertificate: true },
      disclosureRequired: false,
    };
    materials.listOwnerMaterials.mockResolvedValue({
      items: [
        {
          ...photo,
          id: 'certificate-material',
          category: 'NOTARY_CERTIFICATE',
          purpose: 'NOTARY_CERTIFICATE',
          currentVersionId: 'certificate-v1',
          contentVersions: [
            {
              id: 'certificate-v1',
              originalFilename: 'certificate.pdf',
              mimeType: 'application/pdf',
            },
          ],
        },
      ],
    });
    api.recordProxyNotaryCertificate.mockResolvedValue({});
    const workflow = createListWorkflowContext(async () => detail, {
      success: vi.fn(),
    });
    await workflow.sync({
      recordId: detail.id,
      actorKey: 'user-1:INTERNAL:department-1:2',
      actionKey: 'certificate',
      title: '代办公证处出证',
    });
    const session = workflow.state.value.session;
    if (!session) throw new Error('Missing session');
    const wrapper = mount(NotaryPortalWorkflowPanel, {
      props: { detail: detail as never, session, proxy: true },
    });
    await flushPromises();
    await wrapper.get('[data-test="certificate-number"]').setValue('证书-001');
    await wrapper.get('[data-test="certificate-date"]').setValue('2026-10-27');
    await wrapper.get('[data-test="certificate-submit"]').trigger('click');
    await flushPromises();
    expect(api.recordProxyNotaryCertificate).toHaveBeenCalledWith(
      detail.id,
      expect.objectContaining({
        expectedVersion: 5,
        certificateNo: '证书-001',
        contentVersionIds: ['certificate-v1'],
      }),
      expect.any(String),
    );
    expect(api.recordNotaryPortalCertificate).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
    workflow.dispose();
    wrapper.unmount();
  });
  it('keeps Back/Forward safe for an idle draft and blocks leaving during an unresolved POST', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/other', component: { template: '<p>其他页面</p>' } },
        { path: '/notary-portal/matters', component: NotaryPortalListPage },
      ],
    });
    await router.push('/other');
    await router.push('/notary-portal/matters?page=2&stage=WAITING_UNBOX');
    await router.isReady();
    api.listNotaryPortalMatters.mockResolvedValue({
      items: [current],
      total: 23,
      page: 2,
      pageSize: 20,
    });
    const wrapper = mount(RouterView, {
      global: {
        plugins: [router, createPinia()],
        stubs: {
          ElDrawer: {
            props: ['modelValue'],
            template:
              '<section v-if="modelValue"><slot/><slot name="footer"/></section>',
          },
        },
      },
    });
    await flushPromises();
    await wrapper.get('[data-test="notary-portal-action"]').trigger('click');
    await flushPromises();
    await wrapper.get('#sender-name').setValue('未提交资料');
    router.back();
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/other');
    expect(api.recordNotaryPortalOpening).not.toHaveBeenCalled();
    router.forward();
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({
      page: '2',
      stage: 'WAITING_UNBOX',
    });
    await wrapper.get('[data-test="notary-portal-action"]').trigger('click');
    await flushPromises();
    let complete: () => void = () => {};
    api.recordNotaryPortalOpening.mockReturnValue(
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
    );
    await wrapper.get('[data-test="notary-opening-submit"]').trigger('click');
    router.back();
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/notary-portal/matters');
    complete();
    await flushPromises();
    expect(api.recordNotaryPortalOpening).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
  it('recovers the original opening body/key and selected version across a reload', async () => {
    api.recordNotaryPortalOpening
      .mockRejectedValueOnce(new ApiError('lost', 0, 'NETWORK_ERROR'))
      .mockResolvedValueOnce({});
    const first = await open();
    await first.wrapper.get('#sender-name').setValue('测试寄件人');
    await first.wrapper
      .get('[data-test="notary-opening-submit"]')
      .trigger('click');
    await flushPromises();
    const original = api.recordNotaryPortalOpening.mock.calls[0];
    expect(original?.[1]).toEqual({
      expectedVersion: 2,
      contentVersionIds: ['photo-v1'],
      senderName: '测试寄件人',
    });
    first.workflow.dispose();
    first.wrapper.unmount();
    const next = await open();
    expect(next.workflow.state.value.requestState).toBe('unknown');
    await next.wrapper
      .get('[data-test="notary-workflow-retry"]')
      .trigger('click');
    await flushPromises();
    expect(api.recordNotaryPortalOpening.mock.calls[1]).toEqual(original);
    expect(next.success).toHaveBeenCalledTimes(1);
    next.wrapper.unmount();
  });
  it('stops a double click and ignores a completed POST after identity invalidation', async () => {
    let finish: () => void = () => {};
    api.recordNotaryPortalOpening.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const { wrapper, workflow, success } = await open();
    await wrapper.get('[data-test="notary-opening-submit"]').trigger('click');
    await wrapper.get('[data-test="notary-opening-submit"]').trigger('click');
    expect(api.recordNotaryPortalOpening).toHaveBeenCalledTimes(1);
    expect(workflow.requestClose()).toBe(false);
    workflow.dispose();
    finish();
    await flushPromises();
    expect(success).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it('rejects permission failure without reporting success or a new retry', async () => {
    api.recordNotaryPortalOpening.mockRejectedValue(
      new ApiError('denied', 403, 'FORBIDDEN'),
    );
    const { wrapper, workflow, success } = await open();
    await wrapper.get('[data-test="notary-opening-submit"]').trigger('click');
    await flushPromises();
    expect(workflow.state.value.status).toBe('denied');
    expect(success).not.toHaveBeenCalled();
    expect(globalThis.sessionStorage.length).toBe(0);
    wrapper.unmount();
  });
  it('opens from a real list row and reloads the same query after the command', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/notary-portal/matters', component: NotaryPortalListPage },
      ],
    });
    await router.push('/notary-portal/matters?page=2&stage=WAITING_UNBOX');
    await router.isReady();
    api.listNotaryPortalMatters.mockResolvedValue({
      items: [current],
      total: 21,
      page: 2,
      pageSize: 20,
    });
    api.recordNotaryPortalOpening.mockResolvedValue({});
    const wrapper = mount(NotaryPortalListPage, {
      global: {
        plugins: [router, createPinia()],
        stubs: {
          ElDrawer: {
            props: ['modelValue'],
            template:
              '<section v-if="modelValue"><slot/><slot name="footer"/></section>',
          },
        },
      },
    });
    await flushPromises();
    await wrapper.get('[data-test="notary-portal-action"]').trigger('click');
    await flushPromises();
    expect(api.getNotaryPortalMatter).toHaveBeenCalledWith(
      'matter-1',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(router.currentRoute.value.path).toBe('/notary-portal/matters');
    await wrapper.get('[data-test="notary-opening-submit"]').trigger('click');
    await flushPromises();
    expect(api.listNotaryPortalMatters).toHaveBeenCalledTimes(2);
    expect(api.listNotaryPortalMatters.mock.calls[1]?.[0]).toBe(2);
    expect(router.currentRoute.value.query).toEqual({
      page: '2',
      stage: 'WAITING_UNBOX',
    });
    wrapper.unmount();
  });
  it('keeps a global recovery entry when the record has left its old filter', async () => {
    globalThis.sessionStorage.setItem(
      'notary-portal-list-request:' +
        JSON.stringify([':::', 'matter-1', 'opening']),
      JSON.stringify({
        key: 'original',
        command: {
          kind: 'opening',
          input: { expectedVersion: 2, contentVersionIds: ['photo-v1'] },
        },
      }),
    );
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/notary-portal/matters', component: NotaryPortalListPage },
      ],
    });
    await router.push('/notary-portal/matters?stage=WAITING_UNBOX');
    await router.isReady();
    api.listNotaryPortalMatters.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
    api.getNotaryPortalMatter.mockResolvedValue({
      ...current,
      stage: 'UNBOX_REVIEW',
      capabilities: { recordOpening: false, issueCertificate: false },
    });
    api.recordNotaryPortalOpening.mockResolvedValue({});
    const wrapper = mount(NotaryPortalListPage, {
      global: {
        plugins: [router, createPinia()],
        stubs: {
          ElDrawer: {
            props: ['modelValue'],
            template: '<section v-if="modelValue"><slot/></section>',
          },
        },
      },
    });
    await flushPromises();
    await wrapper.get('[data-test="notary-resume-request"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="notary-workflow-retry"]').trigger('click');
    await flushPromises();
    expect(api.recordNotaryPortalOpening).toHaveBeenCalledWith(
      'matter-1',
      { expectedVersion: 2, contentVersionIds: ['photo-v1'] },
      'original',
    );
    wrapper.unmount();
  });
});
