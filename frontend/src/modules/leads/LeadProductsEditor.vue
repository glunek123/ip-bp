<script setup lang="ts">
import { ref } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import type { LeadProduct, LeadProductInput } from '../../api/leads';

type Row = {
  key: string;
  id: string;
  title: string;
  url: string;
  quantity: string;
  unitPrice: string;
  commentCount: string;
  screenshotContentVersionIds: string[];
};

const props = defineProps<{
  products: readonly LeadProduct[];
  pending: boolean;
}>();
const emit = defineEmits<{ save: [LeadProductInput[]]; cancel: [] }>();

function toRow(product: LeadProduct): Row {
  return {
    key: product.id,
    id: product.id,
    title: product.title ?? '',
    url: product.url ?? '',
    quantity: String(product.quantity),
    unitPrice: product.unitPrice,
    commentCount: String(product.commentCount),
    screenshotContentVersionIds: [
      ...(product.screenshotContentVersionIds ?? []),
    ],
  };
}
function blankRow(): Row {
  // 后端只允许「全部无 id」或「全部带 id」两种形态；新增商品必须自带稳定 UUID。
  return {
    key: globalThis.crypto.randomUUID(),
    id: '',
    title: '',
    url: '',
    quantity: '0',
    unitPrice: '0',
    commentCount: '0',
    screenshotContentVersionIds: [],
  };
}

const rows = ref<Row[]>(props.products.map(toRow));
const error = ref('');

const nonNegativeInteger = (value: string) =>
  /^(0|[1-9]\d*)$/u.test(value) && BigInt(value) <= 2_147_483_647n;
const money = (value: string) => /^(0|[1-9]\d{0,15})(\.\d{1,2})?$/u.test(value);

function addProduct(): void {
  if (rows.value.length >= 100) return;
  rows.value.push(blankRow());
}
function removeProduct(index: number): void {
  if (rows.value.length <= 1) return;
  rows.value.splice(index, 1);
}
function validUrl(value: string): boolean {
  try {
    const parsed = new globalThis.URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
function submit(): void {
  if (props.pending) return;
  if (rows.value.length === 0) {
    error.value = '至少保留一条商品';
    return;
  }
  for (const [index, row] of rows.value.entries()) {
    if (!row.title.trim() && !row.url.trim()) {
      error.value = `商品 ${index + 1}：商品链接和名称至少填写一项`;
      return;
    }
    if (row.title.trim().length > 200) {
      error.value = `商品 ${index + 1}：商品名称不能超过 200 字`;
      return;
    }
    if (row.url.trim() && !validUrl(row.url.trim())) {
      error.value = `商品 ${index + 1}：商品链接仅支持 http/https`;
      return;
    }
    if (!nonNegativeInteger(row.quantity)) {
      error.value = `商品 ${index + 1}：销量必须是非负整数`;
      return;
    }
    if (!money(row.unitPrice)) {
      error.value = `商品 ${index + 1}：单价最多保留两位小数`;
      return;
    }
    if (!nonNegativeInteger(row.commentCount)) {
      error.value = `商品 ${index + 1}：评论数必须是非负整数`;
      return;
    }
  }
  error.value = '';
  emit(
    'save',
    rows.value.map((row) => ({
      id: row.id || globalThis.crypto.randomUUID(),
      ...(row.title.trim() ? { title: row.title.trim() } : {}),
      ...(row.url.trim() ? { url: row.url.trim() } : {}),
      quantity: Number(row.quantity),
      unitPrice: row.unitPrice,
      commentCount: Number(row.commentCount),
      screenshotContentVersionIds: [...row.screenshotContentVersionIds],
    })),
  );
}

defineExpose({ addProduct });
</script>

<template>
  <div class="lead-products-editor">
    <div class="lead-products-editor__rows">
      <article
        v-for="(row, index) in rows"
        :key="row.key"
        class="lead-products-editor__row"
        data-test="lead-product-row"
      >
        <div class="lead-products-editor__head">
          <strong>商品 {{ index + 1 }}</strong>
          <ElButton
            v-if="rows.length > 1"
            text
            :data-test="`lead-product-remove-${index}`"
            :disabled="pending"
            @click="removeProduct(index)"
            >移除</ElButton
          >
        </div>
        <div class="demo-form-grid">
          <label>
            <span>商品名称</span>
            <input
              v-model="row.title"
              class="text-input"
              data-test="lead-product-title"
              maxlength="200"
            />
          </label>
          <label>
            <span>商品链接</span>
            <input
              v-model="row.url"
              class="text-input"
              data-test="lead-product-url"
              maxlength="2048"
            />
          </label>
          <label>
            <span>销量</span>
            <input
              v-model="row.quantity"
              class="text-input"
              data-test="lead-product-quantity"
              inputmode="numeric"
            />
          </label>
          <label>
            <span>单价（元）</span>
            <input
              v-model="row.unitPrice"
              class="text-input"
              data-test="lead-product-price"
              inputmode="decimal"
            />
          </label>
          <label>
            <span>评论数</span>
            <input
              v-model="row.commentCount"
              class="text-input"
              data-test="lead-product-comments"
              inputmode="numeric"
            />
          </label>
        </div>
      </article>
    </div>
    <p v-if="error" role="alert" class="submit-error">{{ error }}</p>
    <div class="lead-products-editor__actions">
      <ElButton
        data-test="lead-product-add"
        :disabled="pending || rows.length >= 100"
        @click="addProduct"
        >新增商品</ElButton
      >
      <ElButton
        native-type="button"
        type="primary"
        :loading="pending"
        data-test="lead-products-save"
        @click="submit"
        >保存</ElButton
      >
      <ElButton
        data-test="lead-products-cancel"
        :disabled="pending"
        @click="emit('cancel')"
        >取消</ElButton
      >
    </div>
  </div>
</template>

<style scoped>
.lead-products-editor {
  padding: 8px 16px 16px;
}
.lead-products-editor__rows {
  display: grid;
  gap: 12px;
}
.lead-products-editor__row {
  padding: 12px;
  border: 1px solid #e3e5eb;
  border-radius: 8px;
}
.lead-products-editor__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 13px;
}
.lead-products-editor__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
</style>
