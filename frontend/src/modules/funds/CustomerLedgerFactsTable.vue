<script setup lang="ts">
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { computed } from 'vue';
import type { CustomerSettlementRecord } from '../../api/customer-settlements';
import { formatSettlementAmount } from '../customers/customer-settlement-money';

const props = defineProps<{
  customerId: string;
  records: CustomerSettlementRecord[];
  canRead: boolean;
  loading: boolean;
  error: string;
}>();

const emit = defineEmits<{
  openRecord: [customerId: string, recordId: string];
}>();

const visibleRecords = computed(() =>
  props.canRead && !props.loading && !props.error
    ? props.records.filter(
        (record) => record.currentVersion.customerId === props.customerId,
      )
    : [],
);

function displayAmount(value: string | null): string {
  return value === null ? '未录入' : formatSettlementAmount(value);
}

function openRecord(record: CustomerSettlementRecord): void {
  if (!visibleRecords.value.includes(record)) return;
  emit('openRecord', props.customerId, record.id);
}
</script>

<template>
  <section
    class="ledger-panel demo-card--pad"
    data-test="customer-ledger-facts"
  >
    <h2>人工结算事实</h2>
    <p v-if="!canRead" data-test="ledger-forbidden" role="status">
      无权查看客户结算记录。
    </p>
    <p v-else-if="loading" data-test="ledger-loading" role="status">
      正在加载结算记录…
    </p>
    <p v-else-if="error" data-test="ledger-error" role="alert">{{ error }}</p>
    <p
      v-else-if="visibleRecords.length === 0"
      data-test="ledger-empty"
      role="status"
    >
      暂无人工结算记录。
    </p>
    <div v-else class="demo-table-wrap">
      <table class="demo-table" aria-label="客户人工结算事实">
        <thead>
          <tr>
            <th scope="col">结算日期</th>
            <th scope="col" class="num">结算金额</th>
            <th scope="col" class="num">开票金额</th>
            <th scope="col" class="num">回款金额</th>
            <th scope="col">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="record in visibleRecords"
            :key="record.id"
            data-test="ledger-record"
          >
            <td data-test="ledger-date">
              {{ record.currentVersion.settlementDate }}
            </td>
            <td class="num mono" data-test="ledger-settlement">
              {{ displayAmount(record.currentVersion.settlementAmount) }}
            </td>
            <td class="num mono" data-test="ledger-invoice">
              {{ displayAmount(record.currentVersion.invoiceAmount) }}
            </td>
            <td class="num mono" data-test="ledger-received">
              {{ displayAmount(record.currentVersion.receivedAmount) }}
            </td>
            <td>
              <ElButton
                native-type="button"
                link
                type="primary"
                data-test="ledger-open-record"
                @click="openRecord(record)"
              >
                查看记录
              </ElButton>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
