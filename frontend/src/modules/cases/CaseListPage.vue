<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import { listCases, type CaseSummary } from '../../api/cases';

const state = ref<'loading' | 'ready' | 'failed'>('loading');
const items = ref<CaseSummary[]>([]);
const total = ref(0);
const error = ref('');
let request: AbortController | undefined;
async function load() {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  state.value = 'loading';
  error.value = '';
  try {
    const result = await listCases(1, 20, { signal: controller.signal });
    if (controller.signal.aborted) return;
    items.value = result.items;
    total.value = result.total;
    state.value = 'ready';
  } catch (reason) {
    if (controller.signal.aborted) return;
    error.value =
      reason instanceof ApiError && reason.status === 403
        ? '当前账号无权读取案件，请联系管理员核实权限。'
        : '案件列表暂时无法加载，请检查连接后重试。';
    state.value = 'failed';
  }
}
onMounted(() => void load());
onBeforeUnmount(() => request?.abort());
</script>

<template>
  <div class="page-view page-view--narrow">
    <main>
      <div class="page-head">
        <div>
          <p class="eyebrow">业务管理系统</p>
          <h1>案件</h1>
          <p>案件来源及当前待匹配状态。</p>
        </div>
        <ElButton text :loading="state === 'loading'" @click="load"
          >刷新</ElButton
        >
      </div>
      <section v-if="state === 'loading'" class="state-panel ledger-panel">
        <h2>正在读取案件</h2>
      </section>
      <section v-else-if="state === 'failed'" class="state-panel ledger-panel">
        <h2>案件列表暂时无法加载</h2>
        <p class="submit-error" role="alert">{{ error }}</p>
        <ElButton type="primary" @click="load">重新加载</ElButton>
      </section>
      <section v-else class="demo-card demo-card--pad" data-test="case-list">
        <p v-if="items.length === 0" class="field-help">当前没有案件。</p>
        <ul v-else class="notary-offices-list">
          <li v-for="item in items" :key="item.id">
            <RouterLink :to="`/cases/${encodeURIComponent(item.id)}`">{{
              item.businessNo
            }}</RouterLink
            ><span class="pill">待匹配</span
            ><span
              >来源线索 {{ item.sourceLead.businessNo }} · 公证事项
              {{ item.sourceNotaryMatter.businessNo }}</span
            >
          </li>
        </ul>
        <p v-if="total > items.length" class="field-help">
          当前显示 {{ items.length }} / {{ total }} 项
        </p>
      </section>
    </main>
  </div>
</template>
