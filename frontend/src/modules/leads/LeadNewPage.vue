<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import {
  createLead,
  getLeadFormContext,
  type LeadFormContext,
} from '../../api/leads';
import { uploadMaterialFile } from '../../api/materials';
import { useUnsavedForm } from '../../app/use-unsaved-form';
import LeadForm, { type LeadFormSubmission } from './LeadForm.vue';

const router = useRouter();
const state = ref<'loading' | 'ready' | 'failed'>('loading');
const context = ref<LeadFormContext>();
const saving = ref(false);
const submitError = ref('');
const progress = ref('');
const isDirty = ref(false);
const uploadIds = new Map<InstanceType<typeof globalThis.File>, string>();
let reservedLeadId: string | undefined;
let request: AbortController | undefined;
const idempotencyKey = makeKey();

useUnsavedForm(isDirty);

function makeKey(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `lead-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}
async function load(): Promise<void> {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  state.value = 'loading';
  try {
    context.value = await getLeadFormContext({ signal: controller.signal });
    if (!controller.signal.aborted) state.value = 'ready';
  } catch {
    if (!controller.signal.aborted) state.value = 'failed';
  }
}
async function submit(value: LeadFormSubmission): Promise<void> {
  if (saving.value) return;
  saving.value = true;
  submitError.value = '';
  try {
    for (const [index, file] of value.screenshotFiles.entries()) {
      if (uploadIds.has(file)) continue;
      progress.value = `正在上传 ${file.name}（${index + 1}/${value.screenshotFiles.length}）`;
      const uploaded = await uploadMaterialFile({
        ownerType: 'LEAD_DRAFT',
        ...(reservedLeadId ? { ownerId: reservedLeadId } : {}),
        category: 'LEAD_SCREENSHOT',
        purpose: 'LEAD_SCREENSHOT',
        file,
      });
      if (!uploaded.reservedOwnerId)
        throw new ApiError('服务未返回预留线索', 200, 'INVALID_RESPONSE');
      if (reservedLeadId && uploaded.reservedOwnerId !== reservedLeadId)
        throw new ApiError('预留线索不一致', 200, 'INVALID_RESPONSE');
      reservedLeadId = uploaded.reservedOwnerId;
      uploadIds.set(file, uploaded.contentVersionId);
    }
    progress.value = '正在保存线索';
    const contentVersionIds: string[] = [];
    for (const file of value.screenshotFiles) {
      const contentVersionId = uploadIds.get(file);
      if (!contentVersionId)
        throw new ApiError('截图上传结果不完整', 200, 'INVALID_RESPONSE');
      contentVersionIds.push(contentVersionId);
    }
    const created = await createLead(
      {
        ...value.fields,
        ...(reservedLeadId ? { reservedLeadId } : {}),
        leadScreenshotContentVersionIds: contentVersionIds,
      },
      idempotencyKey,
    );
    isDirty.value = false;
    await router.push(`/leads/${created.id}`);
  } catch (error) {
    submitError.value =
      error instanceof ApiError
        ? error.message
        : '线索没有保存成功，请保留当前内容后重试';
  } finally {
    saving.value = false;
    progress.value = '';
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
          <h1>新建线索</h1>
          <p>填写业务事实并保存，暂不执行推送。</p>
        </div>
        <RouterLink class="back-link" to="/leads">返回线索列表</RouterLink>
      </div>
      <section v-if="state === 'loading'" class="state-panel ledger-panel">
        <h1>正在准备线索表单</h1>
      </section>
      <section v-else-if="state === 'failed'" class="state-panel ledger-panel">
        <h1>线索表单暂时无法加载</h1>
        <ElButton @click="load">重新加载</ElButton>
      </section>
      <template v-else-if="context">
        <p v-if="progress" class="operation-progress" aria-live="polite">
          {{ progress }}
        </p>
        <p v-if="submitError" class="submit-error" role="alert">
          {{ submitError }}
        </p>
        <section
          v-if="context.customers.length === 0"
          class="ledger-panel state-panel"
          data-test="no-admitted-customers"
        >
          <h2>尚无已准入客户</h2>
          <p>线索只能关联已完成准入的客户，请先完成客户准入。</p>
          <RouterLink data-test="go-to-customers" to="/customers">
            <ElButton type="primary">去客户列表</ElButton>
          </RouterLink>
        </section>
        <LeadForm
          v-else
          :context="context"
          :submitting="saving"
          submit-label="创建线索"
          @dirty="isDirty = true"
          @submit="submit"
          ><template #cancel
            ><RouterLink to="/leads">取消</RouterLink></template
          ></LeadForm
        >
      </template>
    </main>
  </div>
</template>
