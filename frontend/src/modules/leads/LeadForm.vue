<script setup lang="ts">
import { computed, nextTick, reactive, ref } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import type {
  CreateLeadInput,
  InfringementType,
  LeadCaseType,
  LeadFormContext,
  LeadPlatform,
  LeadSource,
} from '../../api/leads';
import RequiredFieldMark from '../../app/RequiredFieldMark.vue';
import { decimalEstimate } from './lead-options';

type EditableFields = Omit<
  CreateLeadInput,
  'reservedLeadId' | 'leadScreenshotContentVersionIds'
>;
export type LeadFormSubmission = {
  fields: EditableFields;
  screenshotFiles: Array<InstanceType<typeof globalThis.File>>;
};
type InitialValue = Omit<
  Partial<EditableFields>,
  'shopExternalId' | 'remark' | 'products'
> & {
  shopExternalId?: string | null;
  remark?: string | null;
  products?: Array<{
    url?: string | null;
    title?: string | null;
    quantity: number;
    unitPrice: string;
    commentCount: number;
  }>;
};
type ProductDraft = {
  url: string;
  title: string;
  quantity: string;
  unitPrice: string;
  commentCount: string;
};

const props = withDefaults(
  defineProps<{
    context: LeadFormContext;
    initialValue?: InitialValue;
    customerLocked?: boolean;
    allowScreenshots?: boolean;
    submitting?: boolean;
    submitLabel?: string;
  }>(),
  {
    customerLocked: false,
    allowScreenshots: true,
    submitting: false,
    submitLabel: '保存线索',
  },
);
const emit = defineEmits<{
  submit: [value: LeadFormSubmission];
  dirty: [];
}>();

const initial = props.initialValue;
const customerId = ref(initial?.customerId ?? '');
const rightsHolderId = ref(initial?.rightsHolderId ?? '');
const caseType = ref<LeadCaseType | ''>(initial?.caseType ?? '');
const infringementTypes = ref<InfringementType[]>([
  ...(initial?.infringementTypes ?? []),
]);
const source = ref<LeadSource | ''>(initial?.source ?? '');
const platform = ref<LeadPlatform | ''>(initial?.platform ?? '');
const foundAt = ref(toLocalDateTime(initial?.foundAt));
const shopName = ref(initial?.shopName ?? '');
const shopExternalId = ref(initial?.shopExternalId ?? '');
const needDisclose = ref(initial?.needDisclose ?? false);
const remark = ref(initial?.remark ?? '');
const products = ref<ProductDraft[]>(
  initial?.products?.length
    ? initial.products.map((product) => ({
        url: product.url ?? '',
        title: product.title ?? '',
        quantity: String(product.quantity),
        unitPrice: product.unitPrice,
        commentCount: String(product.commentCount),
      }))
    : [newProduct()],
);
const screenshotFiles = ref<Array<InstanceType<typeof globalThis.File>>>([]);
const errors = reactive<Record<string, string>>({});

const selectedCustomer = computed(() =>
  props.context.customers.find((customer) => customer.id === customerId.value),
);
const rightsHolders = computed(
  () => selectedCustomer.value?.rightsHolders ?? [],
);
const rightsHolderGuidance = computed(() => {
  if (!customerId.value) return '请先选择客户。';
  if (rightsHolders.value.length === 0)
    return '该客户尚未维护权利人，请先前往客户详情添加后再创建线索。';
  if (rightsHolders.value.length === 1) return '已按客户自动带出。';
  return '该客户有多个权利人，请选择本线索对应的一项。';
});
const platforms = computed(() =>
  source.value ? props.context.dictionaries.platforms[source.value] : [],
);

function newProduct(): ProductDraft {
  return {
    url: '',
    title: '',
    quantity: '0',
    unitPrice: '0',
    commentCount: '0',
  };
}
function toLocalDateTime(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
function onCustomerChanged(): void {
  if (rightsHolders.value.length === 1) {
    rightsHolderId.value = rightsHolders.value[0]!.id;
  } else if (
    !rightsHolders.value.some((holder) => holder.id === rightsHolderId.value)
  ) {
    rightsHolderId.value = '';
  }
  errors.customerId = '';
  errors.rightsHolderId = '';
}
function markDirty(): void {
  emit('dirty');
}
function onSourceChanged(): void {
  if (!platforms.value.some((option) => option.value === platform.value)) {
    platform.value = '';
  }
  errors.source = '';
  errors.platform = '';
}
function addProduct(): void {
  if (products.value.length < 100) {
    products.value.push(newProduct());
    markDirty();
  }
}
function removeProduct(index: number): void {
  if (products.value.length > 1) {
    products.value.splice(index, 1);
    markDirty();
  }
}
function estimate(product: ProductDraft): string {
  return (
    decimalEstimate(
      product.quantity,
      product.commentCount,
      product.unitPrice,
    ) ?? '—'
  );
}
function onFilesChanged(event: InstanceType<typeof globalThis.Event>): void {
  if (!(event.target instanceof globalThis.HTMLInputElement)) return;
  const files = Array.from(event.target.files ?? []);
  errors.screenshots = '';
  if (files.length > 20) {
    errors.screenshots = '最多选择 20 份截图';
    screenshotFiles.value = [];
    return;
  }
  const allowed = new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
  ]);
  if (files.some((file) => !allowed.has(file.type))) {
    errors.screenshots = '截图仅支持 PDF、JPG/JPEG、PNG、WEBP';
    screenshotFiles.value = [];
    return;
  }
  if (files.some((file) => file.size > 20 * 1024 * 1024)) {
    errors.screenshots = '每份截图不能超过 20MB';
    screenshotFiles.value = [];
    return;
  }
  screenshotFiles.value = files;
}
function nonNegativeInteger(value: string): boolean {
  return /^(0|[1-9]\d*)$/u.test(value) && BigInt(value) <= 2_147_483_647n;
}
function money(value: string): boolean {
  return /^(0|[1-9]\d{0,15})(\.\d{1,2})?$/u.test(value);
}
function firstErrorSelector(): string | undefined {
  const order: Array<[string, string]> = [
    ['customerId', '[name="customerId"]'],
    ['rightsHolderId', '[name="rightsHolderId"]'],
    ['caseType', '[name="caseType"]'],
    ['infringementTypes', '[name="infringementTypes"]'],
    ['source', '[name="source"]'],
    ['platform', '[name="platform"]'],
    ['foundAt', '[name="foundAt"]'],
    ['shopName', '[name="shopName"]'],
  ];
  for (const [key, selector] of order) if (errors[key]) return selector;
  for (const index of products.value.keys()) {
    for (const key of [
      `productUrl-${index}`,
      `productTitle-${index}`,
      `quantity-${index}`,
      `unitPrice-${index}`,
      `commentCount-${index}`,
    ]) {
      if (errors[key]) return `[name="${key}"]`;
    }
  }
  if (errors.screenshots) return '[name="screenshots"]';
  return undefined;
}
function validate(): boolean {
  const screenshotError = errors.screenshots;
  for (const key of Object.keys(errors)) delete errors[key];
  if (screenshotError) errors.screenshots = screenshotError;
  if (!customerId.value) errors.customerId = '请选择客户';
  if (!rightsHolderId.value) errors.rightsHolderId = '请选择权利人';
  if (!caseType.value) errors.caseType = '请选择拟办理业务类型';
  if (infringementTypes.value.length === 0)
    errors.infringementTypes = '请至少选择一种侵权类型';
  if (!source.value) errors.source = '请选择线索来源';
  if (!platform.value) errors.platform = '请选择平台';
  if (!foundAt.value || Number.isNaN(new Date(foundAt.value).getTime()))
    errors.foundAt = '请选择发现时间';
  if (!shopName.value.trim()) errors.shopName = '请输入店铺名称';
  products.value.forEach((product, index) => {
    if (!product.url.trim() && !product.title.trim())
      errors[`productTitle-${index}`] = '商品链接和标题至少填写一项';
    if (product.url.trim()) {
      try {
        const parsed = new globalThis.URL(product.url.trim());
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
      } catch {
        errors[`productUrl-${index}`] = '商品链接仅支持 http/https';
      }
    }
    if (!nonNegativeInteger(product.quantity))
      errors[`quantity-${index}`] = '数量必须是非负整数';
    if (!money(product.unitPrice))
      errors[`unitPrice-${index}`] = '金额最多保留两位小数';
    if (!nonNegativeInteger(product.commentCount))
      errors[`commentCount-${index}`] = '评论数必须是非负整数';
  });
  return Object.values(errors).every((message) => !message);
}
async function submit(): Promise<void> {
  if (props.submitting || !validate()) {
    await nextTick();
    const selector = firstErrorSelector();
    if (selector)
      globalThis.document
        .querySelector<InstanceType<typeof globalThis.HTMLElement>>(selector)
        ?.focus();
    return;
  }
  emit('submit', {
    fields: {
      customerId: customerId.value,
      rightsHolderId: rightsHolderId.value,
      caseType: caseType.value as LeadCaseType,
      infringementTypes: [...infringementTypes.value],
      source: source.value as LeadSource,
      platform: platform.value as LeadPlatform,
      foundAt: new Date(foundAt.value).toISOString(),
      shopName: shopName.value.trim(),
      ...(shopExternalId.value.trim()
        ? { shopExternalId: shopExternalId.value.trim() }
        : {}),
      needDisclose: needDisclose.value,
      ...(remark.value.trim() ? { remark: remark.value.trim() } : {}),
      products: products.value.map((product) => ({
        ...(product.url.trim() ? { url: product.url.trim() } : {}),
        ...(product.title.trim() ? { title: product.title.trim() } : {}),
        quantity: Number(product.quantity),
        unitPrice: product.unitPrice,
        commentCount: Number(product.commentCount),
      })),
    },
    screenshotFiles: [...screenshotFiles.value],
  });
}
</script>

<template>
  <form
    class="demo-form lead-form"
    @submit.prevent="submit"
    @input="markDirty"
    @change="markDirty"
  >
    <section class="demo-card demo-card--pad" data-test="lead-facts-section">
      <h2 class="form-section-title">线索基础</h2>
      <div class="demo-form-grid">
        <label>
          <span>客户<RequiredFieldMark /></span>
          <select
            v-model="customerId"
            name="customerId"
            class="text-input"
            :disabled="customerLocked"
            @change="onCustomerChanged"
          >
            <option value="">请选择</option>
            <option
              v-for="customer in context.customers"
              :key="customer.id"
              :value="customer.id"
            >
              {{ customer.name }}
            </option>
          </select>
          <small v-if="errors.customerId" class="field-error">{{
            errors.customerId
          }}</small>
        </label>
        <label>
          <span>权利人<RequiredFieldMark /></span>
          <select
            v-model="rightsHolderId"
            name="rightsHolderId"
            class="text-input"
            :disabled="customerLocked"
            aria-describedby="rights-holder-guidance"
            @change="errors.rightsHolderId = ''"
          >
            <option value="">请选择</option>
            <option
              v-for="holder in rightsHolders"
              :key="holder.id"
              :value="holder.id"
            >
              {{ holder.name }}
            </option>
          </select>
          <small v-if="errors.rightsHolderId" class="field-error">{{
            errors.rightsHolderId
          }}</small>
          <small id="rights-holder-guidance" class="field-guidance">{{
            rightsHolderGuidance
          }}</small>
        </label>
        <label>
          <span>拟办理业务类型<RequiredFieldMark /></span>
          <select v-model="caseType" name="caseType" class="text-input">
            <option value="">请选择</option>
            <option
              v-for="option in context.dictionaries.caseTypes"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
          <small v-if="errors.caseType" class="field-error">{{
            errors.caseType
          }}</small>
        </label>
        <label>
          <span>发现时间<RequiredFieldMark /></span>
          <input
            v-model="foundAt"
            name="foundAt"
            class="text-input"
            type="datetime-local"
          />
          <small v-if="errors.foundAt" class="field-error">{{
            errors.foundAt
          }}</small>
        </label>
        <label>
          <span>线索来源<RequiredFieldMark /></span>
          <select
            v-model="source"
            name="source"
            class="text-input"
            @change="onSourceChanged"
          >
            <option value="">请选择</option>
            <option
              v-for="option in context.dictionaries.sources"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
          <small v-if="errors.source" class="field-error">{{
            errors.source
          }}</small>
        </label>
        <label>
          <span>发现平台<RequiredFieldMark /></span>
          <select v-model="platform" name="platform" class="text-input">
            <option value="">请选择</option>
            <option
              v-for="option in platforms"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
          <small v-if="errors.platform" class="field-error">{{
            errors.platform
          }}</small>
        </label>
        <label>
          <span>店铺名称<RequiredFieldMark /></span>
          <input
            v-model="shopName"
            name="shopName"
            class="text-input"
            maxlength="200"
          />
          <small v-if="errors.shopName" class="field-error">{{
            errors.shopName
          }}</small>
        </label>
        <label>
          <span>平台店铺ID（选填）</span>
          <input
            v-model="shopExternalId"
            name="shopExternalId"
            class="text-input"
            maxlength="100"
          />
        </label>
      </div>

      <fieldset class="form-section lead-rights-fieldset">
        <legend>疑似侵权类型<RequiredFieldMark /></legend>
        <label
          v-for="option in context.dictionaries.infringementTypes"
          :key="option.value"
          class="check-option"
        >
          <input
            v-model="infringementTypes"
            name="infringementTypes"
            type="checkbox"
            :value="option.value"
          />
          {{ option.label }}
        </label>
        <p v-if="errors.infringementTypes" class="field-error">
          {{ errors.infringementTypes }}
        </p>
      </fieldset>
    </section>

    <section class="demo-card demo-card--pad" data-test="products-section">
      <div class="lead-form__section-head">
        <h2 class="form-section-title">商品链接</h2>
        <ElButton data-test="add-product" @click="addProduct"
          >添加商品</ElButton
        >
      </div>
      <article
        v-for="(product, index) in products"
        :key="index"
        class="product-row"
        data-test="product-row"
      >
        <div class="product-row__heading">
          <strong>商品 {{ index + 1 }}</strong>
          <ElButton
            v-if="products.length > 1"
            text
            :data-test="`remove-product-${index}`"
            @click="removeProduct(index)"
            >移除</ElButton
          >
        </div>
        <div class="demo-form-grid product-fields">
          <label
            ><span>商品链接</span
            ><input
              v-model="product.url"
              :name="`productUrl-${index}`"
              class="text-input"
            /><small v-if="errors[`productUrl-${index}`]" class="field-error">{{
              errors[`productUrl-${index}`]
            }}</small></label
          >
          <label
            ><span>商品标题</span
            ><input
              v-model="product.title"
              :name="`productTitle-${index}`"
              class="text-input"
              maxlength="200"
            /><small
              v-if="errors[`productTitle-${index}`]"
              class="field-error"
              >{{ errors[`productTitle-${index}`] }}</small
            ></label
          >
          <label
            ><span>销量<RequiredFieldMark /></span
            ><input
              v-model="product.quantity"
              :name="`quantity-${index}`"
              class="text-input"
              inputmode="numeric"
            /><small v-if="errors[`quantity-${index}`]" class="field-error">{{
              errors[`quantity-${index}`]
            }}</small></label
          >
          <label
            ><span>单价（元）<RequiredFieldMark /></span
            ><input
              v-model="product.unitPrice"
              :name="`unitPrice-${index}`"
              class="text-input"
              inputmode="decimal"
            /><small v-if="errors[`unitPrice-${index}`]" class="field-error">{{
              errors[`unitPrice-${index}`]
            }}</small></label
          >
          <label
            ><span>评论数<RequiredFieldMark /></span
            ><input
              v-model="product.commentCount"
              :name="`commentCount-${index}`"
              class="text-input"
              inputmode="numeric"
            /><small
              v-if="errors[`commentCount-${index}`]"
              class="field-error"
              >{{ errors[`commentCount-${index}`] }}</small
            ></label
          >
          <p class="estimate-preview mono" :data-test="`estimate-${index}`">
            预估销售额（元） {{ estimate(product) }}
          </p>
          <p class="field-guidance product-estimate-guidance">
            预估销售额 = 单价 × 销量；销量为 0
            时使用评论数。该金额仅供线索评估，不代表真实成交金额。
          </p>
        </div>
      </article>
    </section>

    <section class="demo-card demo-card--pad" data-test="screenshots-section">
      <h2 class="form-section-title">附件与备注</h2>
      <label class="disclose-field">
        <input v-model="needDisclose" name="needDisclose" type="checkbox" />
        申请披露店铺经营者信息
      </label>
      <label class="field-label field-label--spaced" for="lead-remark"
        >备注</label
      >
      <textarea
        id="lead-remark"
        v-model="remark"
        name="remark"
        class="text-area"
        maxlength="5000"
      />

      <div v-if="allowScreenshots" class="lead-upload">
        <label class="field-label" for="lead-screenshots"
          >线索截图（选填）</label
        >
        <input
          id="lead-screenshots"
          name="screenshots"
          type="file"
          multiple
          accept="application/pdf,image/jpeg,image/png,image/webp"
          @change="onFilesChanged"
        />
        <p class="field-help">最多 20 份，每份不超过 20MB。</p>
        <p v-if="errors.screenshots" class="field-error">
          {{ errors.screenshots }}
        </p>
        <ul v-if="screenshotFiles.length" class="file-name-list">
          <li v-for="file in screenshotFiles" :key="file.name">
            {{ file.name }}
          </li>
        </ul>
      </div>
    </section>

    <footer class="demo-form-actions">
      <slot name="cancel" />
      <ElButton
        native-type="submit"
        type="primary"
        :loading="submitting"
        :disabled="submitting"
        >{{ submitLabel }}</ElButton
      >
    </footer>
  </form>
</template>
