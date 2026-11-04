import { defineComponent, onMounted } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import type { CaseDetail } from '../../api/cases';
import { getCase } from '../../api/cases';
import CaseAdditionalActions from './CaseAdditionalActions.vue';
import type { ListWorkflowSession } from '../../app/list-workflow-context';

vi.mock('../../api/cases', async (original) => ({
  ...(await original<typeof import('../../api/cases')>()),
  getCase: vi.fn(),
}));

const wrappers: ReturnType<typeof mount>[] = [];
const actor = 'INTERNAL:user-1:department-1:1';
const caseId = 'case-1';
const workflowPanelStub = defineComponent({
  name: 'CaseListWorkflowPanel',
  props: {
    action: String,
    item: Object,
    session: Object,
    requestState: String,
  },
  setup(props) {
    onMounted(() => {
      (props.session as ListWorkflowSession | undefined)?.restoreUnknown();
    });
  },
  template:
    '<div data-test="workflow-panel-stub" :data-action="action"><span>{{ item.id }}</span><p v-if="requestState === \'unknown\'" data-test="case-list-original-request">Original request retained</p><button v-if="requestState === \'unknown\'" data-test="retry-original">Retry original request</button></div>',
});

function caseFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: caseId,
    businessNo: 'CA-1',
    stage: 'WAITING_ARCHIVE',
    version: 3,
    owner: { id: 'user-1', displayName: '负责人' },
    closure: {
      id: 'closure-1',
      finishId: null,
      current: {
        id: 'closure-version-1',
        kind: 'REGISTER',
        priorVersionId: null,
        finishId: null,
        fromVersion: 2,
        toVersion: 3,
        closeAt: '2026-11-01',
        closeAmountState: 'KNOWN',
        closeAmt: '10.00',
        note: null,
        correctionReason: null,
        recordedAt: '2026-11-01T00:00:00Z',
        recordedByUserId: 'user-1',
        files: [],
      },
      history: [],
    },
    canEarlyClose: false,
    canUpdateClosureSettlement: true,
    canReadClosurePaymentHistory: true,
    canSupplementPaymentProof: false,
    canRecordClosure: false,
    ...overrides,
  } as unknown as CaseDetail;
}

async function render(
  item = caseFixture(),
  overrides: {
    identity?: string;
    actorUserId?: string;
    disabled?: boolean;
    closureRegistrationSucceeded?: boolean;
  } = {},
) {
  vi.mocked(getCase).mockResolvedValue(item);
  const wrapper = mount(CaseAdditionalActions, {
    props: {
      item,
      identity: overrides.identity ?? actor,
      actorUserId: overrides.actorUserId ?? 'user-1',
      disabled: overrides.disabled ?? false,
      closureRegistrationSucceeded:
        overrides.closureRegistrationSucceeded ?? false,
    },
    global: {
      stubs: {
        ElDrawer: {
          props: ['modelValue', 'title'],
          template:
            '<section v-if="modelValue" role="dialog" :aria-label="title"><slot/><slot name="footer"/></section>',
        },
        CaseListWorkflowPanel: workflowPanelStub,
      },
    },
  });
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}

afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  sessionStorage.clear();
  vi.clearAllMocks();
});

it('offers only server-authorized actions and opens the existing fresh-detail workflow', async () => {
  const wrapper = await render();
  expect(wrapper.find('[data-case-action="settlement-update"]').exists()).toBe(
    true,
  );
  expect(wrapper.find('[data-case-action="payment-proof"]').exists()).toBe(
    true,
  );
  expect(wrapper.find('[data-case-action="early-closure"]').exists()).toBe(
    false,
  );
  await wrapper.get('[data-case-action="settlement-update"]').trigger('click');
  await flushPromises();
  expect(getCase).toHaveBeenCalledExactlyOnceWith(caseId, {
    signal: expect.any(AbortSignal),
  });
  expect(
    wrapper.get('[data-test="workflow-panel-stub"]').attributes(),
  ).toMatchObject({
    'data-action': 'settlement-update',
  });
});

it('uses server capabilities for another case owner and hides actions without those capabilities', async () => {
  const delegatedEarlyClosure = await render(
    caseFixture({
      stage: 'EXECUTING',
      owner: { id: 'user-2', displayName: '其他负责人' },
      canEarlyClose: true,
      canReadClosurePaymentHistory: false,
    }),
    { actorUserId: 'user-1' },
  );
  expect(
    delegatedEarlyClosure.find('[data-case-action="early-closure"]').exists(),
  ).toBe(true);

  const delegatedPaymentHistory = await render(
    caseFixture({
      stage: 'ARCHIVED',
      owner: { id: 'user-2', displayName: '其他负责人' },
      canReadClosurePaymentHistory: true,
    }),
    { actorUserId: 'user-1' },
  );
  expect(
    delegatedPaymentHistory.find('[data-case-action="payment-proof"]').exists(),
  ).toBe(true);

  const unavailable = await render(
    caseFixture({
      stage: 'EXECUTING',
      owner: { id: 'user-2', displayName: '其他负责人' },
      canEarlyClose: false,
      canReadClosurePaymentHistory: false,
      canSupplementPaymentProof: false,
    }),
    { actorUserId: 'user-1' },
  );
  expect(unavailable.find('[data-case-action="early-closure"]').exists()).toBe(
    false,
  );
  expect(unavailable.find('[data-case-action="payment-proof"]').exists()).toBe(
    false,
  );

  const disabled = await render(caseFixture(), { disabled: true });
  expect(
    disabled
      .get('[data-case-action="settlement-update"]')
      .attributes('disabled'),
  ).toBeDefined();
});

it('keeps original requests actor-scoped and opens recovery without creating a new action', async () => {
  const requestKey = `case-list-workflow:v1:${encodeURIComponent(actor)}:${encodeURIComponent(caseId)}`;
  sessionStorage.setItem(
    requestKey,
    JSON.stringify({
      version: 1,
      actor,
      caseId,
      action: 'record-closure',
      command: {
        kind: 'closure',
        input: {
          expectedVersion: 3,
          idempotencyKey: 'original-key',
          expectedFinishId: null,
          closeAt: '2026-11-01',
          closeAmountState: 'KNOWN',
          closeAmt: '10.00',
          note: null,
          closeContentVersionIds: [],
        },
      },
    }),
  );
  const wrapper = await render();
  await wrapper.get('[data-test="recover-case-list-action"]').trigger('click');
  await flushPromises();
  expect(getCase).toHaveBeenCalledTimes(1);
  expect(
    wrapper.get('[data-test="workflow-panel-stub"]').attributes(),
  ).toMatchObject({
    'data-action': 'record-closure',
  });
  const child = wrapper.getComponent(workflowPanelStub);
  expect(child.props('session')?.context.actorKey).toBe(actor);
  expect(sessionStorage.getItem(requestKey)).toContain('original-key');
});

it('offers settlement continuation only after a fresh closure and permission read', async () => {
  const wrapper = await render(caseFixture(), {
    closureRegistrationSucceeded: true,
  });
  expect(wrapper.text()).toContain('结案资料已登记并重新读取');
  await wrapper
    .get('[data-test="continue-closure-settlement"]')
    .trigger('click');
  await flushPromises();
  expect(
    wrapper.get('[data-test="workflow-panel-stub"]').attributes(),
  ).toMatchObject({
    'data-action': 'settlement-update',
  });

  const noPermission = await render(
    caseFixture({ canUpdateClosureSettlement: false }),
    { closureRegistrationSucceeded: true },
  );
  expect(noPermission.get('[role="alert"]').text()).toContain(
    '没有更新结算的权限',
  );
  expect(
    noPermission.find('[data-test="continue-closure-settlement"]').exists(),
  ).toBe(false);
});

it('rechecks settlement permission on the fresh detail before showing its panel', async () => {
  const wrapper = await render(caseFixture());
  const fresh = caseFixture({ canUpdateClosureSettlement: false });
  vi.mocked(getCase).mockResolvedValue(fresh);
  await wrapper.get('[data-case-action="settlement-update"]').trigger('click');
  await flushPromises();
  const panel = wrapper.getComponent(workflowPanelStub);
  expect(panel.props('item')).toBe(fresh);
  expect((panel.props('item') as CaseDetail).canUpdateClosureSettlement).toBe(
    false,
  );
});

it('restores a retained original request inside the existing workflow panel', async () => {
  const requestKey = `case-list-workflow:v1:${encodeURIComponent(actor)}:${encodeURIComponent(caseId)}`;
  const original = {
    version: 1,
    actor,
    caseId,
    action: 'record-closure',
    command: {
      kind: 'closure',
      input: {
        expectedVersion: 3,
        idempotencyKey: 'original-key',
        expectedFinishId: null,
        closeAt: '2026-11-01',
        closeAmountState: 'KNOWN',
        closeAmt: '10.00',
        note: null,
        closeContentVersionIds: [],
      },
    },
  };
  sessionStorage.setItem(requestKey, JSON.stringify(original));
  const wrapper = await render(caseFixture({ canRecordClosure: true }));
  await wrapper.get('[data-test="recover-case-list-action"]').trigger('click');
  await flushPromises();
  expect(
    wrapper.find('[data-test="case-list-original-request"]').exists(),
  ).toBe(true);
  expect(wrapper.find('[data-test="retry-original"]').exists()).toBe(true);
  expect(sessionStorage.getItem(requestKey)).toBe(JSON.stringify(original));
});
