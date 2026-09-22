<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import {
  getCustomerRightsHolder,
  type RightsHolderSummary,
} from '../../api/rights-holders';
import { ApiError } from '../../api/http';

const route = useRoute();
const state = ref<'loading' | 'ready' | 'missing' | 'failed'>('loading');
const holder = ref<RightsHolderSummary>();
let activeRequest: AbortController | undefined;

function isMissing(error: unknown): boolean {
  return (
    (error instanceof ApiError &&
      ['CUSTOMER_NOT_FOUND', 'RIGHTS_HOLDER_NOT_FOUND'].includes(error.code)) ||
    (typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error.code === 'CUSTOMER_NOT_FOUND' ||
        error.code === 'RIGHTS_HOLDER_NOT_FOUND'))
  );
}

async function load(): Promise<void> {
  activeRequest?.abort();
  const controller = new AbortController();
  activeRequest = controller;
  holder.value = undefined;
  state.value = 'loading';
  try {
    const result = await getCustomerRightsHolder(
      String(route.params.customerId),
      String(route.params.rightsHolderId),
      { signal: controller.signal },
    );
    if (controller.signal.aborted) return;
    holder.value = result;
    state.value = 'ready';
  } catch (error) {
    if (controller.signal.aborted) return;
    state.value = isMissing(error) ? 'missing' : 'failed';
  }
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}

watch(
  () => [route.params.customerId, route.params.rightsHolderId],
  () => void load(),
  { immediate: true },
);
onBeforeUnmount(() => activeRequest?.abort());
</script>

<template>
  <div class="page-view page-view--narrow">
    <main>
      <RouterLink
        class="back-link"
        :to="`/customers/${String(route.params.customerId)}`"
      >
        ← 返回客户详情
      </RouterLink>
      <section v-if="state === 'loading'" class="state-panel ledger-panel">
        <span class="state-index">读取中</span>
        <h1>正在读取权利主体</h1>
      </section>
      <section v-else-if="state === 'missing'" class="state-panel ledger-panel">
        <span class="state-index">404</span>
        <h1>权利主体不存在或当前不可访问</h1>
        <p>请返回客户详情，从已关联的主体中重新选择。</p>
      </section>
      <section v-else-if="state === 'failed'" class="state-panel ledger-panel">
        <span class="state-index">连接失败</span>
        <h1>权利主体暂时无法加载</h1>
        <ElButton @click="load">重新加载</ElButton>
      </section>
      <template v-else-if="holder">
        <div class="detail-heading">
          <div>
            <p class="section-kicker">权利主体详情</p>
            <h1>{{ holder.name }}</h1>
          </div>
          <span class="status-chip status-chip--large">只读</span>
        </div>
        <section class="ledger-panel detail-card">
          <dl class="detail-grid">
            <div>
              <dt>稳定主体标识</dt>
              <dd>{{ holder.id }}</dd>
            </div>
            <div>
              <dt>主体名称</dt>
              <dd>{{ holder.name }}</dd>
            </div>
            <div>
              <dt>统一社会信用代码</dt>
              <dd>{{ holder.credit || '未填写' }}</dd>
            </div>
            <div>
              <dt>地址</dt>
              <dd>{{ holder.address || '未填写' }}</dd>
            </div>
            <div>
              <dt>法定代表人</dt>
              <dd>{{ holder.legalRepresentative || '未填写' }}</dd>
            </div>
            <div>
              <dt>职务</dt>
              <dd>{{ holder.duty || '未填写' }}</dd>
            </div>
            <div>
              <dt>最近更新</dt>
              <dd>{{ formatTime(holder.updatedAt) }}</dd>
            </div>
          </dl>
        </section>
      </template>
    </main>
  </div>
</template>
