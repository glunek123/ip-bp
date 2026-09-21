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
import LeadForm, { type LeadFormSubmission } from './LeadForm.vue';

const router = useRouter();
const state = ref<'loading' | 'ready' | 'failed'>('loading');
const context = ref<LeadFormContext>();
const saving = ref(false);
const submitError = ref('');
const progress = ref('');
const uploadIds = new Map<InstanceType<typeof globalThis.File>, string>();
let reservedLeadId: string | undefined;
let request: AbortController | undefined;
const idempotencyKey = makeKey();

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
  <div class="workspace-shell">
    <header class="workspace-header">
      <RouterLink class="workspace-brand" to="/leads"
        ><span class="workspace-mark">品知</span
        ><span>品维·知产业务管理</span></RouterLink
      ><span class="workspace-context">运营端 · 新建线索</span>
    </header>
    <main class="workspace-main workspace-main--narrow">
      <RouterLink class="back-link" to="/leads">← 返回线索列表</RouterLink>
      <section v-if="state === 'loading'" class="state-panel ledger-panel">
        <h1>正在准备线索表单</h1>
      </section>
      <section v-else-if="state === 'failed'" class="state-panel ledger-panel">
        <h1>线索表单暂时无法加载</h1>
        <ElButton @click="load">重新加载</ElButton>
      </section>
      <template v-else-if="context"
        ><div class="section-heading section-heading--form">
          <div>
            <p class="section-kicker">待推送</p>
            <h1>新建线索</h1>
            <p>填写业务事实并保存，暂不执行推送。</p>
          </div>
        </div>
        <p v-if="progress" class="operation-progress" aria-live="polite">
          {{ progress }}
        </p>
        <p v-if="submitError" class="submit-error" role="alert">
          {{ submitError }}
        </p>
        <LeadForm
          :context="context"
          :submitting="saving"
          submit-label="创建线索"
          @submit="submit"
          ><template #cancel
            ><RouterLink to="/leads">取消</RouterLink></template
          ></LeadForm
        >
      </template>
    </main>
  </div>
</template>
