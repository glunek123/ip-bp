<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import type {
  InfringementType,
  LeadCaseType,
  LeadDetail,
  LeadFormContext,
  LeadPlatform,
  LeadSource,
} from '../../api/leads';

export type LeadFactsValue = {
  caseType: LeadCaseType;
  infringementTypes: InfringementType[];
  source: LeadSource;
  platform: LeadPlatform;
  foundAt: string;
  shopName: string;
  shopExternalId?: string;
  needDisclose: boolean;
  remark?: string;
};

const props = defineProps<{
  context: LeadFormContext;
  lead: LeadDetail;
  pending: boolean;
}>();
const emit = defineEmits<{ save: [LeadFactsValue]; cancel: [] }>();

function toLocalInput(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

const initialFoundAt = toLocalInput(props.lead.foundAt);
const caseType = ref<LeadCaseType | ''>(props.lead.caseType);
const infringementTypes = ref<InfringementType[]>([
  ...props.lead.infringementTypes,
]);
const source = ref<LeadSource | ''>(props.lead.source);
const platform = ref<LeadPlatform | ''>(props.lead.platform);
const foundAt = ref(initialFoundAt);
const shopName = ref(props.lead.shopName);
const shopExternalId = ref(props.lead.shopExternalId ?? '');
const needDisclose = ref<boolean | null>(props.lead.needDisclose);
const remark = ref(props.lead.remark ?? '');
const error = ref('');

const platforms = computed(() =>
  source.value ? props.context.dictionaries.platforms[source.value] : [],
);

function onSourceChanged(): void {
  if (!platforms.value.some((item) => item.value === platform.value))
    platform.value = '';
}

function submit(): void {
  if (props.pending) return;
  if (!caseType.value) {
    error.value = '请选择案件类型';
    return;
  }
  if (infringementTypes.value.length === 0) {
    error.value = '请至少选择一种侵权类型';
    return;
  }
  if (!source.value) {
    error.value = '请选择线索来源';
    return;
  }
  if (!platform.value) {
    error.value = '请选择平台';
    return;
  }
  if (!foundAt.value || Number.isNaN(new Date(foundAt.value).getTime())) {
    error.value = '请选择线索发现日期';
    return;
  }
  if (!shopName.value.trim()) {
    error.value = '请输入店铺名称';
    return;
  }
  if (shopName.value.trim().length > 200) {
    error.value = '店铺名称不能超过 200 字';
    return;
  }
  if (shopExternalId.value.trim().length > 100) {
    error.value = '平台店铺 ID 不能超过 100 字';
    return;
  }
  if (needDisclose.value === null) {
    error.value = '请选择是否申请披露店铺经营者信息';
    return;
  }
  if ([...remark.value.trim()].length > 5000) {
    error.value = '备注不能超过 5000 字';
    return;
  }
  error.value = '';
  const shopId = shopExternalId.value.trim();
  const trimmedRemark = remark.value.trim();
  emit('save', {
    caseType: caseType.value,
    infringementTypes: [...infringementTypes.value],
    source: source.value,
    platform: platform.value,
    foundAt:
      props.lead.foundAt && foundAt.value === initialFoundAt
        ? props.lead.foundAt
        : new Date(foundAt.value).toISOString(),
    shopName: shopName.value.trim(),
    ...(shopId ? { shopExternalId: shopId } : {}),
    needDisclose: needDisclose.value,
    ...(trimmedRemark ? { remark: trimmedRemark } : {}),
  });
}
</script>

<template>
  <div class="lead-facts-editor">
    <dl class="demo-detail-grid lead-facts-grid" data-test="lead-facts-locked">
      <div>
        <dt>客户</dt>
        <dd>{{ lead.displayNames.customerName }}</dd>
      </div>
      <div>
        <dt>权利主体</dt>
        <dd>{{ lead.displayNames.rightsHolderName }}</dd>
      </div>
      <div>
        <dt>运营</dt>
        <dd>{{ lead.displayNames.responsibleUserName }}</dd>
      </div>
    </dl>
    <form
      class="demo-form-grid"
      data-test="lead-facts-form"
      @submit.prevent="submit"
    >
      <label>
        <span>案件类型</span>
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
      </label>
      <label>
        <span>来源</span>
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
      </label>
      <label>
        <span>平台</span>
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
      </label>
      <label>
        <span>线索发现日期</span>
        <input
          v-model="foundAt"
          name="foundAt"
          class="text-input"
          type="datetime-local"
        />
      </label>
      <label>
        <span>店铺名</span>
        <input
          v-model="shopName"
          name="shopName"
          class="text-input"
          maxlength="200"
        />
      </label>
      <label>
        <span>店铺 ID</span>
        <input
          v-model="shopExternalId"
          name="shopExternalId"
          class="text-input"
          maxlength="100"
        />
      </label>
      <fieldset class="lead-facts-editor__wide">
        <legend>侵权类型</legend>
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
      </fieldset>
      <fieldset class="lead-facts-editor__wide">
        <legend>披露标记</legend>
        <label class="check-option">
          <input
            v-model="needDisclose"
            name="needDisclose"
            type="radio"
            :value="true"
          />
          需要披露
        </label>
        <label class="check-option">
          <input
            v-model="needDisclose"
            name="needDisclose"
            type="radio"
            :value="false"
          />
          无需披露
        </label>
      </fieldset>
      <label class="lead-facts-editor__wide">
        <span>备注</span>
        <textarea
          v-model="remark"
          name="remark"
          class="text-area"
          maxlength="5000"
        />
      </label>
      <p v-if="error" role="alert" class="submit-error">
        {{ error }}
      </p>
      <div class="lead-facts-editor__actions">
        <ElButton native-type="submit" type="primary" :loading="pending"
          >保存</ElButton
        >
        <ElButton
          data-test="facts-cancel"
          :disabled="pending"
          @click="emit('cancel')"
          >取消</ElButton
        >
      </div>
    </form>
  </div>
</template>

<style scoped>
.lead-facts-editor {
  padding: 0 16px 16px;
}
.lead-facts-editor__wide {
  grid-column: 1 / -1;
}
.lead-facts-editor__actions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.lead-facts-editor fieldset {
  margin: 0;
  padding: 0;
  border: 0;
}
.lead-facts-editor legend {
  padding: 0;
  font-size: 13px;
  color: #505668;
}
</style>
