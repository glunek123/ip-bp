<script setup lang="ts">
import { ref, useId } from 'vue';
import type { WorkspaceTab } from './case-workspace-contract';

const props = withDefaults(
  defineProps<{
    businessNo: string;
    subtitle: string;
    activeTab?: WorkspaceTab;
    contextKey: string;
  }>(),
  { activeTab: 'details' },
);

const emit = defineEmits<{ 'update:activeTab': [tab: WorkspaceTab] }>();
const id = useId();
const tabList = ref<globalThis.HTMLDivElement | null>(null);
const tabs: { key: WorkspaceTab; label: string }[] = [
  { key: 'details', label: '案件详情' },
  { key: 'files', label: '文件管理' },
  { key: 'fees', label: '费用管理' },
];

function selectTab(tab: WorkspaceTab): void {
  if (tab !== props.activeTab) emit('update:activeTab', tab);
}

function navigateTabs(
  event: globalThis.KeyboardEvent,
  tab: WorkspaceTab,
): void {
  const index = tabs.findIndex((item) => item.key === tab);
  let nextIndex: number;
  switch (event.key) {
    case 'ArrowLeft':
      nextIndex = (index + tabs.length - 1) % tabs.length;
      break;
    case 'ArrowRight':
      nextIndex = (index + 1) % tabs.length;
      break;
    case 'Home':
      nextIndex = 0;
      break;
    case 'End':
      nextIndex = tabs.length - 1;
      break;
    default:
      return;
  }
  event.preventDefault();
  const nextTab = tabs[nextIndex];
  if (!nextTab) return;
  selectTab(nextTab.key);
  tabList.value
    ?.querySelector<globalThis.HTMLButtonElement>(
      `[data-workspace-tab="${nextTab.key}"]`,
    )
    ?.focus();
}
</script>

<template>
  <div class="case-workspace">
    <header class="case-workspace-header">
      <div class="case-workspace-back"><slot name="back" /></div>
      <div class="case-workspace-heading">
        <h1 class="case-workspace-title">{{ businessNo }}</h1>
        <p class="case-workspace-subtitle">{{ subtitle }}</p>
      </div>
      <div class="case-workspace-actions"><slot name="actions" /></div>
    </header>

    <div
      ref="tabList"
      class="case-workspace-tabs"
      role="tablist"
      aria-label="案件工作页"
      aria-orientation="horizontal"
    >
      <button
        v-for="tab in tabs"
        :id="`${id}-tab-${tab.key}`"
        :key="tab.key"
        type="button"
        class="case-workspace-tab"
        :class="{ 'case-workspace-tab--active': activeTab === tab.key }"
        role="tab"
        :data-workspace-tab="tab.key"
        :aria-selected="activeTab === tab.key"
        :aria-controls="`${id}-panel-${tab.key}`"
        :tabindex="activeTab === tab.key ? 0 : -1"
        @click="selectTab(tab.key)"
        @keydown="navigateTabs($event, tab.key)"
      >
        {{ tab.label }}
      </button>
    </div>

    <div
      v-for="tab in tabs"
      :id="`${id}-panel-${tab.key}`"
      :key="tab.key"
      v-show="activeTab === tab.key"
      :class="`case-workspace-${tab.key}`"
      role="tabpanel"
      :aria-labelledby="`${id}-tab-${tab.key}`"
      tabindex="0"
    >
      <slot :name="tab.key" />
    </div>
    <div class="case-workspace-editors"><slot name="editors" /></div>
  </div>
</template>
