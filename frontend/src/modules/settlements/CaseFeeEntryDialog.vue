<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ElDialog } from 'element-plus/es/components/dialog/index.mjs';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ElInput } from 'element-plus/es/components/input/index.mjs';
import {
  ElSelect,
  ElOption,
} from 'element-plus/es/components/select/index.mjs';
import { ApiError } from '../../api/http';
import { createCaseFeeEntries } from '../../api/settlements';
import { todayShanghai } from '../../api/cases';
import { useAuthStore } from '../../stores/auth';
import {
  loadFinancialPending,
  storeFinancialPending,
  clearFinancialPending,
  isPendingCaseFees,
} from './financial-pending';
const props = defineProps<{ caseId: string; canCreate: boolean }>();
const open = defineModel<boolean>('open', { default: false });
const emit = defineEmits<{ saved: [] }>();
const types = [
  '诉讼费',
  '保全费',
  '保全保费',
  '公告费',
  '调档费',
  '调查费',
  '公证费',
  '披露费',
  '样品费',
  '样品费退款',
  '退货运费',
  '律师费',
  '诉讼退费',
  '其他',
];
type DraftRow = {
  id: string;
  type: string;
  direction: '收入' | '支出';
  status: string;
  amount: string;
  note: string;
};
function row(): DraftRow {
  return {
    id: globalThis.crypto.randomUUID(),
    type: '诉讼费',
    direction: '支出',
    status: '未发起',
    amount: '',
    note: '',
  };
}
const rows = ref<DraftRow[]>([row()]);
const date = ref(todayShanghai());
const saving = ref(false);
const error = ref('');
const unknown = ref(false);
let pending: Parameters<typeof createCaseFeeEntries>[0] | null = null;
const disabled = computed(() => saving.value || unknown.value);
const auth = useAuthStore();
const scope = computed(
  () =>
    `${auth.session?.user.id ?? ''}:${auth.session?.department?.id ?? ''}:case-fees:${props.caseId}`,
);
watch(
  scope,
  () => {
    try {
      pending = loadFinancialPending(scope.value, 'entries', isPendingCaseFees);
      if (pending && pending.caseId !== props.caseId)
        throw new Error('原费用批次与当前案件不一致');
      unknown.value = pending !== null;
      if (pending) {
        rows.value = pending.rows.map((item) => ({
          id: globalThis.crypto.randomUUID(),
          type: item.type,
          direction: item.direction,
          status: item.status,
          amount: item.amount,
          note: item.note ?? '',
        }));
        date.value = pending.rows[0]!.feeDate;
        open.value = true;
      }
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '原批次恢复失败';
    }
  },
  { immediate: true },
);
let active = true;
onBeforeUnmount(() => {
  active = false;
});
function statuses(type: string): string[] {
  return type === '诉讼退费'
    ? ['退原告', '退律所']
    : ['未发起', '发起', '已支付'];
}
function changeType(draft: DraftRow, value: unknown): void {
  if (typeof value !== 'string') return;
  draft.type = value;
  if (!statuses(value).includes(draft.status))
    draft.status = statuses(value)[0]!;
}
function beforeClose(done: () => void): void {
  if (!disabled.value) done();
}
async function save(): Promise<void> {
  if (saving.value || !props.canCreate) return;
  saving.value = true;
  error.value = '';
  const originalScope = scope.value;
  let submitted = false;
  try {
    if (pending === null) {
      const key = globalThis.crypto.randomUUID();
      const entries = rows.value.filter(
        (draft) =>
          draft.amount.trim() !== '' &&
          !/^0(?:\.0{1,2})?$/u.test(draft.amount.trim()),
      );
      if (entries.length === 0) throw new Error('请至少填写一笔正金额费用');
      if (
        entries.some(
          (draft) =>
            !/^(?:[1-9]\d{0,15}(?:\.\d{1,2})?|0\.(?:0[1-9]|[1-9]\d))$/u.test(
              draft.amount.trim(),
            ),
        )
      )
        throw new Error('费用金额须为正数，最多16位整数与2位小数');
      pending = {
        caseId: props.caseId,
        idempotencyKey: key,
        rows: entries.map((draft) => ({
          caseId: props.caseId,
          type: draft.type,
          direction: draft.direction,
          status: draft.status,
          amount: draft.amount.trim(),
          feeDate: date.value,
          note: draft.note.trim(),
          idempotencyKey: `${key}:${draft.id}`,
        })),
      };
    }
    storeFinancialPending(originalScope, 'entries', pending);
    submitted = true;
    const original = pending;
    await createCaseFeeEntries(original);
    if (!active) return;
    clearFinancialPending(originalScope, 'entries', original);
    pending = null;
    unknown.value = false;
    open.value = false;
    rows.value = [row()];
    emit('saved');
  } catch (cause) {
    if (!active) return;
    if (
      cause instanceof ApiError &&
      [400, 401, 403, 404, 409, 413, 415, 422].includes(cause.status)
    ) {
      if (pending) clearFinancialPending(originalScope, 'entries', pending);
      pending = null;
    }
    if (!submitted) pending = null;
    unknown.value = pending !== null;
    error.value = cause instanceof Error ? cause.message : '费用批次保存失败';
  } finally {
    saving.value = false;
  }
}
</script>
<template>
  <ElDialog
    v-model="open"
    title="添加案件费用"
    width="min(1050px,94vw)"
    :before-close="beforeClose"
    :close-on-click-modal="!disabled"
    :close-on-press-escape="!disabled"
  >
    <form class="case-fee-entry" @submit.prevent="save">
      <p>可一次添加多笔。空行和零金额不保存；所有有效行统一提交。</p>
      <label
        >费用日期<ElInput v-model="date" type="date" :disabled="disabled"
      /></label>
      <div
        v-for="(draft, index) in rows"
        :key="draft.id"
        class="case-fee-entry__row"
        :aria-label="`第${index + 1}笔费用`"
      >
        <label
          >费用类型<ElSelect
            :model-value="draft.type"
            :disabled="disabled"
            @update:model-value="changeType(draft, $event)"
            ><ElOption
              v-for="type in types"
              :key="type"
              :value="type"
              :label="type" /></ElSelect></label
        ><label
          >方向<ElSelect v-model="draft.direction" :disabled="disabled"
            ><ElOption value="支出" label="支出" /><ElOption
              value="收入"
              label="收入" /></ElSelect></label
        ><label
          >金额（元）<ElInput
            v-model="draft.amount"
            inputmode="decimal"
            :disabled="disabled" /></label
        ><label
          >状态<ElSelect v-model="draft.status" :disabled="disabled"
            ><ElOption
              v-for="status in statuses(draft.type)"
              :key="status"
              :value="status"
              :label="status" /></ElSelect></label
        ><label
          >备注<ElInput
            v-model="draft.note"
            :maxlength="500"
            :disabled="disabled" /></label
        ><ElButton :disabled="disabled" @click="rows.splice(index, 1)"
          >移除此行</ElButton
        >
      </div>
      <ElButton :disabled="disabled" @click="rows.push(row())"
        >再添加一笔</ElButton
      >
      <p v-if="error" role="alert">{{ error }}</p>
      <p v-if="unknown" role="status">
        保存结果尚未确认，重试使用原批次和每行的原请求身份。
      </p>
      <ElButton native-type="submit" type="primary" :loading="saving">{{
        unknown ? '用原批次重试' : '保存全部费用'
      }}</ElButton>
    </form></ElDialog
  >
</template>
<style scoped>
.case-fee-entry {
  display: grid;
  gap: 16px;
}
.case-fee-entry label {
  display: grid;
  gap: 4px;
}
.case-fee-entry__row {
  display: grid;
  grid-template-columns: 1.2fr 0.7fr 1fr 1fr 1.2fr auto;
  gap: 8px;
  align-items: end;
  border-bottom: 1px solid var(--color-hairline);
  padding-bottom: 12px;
}
@media (max-width: 760px) {
  .case-fee-entry__row {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
