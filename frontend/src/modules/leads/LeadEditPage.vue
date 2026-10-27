<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import { uploadMaterialFile } from '../../api/materials';
import { useUnsavedForm } from '../../app/use-unsaved-form';
import {
  getLead,
  getLeadEditContext,
  updateLead,
  type LeadDetail,
  type LeadFormContext,
} from '../../api/leads';
import LeadForm, { type LeadFormSubmission } from './LeadForm.vue';
import { leadStatusCards } from './lead-options';

const route = useRoute();
const router = useRouter();
const allowedStatuses = new Set<string>(
  leadStatusCards.map((card) => card.status),
);
const returnsToList = computed(
  () => returnTo.value === '/leads' || returnTo.value.startsWith('/leads?'),
);
const returnTo = computed(() => {
  const raw = route.query.returnTo;
  if (
    typeof raw !== 'string' ||
    (raw !== '/leads' && !raw.startsWith('/leads?'))
  ) {
    return `/leads/${String(route.params.id)}`;
  }
  try {
    const url = new globalThis.URL(raw, 'https://internal.invalid');
    if (
      url.origin !== 'https://internal.invalid' ||
      url.pathname !== '/leads' ||
      url.hash ||
      raw.includes('\\')
    )
      return `/leads/${String(route.params.id)}`;
    const keys = [...url.searchParams.keys()];
    if (
      keys.some((key) => key !== 'page' && key !== 'status') ||
      new Set(keys).size !== keys.length
    )
      return `/leads/${String(route.params.id)}`;
    const page = url.searchParams.get('page');
    const status = url.searchParams.get('status');
    if (
      page !== null &&
      (!/^[1-9]\d*$/u.test(page) || !Number.isSafeInteger(Number(page)))
    ) {
      return `/leads/${String(route.params.id)}`;
    }
    if (status !== null && !allowedStatuses.has(status)) {
      return `/leads/${String(route.params.id)}`;
    }
    return `/leads${url.search}`;
  } catch {
    return `/leads/${String(route.params.id)}`;
  }
});
const state = ref<'loading' | 'ready' | 'missing' | 'denied' | 'failed'>(
  'loading',
);
const lead = ref<LeadDetail>();
const context = ref<LeadFormContext>();
const saving = ref(false);
const submitError = ref('');
const uncertainWrite = ref(false);
const isDirty = ref(false);
let request: AbortController | undefined;
const uploadIds = new Map<
  string,
  Map<InstanceType<typeof globalThis.File>, string>
>();

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
  const submittedLead = lead.value;
  const submittedLeadId = submittedLead.id;
  saving.value = true;
  submitError.value = '';
  try {
    const productScreenshots = new Map<string, string[]>();
    const pending = value.productScreenshotFiles.flatMap((item) =>
      item.files.map((file) => ({ productId: item.productId, file })),
    );
    for (const item of pending) {
      let productUploads = uploadIds.get(item.productId);
      if (!productUploads) {
        productUploads = new Map();
        uploadIds.set(item.productId, productUploads);
      }
      let versionId = productUploads.get(item.file);
      if (!versionId) {
        const uploaded = await uploadMaterialFile({
          ownerType: 'LEAD',
          ownerId: submittedLeadId,
          category: 'LEAD_SCREENSHOT',
          purpose: 'LEAD_SCREENSHOT',
          file: item.file,
        });
        versionId = uploaded.contentVersionId;
        productUploads.set(item.file, versionId);
      }
      if (
        String(route.params.id) !== submittedLeadId ||
        lead.value?.id !== submittedLeadId
      )
        return;
      productScreenshots.set(item.productId, [
        ...(productScreenshots.get(item.productId) ?? []),
        versionId,
      ]);
    }
    if (lead.value.version !== submittedLead.version)
      throw new ApiError(
        '线索已被他人更新，请刷新后再编辑',
        409,
        'VERSION_CONFLICT',
      );
    await updateLead(submittedLeadId, {
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
      products: value.fields.products.map((product) => ({
        ...product,
        screenshotContentVersionIds: [
          ...(product.screenshotContentVersionIds ?? []),
          ...(productScreenshots.get(product.id ?? '') ?? []),
        ],
      })),
      expectedVersion: submittedLead.version,
      leadScreenshotContentVersionIds: [
        ...submittedLead.leadScreenshotContentVersionIds,
      ],
    });
    isDirty.value = false;
    await router.push(returnTo.value);
  } catch (error) {
    uncertainWrite.value =
      !(error instanceof ApiError) ||
      error.status >= 500 ||
      error.code === 'INVALID_RESPONSE';
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
        <RouterLink class="back-link" :to="returnTo" data-test="edit-return">{{
          returnsToList ? '返回线索列表' : '返回线索详情'
        }}</RouterLink>
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
        <section
          v-if="uncertainWrite"
          class="state-panel ledger-panel"
          role="alert"
        >
          <h2>线索修改结果未确认</h2>
          <p>
            请返回详情刷新并核对商品截图，再继续操作。当前表单已锁定，不能重复提交。
          </p>
          <RouterLink :to="`/leads/${lead.id}`">返回线索详情</RouterLink>
        </section>
        <template v-else>
          <p v-if="submitError" class="submit-error" role="alert">
            {{ submitError }}
          </p>
          <LeadForm
            :context="context"
            :initial-value="lead"
            customer-locked
            :submitting="saving"
            submit-label="保存修改"
            @dirty="isDirty = true"
            @submit="submit"
            ><template #cancel
              ><RouterLink :to="returnTo" data-test="edit-cancel"
                >取消</RouterLink
              ></template
            ></LeadForm
          >
        </template>
      </template>
    </main>
  </div>
</template>
