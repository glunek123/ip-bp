<script setup lang="ts">
import { computed } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ElCheckbox } from 'element-plus/es/components/checkbox/index.mjs';
import type { LeadFormContext } from '../../api/leads';
import type { LeadCsvParsedRow, LeadCsvPreview } from './lead-csv-preview';
import {
  labelLeadPlatform,
  leadCaseTypeLabels,
  leadInfringementTypeLabels,
  leadSourceLabels,
} from './lead-options';

const props = defineProps<{
  snapshot: LeadCsvPreview;
  formContext?: LeadFormContext;
}>();

const emit = defineEmits<{
  selectRows: [request: { generation: number; rowNumbers: number[] }];
  acknowledgeDuplicate: [
    request: { generation: number; rowNumber: number },
  ];
  cancelRequest: [request: { generation: number }];
  confirmRequest: [request: { generation: number }];
}>();

type LeadNames = { customerName: string; rightsHolderName: string };

function resolveNames(
  customerId: string,
  rightsHolderId: string,
  context: LeadFormContext | undefined,
): LeadNames | null {
  if (!context) return null;
  const customers = context.customers.filter(
    (customer) => customer.id === customerId,
  );
  if (customers.length !== 1) return null;
  const customer = customers[0]!;
  const customerName = customer.name.trim();
  // 同名客户可能被重复建档，按 id 命中即可，不再要求名称全表唯一
  if (!customerName) return null;

  const rightsHolders = customer.rightsHolders.filter(
    (rightsHolder) => rightsHolder.id === rightsHolderId,
  );
  if (rightsHolders.length !== 1) return null;
  const rightsHolderName = rightsHolders[0]!.name.trim();
  if (!rightsHolderName) return null;

  return { customerName, rightsHolderName };
}

function canConfirm(
  snapshot: LeadCsvPreview,
  context: LeadFormContext | undefined,
): boolean {
  if (snapshot.phase !== 'ready' || snapshot.selectedRowNumbers.length === 0)
    return false;
  const validRowNumbers = new Set(
    snapshot.rows
      .filter(
        (row) =>
          row.status === 'valid' &&
          resolveNames(row.input.customerId, row.input.rightsHolderId, context),
      )
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
    !resolveNames(
      row.input.customerId,
      row.input.rightsHolderId,
      props.formContext,
    ) ||
    !snapshot.rows.some(
      (current) =>
        current.rowNumber === row.rowNumber &&
        current.status === 'valid' &&
        current.input.customerId === row.input.customerId &&
        current.input.rightsHolderId === row.input.rightsHolderId &&
        resolveNames(
          current.input.customerId,
          current.input.rightsHolderId,
          props.formContext,
        ),
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
  if (
    generation !== props.snapshot.generation ||
    !canConfirm(props.snapshot, props.formContext)
  )
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
    canConfirm: canConfirm(snapshot, props.formContext),
    totalCount: snapshot.rows.length,
    validCount: snapshot.rows.filter((row) => row.status === 'valid').length,
    problemCount: snapshot.rows.filter(
      (row) =>
        row.status === 'invalid' ||
        ((row.shopDuplicates?.length ?? 0) > 0 &&
          row.shopDuplicateAcknowledged !== true),
    ).length,
    rows: snapshot.rows.map((row) => ({
      row,
      names:
        row.status === 'valid'
          ? resolveNames(
              row.input.customerId,
              row.input.rightsHolderId,
              props.formContext,
            )
          : null,
      shopDuplicates:
        row.status === 'valid' ? (row.shopDuplicates ?? []) : [],
      duplicateBlocked:
        row.status === 'valid' &&
        (row.shopDuplicates?.length ?? 0) > 0 &&
        row.shopDuplicateAcknowledged !== true,
      acknowledge: () =>
        emit('acknowledgeDuplicate', { generation, rowNumber: row.rowNumber }),
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
    v-if="display.phase !== 'empty' && display.phase !== 'closed'"
    class="lead-csv-preview"
    data-test="lead-csv-preview"
  >
    <p v-if="display.fileName" data-test="csv-file-name">
      当前文件：{{ display.fileName }}
    </p>

    <p v-else-if="display.phase === 'reading'" aria-live="polite">
      正在读取当前文件…
    </p>
    <p v-else-if="display.phase === 'error'" role="alert" data-test="csv-error">
      文件读取失败，当前预览已清除。请重新选择文件。
    </p>
    <p
      v-else-if="display.phase === 'ready' && display.rows.length === 0"
      data-test="csv-no-rows"
    >
      <template v-if="display.validCount > 0">
        全部 {{ display.validCount }} 行校验通过，已自动选中，点「导入」即可。
      </template>
      <template v-else> 当前文件没有可预览的行。 </template>
    </p>

    <template v-if="display.phase === 'ready' && display.rows.length > 0">
      <p data-test="csv-selection-help" class="lead-csv-preview__summary">
        共 {{ display.totalCount }} 行，其中
        <strong>{{ display.validCount }}</strong> 行可直接导入，
        <strong v-if="display.problemCount > 0" class="is-problem">{{
          display.problemCount
        }}</strong>
        <strong v-else>0</strong> 行需要处理。
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
                displayRow.row.status === 'invalid' ||
                !displayRow.names ||
                displayRow.duplicateBlocked
                  ? 'true'
                  : undefined
              "
            >
              <th scope="row">{{ displayRow.row.rowNumber }}</th>
              <td>
                <div
                  v-if="displayRow.row.status === 'valid' && displayRow.names"
                  class="lead-csv-preview__select"
                >
                  <ElCheckbox
                    data-test="csv-row-selection"
                    :model-value="displayRow.selected"
                    :aria-label="`选择第 ${displayRow.row.rowNumber} 行线索`"
                    @change="displayRow.change"
                  />
                </div>
                <span
                  v-else-if="displayRow.row.status === 'valid' && displayRow.duplicateBlocked"
                  class="lead-csv-preview__duplicate-block"
                >
                  <span data-test="csv-row-duplicate-blocked">店铺重复</span>
                  <button
                    type="button"
                    data-test="csv-acknowledge-duplicate"
                    @click="displayRow.acknowledge()"
                  >
                    确认仍要导入
                  </button>
                </span>
                <span v-else-if="displayRow.row.status === 'valid'">
                  <span data-test="csv-row-unavailable">
                    客户或权利主体不可用
                  </span>
                </span>
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
                  v-if="displayRow.shopDuplicates.length > 0"
                  class="lead-csv-preview__duplicates"
                  data-test="csv-shop-duplicate-list"
                  aria-label="店铺重复提示"
                >
                  <li
                    v-for="(dup, index) in displayRow.shopDuplicates"
                    :key="`${index}:${dup.leadBusinessNo}`"
                  >
                    店铺重复：与{{
                      dup.caseBusinessNo
                        ? `案件 ${dup.caseBusinessNo}`
                        : `线索 ${dup.leadBusinessNo}`
                    }}的「{{ dup.shopName }}」相同{{
                      displayRow.duplicateBlocked ? '' : '（已确认）'
                    }}
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
                  <dt>客户</dt>
                  <dd>{{ displayRow.names?.customerName ?? '不可用' }}</dd>
                  <dt>权利主体</dt>
                  <dd>{{ displayRow.names?.rightsHolderName ?? '不可用' }}</dd>
                  <dt>案件类型</dt>
                  <dd>
                    {{ leadCaseTypeLabels[displayRow.row.input.caseType] }}
                  </dd>
                  <dt>侵权类型</dt>
                  <dd>
                    {{
                      displayRow.row.input.infringementTypes
                        .map((type) => leadInfringementTypeLabels[type])
                        .join('、')
                    }}
                  </dd>
                  <dt>线索来源</dt>
                  <dd>{{ leadSourceLabels[displayRow.row.input.source] }}</dd>
                  <dt>平台</dt>
                  <dd>
                    {{ labelLeadPlatform(displayRow.row.input.platform) }}
                  </dd>
                  <dt>发现时间</dt>
                  <dd>{{ formatTime(displayRow.row.input.foundAt) }}</dd>
                  <dt>店铺名称</dt>
                  <dd>{{ displayRow.row.input.shopName }}</dd>
                  <dt>店铺外部 ID</dt>
                  <dd>{{ displayRow.row.input.shopExternalId }}</dd>
                  <dt>披露标记</dt>
                  <dd>{{ displayRow.row.input.needDisclose ? '是' : '否' }}</dd>
                  <dt>备注</dt>
                  <dd :title="displayRow.row.input.remark ?? ''">
                    {{ displayRow.row.input.remark }}
                  </dd>
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
                          <dt>商品链接</dt>
                          <dd :title="product.url ?? ''">{{ product.url }}</dd>
                          <dt>名称</dt>
                          <dd :title="product.title ?? ''">{{ product.title }}</dd>
                          <dt>销量</dt>
                          <dd>{{ product.quantity }}</dd>
                          <dt>单价</dt>
                          <dd>{{ product.unitPrice }}</dd>
                          <dt>评论数</dt>
                          <dd>{{ product.commentCount }}</dd>
                          <dt
                            v-if="
                              displayRow.row.remoteScreenshots?.some(
                                (group) => group.productNumber === index + 1,
                              )
                            "
                          >
                            待下载截图
                          </dt>
                          <dd
                            v-if="
                              displayRow.row.remoteScreenshots?.some(
                                (group) => group.productNumber === index + 1,
                              )
                            "
                          >
                            <ul>
                              <li
                                v-for="url in displayRow.row.remoteScreenshots?.find(
                                  (group) => group.productNumber === index + 1,
                                )?.urls ?? []"
                                :key="url"
                              >
                                {{ url }}
                              </li>
                            </ul>
                            导入线索后后台下载；失败时线索仍保留，图片在详情页标记待补。
                          </dd>
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

/* 表格：固定列宽，避免长内容把列挤变形 */
.lead-csv-preview :deep(.demo-table) {
  table-layout: fixed;
  width: 100%;
  border-collapse: collapse;
}

.lead-csv-preview :deep(.demo-table th:nth-child(1)) {
  width: 56px;
}

.lead-csv-preview :deep(.demo-table th:nth-child(2)) {
  width: 84px;
}

.lead-csv-preview :deep(.demo-table th:nth-child(3)) {
  width: 150px;
}

.lead-csv-preview :deep(.demo-table th),
.lead-csv-preview :deep(.demo-table td) {
  vertical-align: top;
  padding: 12px 10px;
  line-height: 1.5;
}

.lead-csv-preview :deep(.demo-table tbody tr + tr) {
  border-top: 1px solid var(--color-border-subtle, #eee);
}

/* 字段网格：标签固定窄列，值自适应 */
.lead-csv-preview__fields,
.lead-csv-preview__product-fields {
  display: grid;
  grid-template-columns: 84px minmax(0, 1fr);
  gap: 6px 12px;
  margin: 0;
  font-size: 13px;
}

.lead-csv-preview__fields dt,
.lead-csv-preview__product-fields dt {
  color: var(--color-ink-subtle);
  white-space: nowrap;
}

.lead-csv-preview__fields dd,
.lead-csv-preview__product-fields dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

/* 长 URL 最多显示 3 行，超出省略，避免单行拉满整屏 */
.lead-csv-preview__fields dd {
  max-height: 4.5em;
  overflow: hidden;
}

/* 商品块用浅底卡片区分 */
.lead-csv-preview__product-fields {
  margin: 8px 0 0;
  padding: 10px 12px;
  background: var(--color-surface-muted, #fafafa);
  border-radius: 6px;
}

.lead-csv-preview__fields ol {
  margin: 0;
  padding-left: 18px;
}

.lead-csv-preview__fields li + li {
  margin-top: 8px;
}

.lead-csv-preview__errors,
.lead-csv-preview__duplicates {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.6;
}

.lead-csv-preview__duplicates {
  margin-top: 6px;
  color: var(--color-warning-ink, #b26a00);
}

.lead-csv-preview__select {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.lead-csv-preview__duplicate-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--color-warning-ink, #b26a00);
}

.lead-csv-preview__duplicate-block button {
  align-self: flex-start;
  padding: 2px 8px;
  font-size: 12px;
  border: 1px solid currentcolor;
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
}
</style>
