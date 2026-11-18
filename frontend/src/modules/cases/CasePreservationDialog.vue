<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import ElButton from 'element-plus/es/components/button/index';
import ElDialog from 'element-plus/es/components/dialog/index';
import ElInput from 'element-plus/es/components/input/index';
import { ApiError } from '../../api/http';
import {
  getCasePreservation,
  saveCasePreservation,
} from '../../api/case-preservation';

const props = defineProps<{ caseId: string; open: boolean }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const documentName = ref('');
const preservedOn = ref('');
const feeAmount = ref('');
const premiumAmount = ref('');
const recordedOn = ref('');
const error = ref('');
const busy = ref(false);

const title = computed(() =>
  recordedOn.value ? '保全登记（已登记，可更正）' : '保全登记',
);

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    documentName.value = '';
    preservedOn.value = '';
    feeAmount.value = '';
    premiumAmount.value = '';
    recordedOn.value = '';
    error.value = '';
    try {
      const current = await getCasePreservation(props.caseId);
      if (!current) return;
      documentName.value = current.documentName ?? '';
      preservedOn.value = current.preservedOn;
      feeAmount.value = current.feeAmount ?? '';
      premiumAmount.value = current.premiumAmount ?? '';
      recordedOn.value = current.recordedAt.slice(0, 10);
    } catch {
      error.value = '读取保全登记失败';
    }
  },
);

async function submit(): Promise<void> {
  error.value = '';
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(preservedOn.value)) {
    error.value = '请选择保全日期';
    return;
  }
  busy.value = true;
  try {
    await saveCasePreservation(props.caseId, {
      documentName: documentName.value.trim() || null,
      preservedOn: preservedOn.value,
    });
    emit('saved');
    emit('close');
  } catch (caught) {
    error.value =
      caught instanceof ApiError ? caught.message : '保存失败，请稍后重试';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <ElDialog
    :model-value="open"
    :title="title"
    width="560px"
    data-test="case-preservation-dialog"
    @close="emit('close')"
  >
    <div class="preservation">
      <label>
        保全文书
        <ElInput
          v-model="documentName"
          placeholder="填写保全文书名称或编号"
          data-test="preservation-document"
        />
      </label>
      <label>
        保全日期
        <ElInput
          v-model="preservedOn"
          placeholder="YYYY-MM-DD"
          data-test="preservation-date"
        />
      </label>
      <label>
        保全费（元）
        <p class="preservation__readonly" data-test="preservation-fee">
          {{ feeAmount || '0.00' }}
          <span class="preservation__hint">来自费用明细「保全费」</span>
        </p>
      </label>
      <label>
        保全保费（元）
        <p class="preservation__readonly" data-test="preservation-premium">
          {{ premiumAmount || '0.00' }}
          <span class="preservation__hint">来自费用明细「保全保费」</span>
        </p>
      </label>
      <p v-if="recordedOn" class="preservation__hint">
        登记时间：{{ recordedOn }}
      </p>
      <p v-if="error" role="alert" class="preservation__error">{{ error }}</p>
    </div>
    <template #footer>
      <ElButton :disabled="busy" @click="emit('close')">取消</ElButton>
      <ElButton
        type="primary"
        :loading="busy"
        data-test="preservation-save"
        @click="submit"
        >保存</ElButton
      >
    </template>
  </ElDialog>
</template>

<style scoped>
.preservation {
  display: grid;
  gap: 12px;
}
.preservation label {
  display: grid;
  gap: 6px;
  font-size: 13px;
}
.preservation__readonly {
  margin: 0;
  padding: 6px 0;
  font-size: 14px;
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.preservation__hint {
  margin: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.preservation__error {
  margin: 0;
  font-size: 13px;
  color: var(--el-color-danger);
}
</style>
