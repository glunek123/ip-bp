<script setup lang="ts">
import { computed } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ElCheckbox } from 'element-plus/es/components/checkbox/index.mjs';
import type { LeadCsvParsedRow, LeadCsvPreview } from './lead-csv-preview';

const props = defineProps<{
  snapshot: LeadCsvPreview;
}>();

const emit = defineEmits<{
  selectRows: [request: { generation: number; rowNumbers: number[] }];
  cancelRequest: [request: { generation: number }];
  confirmRequest: [request: { generation: number }];
}>();

function canConfirm(snapshot: LeadCsvPreview): boolean {
  if (snapshot.phase !== 'ready' || snapshot.selectedRowNumbers.length === 0)
    return false;
  const validRowNumbers = new Set(
    snapshot.rows
      .filter((row) => row.status === 'valid')
      .map((row) => row.rowNumber),
  );
  return (
    new Set(snapshot.selectedRowNumbers).size ===
      snapshot.selectedRowNumbers.length &&
    snapshot.selectedRowNumbers.every((rowNumber) =>
      validRowNumbers.has(rowNumber),
    )
  );
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}

function changeSelection(
  row: LeadCsvParsedRow,
  generation: number,
  checkedValue: boolean | number | string,
): void {
  const { snapshot } = props;
  if (
    generation !== snapshot.generation ||
    snapshot.phase !== 'ready' ||
    row.status !== 'valid' ||
    !snapshot.rows.some(
      (current) =>
        current.rowNumber === row.rowNumber && current.status === 'valid',
    )
  )
    return;

  const selected = new Set(snapshot.selectedRowNumbers);
  if (checkedValue === true) selected.add(row.rowNumber);
  else selected.delete(row.rowNumber);
  const rowNumbers = snapshot.rows.flatMap((current) =>
    current.status === 'valid' && selected.has(current.rowNumber)
      ? [current.rowNumber]
      : [],
  );
  emit('selectRows', { generation, rowNumbers });
}

function requestCancel(generation: number): void {
  if (
    generation !== props.snapshot.generation ||
    props.snapshot.phase === 'closed'
  )
    return;
  emit('cancelRequest', { generation });
}

function requestConfirm(generation: number): void {
  if (generation !== props.snapshot.generation || !canConfirm(props.snapshot))
    return;
  emit('confirmRequest', { generation });
}

const display = computed(() => {
  const snapshot = props.snapshot;
  const generation = snapshot.generation;
  return {
    generation,
    phase: snapshot.phase,
    fileName: snapshot.fileName,
    canConfirm: canConfirm(snapshot),
    rows: snapshot.rows.map((row) => ({
      row,
      selected: snapshot.selectedRowNumbers.includes(row.rowNumber),
      key: `${generation}:${row.rowNumber}`,
      change: (checkedValue: boolean | number | string) =>
        changeSelection(row, generation, checkedValue),
    })),
    cancelListeners: { click: () => requestCancel(generation) },
    confirmListeners: { click: () => requestConfirm(generation) },
  };
});
</script>

<template>
  <section
    class="demo-card demo-card--pad lead-csv-preview"
    aria-labelledby="lead-csv-preview-title"
    data-test="lead-csv-preview"
  >
    <h2 id="lead-csv-preview-title">CSV 线索预览</h2>
    <p v-if="display.fileName" data-test="csv-file-name">
      当前文件：{{ display.fileName }}
    </p>

    <p v-if="display.phase === 'closed'" data-test="csv-closed">预览已关闭。</p>
    <p v-else-if="display.phase === 'empty'" data-test="csv-empty">
      尚未选择 CSV 文件。
    </p>
    <p v-else-if="display.phase === 'reading'" aria-live="polite">
      正在读取当前 CSV 文件…
    </p>
    <p v-else-if="display.phase === 'error'" role="alert" data-test="csv-error">
      文件读取失败，当前预览已清除。请重新选择文件。
    </p>
    <p
      v-else-if="display.phase === 'ready' && display.rows.length === 0"
      data-test="csv-no-rows"
    >
      当前文件没有可预览的行。
    </p>

    <template v-if="display.phase === 'ready' && display.rows.length > 0">
      <p data-test="csv-selection-help">
        逐行检查字段和校验结果，再选择要处理的有效线索。疑似重复提示仅供核对。
      </p>
      <div class="demo-table-wrap">
        <table class="demo-table">
          <caption class="lead-csv-preview__caption">
            当前文件的逐行校验和选择情况
          </caption>
          <thead>
            <tr>
              <th scope="col">文件行</th>
              <th scope="col">选择</th>
              <th scope="col">校验结果</th>
              <th scope="col">线索字段和商品</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="displayRow in display.rows"
              :key="displayRow.key"
              :data-test="`csv-row-${displayRow.row.rowNumber}`"
              :aria-disabled="
                displayRow.row.status === 'invalid' ? 'true' : undefined
              "
            >
              <th scope="row">{{ displayRow.row.rowNumber }}</th>
              <td>
                <div
                  v-if="displayRow.row.status === 'valid'"
                  class="lead-csv-preview__select"
                >
                  <ElCheckbox
                    data-test="csv-row-selection"
                    :model-value="displayRow.selected"
                    :aria-label="`选择第 ${displayRow.row.rowNumber} 行线索`"
                    @change="displayRow.change"
                  />
                </div>
                <span v-else>不可选</span>
              </td>
              <td>
                <span v-if="displayRow.row.status === 'valid'">有效</span>
                <ul
                  v-else
                  class="lead-csv-preview__errors"
                  aria-label="逐行错误"
                >
                  <li
                    v-for="(error, index) in displayRow.row.errors"
                    :key="`${index}:${error}`"
                  >
                    {{ error }}
                  </li>
                </ul>
                <ul
                  v-if="
                    displayRow.row.status === 'valid' &&
                    displayRow.row.suspectedDuplicates.length > 0
                  "
                  class="lead-csv-preview__duplicates"
                  aria-label="疑似重复提示"
                >
                  <li
                    v-for="(hint, index) in displayRow.row.suspectedDuplicates"
                    :key="`${index}:${hint}`"
                  >
                    疑似重复：{{ hint }}
                  </li>
                </ul>
              </td>
              <td>
                <dl
                  v-if="displayRow.row.status === 'valid'"
                  class="lead-csv-preview__fields"
                >
                  <dt>客户 ID</dt>
                  <dd>{{ displayRow.row.input.customerId }}</dd>
                  <dt>权利主体 ID</dt>
                  <dd>{{ displayRow.row.input.rightsHolderId }}</dd>
                  <dt>案件类型</dt>
                  <dd>{{ displayRow.row.input.caseType }}</dd>
                  <dt>侵权类型</dt>
                  <dd>
                    {{ displayRow.row.input.infringementTypes.join('、') }}
                  </dd>
                  <dt>线索来源</dt>
                  <dd>{{ displayRow.row.input.source }}</dd>
                  <dt>平台</dt>
                  <dd>{{ displayRow.row.input.platform }}</dd>
                  <dt>发现时间</dt>
                  <dd>{{ formatTime(displayRow.row.input.foundAt) }}</dd>
                  <dt>店铺名称</dt>
                  <dd>{{ displayRow.row.input.shopName }}</dd>
                  <dt>店铺外部 ID</dt>
                  <dd>{{ displayRow.row.input.shopExternalId }}</dd>
                  <dt>披露标记</dt>
                  <dd>{{ displayRow.row.input.needDisclose ? '是' : '否' }}</dd>
                  <dt>备注</dt>
                  <dd>{{ displayRow.row.input.remark }}</dd>
                  <dt>商品明细</dt>
                  <dd>
                    <ol>
                      <li
                        v-for="(product, index) in displayRow.row.input
                          .products"
                        :key="index"
                      >
                        <span>商品 {{ index + 1 }}</span>
                        <dl class="lead-csv-preview__product-fields">
                          <dt>URL</dt>
                          <dd>{{ product.url }}</dd>
                          <dt>名称</dt>
                          <dd>{{ product.title }}</dd>
                          <dt>销量</dt>
                          <dd>{{ product.quantity }}</dd>
                          <dt>单价</dt>
                          <dd>{{ product.unitPrice }}</dd>
                          <dt>评论数</dt>
                          <dd>{{ product.commentCount }}</dd>
                        </dl>
                      </li>
                    </ol>
                  </dd>
                  <dt>截图版本 ID</dt>
                  <dd>
                    <ul>
                      <li
                        v-for="contentVersionId in displayRow.row.input
                          .leadScreenshotContentVersionIds"
                        :key="contentVersionId"
                      >
                        {{ contentVersionId }}
                      </li>
                    </ul>
                  </dd>
                </dl>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!display.canConfirm" data-test="csv-selection-required">
        先明确选择至少一条有效线索。
      </p>
      <ElButton
        key="confirm"
        native-type="button"
        data-test="csv-confirm-request"
        :disabled="!display.canConfirm"
        v-on="display.confirmListeners"
      >
        请求确认所选线索
      </ElButton>
    </template>

    <ElButton
      key="cancel"
      native-type="button"
      data-test="csv-cancel-request"
      :disabled="display.phase === 'closed'"
      v-on="display.cancelListeners"
    >
      取消预览
    </ElButton>
  </section>
</template>

<style scoped>
.lead-csv-preview__caption {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.lead-csv-preview__fields,
.lead-csv-preview__product-fields {
  display: grid;
  grid-template-columns: minmax(100px, max-content) minmax(180px, 1fr);
  gap: 4px 10px;
  margin: 0;
}

.lead-csv-preview__fields dt,
.lead-csv-preview__product-fields dt {
  color: var(--color-ink-subtle);
}

.lead-csv-preview__fields dd,
.lead-csv-preview__product-fields dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.lead-csv-preview__product-fields {
  margin: 6px 0 12px;
}

.lead-csv-preview__errors,
.lead-csv-preview__duplicates {
  margin: 0;
  padding-left: 18px;
}

.lead-csv-preview__duplicates {
  margin-top: 6px;
}

.lead-csv-preview__select {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
</style>
