<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import {
  listNotaryPortalMatters,
  type NotaryPortalMatterSummary,
} from '../../api/notary-portal';

const state = ref<'loading' | 'ready' | 'failed'>('loading');
const matters = ref<NotaryPortalMatterSummary[]>([]);
const total = ref(0);
const page = ref(1);
const stage = ref<'WAITING_UNBOX' | 'WAITING_CERTIFICATE' | 'ARCHIVED'>(
  'WAITING_UNBOX',
);
const stageOptions = [
  { stage: 'WAITING_UNBOX', label: '待开箱' },
  { stage: 'WAITING_CERTIFICATE', label: '待出证' },
  { stage: 'ARCHIVED', label: '已出证' },
] as const;
const error = ref('');
let request: AbortController | undefined;

async function load(): Promise<void> {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  state.value = 'loading';
  error.value = '';
  try {
    const result = await listNotaryPortalMatters(page.value, 20, {
      signal: controller.signal,
      ...(stage.value === 'WAITING_UNBOX' ? {} : { stage: stage.value }),
    });
    if (controller.signal.aborted) return;
    matters.value = result.items;
    total.value = result.total;
    state.value = 'ready';
  } catch (reason) {
    if (controller.signal.aborted) return;
    error.value =
      reason instanceof ApiError && reason.status === 403
        ? '当前公证处账号暂时无权读取事项，请联系管理员核实账号状态。'
        : '事项列表暂时无法加载，请检查连接后重试。';
    state.value = 'failed';
  }
}
function selectStage(
  value: 'WAITING_UNBOX' | 'WAITING_CERTIFICATE' | 'ARCHIVED',
) {
  if (stage.value === value) return;
  stage.value = value;
  page.value = 1;
  void load();
}
const stageLabel = () =>
  stage.value === 'WAITING_UNBOX'
    ? '待开箱'
    : stage.value === 'WAITING_CERTIFICATE'
      ? '待出证'
      : '已出证';

function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}
onMounted(() => void load());
onBeforeUnmount(() => request?.abort());
</script>

<template>
  <div class="page-view page-view--narrow">
    <main>
      <div class="page-head">
        <div>
          <p class="eyebrow">公证处办理端</p>
          <h1>公证事项</h1>
          <p>这里只显示分派给当前公证处的办理事项。</p>
        </div>
        <ElButton
          data-test="refresh-notary-portal"
          text
          :loading="state === 'loading'"
          @click="load"
          >刷新</ElButton
        >
      </div>
      <nav class="notary-portal-segments" aria-label="事项阶段">
        <button
          v-for="item in stageOptions"
          :key="item.stage"
          type="button"
          :aria-current="stage === item.stage ? 'page' : undefined"
          :data-test="`notary-segment-${item.stage.toLowerCase()}`"
          @click="selectStage(item.stage)"
        >
          {{ item.label }}
        </button>
      </nav>
      <section v-if="state === 'loading'" class="state-panel ledger-panel">
        <h2>正在读取{{ stageLabel() }}事项</h2>
      </section>
      <section v-else-if="state === 'failed'" class="state-panel ledger-panel">
        <h2>事项列表暂时无法加载</h2>
        <p class="submit-error" role="alert">{{ error }}</p>
        <ElButton type="primary" @click="load">重新加载</ElButton>
      </section>
      <section
        v-else
        class="demo-card demo-card--pad"
        data-test="notary-portal-list"
      >
        <p v-if="matters.length === 0" class="field-help">
          当前没有{{ stageLabel() }}事项。
        </p>
        <ul v-else class="notary-offices-list">
          <li v-for="matter in matters" :key="matter.id">
            <RouterLink
              data-test="notary-portal-row"
              :to="`/notary-portal/matters/${encodeURIComponent(matter.id)}`"
              >{{ matter.businessNo }}</RouterLink
            >
            <span class="pill">{{
              matter.stage === 'WAITING_UNBOX'
                ? '待开箱'
                : matter.stage === 'WAITING_CERTIFICATE'
                  ? '待出证'
                  : '已出证'
            }}</span
            ><span>{{ formatTime(matter.createdAt) }}</span>
          </li>
        </ul>
        <div v-if="total > 20" class="pagination-row">
          <ElButton
            text
            :disabled="page <= 1"
            @click="
              page -= 1;
              load();
            "
            >上一页</ElButton
          >
          <span>第 {{ page }} 页 · 共 {{ total }} 项</span>
          <ElButton
            text
            :disabled="page * 20 >= total"
            @click="
              page += 1;
              load();
            "
            >下一页</ElButton
          >
        </div>
      </section>
    </main>
  </div>
</template>
