<script setup lang="ts">
import { ref } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';

export type ProductScreenshot = {
  versionId: string;
  materialId: string;
  filename: string;
};
withDefaults(
  defineProps<{
    items: ProductScreenshot[];
    canEdit?: boolean;
    busy?: boolean;
  }>(),
  { canEdit: false, busy: false },
);
const fileInput = ref<InstanceType<typeof globalThis.HTMLInputElement> | null>(
  null,
);
const emit = defineEmits<{
  preview: [item: ProductScreenshot];
  download: [item: ProductScreenshot];
  remove: [versionId: string];
  replace: [files: Array<InstanceType<typeof globalThis.File>>];
}>();
function selected(event: InstanceType<typeof globalThis.Event>): void {
  const target = event.target;
  if (!(target instanceof globalThis.HTMLInputElement)) return;
  emit('replace', Array.from(target.files ?? []));
  target.value = '';
}
</script>

<template>
  <div class="product-screenshots-row" data-test="product-screenshots-row">
    <span v-if="items.length === 0">未上传</span>
    <ul v-else>
      <li v-for="item in items" :key="item.versionId">
        <span>{{ item.filename }}</span>
        <ElButton text :disabled="busy" @click="emit('preview', item)"
          >预览</ElButton
        >
        <ElButton text :disabled="busy" @click="emit('download', item)"
          >下载</ElButton
        >
        <ElButton
          v-if="canEdit"
          text
          :disabled="busy"
          @click="emit('remove', item.versionId)"
          >移除</ElButton
        >
      </li>
    </ul>
    <div v-if="canEdit" class="product-screenshots-row__picker">
      <input
        ref="fileInput"
        class="product-screenshots-row__visually-hidden"
        type="file"
        multiple
        accept="application/pdf,image/jpeg,image/png,image/webp"
        :disabled="busy"
        aria-label="替换商品截图"
        @change="selected"
      />
      <ElButton
        native-type="button"
        data-test="select-product-screenshots"
        :disabled="busy"
        @click="fileInput?.click()"
      >
        {{ items.length ? '替换截图' : '添加截图' }}
      </ElButton>
    </div>
  </div>
</template>

<style scoped>
.product-screenshots-row__visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  clip-path: inset(50%);
}
</style>
