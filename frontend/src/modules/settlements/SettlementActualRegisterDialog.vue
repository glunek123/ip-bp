<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import ElButton from 'element-plus/es/components/button/index';
import ElDialog from 'element-plus/es/components/dialog/index';
import ElInput from 'element-plus/es/components/input/index';
import ElOption from 'element-plus/es/components/select/index';
import ElSelect from 'element-plus/es/components/select/index';
import { listCases, listLawyerMatchCandidates } from '../../api/cases';
import { registerCaseSettlementActual } from '../../api/settlement-actual-registration';
import { ApiError } from '../../api/http';

type Side = 'CUSTOMER' | 'LAWYER';
const props = defineProps<{
  side: Side;
  open: boolean;
}>();
const emit = defineEmits<{ close: []; registered: [] }>();

const title = computed(() =>
  props.side === 'CUSTOMER' ? '登记实际回款' : '登记律师开票',
);

const keyword = ref('');
const options = ref<{ id: string; businessNo: string; stage: string }[]>([]);
const picked = ref<{ id: string; businessNo: string } | null>(null);
const occurredOn = ref('');
const amount = ref('');
const sourceReference = ref('');
const note = ref('');
const lawyers = ref<{ id: string; name: string }[]>([]);
const lawyerId = ref('');
const error = ref('');
const busy = ref(false);
let searchTimer: ReturnType<typeof setTimeout> | null = null;

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    keyword.value = '';
    options.value = [];
    picked.value = null;
    occurredOn.value = '';
    amount.value = '';
    sourceReference.value = '';
    note.value = '';
    lawyers.value = [];
    lawyerId.value = '';
    error.value = '';
  },
);

async function search(): Promise<void> {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    void runSearch();
  }, 250);
}
async function runSearch(): Promise<void> {
  const q = keyword.value.trim();
  if (!q) {
    options.value = [];
    return;
  }
  try {
    const result = await listCases(1, 20, { q, view: 'department' });
    options.value = result.items.map((item) => ({
      id: item.id,
      businessNo: item.businessNo,
      stage: item.stage,
    }));
  } catch {
    options.value = [];
  }
}
async function pick(option: { id: string; businessNo: string }): Promise<void> {
  picked.value = { id: option.id, businessNo: option.businessNo };
  options.value = [];
  keyword.value = option.businessNo;
  lawyers.value = [];
  lawyerId.value = '';
  if (props.side !== 'LAWYER') return;
  try {
    const rows = await listLawyerMatchCandidates(option.id);
    lawyers.value = rows.map((row) => ({
      id: row.lawyerAccountId,
      name: row.displayName ?? row.username,
    }));
  } catch {
    lawyers.value = [];
  }
}

async function submit(): Promise<void> {
  error.value = '';
  if (!picked.value) {
    error.value = '请选择案件';
    return;
  }
  if (!/^(?:0|[1-9]\d{0,15})\.\d{2}$/u.test(amount.value.trim())) {
    error.value = '金额需为不超过 2 位小数的数字';
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(occurredOn.value)) {
    error.value = '请选择实际发生日期';
    return;
  }
  if (props.side === 'LAWYER' && !lawyerId.value) {
    error.value = '请选择开票律师';
    return;
  }
  busy.value = true;
  try {
    const base = {
      caseId: picked.value.id,
      amount: amount.value.trim(),
      occurredOn: occurredOn.value,
      idempotencyKey: crypto.randomUUID(),
      ...(sourceReference.value.trim()
        ? { sourceReference: sourceReference.value.trim() }
        : {}),
      ...(note.value.trim() ? { note: note.value.trim() } : {}),
    };
    await registerCaseSettlementActual(
      props.side === 'LAWYER'
        ? { ...base, side: 'LAWYER', lawyerId: lawyerId.value }
        : { ...base, side: 'CUSTOMER' },
    );
    emit('registered');
    emit('close');
  } catch (caught) {
    error.value =
      caught instanceof ApiError ? caught.message : '登记失败，请稍后重试';
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
    @close="emit('close')"
  >
    <div class="actual-register">
      <label>
        案件
        <ElInput
          v-model="keyword"
          placeholder="输入案件编号、客户、店铺搜索"
          data-test="actual-case-search"
          @input="search"
        />
      </label>
      <ul v-if="options.length" class="actual-register__options">
        <li v-for="option in options" :key="option.id">
          <button type="button" @click="pick(option)">
            {{ option.businessNo }} · {{ option.stage }}
          </button>
        </li>
      </ul>
      <p v-if="picked" class="actual-register__picked">
        已选案件：{{ picked.businessNo }}
      </p>
      <label>
        实际发生日期
        <ElInput v-model="occurredOn" placeholder="YYYY-MM-DD" />
      </label>
      <label>
        实际金额（元）
        <ElInput v-model="amount" placeholder="如 1250.00" />
      </label>
      <label v-if="side === 'LAWYER'">
        开票律师
        <ElSelect v-model="lawyerId" placeholder="选择律师" class="w-full">
          <ElOption
            v-for="lawyer in lawyers"
            :key="lawyer.id"
            :label="lawyer.name"
            :value="lawyer.id"
          />
        </ElSelect>
      </label>
      <label>
        来源编号
        <ElInput v-model="sourceReference" placeholder="银行流水号 / 发票号" />
      </label>
      <label>
        备注
        <ElInput v-model="note" type="textarea" :rows="2" />
      </label>
      <p v-if="error" role="alert" class="actual-register__error">{{ error }}</p>
    </div>
    <template #footer>
      <ElButton :disabled="busy" @click="emit('close')">取消</ElButton>
      <ElButton type="primary" :loading="busy" @click="submit">提交登记</ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.actual-register {
  display: grid;
  gap: 12px;
}
.actual-register label {
  display: grid;
  gap: 6px;
  font-size: 13px;
}
.actual-register__options {
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 180px;
  overflow: auto;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
}
.actual-register__options button {
  width: 100%;
  padding: 8px 10px;
  text-align: left;
  border: 0;
  background: transparent;
  cursor: pointer;
}
.actual-register__options button:hover {
  background: var(--el-fill-color-light);
}
.actual-register__picked {
  margin: 0;
  font-size: 13px;
  color: var(--el-color-primary);
}
.actual-register__error {
  margin: 0;
  color: var(--el-color-danger);
  font-size: 13px;
}
.w-full {
  width: 100%;
}
</style>
