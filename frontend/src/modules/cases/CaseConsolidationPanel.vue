<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import type { CaseSummary } from '../../api/cases';
import { ApiError } from '../../api/http';
import {
  createCaseConsolidation,
  previewCaseConsolidation,
  type ConsolidationInputMember,
  type ConsolidationPreview,
  type ConsolidationResult,
} from '../../api/case-consolidation';

const props = defineProps<{ items: CaseSummary[]; contextKey: string }>();
const emit = defineEmits<{ close: []; completed: [] }>();
type DraftRow = Pick<ConsolidationInputMember, 'caseId' | 'expectedVersion'> & {
  confirmed: boolean;
};
const rows = ref<DraftRow[]>([]);
const commonDefendant = ref<ConsolidationInputMember['defendant']>({
  kind: 'PERSON',
  name: '',
  idNo: '',
});
const chosenMainId = ref('');
const preview = ref<ConsolidationPreview | null>(null);
const result = ref<ConsolidationResult | null>(null);
const error = ref('');
const busy = ref(false);
let requestKey = '';
let generation = 0;

function reset() {
  generation += 1;
  rows.value = props.items.map((item) => ({
    caseId: item.id,
    expectedVersion: item.version,
    confirmed: false,
  }));
  commonDefendant.value = { kind: 'PERSON', name: '', idNo: '' };
  chosenMainId.value = '';
  preview.value = null;
  result.value = null;
  error.value = '';
  requestKey = '';
}
watch(
  () => [
    props.contextKey,
    ...props.items.map((item) => `${item.id}:${item.version}`),
  ],
  reset,
  { immediate: true },
);
const valid = computed(
  () =>
    rows.value.length >= 2 &&
    rows.value.length <= 20 &&
    props.items.length === rows.value.length &&
    props.items.every(
      (item) => item.stage === 'PENDING_MATCH' && item.canConsolidate,
    ) &&
    rows.value.every((row) => row.confirmed === true) &&
    Boolean(commonDefendant.value.name.trim()) &&
    Boolean(commonDefendant.value.idNo.trim()),
);
function changed() {
  preview.value = null;
  result.value = null;
  requestKey = '';
  error.value = '';
}
function message(cause: unknown) {
  return cause instanceof ApiError
    ? cause.message
    : '合案请求失败，请核对案件状态后重试。';
}
function confirmedMembers(): ConsolidationInputMember[] {
  return rows.value.map((row) => ({
    caseId: row.caseId,
    expectedVersion: row.expectedVersion,
    confirmed: true,
    defendant: { ...commonDefendant.value },
  }));
}
async function loadPreview() {
  if (!valid.value || busy.value) return;
  const turn = ++generation;
  busy.value = true;
  error.value = '';
  preview.value = null;
  try {
    const data = await previewCaseConsolidation({
      members: confirmedMembers(),
      ...(chosenMainId.value ? { mainCaseId: chosenMainId.value } : {}),
    });
    if (turn !== generation) return;
    preview.value = data;
    chosenMainId.value = data.mainCaseId;
    requestKey = globalThis.crypto.randomUUID();
  } catch (cause) {
    if (turn === generation) error.value = message(cause);
  } finally {
    if (turn === generation) busy.value = false;
  }
}
async function submit() {
  if (!preview.value || !requestKey || busy.value) return;
  const turn = ++generation;
  busy.value = true;
  error.value = '';
  try {
    const data = await createCaseConsolidation({
      members: confirmedMembers(),
      mainCaseId: preview.value.mainCaseId,
      idempotencyKey: requestKey,
    });
    if (turn !== generation) return;
    result.value = data;
    emit('completed');
  } catch (cause) {
    if (turn === generation) error.value = message(cause);
  } finally {
    if (turn === generation) busy.value = false;
  }
}
</script>

<template>
  <section class="consolidation-panel" aria-label="合并起诉">
    <header>
      <h3>合并起诉</h3>
      <ElButton @click="emit('close')">关闭</ElButton>
    </header>
    <p>
      仅待匹配案件可合案。请逐案核对同一实际被告的类型、姓名及证件号或统一社会信用代码。
    </p>
    <div class="consolidation-defendant">
      <label
        >被告类型<select v-model="commonDefendant.kind" @change="changed">
          <option value="PERSON">个人</option>
          <option value="ORGANIZATION">企业</option>
        </select></label
      >
      <label
        >被告姓名<input
          v-model.trim="commonDefendant.name"
          maxlength="200"
          @input="changed"
      /></label>
      <label
        >证件号／统一信用代码<input
          v-model.trim="commonDefendant.idNo"
          maxlength="100"
          @input="changed"
      /></label>
    </div>
    <div v-for="row in rows" :key="row.caseId" class="consolidation-row">
      <strong>{{
        items.find((item) => item.id === row.caseId)?.businessNo
      }}</strong>
      <span>版本 {{ row.expectedVersion }}</span>
      <span
        >原案被告：{{
          items
            .find((item) => item.id === row.caseId)
            ?.displaySummary.defendants.map((party) => party.name)
            .join('、') || '尚未录入，请核对来源资料'
        }}</span
      >
      <label
        ><input
          v-model="row.confirmed"
          type="checkbox"
          @change="changed"
        />已核对本案为上述同一被告</label
      >
    </div>
    <ElButton
      :disabled="!valid || busy"
      :loading="busy"
      data-test="preview-consolidation"
      @click="loadPreview"
      >核对合案</ElButton
    >
    <div
      v-if="preview"
      class="consolidation-preview"
      aria-label="合案提交前核对"
    >
      <p>
        参与 {{ preview.caseCount }} 件；平台 {{ preview.shop.platform }}；店铺
        ID {{ preview.shop.externalId }}
      </p>
      <label
        >主案<select v-model="chosenMainId" data-test="consolidation-main">
          <option v-for="item in preview.cases" :key="item.id" :value="item.id">
            {{ item.businessNo }}
          </option>
        </select></label
      >
      <p>主案编号：{{ preview.mainBusinessNo }}</p>
      <ol>
        <li v-for="item in preview.cases" :key="item.id">
          {{ item.businessNo }}（版本 {{ item.version }}）{{
            item.isMain ? '主案' : '并入'
          }}
        </li>
      </ol>
      <ElButton
        :disabled="busy || chosenMainId !== preview.mainCaseId"
        :loading="busy"
        type="primary"
        data-test="submit-consolidation"
        @click="submit"
        >确认合并起诉</ElButton
      >
    </div>
    <p v-if="result" role="status">
      已合案，主案
      <RouterLink :to="`/cases/${result.mainCaseId}`">{{
        result.mainBusinessNo
      }}</RouterLink
      >。原案与费用仍按原编号保留。
    </p>
    <p v-if="error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.consolidation-panel {
  border: 1px solid var(--color-border, #d9dfeb);
  border-radius: 12px;
  padding: 16px;
  display: grid;
  gap: 12px;
}
.consolidation-panel header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.consolidation-panel h3 {
  margin: 0;
}
.consolidation-row {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 8px 14px;
  border-top: 1px solid var(--color-border, #d9dfeb);
  padding-top: 12px;
}
.consolidation-defendant {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
}
.consolidation-defendant label {
  display: grid;
  gap: 4px;
}
.consolidation-row label {
  display: grid;
  gap: 4px;
}
.consolidation-defendant input,
.consolidation-defendant select,
.consolidation-preview select {
  min-height: 32px;
}
.consolidation-preview {
  display: grid;
  gap: 8px;
}
.consolidation-preview p,
.consolidation-preview ol {
  margin: 0;
}
</style>
