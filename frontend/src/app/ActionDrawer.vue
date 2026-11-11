<script setup lang="ts">
/**
 * 与案件／公证一致的操作侧栏外壳：右侧滑出、宽度与案件抽屉一致。
 * 只用本地 DOM（不 teleport），避免影响列表页既有交互与测试。
 */
defineProps<{ modelValue: boolean; title?: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();
</script>

<template>
  <div
    v-if="modelValue"
    class="action-drawer"
    role="dialog"
    aria-modal="true"
    :aria-label="title ?? ''"
  >
    <div
      class="action-drawer__mask"
      @click="emit('update:modelValue', false)"
    />
    <aside class="action-drawer__panel">
      <header v-if="title" class="action-drawer__head">
        <h2 class="action-drawer__title">{{ title }}</h2>
        <button
          type="button"
          class="action-drawer__close"
          aria-label="关闭"
          @click="emit('update:modelValue', false)"
        >
          ×
        </button>
      </header>
      <div class="action-drawer__body">
        <slot />
      </div>
    </aside>
  </div>
</template>

<style scoped>
.action-drawer {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  justify-content: flex-end;
}
.action-drawer__mask {
  position: absolute;
  inset: 0;
  background: rgb(0 0 0 / 45%);
}
.action-drawer__panel {
  position: relative;
  display: flex;
  flex-direction: column;
  width: min(720px, 100vw);
  height: 100%;
  background: #fff;
  box-shadow: -8px 0 24px rgb(0 0 0 / 18%);
}
.action-drawer__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 20px;
  border-bottom: 1px solid #ebeef5;
}
.action-drawer__title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #1f2329;
}
.action-drawer__close {
  border: 0;
  background: none;
  font-size: 20px;
  line-height: 1;
  color: #8a919f;
  cursor: pointer;
}
.action-drawer__body {
  flex: 1;
  overflow: auto;
  padding: 16px 20px 24px;
  color: #1f2329;
}
</style>
