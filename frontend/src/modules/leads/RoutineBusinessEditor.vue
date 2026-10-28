<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';

type Product = {
  id: string;
  title: string | null;
  url: string | null;
  quantity: number;
  unitPrice: string;
};
const props = defineProps<{
  shopName: string;
  products: readonly Product[];
  pending: boolean;
  remark?: string | null;
}>();
const emit = defineEmits<{
  save: [
    value: { shopName: string; products: Product[]; remark?: string | null },
  ];
  cancel: [];
}>();
const shopName = ref(props.shopName);
const remark = ref(props.remark ?? '');
const products = ref(
  props.products.map((product) => ({
    ...product,
    title: product.title ?? '',
    url: product.url ?? '',
    quantity: String(product.quantity),
  })),
);
const error = ref('');
function validUrl(value: string) {
  if (!value) return true;
  try {
    const parsed = new globalThis.URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
const valid = computed(() => {
  const name = shopName.value.trim();
  return (
    name.length > 0 &&
    name.length <= 200 &&
    products.value.every((item) => {
      const qty = Number(item.quantity);
      return (
        item.title.trim().length <= 200 &&
        item.url.trim().length <= 2048 &&
        (item.title.trim().length > 0 || item.url.trim().length > 0) &&
        validUrl(item.url.trim()) &&
        /^\d+$/u.test(item.quantity) &&
        Number.isSafeInteger(qty) &&
        qty >= 0 &&
        qty <= 2147483647 &&
        /^(0|[1-9]\d{0,15})(\.\d{1,2})?$/u.test(item.unitPrice)
      );
    })
  );
});
function submit() {
  if (props.pending) return;
  if (!valid.value) {
    error.value = '请检查店铺名称、商品链接、数量和单价。';
    return;
  }
  error.value = '';
  emit('save', {
    shopName: shopName.value.trim(),
    products: products.value.map((item) => ({
      id: item.id,
      title: item.title.trim() || null,
      url: item.url.trim() || null,
      quantity: Number(item.quantity),
      unitPrice: item.unitPrice,
    })),
    ...(props.remark !== undefined
      ? { remark: remark.value.trim() || null }
      : {}),
  });
}
</script>

<template>
  <form class="routine-editor" @submit.prevent="submit">
    <label class="routine-field">
      店铺名称
      <input
        v-model="shopName"
        class="text-input"
        data-test="routine-shop"
        maxlength="200"
        :disabled="pending"
      />
    </label>
    <label v-if="props.remark !== undefined" class="routine-field">
      备注
      <textarea
        v-model="remark"
        class="text-input"
        data-test="routine-remark"
        maxlength="5000"
        :disabled="pending"
      />
    </label>
    <fieldset
      v-for="(product, index) in products"
      :key="product.id"
      class="routine-product"
      :disabled="pending"
    >
      <legend>商品 {{ index + 1 }}</legend>
      <div class="routine-grid">
        <label class="routine-field"
          >商品名称<input
            v-model="product.title"
            class="text-input"
            data-test="routine-product-title"
            maxlength="200"
        /></label>
        <label class="routine-field"
          >商品链接<input
            v-model="product.url"
            class="text-input"
            data-test="routine-product-url"
            maxlength="2048"
        /></label>
        <label class="routine-field"
          >数量<input
            v-model="product.quantity"
            class="text-input"
            data-test="routine-product-quantity"
            inputmode="numeric"
        /></label>
        <label class="routine-field"
          >单价<input
            v-model="product.unitPrice"
            class="text-input"
            data-test="routine-product-price"
            inputmode="decimal"
        /></label>
      </div>
    </fieldset>
    <p v-if="error" role="alert" class="submit-error">{{ error }}</p>
    <div class="routine-actions">
      <ElButton native-type="submit" type="primary" :loading="pending"
        >保存</ElButton
      >
      <ElButton
        data-test="routine-cancel"
        :disabled="pending"
        @click="emit('cancel')"
        >取消</ElButton
      >
    </div>
  </form>
</template>

<style scoped>
.routine-editor {
  display: grid;
  gap: 16px;
}
.routine-field {
  display: grid;
  gap: 6px;
  font-size: 13px;
  color: #505668;
}
.routine-product {
  margin: 0;
  padding: 14px;
  border: 1px solid #e3e5eb;
  border-radius: 8px;
}
.routine-product legend {
  padding: 0 6px;
  font-weight: 600;
}
.routine-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.routine-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
@media (max-width: 600px) {
  .routine-grid {
    grid-template-columns: 1fr;
  }
}
</style>
