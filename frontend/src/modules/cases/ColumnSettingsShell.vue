<script setup lang="ts">
defineProps<{
  open: boolean;
  title: string;
  hint?: string;
}>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <div
    v-if="open"
    class="column-settings-backdrop"
    data-test="column-settings-backdrop"
    @click.self="emit('close')"
  >
    <section
      class="column-settings-card"
      role="dialog"
      aria-modal="true"
      :aria-label="title"
    >
      <header>
        <h2>{{ title }}</h2>
        <p v-if="hint" class="column-settings-hint">{{ hint }}</p>
      </header>
      <div class="column-settings-body">
        <slot />
      </div>
      <footer class="column-settings-actions">
        <slot name="actions" />
      </footer>
    </section>
  </div>
</template>

<style scoped>
.column-settings-backdrop {
  position: fixed;
  z-index: var(--z-modal, 2000);
  inset: 0;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgb(15 23 42 / 24%);
}
.column-settings-card {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  width: min(560px, calc(100vw - 32px));
  max-height: min(80vh, 680px);
  overflow: hidden;
  border: 1px solid var(--color-hairline, #e5e7eb);
  border-radius: 12px;
  background: var(--color-canvas, #fff);
  box-shadow: 0 18px 48px rgb(15 23 42 / 18%);
}
header {
  padding: 18px 20px 12px;
  border-bottom: 1px solid var(--color-hairline, #e5e7eb);
}
h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.column-settings-hint {
  margin: 6px 0 0;
  color: var(--color-ink-muted, #6b7280);
  font-size: 12px;
}
.column-settings-body {
  display: grid;
  gap: 4px;
  padding: 12px 20px;
  overflow-y: auto;
}
.column-settings-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding: 12px 20px 16px;
  border-top: 1px solid var(--color-hairline, #e5e7eb);
}
:deep(.column-row) {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--color-hairline, #eef0f3);
  font-size: 13px;
}
:deep(.column-row:last-child) {
  border-bottom: 0;
}
:deep(.column-row label) {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
:deep(.column-row .column-fixed) {
  color: var(--color-ink-muted, #6b7280);
  font-size: 12px;
}
</style>
