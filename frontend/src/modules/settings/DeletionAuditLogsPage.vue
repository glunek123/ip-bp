<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ElDialog } from 'element-plus/es/components/dialog/index.mjs';
import { ApiError } from '../../api/http';
import {
  listDeletionAuditLogs,
  type DeletionAuditEntityType,
  type DeletionAuditLogItem,
} from '../../api/deletion-audit';
import { useAuthStore } from '../../stores/auth';

const auth = useAuthStore();
const identity = computed(
  () =>
    `${auth.session?.user.id ?? ''}:${auth.session?.department?.id ?? ''}:${auth.session?.authorizationRevision ?? ''}`,
);

const entityTypeLabels: Record<string, string> = {
  CASE: '案件',
  LEAD: '线索',
  NOTARY_MATTER: '公证',
  CUSTOMER: '客户',
  LEGACY_ATTACHMENT: '历史附件',
};

const entityType = ref<DeletionAuditEntityType | ''>('');
const fromDate = ref('');
const toDate = ref('');
const page = ref(1);
const pageSize = 20;

const status = ref<'loading' | 'ready' | 'denied' | 'failed'>('loading');
const items = ref<DeletionAuditLogItem[]>([]);
const total = ref(0);
const errorText = ref('');
const snapshotItem = ref<DeletionAuditLogItem | null>(null);

let controller: globalThis.AbortController | undefined;
let generation = 0;

function formatShanghaiTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

const totalPages = computed(() =>
  Math.max(1, Math.ceil(total.value / pageSize)),
);

async function load(targetPage = page.value): Promise<void> {
  controller?.abort();
  controller = new globalThis.AbortController();
  const current = ++generation;
  page.value = targetPage;
  status.value = 'loading';
  errorText.value = '';
  try {
    const res = await listDeletionAuditLogs(
      {
        entityType: entityType.value || undefined,
        from: fromDate.value ? `${fromDate.value}T00:00:00+08:00` : undefined,
        to: toDate.value ? `${toDate.value}T23:59:59+08:00` : undefined,
        page: targetPage,
        pageSize,
      },
      { signal: controller.signal },
    );
    if (current !== generation) return;
    items.value = res.items;
    total.value = res.total;
    status.value = 'ready';
  } catch (error) {
    if (controller.signal.aborted || current !== generation) return;
    if (error instanceof ApiError && error.status === 403) {
      status.value = 'denied';
      errorText.value = '当前账号无权查看删除留痕记录。';
      return;
    }
    status.value = 'failed';
    errorText.value =
      error instanceof ApiError ? error.message : '删除留痕加载失败，请重试。';
  }
}

function resetFilters(): void {
  entityType.value = '';
  fromDate.value = '';
  toDate.value = '';
  void load(1);
}

watch(
  identity,
  () => {
    void load(1);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  controller?.abort();
});
</script>

<template>
  <main class="page-view deletion-audit-page">
    <header class="page-head">
      <div>
        <h1>删除留痕日志</h1>
        <p class="field-help">
          持久化记录业务删除的精确时间、操作人账号、姓名、所属角色、删除原因与被删数据摘要，不可篡改或删除。
        </p>
      </div>
      <ElButton plain data-test="deletion-logs-refresh" @click="load(page)"
        >刷新</ElButton
      >
    </header>

    <section class="demo-card demo-card--pad deletion-audit-filters">
      <label>
        <span>实体类型</span>
        <select
          v-model="entityType"
          class="text-input"
          data-test="filter-entity-type"
        >
          <option value="">全部</option>
          <option value="CASE">案件</option>
          <option value="LEAD">线索</option>
          <option value="NOTARY_MATTER">公证</option>
          <option value="CUSTOMER">客户</option>
          <option value="LEGACY_ATTACHMENT">历史附件</option>
        </select>
      </label>
      <label>
        <span>开始日期</span>
        <input
          v-model="fromDate"
          type="date"
          class="text-input"
          data-test="filter-from-date"
        />
      </label>
      <label>
        <span>结束日期</span>
        <input
          v-model="toDate"
          type="date"
          class="text-input"
          data-test="filter-to-date"
        />
      </label>
      <div class="deletion-audit-filter-actions">
        <ElButton type="primary" data-test="filter-apply" @click="load(1)"
          >查询</ElButton
        >
        <ElButton plain data-test="filter-reset" @click="resetFilters"
          >重置</ElButton
        >
      </div>
    </section>

    <section class="demo-card demo-card--pad">
      <p v-if="status === 'loading'">正在加载删除日志…</p>
      <p v-else-if="status === 'denied' || status === 'failed'" role="alert">
        {{ errorText }}
      </p>
      <p v-else-if="items.length === 0" data-test="deletion-logs-empty">
        暂无符合条件的删除日志。
      </p>
      <div v-else class="business-table-wrap">
        <table class="business-list-table" data-test="deletion-logs-table">
          <thead>
            <tr>
              <th>删除时间</th>
              <th>实体类型</th>
              <th>业务编号</th>
              <th>标题摘要</th>
              <th>操作账号</th>
              <th>操作人</th>
              <th>所属角色</th>
              <th>删除原因</th>
              <th>快照</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in items"
              :key="row.id"
              :data-test="`deletion-log-row-${row.id}`"
            >
              <td class="mono">{{ formatShanghaiTime(row.deletedAt) }}</td>
              <td>{{ entityTypeLabels[row.entityType] ?? row.entityType }}</td>
              <td class="mono">{{ row.businessNo || '—' }}</td>
              <td>{{ row.entityTitle || '—' }}</td>
              <td class="mono">{{ row.actorUsername }}</td>
              <td>{{ row.actorDisplayName }}</td>
              <td>
                <span
                  v-for="role in row.actorRoles"
                  :key="role"
                  class="pill deletion-role-pill"
                  >{{ role }}</span
                >
                <span v-if="row.actorRoles.length === 0">—</span>
              </td>
              <td>{{ row.deleteReason || '—' }}</td>
              <td>
                <ElButton
                  size="small"
                  text
                  :data-test="`view-snapshot-${row.id}`"
                  @click="snapshotItem = row"
                  >查看</ElButton
                >
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <footer
        v-if="status === 'ready' && total > 0"
        class="deletion-audit-pager"
      >
        <span>共 {{ total }} 条 · 第 {{ page }} / {{ totalPages }} 页</span>
        <div class="deletion-audit-pager-actions">
          <ElButton
            size="small"
            plain
            :disabled="page <= 1"
            data-test="pager-prev"
            @click="load(page - 1)"
            >上一页</ElButton
          >
          <ElButton
            size="small"
            plain
            :disabled="page >= totalPages"
            data-test="pager-next"
            @click="load(page + 1)"
            >下一页</ElButton
          >
        </div>
      </footer>
    </section>

    <ElDialog
      :model-value="snapshotItem !== null"
      :title="`被删数据快照 · ${snapshotItem?.businessNo || snapshotItem?.entityId || ''}`"
      width="min(720px, 92vw)"
      @update:model-value="(open: boolean) => { if (!open) snapshotItem = null; }"
      @close="snapshotItem = null"
    >
      <pre v-if="snapshotItem" class="deletion-snapshot-pre">{{
        JSON.stringify(snapshotItem.snapshot, null, 2)
      }}</pre>
    </ElDialog>
  </main>
</template>

<style scoped>
.deletion-audit-page {
  display: grid;
  gap: 14px;
}
.deletion-audit-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 12px;
}
.deletion-audit-filters label {
  display: grid;
  gap: 4px;
  font-size: 13px;
}
.deletion-audit-filter-actions {
  display: flex;
  gap: 8px;
}
.deletion-role-pill {
  display: inline-block;
  margin: 2px 4px 2px 0;
}
.deletion-audit-pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
  font-size: 13px;
}
.deletion-audit-pager-actions {
  display: flex;
  gap: 8px;
}
.deletion-snapshot-pre {
  max-height: 60vh;
  overflow: auto;
  padding: 12px;
  border-radius: 6px;
  background: var(--el-fill-color-light, #f5f7fa);
  font-size: 12px;
  line-height: 1.5;
}
</style>
