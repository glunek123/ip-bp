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
        : '待开箱事项暂时无法加载，请检查连接后重试。';
    state.value = 'failed';
  }
}

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
          <h1>待开箱事项</h1>
          <p>这里只显示分派给当前公证处、等待开箱的事项。</p>
        </div>
        <ElButton
          data-test="refresh-notary-portal"
          text
          :loading="state === 'loading'"
          @click="load"
          >刷新</ElButton
        >
      </div>
      <section v-if="state === 'loading'" class="state-panel ledger-panel">
        <h2>正在读取待开箱事项</h2>
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
          当前没有待开箱事项。
        </p>
        <ul v-else class="notary-offices-list">
          <li v-for="matter in matters" :key="matter.id">
            <RouterLink
              data-test="notary-portal-row"
              :to="`/notary-portal/matters/${encodeURIComponent(matter.id)}`"
              >{{ matter.businessNo }}</RouterLink
            >
            <span class="pill">待开箱</span
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
