<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import {
  getCaseConsolidation,
  isConsolidationId,
  type ConsolidationTrace,
} from '../../api/case-consolidation';

const props = defineProps<{ caseId: string; contextKey: string }>();
const trace = ref<ConsolidationTrace | null>(null);
const error = ref('');
const uniqueSources = computed(() => {
  const cases = trace.value?.cases ?? [];
  return {
    products: new Set(
      cases.flatMap(
        (source) =>
          source.sourceLead?.products.map((product) => product.id) ?? [],
      ),
    ).size,
    versions: new Set(
      cases.flatMap((source) =>
        source.materials.flatMap((material) =>
          material.contentVersions.map((version) => version.id),
        ),
      ),
    ).size,
    fees: new Set(cases.flatMap((source) => source.feeRecordIds)).size,
  };
});
let request: AbortController | null = null;
watch(
  () => [props.caseId, props.contextKey],
  async () => {
    request?.abort();
    const controller = new AbortController();
    request = controller;
    trace.value = null;
    error.value = '';
    if (!isConsolidationId(props.caseId)) return;
    try {
      const result = await getCaseConsolidation(props.caseId, {
        signal: controller.signal,
      });
      if (!controller.signal.aborted) trace.value = result;
    } catch {
      if (!controller.signal.aborted)
        error.value = '合案来源读取失败，请刷新重试。';
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => request?.abort());
</script>

<template>
  <section v-if="trace" class="case-consolidation-trace" aria-label="合案来源">
    <h3>合案来源</h3>
    <p>
      主案
      <RouterLink :to="`/cases/${trace.mainCaseId}`">{{
        trace.cases.find((item) => item.caseId === trace?.mainCaseId)
          ?.businessNo
      }}</RouterLink
      >；共 {{ trace.caseCount }} 件。每案原编号、材料及费用仍按原来源保留。
    </p>
    <p>
      按原 ID 去重：商品 {{ uniqueSources.products }} 件、材料版本
      {{ uniqueSources.versions }} 份、原案费用记录
      {{ uniqueSources.fees }} 条；费用仍在原案办理。
    </p>
    <div
      v-for="source in trace.cases"
      :key="source.caseId"
      class="case-consolidation-source"
    >
      <h4>
        <RouterLink :to="`/cases/${source.caseId}`">{{
          source.businessNo
        }}</RouterLink>
        <small>{{ source.isMain ? '主案' : '并入案' }}</small>
      </h4>
      <p>
        被告：{{ source.defendant.name }}（{{
          source.defendant.kind === 'PERSON' ? '个人' : '企业'
        }}，{{ source.defendant.idNo }}）
      </p>
      <p v-if="source.sourceLead">
        线索：{{ source.sourceLead.businessNo }}；商品
        {{ source.sourceLead.products.length }} 件
      </p>
      <ul v-if="source.sourceLead?.products.length">
        <li v-for="product in source.sourceLead.products" :key="product.id">
          {{ product.title || '未命名商品' }}
          <span v-if="product.screenshots.length"
            >（截图 {{ product.screenshots.length }} 份）</span
          >
        </li>
      </ul>
      <p v-if="source.sourceNotaryMatter">
        公证：{{ source.sourceNotaryMatter.businessNo }}；精确材料版本
        {{ source.selectedMaterialVersions.length }} 份
      </p>
      <p>
        原案材料 {{ source.materials.length }} 份；立案已引用
        {{ source.filingReferences.length }} 份；原案费用记录
        {{ source.feeRecordIds.length }} 条。查看或办理费用请进入原案。
      </p>
      <ul v-if="source.materials.length">
        <li v-for="material in source.materials" :key="material.id">
          {{ material.category }}：{{
            material.contentVersions
              .map((version) => `${version.originalFilename}（${version.id}）`)
              .join('、')
          }}
        </li>
      </ul>
      <p v-if="source.selectedMaterialVersions.length">
        公证选材版本：{{
          source.selectedMaterialVersions
            .map((version) => version.contentVersionId)
            .join('、')
        }}
      </p>
      <ul v-if="source.feeRecordIds.length">
        <li v-for="feeId in source.feeRecordIds" :key="feeId">
          <RouterLink :to="`/cases/${source.caseId}?tab=fees`"
            >原案费用 {{ feeId }}</RouterLink
          >
        </li>
      </ul>
    </div>
  </section>
  <p v-else-if="error" role="alert">{{ error }}</p>
</template>

<style scoped>
.case-consolidation-trace {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--color-border, #d9dfeb);
  border-radius: 12px;
}
.case-consolidation-trace h3,
.case-consolidation-trace h4,
.case-consolidation-trace p,
.case-consolidation-trace ul {
  margin: 0;
}
.case-consolidation-source {
  display: grid;
  gap: 6px;
  padding-top: 10px;
  border-top: 1px solid var(--color-border, #d9dfeb);
}
</style>
