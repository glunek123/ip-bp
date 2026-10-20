import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createMemoryHistory, RouterView } from 'vue-router';
import { useAuthStore } from '../../stores/auth';
const api = vi.hoisted(() => ({
  capability: vi.fn(),
  list: vi.fn(),
  candidates: vi.fn(),
  detail: vi.fn(),
  create: vi.fn(),
  dissolve: vi.fn(),
}));
vi.mock('../../api/case-handling-groups', async (original) => ({
  ...(await original<typeof import('../../api/case-handling-groups')>()),
  getCaseHandlingGroupCapability: api.capability,
  listCaseHandlingGroups: api.list,
  listCaseHandlingGroupCandidates: api.candidates,
  getCaseHandlingGroup: api.detail,
  createCaseHandlingGroup: api.create,
  dissolveCaseHandlingGroup: api.dissolve,
}));
import { ApiError } from '../../api/http';
import type { CaseHandlingGroupAttempt } from '../../api/case-handling-groups';
import {
  readPendingCaseHandlingGroups,
  savePendingCaseHandlingGroups,
  clearPendingCaseHandlingGroup,
  runCaseHandlingGroupAttempt,
} from './CaseHandlingGroupsPage.vue';
import CaseHandlingGroupsPage from './CaseHandlingGroupsPage.vue';
const actorKey = 'actor:INTERNAL:dept';
const groupId = '55555555-5555-4555-8555-555555555555';
const attempt = (): CaseHandlingGroupAttempt => ({
  kind: 'CREATE',
  actorKey,
  input: {
    groupId,
    caseIds: [
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
    ],
    idempotencyKey: 'original-key',
  },
});
const result = {
  id: groupId,
  revision: 1,
  status: 'ACTIVE',
  recordedAt: '2026-10-20T00:00:00.000Z',
};
const context = () => ({
  actorKey,
  contextKey: 'session1:route1',
  signal: new AbortController().signal,
});
describe('handling group original request host', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });
  it('persists the complete ordered body/key before a command and clears only confirmed same-context success', async () => {
    const command = vi.fn(async (input) => {
      expect(readPendingCaseHandlingGroups()?.[actorKey]).toEqual(input);
      return result;
    });
    await expect(
      runCaseHandlingGroupAttempt(attempt(), context(), () => true, command),
    ).resolves.toEqual({ kind: 'confirmed', result });
    expect(command).toHaveBeenCalledTimes(1);
    expect(readPendingCaseHandlingGroups()).toEqual({});
  });
  it('keeps original input and key for explicit replay after a lost response or 403', async () => {
    const command = vi
      .fn()
      .mockRejectedValueOnce(new Error('lost response'))
      .mockRejectedValueOnce(new ApiError('denied', 403, 'FORBIDDEN'))
      .mockResolvedValue(result);
    for (let index = 0; index < 2; index += 1) {
      expect(
        (
          await runCaseHandlingGroupAttempt(
            attempt(),
            context(),
            () => true,
            command,
          )
        ).kind,
      ).toBe('unknown');
      expect(readPendingCaseHandlingGroups()?.[actorKey]).toEqual(attempt());
    }
    expect(
      (
        await runCaseHandlingGroupAttempt(
          attempt(),
          context(),
          () => true,
          command,
        )
      ).kind,
    ).toBe('confirmed');
    expect(command.mock.calls.map(([input]) => input)).toEqual([
      attempt(),
      attempt(),
      attempt(),
    ]);
  });
  it('retains the original record on partial/extra response and never clears another pending command', async () => {
    expect(
      (
        await runCaseHandlingGroupAttempt(
          attempt(),
          context(),
          () => true,
          async () => ({ ...result, extra: true }),
        )
      ).kind,
    ).toBe('unknown');
    const other = {
      ...attempt(),
      input: { ...attempt().input, idempotencyKey: 'newer-key' },
    } as CaseHandlingGroupAttempt;
    savePendingCaseHandlingGroups({ [actorKey]: other });
    expect(clearPendingCaseHandlingGroup(attempt())).toBe(false);
    const command = vi.fn();
    expect(
      (
        await runCaseHandlingGroupAttempt(
          attempt(),
          context(),
          () => true,
          command,
        )
      ).kind,
    ).toBe('rejected');
    expect(command).not.toHaveBeenCalled();
    expect(readPendingCaseHandlingGroups()?.[actorKey]).toEqual(other);
  });
  it('does not issue a command if persistence or the before-submit context check fails', async () => {
    const command = vi.fn();
    expect(
      (
        await runCaseHandlingGroupAttempt(
          attempt(),
          context(),
          () => false,
          command,
        )
      ).kind,
    ).toBe('rejected');
    expect(command).not.toHaveBeenCalled();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    expect(
      (
        await runCaseHandlingGroupAttempt(
          attempt(),
          context(),
          () => true,
          command,
        )
      ).kind,
    ).toBe('rejected');
    expect(command).not.toHaveBeenCalled();
  });
  it('rechecks context after persistence and retains the original when it changes before HTTP', async () => {
    const current = vi
      .fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    const command = vi.fn();
    expect(
      (
        await runCaseHandlingGroupAttempt(
          attempt(),
          context(),
          current,
          command,
        )
      ).kind,
    ).toBe('unknown');
    expect(command).not.toHaveBeenCalled();
    expect(readPendingCaseHandlingGroups()?.[actorKey]).toEqual(attempt());
  });
  it('keeps the captured original body when callers mutate their objects during an uncertain command', async () => {
    const original = attempt();
    const before = structuredClone(original);
    const command = vi.fn(async () => {
      if (original.kind === 'CREATE') {
        original.input.caseIds.reverse();
        original.input.idempotencyKey = 'mutated';
      }
      throw new Error('unknown');
    });
    expect(
      (
        await runCaseHandlingGroupAttempt(
          original,
          context(),
          () => true,
          command,
        )
      ).kind,
    ).toBe('unknown');
    expect(readPendingCaseHandlingGroups()?.[actorKey]).toEqual(before);
  });
  it('does not clear pending after route/full-session/revision invalidation during a command', async () => {
    let resolve!: (value: unknown) => void;
    let current = true;
    const command = vi.fn(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = runCaseHandlingGroupAttempt(
      attempt(),
      context(),
      () => current,
      command,
    );
    current = false;
    resolve(result);
    expect((await pending).kind).toBe('unknown');
    expect(readPendingCaseHandlingGroups()?.[actorKey]).toEqual(attempt());
  });
  it('preserves pending if the page aborts after a server command has started', async () => {
    const controller = new AbortController();
    let resolve!: (value: unknown) => void;
    const pending = runCaseHandlingGroupAttempt(
      attempt(),
      { ...context(), signal: controller.signal },
      () => true,
      async () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    controller.abort();
    resolve(result);
    expect((await pending).kind).toBe('unknown');
    expect(readPendingCaseHandlingGroups()?.[actorKey]).toEqual(attempt());
  });
  it('fails closed for malformed storage and protects other actors', () => {
    localStorage.setItem('case-handling-group-pending-v1', '{bad');
    expect(readPendingCaseHandlingGroups()).toBeNull();
    const other = { ...attempt(), actorKey: 'other:INTERNAL:dept' };
    savePendingCaseHandlingGroups({ [other.actorKey]: other });
    expect(clearPendingCaseHandlingGroup(attempt())).toBe(false);
    expect(readPendingCaseHandlingGroups()?.[other.actorKey]).toEqual(other);
  });
});

const firstCase = '33333333-3333-4333-8333-333333333333';
const secondCase = '44444444-4444-4444-8444-444444444444';
const customerId = '66666666-6666-4666-8666-666666666666';
const visibleMembers = [
  {
    caseId: firstCase,
    businessNo: 'CA-合成001',
    customerId,
    customerName: '合成客户',
    stage: 'WAITING_ARCHIVE',
  },
  {
    caseId: secondCase,
    businessNo: 'CA-合成002',
    customerId,
    customerName: '合成客户',
    stage: 'WAITING_COMPLAINT',
  },
];
const visibleDetail = {
  id: groupId,
  revision: 1,
  status: 'ACTIVE',
  createdAt: '2026-10-20T00:00:00.000Z',
  members: visibleMembers,
  canDissolve: true,
};
const pageWrappers: ReturnType<typeof mount>[] = [];
async function mountGroups(path = '/case-handling-groups') {
  const pinia = createPinia();
  setActivePinia(pinia);
  const auth = useAuthStore(pinia);
  auth.session = {
    principalType: 'INTERNAL',
    user: { id: 'actor', displayName: '运营甲', username: 'synthetic' },
    department: { id: 'dept', name: '合成部门' },
    departments: [{ id: 'dept', name: '合成部门' }],
    customer: null,
    notaryOffice: null,
    authorizationRevision: 1,
    expiresAt: '2099-01-01T00:00:00Z',
    csrfToken: 'synthetic',
  };
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/case-handling-groups/:id?', component: CaseHandlingGroupsPage },
      { path: '/cases', component: { template: '<p>案件列表</p>' } },
      { path: '/cases/:id', component: { template: '<p>原案详情</p>' } },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(
    { components: { RouterView }, template: '<RouterView />' },
    { global: { plugins: [pinia, router] } },
  );
  pageWrappers.push(wrapper);
  await flushPromises();
  return { wrapper, router, auth };
}
async function selectAndPrepare(wrapper: ReturnType<typeof mount>) {
  await wrapper.get('[data-test="open-create-group"]').trigger('click');
  await flushPromises();
  for (const id of [firstCase, secondCase])
    await wrapper.get(`[data-test="select-group-case-${id}"]`).setValue(true);
  await wrapper.get('[data-test="prepare-group"]').trigger('click');
  await flushPromises();
  await wrapper.get('[data-test="confirm-create-group"]').setValue(true);
}
describe('handling groups production page adapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    localStorage.clear();
    api.capability.mockResolvedValue({ canCreate: true });
    api.list.mockImplementation(
      async (query: { page: number; pageSize: number }) => ({
        items: [visibleDetail],
        total: 21,
        ...query,
      }),
    );
    api.candidates.mockImplementation(
      async (query: { page: number; pageSize: number }) => ({
        items: visibleMembers,
        total: 2,
        page: query.page,
        pageSize: query.pageSize,
      }),
    );
    api.detail.mockImplementation(async (id: string) => ({
      ...visibleDetail,
      id,
    }));
    api.create.mockImplementation(async (input: { groupId: string }) => ({
      ...result,
      id: input.groupId,
    }));
    api.dissolve.mockResolvedValue({
      ...result,
      status: 'DISSOLVED',
      revision: 2,
    });
  });
  afterEach(() => {
    pageWrappers.splice(0).forEach((wrapper) => wrapper.unmount());
    vi.restoreAllMocks();
  });
  it('keeps readable groups available when current create capability is false or fails', async () => {
    api.capability.mockRejectedValue(new ApiError('denied', 403, 'FORBIDDEN'));
    const { wrapper } = await mountGroups();
    expect(wrapper.text()).toContain('CA-合成001');
    expect(wrapper.find('[data-test="open-create-group"]').exists()).toBe(
      false,
    );
    expect(api.candidates).not.toHaveBeenCalled();
  });
  it('uses real candidates and a second capability/read pass before persisting a single command', async () => {
    api.create.mockImplementation(async (input: { groupId: string }) => {
      expect(readPendingCaseHandlingGroups()?.[actorKey]?.input).toEqual(input);
      return { ...result, id: input.groupId };
    });
    const destination =
      '/cases?view=department&page=3&rightsHolderName=合成#records';
    const { wrapper, router } = await mountGroups(
      `/case-handling-groups?returnTo=${encodeURIComponent(destination)}`,
    );
    await selectAndPrepare(wrapper);
    expect(api.capability).toHaveBeenCalledTimes(2);
    expect(api.candidates).toHaveBeenLastCalledWith(
      { page: 1, pageSize: 100, customerId },
      { signal: expect.any(AbortSignal) },
    );
    await wrapper.get('[data-test="submit-create-group"]').trigger('click');
    await flushPromises();
    expect(api.create).toHaveBeenCalledExactlyOnceWith(
      {
        groupId: expect.any(String),
        caseIds: [firstCase, secondCase],
        idempotencyKey: expect.any(String),
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(readPendingCaseHandlingGroups()).toEqual({});
    expect(router.currentRoute.value.query.returnTo).toBe(destination);
    expect(
      wrapper.get('[data-test="group-return-to-cases"]').attributes('href'),
    ).toBe(destination);
  });
  it('reads candidate pages and rechecks every selected member across current scoped pages', async () => {
    api.candidates.mockImplementation(
      async (query: { page: number; pageSize: number }) => ({
        items: query.page === 1 ? [visibleMembers[0]] : [visibleMembers[1]],
        total: 101,
        page: query.page,
        pageSize: query.pageSize,
      }),
    );
    const { wrapper } = await mountGroups();
    await wrapper.get('[data-test="open-create-group"]').trigger('click');
    await flushPromises();
    await wrapper
      .get(`[data-test="select-group-case-${firstCase}"]`)
      .setValue(true);
    await wrapper.get('[data-test="more-group-candidates"]').trigger('click');
    await flushPromises();
    await wrapper
      .get(`[data-test="select-group-case-${secondCase}"]`)
      .setValue(true);
    await wrapper.get('[data-test="prepare-group"]').trigger('click');
    await flushPromises();
    expect(api.candidates.mock.calls.map(([query]) => query)).toEqual([
      { page: 1, pageSize: 100, q: '' },
      { page: 2, pageSize: 100, q: '' },
      { page: 1, pageSize: 100, customerId },
      { page: 2, pageSize: 100, customerId },
    ]);
    await wrapper.get('[data-test="confirm-create-group"]').setValue(true);
    await wrapper.get('[data-test="submit-create-group"]').trigger('click');
    await flushPromises();
    expect(api.create.mock.calls[0]?.[0].caseIds).toEqual([
      firstCase,
      secondCase,
    ]);
  });
  it('blocks the whole preparation if current candidate scope no longer contains one selected case', async () => {
    api.candidates
      .mockResolvedValueOnce({
        items: visibleMembers,
        total: 2,
        page: 1,
        pageSize: 100,
      })
      .mockResolvedValueOnce({
        items: [visibleMembers[0]],
        total: 1,
        page: 1,
        pageSize: 100,
      });
    const { wrapper } = await mountGroups();
    await wrapper.get('[data-test="open-create-group"]').trigger('click');
    await flushPromises();
    for (const id of [firstCase, secondCase])
      await wrapper.get(`[data-test="select-group-case-${id}"]`).setValue(true);
    await wrapper.get('[data-test="prepare-group"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-test="confirm-create-group"]').exists()).toBe(
      false,
    );
    expect(api.create).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('整组未提交');
  });
  it('retains the exact original create after POST 403 and explicitly replays despite revoked create capability', async () => {
    api.create
      .mockRejectedValueOnce(
        new ApiError('denied', 403, 'CASE_ACTION_FORBIDDEN'),
      )
      .mockImplementationOnce(async (input: { groupId: string }) => ({
        ...result,
        id: input.groupId,
      }));
    const { wrapper } = await mountGroups();
    await selectAndPrepare(wrapper);
    await wrapper.get('[data-test="submit-create-group"]').trigger('click');
    await flushPromises();
    const original = structuredClone(api.create.mock.calls[0]![0]);
    expect(readPendingCaseHandlingGroups()?.[actorKey]?.input).toEqual(
      original,
    );
    expect(wrapper.find('[data-test="open-create-group"]').exists()).toBe(
      false,
    );
    await wrapper.get('[data-test="submit-create-group"]').trigger('click');
    await flushPromises();
    expect(api.create.mock.calls[1]?.[0]).toEqual(original);
    expect(readPendingCaseHandlingGroups()).toEqual({});
  });
  it('recovers an original dissolve without fabricating a readable detail when GET is denied', async () => {
    const original = {
      kind: 'DISSOLVE' as const,
      actorKey,
      groupId,
      input: { expectedRevision: 1, idempotencyKey: 'original-dissolve' },
    };
    savePendingCaseHandlingGroups({ [actorKey]: original });
    api.capability.mockResolvedValue({ canCreate: false });
    api.detail.mockRejectedValue(new ApiError('not found', 404, 'NOT_FOUND'));
    api.dissolve
      .mockRejectedValueOnce(new ApiError('denied', 403, 'FORBIDDEN'))
      .mockResolvedValueOnce({ ...result, revision: 2, status: 'DISSOLVED' });
    const { wrapper } = await mountGroups(`/case-handling-groups/${groupId}`);
    expect(wrapper.find('[data-test="dissolve-group"]').exists()).toBe(false);
    await wrapper.get('[data-test="confirm-recover-dissolve"]').setValue(true);
    await wrapper.get('[data-test="recover-dissolve-group"]').trigger('click');
    await flushPromises();
    expect(readPendingCaseHandlingGroups()?.[actorKey]).toEqual(original);
    await wrapper.get('[data-test="recover-dissolve-group"]').trigger('click');
    await flushPromises();
    expect(
      api.dissolve.mock.calls.map(([id, input]) => ({ id, input })),
    ).toEqual([
      { id: groupId, input: original.input },
      { id: groupId, input: original.input },
    ]);
    expect(readPendingCaseHandlingGroups()).toEqual({});
  });
  it('offers only explicit original create recovery with no new selection or capability assumption', async () => {
    const original = {
      kind: 'CREATE' as const,
      actorKey,
      input: {
        groupId,
        caseIds: [secondCase, firstCase],
        idempotencyKey: 'original-create',
      },
    };
    savePendingCaseHandlingGroups({ [actorKey]: original });
    api.capability.mockResolvedValue({ canCreate: false });
    const { wrapper } = await mountGroups();
    await wrapper.get('[data-test="recover-create-group"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="confirm-create-group"]').setValue(true);
    await wrapper.get('[data-test="submit-create-group"]').trigger('click');
    await flushPromises();
    expect(api.create).toHaveBeenCalledWith(original.input, {
      signal: expect.any(AbortSignal),
    });
    expect(api.candidates).not.toHaveBeenCalled();
  });
  it('restores the same full create body and key after a failed response and component remount', async () => {
    api.create.mockRejectedValueOnce(new Error('response lost'));
    const firstMount = await mountGroups();
    await selectAndPrepare(firstMount.wrapper);
    await firstMount.wrapper
      .get('[data-test="submit-create-group"]')
      .trigger('click');
    await flushPromises();
    const original = structuredClone(api.create.mock.calls[0]![0]);
    firstMount.wrapper.unmount();
    pageWrappers.splice(pageWrappers.indexOf(firstMount.wrapper), 1);
    api.capability.mockResolvedValue({ canCreate: false });
    api.create.mockImplementationOnce(async (input: { groupId: string }) => ({
      ...result,
      id: input.groupId,
    }));
    const secondMount = await mountGroups();
    await secondMount.wrapper
      .get('[data-test="recover-create-group"]')
      .trigger('click');
    await flushPromises();
    await secondMount.wrapper
      .get('[data-test="confirm-create-group"]')
      .setValue(true);
    await secondMount.wrapper
      .get('[data-test="submit-create-group"]')
      .trigger('click');
    await flushPromises();
    expect(api.create.mock.calls[1]?.[0]).toEqual(original);
    expect(readPendingCaseHandlingGroups()).toEqual({});
  });
  it('does not prepare or send cached candidates after the fresh create capability is revoked', async () => {
    api.capability
      .mockResolvedValueOnce({ canCreate: true })
      .mockResolvedValueOnce({ canCreate: false });
    const { wrapper } = await mountGroups();
    await wrapper.get('[data-test="open-create-group"]').trigger('click');
    await flushPromises();
    for (const id of [firstCase, secondCase])
      await wrapper.get(`[data-test="select-group-case-${id}"]`).setValue(true);
    await wrapper.get('[data-test="prepare-group"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-test="confirm-create-group"]').exists()).toBe(
      false,
    );
    expect(api.candidates).toHaveBeenCalledTimes(1);
    expect(api.create).not.toHaveBeenCalled();
  });
  it.each([
    'unknown query/hash',
    'new session',
    'authorization revision',
    'different actor',
  ])('does not clear or navigate on late success after %s', async (change) => {
    let resolve!: (value: unknown) => void;
    api.create.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { wrapper, router, auth } = await mountGroups();
    await selectAndPrepare(wrapper);
    await wrapper.get('[data-test="submit-create-group"]').trigger('click');
    const input = structuredClone(api.create.mock.calls[0]![0]);
    const signal = api.create.mock.calls[0]![1].signal;
    if (change === 'unknown query/hash')
      await router.push('/case-handling-groups?unused=1#changed');
    else if (auth.session)
      auth.session = {
        ...auth.session,
        ...(change === 'authorization revision'
          ? { authorizationRevision: 2 }
          : {}),
        ...(change === 'different actor'
          ? { user: { ...auth.session.user, id: 'other' } }
          : {}),
      };
    await flushPromises();
    const reads = api.list.mock.calls.length;
    expect(signal.aborted).toBe(true);
    resolve({ ...result, id: input.groupId });
    await flushPromises();
    expect(readPendingCaseHandlingGroups()?.[actorKey]?.input).toEqual(input);
    expect(api.list).toHaveBeenCalledTimes(reads);
    expect(router.currentRoute.value.path).toBe('/case-handling-groups');
  });
  it('uses internal return context and real group pagination without exposing hidden member metadata', async () => {
    const { wrapper, router } = await mountGroups(
      '/case-handling-groups?returnTo=https://example.com',
    );
    expect(
      wrapper.get('[data-test="group-return-to-cases"]').attributes('href'),
    ).toBe('/cases');
    await wrapper.get('[data-test="next-group-page"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query.page).toBe('2');
    expect(api.list).toHaveBeenLastCalledWith(
      { page: 2, pageSize: 20 },
      { signal: expect.any(AbortSignal) },
    );
    expect(wrapper.text()).not.toContain('隐藏成员');
  });
  it('links materials and fees to readable original cases only', async () => {
    const { wrapper } = await mountGroups(`/case-handling-groups/${groupId}`);
    expect(
      wrapper.find(`a[href="/cases/${firstCase}?tab=files"]`).exists(),
    ).toBe(true);
    expect(
      wrapper.find(`a[href="/cases/${firstCase}?tab=fees"]`).exists(),
    ).toBe(true);
  });
  it('does not issue detail requests for the empty optional list route parameter', async () => {
    await mountGroups();
    expect(api.detail).not.toHaveBeenCalled();
  });
  it('does not retain stale actor capability or readable names after a new authorization session', async () => {
    let resolveCapability!: (value: unknown) => void;
    let resolveList!: (value: unknown) => void;
    api.capability
      .mockReturnValueOnce(
        new Promise((done) => {
          resolveCapability = done;
        }),
      )
      .mockResolvedValueOnce({ canCreate: false });
    api.list
      .mockReturnValueOnce(
        new Promise((done) => {
          resolveList = done;
        }),
      )
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 });
    const { wrapper, auth } = await mountGroups();
    const signal = api.capability.mock.calls[0]![0].signal;
    if (auth.session)
      auth.session = { ...auth.session, authorizationRevision: 2 };
    await flushPromises();
    resolveCapability({ canCreate: true });
    resolveList({ items: [visibleDetail], total: 1, page: 1, pageSize: 20 });
    await flushPromises();
    expect(signal.aborted).toBe(true);
    expect(wrapper.text()).not.toContain('合成客户');
    expect(wrapper.find('[data-test="open-create-group"]').exists()).toBe(
      false,
    );
  });
  it('fails closed for corrupt original-request storage while retaining read-only groups', async () => {
    localStorage.setItem('case-handling-group-pending-v1', '{bad');
    const { wrapper } = await mountGroups(`/case-handling-groups/${groupId}`);
    expect(wrapper.find('[data-test="dissolve-group"]').exists()).toBe(false);
    expect(
      wrapper.get('[data-test="open-create-group"]').attributes('disabled'),
    ).toBeDefined();
    expect(api.create).not.toHaveBeenCalled();
    expect(api.dissolve).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('原请求记录不可读');
  });
});
