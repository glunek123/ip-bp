<script setup lang="ts">
import { ElDrawer } from 'element-plus/es/components/drawer/index.mjs';

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    ariaLabel?: string;
    locked?: boolean;
    size?: string;
  }>(),
  { locked: false, size: 'min(720px, 100vw)' },
);
const emit = defineEmits<{ close: [] }>();

function beforeClose(done: () => void): void {
  if (props.locked) return;
  emit('close');
  done();
}
</script>

<template>
  <ElDrawer
    class="operation-drawer"
    :model-value="open"
    :title="title"
    :aria-label="ariaLabel ?? title"
    :size="size"
    append-to-body
    destroy-on-close
    :show-close="!locked"
    :close-on-click-modal="!locked"
    :close-on-press-escape="!locked"
    :before-close="beforeClose"
  >
    <div class="operation-drawer-content"><slot /></div>
    <template #footer>
      <div class="operation-drawer-actions operation-bar">
        <slot name="footer" />
      </div>
    </template>
  </ElDrawer>
</template>

<style>
.el-drawer.operation-drawer {
  max-width: 100%;
  color: var(--color-ink);
  font: 14px/1.6 var(--font-text);
}

.operation-drawer .el-drawer__header {
  flex-shrink: 0;
  align-items: center;
  gap: var(--s-4);
  margin: 0;
  padding: var(--s-4) var(--app-content-padding);
  border-bottom: 1px solid var(--color-hairline);
  color: var(--color-ink);
}

.operation-drawer .el-drawer__title {
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 16px;
  font-weight: 600;
}

.operation-drawer .el-drawer__body {
  min-width: 0;
  min-height: 0;
  padding: var(--s-4) var(--app-content-padding);
  background: var(--color-canvas);
  overflow-wrap: anywhere;
  overscroll-behavior: contain;
}

.operation-drawer .el-drawer__footer {
  flex-shrink: 0;
  padding: var(--s-3) var(--app-content-padding);
  border-top: 1px solid var(--color-hairline);
  background: var(--color-surface-1);
}

.operation-drawer-content {
  min-width: 0;
}

.operation-drawer-actions {
  justify-content: flex-end;
}

.operation-drawer-actions .el-button + .el-button {
  margin-left: 0;
}

@media (max-width: 767px) {
  .operation-drawer-actions > .el-button {
    flex: 1 1 auto;
  }
}
</style>
