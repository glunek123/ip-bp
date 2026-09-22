<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import { useUnsavedForm } from '../../app/use-unsaved-form';
import {
  getLead,
  getLeadEditContext,
  updateLead,
  type LeadDetail,
  type LeadFormContext,
} from '../../api/leads';
import LeadForm, { type LeadFormSubmission } from './LeadForm.vue';

const route = useRoute();
const router = useRouter();
const state = ref<'loading' | 'ready' | 'missing' | 'denied' | 'failed'>(
  'loading',
);
const lead = ref<LeadDetail>();
const context = ref<LeadFormContext>();
const saving = ref(false);
const submitError = ref('');
const isDirty = ref(false);
let request: AbortController | undefined;

useUnsavedForm(isDirty);
async function load(): Promise<void> {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  state.value = 'loading';
  try {
    const current = await getLead(String(route.params.id), {
      signal: controller.signal,
    });
    if (controller.signal.aborted) return;
    lead.value = current;
    if (!current.capabilities.edit) {
      state.value = 'denied';
      return;
    }
    const formContext = await getLeadEditContext(current.id, {
      signal: controller.signal,
    });
    if (controller.signal.aborted) return;
    context.value = formContext;
    state.value = 'ready';
  } catch (error) {
    if (controller.signal.aborted) return;
    state.value =
      error instanceof ApiError && error.code === 'RESOURCE_NOT_FOUND'
        ? 'missing'
        : 'failed';
  }
}
async function submit(value: LeadFormSubmission): Promise<void> {
  if (saving.value || !lead.value) return;
  saving.value = true;
  submitError.value = '';
  try {
    await updateLead(lead.value.id, {
      caseType: value.fields.caseType,
      infringementTypes: [...value.fields.infringementTypes],
      source: value.fields.source,
      platform: value.fields.platform,
      foundAt: value.fields.foundAt,
      shopName: value.fields.shopName,
      ...(value.fields.shopExternalId === undefined
        ? {}
        : { shopExternalId: value.fields.shopExternalId }),
      needDisclose: value.fields.needDisclose,
      ...(value.fields.remark === undefined
        ? {}
        : { remark: value.fields.remark }),
      products: value.fields.products.map((product) => ({ ...product })),
      expectedVersion: lead.value.version,
      leadScreenshotContentVersionIds: [
        ...lead.value.leadScreenshotContentVersionIds,
      ],
    });
    isDirty.value = false;
    await router.push(`/leads/${lead.value.id}`);
  } catch (error) {
    submitError.value =
      error instanceof ApiError && error.code === 'VERSION_CONFLICT'
        ? '线索已被他人更新，请返回详情刷新后再编辑'
        : '线索修改没有保存成功，请保留当前内容后重试';
  } finally {
    saving.value = false;
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
          <span class="pill">待推送</span>
          <h1>编辑线索</h1>
        </div>
        <RouterLink class="back-link" :to="`/leads/${String(route.params.id)}`"
          >返回线索详情</RouterLink
        >
      </div>
      <section v-if="state === 'loading'" class="state-panel ledger-panel">
        <h1>正在读取线索</h1>
      </section>
      <section v-else-if="state === 'missing'" class="state-panel ledger-panel">
        <h1>线索不存在或当前不可访问</h1>
      </section>
      <section v-else-if="state === 'denied'" class="state-panel ledger-panel">
        <h1>当前线索不可编辑</h1>
        <p>只有后端明确授予编辑能力的待推送线索可修改。</p>
      </section>
      <section v-else-if="state === 'failed'" class="state-panel ledger-panel">
        <h1>编辑表单暂时无法加载</h1>
        <ElButton @click="load">重新加载</ElButton>
      </section>
      <template v-else-if="lead && context">
        <p v-if="submitError" class="submit-error" role="alert">
          {{ submitError }}
        </p>
        <LeadForm
          :context="context"
          :initial-value="lead"
          customer-locked
          :allow-screenshots="false"
          :submitting="saving"
          submit-label="保存修改"
          @dirty="isDirty = true"
          @submit="submit"
          ><template #cancel
            ><RouterLink :to="`/leads/${lead.id}`">取消</RouterLink></template
          ></LeadForm
        ></template
      >
    </main>
  </div>
</template>
