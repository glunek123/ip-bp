import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import { useAuthStore } from '../../stores/auth';
import DeletionAuditLogsPage from './DeletionAuditLogsPage.vue';

const api = vi.hoisted(() => ({
  listDeletionAuditLogs: vi.fn(),
}));

vi.mock('../../api/deletion-audit', () => api);

beforeEach(() => {
  vi.resetAllMocks();
  const pinia = createPinia();
  setActivePinia(pinia);
  const auth = useAuthStore();
  auth.session = {
    principalType: 'INTERNAL',
    user: { id: 'u1', displayName: '管理员', username: 'admin' },
    department: { id: 'd1', name: '知产部' },
    departments: [{ id: 'd1', name: '知产部' }],
    customer: null,
    notaryOffice: null,
    authorizationRevision: 1,
    expiresAt: '2026-12-01T00:00:00Z',
    csrfToken: 'csrf',
  };
  api.listDeletionAuditLogs.mockResolvedValue({
    total: 1,
    page: 1,
    pageSize: 20,
    items: [
      {
        id: 'log-1',
        entityType: 'CASE',
        entityId: 'case-1',
        businessNo: '00120261128',
        entityTitle: '案件 00120261128（测试客户）',
        actorUserId: 'u1',
        actorUsername: 'zhichan',
        actorDisplayName: '徐梦梦',
        actorRoles: ['UAT知产运营'],
        deleteReason: '误创建测试数据',
        snapshot: { businessNo: '00120261128', stage: 'PENDING_MATCH' },
        deletedAt: '2026-11-28T03:00:00.000Z',
      },
    ],
  });
});

describe('DeletionAuditLogsPage', () => {
  it('renders deletion audit logs with operator, role, reason and snapshot modal', async () => {
    const wrapper = mount(DeletionAuditLogsPage, {
      global: { stubs: { teleport: true } },
    });
    await flushPromises();
    expect(wrapper.text()).toContain('00120261128');
    expect(wrapper.text()).toContain('zhichan');
    expect(wrapper.text()).toContain('徐梦梦');
    expect(wrapper.text()).toContain('UAT知产运营');
    expect(wrapper.text()).toContain('误创建测试数据');

    await wrapper.get('[data-test="view-snapshot-log-1"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('PENDING_MATCH');
  });

  it('filters by entityType and handles 403 permission denial cleanly', async () => {
    const wrapper = mount(DeletionAuditLogsPage, {
      global: { stubs: { teleport: true } },
    });
    await flushPromises();
    await wrapper.get('[data-test="filter-entity-type"]').setValue('LEAD');
    await wrapper.get('[data-test="filter-apply"]').trigger('click');
    await flushPromises();
    expect(api.listDeletionAuditLogs).toHaveBeenLastCalledWith(
      expect.objectContaining({ entityType: 'LEAD', page: 1 }),
      expect.any(Object),
    );

    api.listDeletionAuditLogs.mockRejectedValueOnce(
      new ApiError('denied', 403, 'DELETION_AUDIT_FORBIDDEN'),
    );
    await wrapper.get('[data-test="deletion-logs-refresh"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('无权查看删除留痕记录');
  });
});
