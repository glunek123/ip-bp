<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { CaseDetail } from '../../api/cases';
import type { LeadDetail } from '../../api/leads';
import CaseWorkspaceSection from './CaseWorkspaceSection.vue';
import type { SectionAction, SectionKey } from './case-workspace-contract';
import {
  buildCaseWorkspaceEvents,
  buildCaseWorkspaceSections,
  workspaceDate,
  type LeadState,
} from './case-workspace-read-model';

const props = defineProps<{
  item: CaseDetail;
  lead: LeadDetail | null;
  leadState: LeadState;
  actions: Record<SectionKey, SectionAction>;
  contextKey: string;
}>();
const emit = defineEmits<{
  edit: [sectionKey: SectionKey];
  'view-timeline': [];
}>();
const sections = computed(() =>
  buildCaseWorkspaceSections(props.item, props.lead, props.leadState),
);
const events = computed(() => buildCaseWorkspaceEvents(props.item));
const selectedGroups = ref<Partial<Record<SectionKey, string>>>({});
watch(
  () => props.contextKey,
  () => {
    selectedGroups.value = {};
  },
  { flush: 'sync' },
);
function activeGroup(
  section: (typeof sections.value)[number],
): string | undefined {
  const selected = selectedGroups.value[section.key];
  if (section.groups.some((group) => group.id === selected)) return selected;
  return (
    section.groups.find(
      (group) => !group.historical && group.id !== 'judgment-state',
    ) ?? section.groups[0]
  )?.id;
}
function edit(key: SectionKey): void {
  if (props.actions[key].enabled) emit('edit', key);
}
</script>

<template>
  <div class="case-workspace-details">
    <CaseWorkspaceSection
      v-for="section in sections"
      :key="section.key"
      :section-key="section.key"
      :title="section.title"
      :context-key="contextKey"
      :action="actions[section.key]"
      :action-label="section.key === 'timeline' ? '登记／更正' : '编辑'"
      @edit="edit"
    >
      <template v-if="section.key === 'timeline'" #tools>
        <button
          type="button"
          class="case-workspace-section__view"
          @click="emit('view-timeline')"
        >
          查看记录
        </button>
      </template>
      <p
        v-if="section.message"
        class="case-workspace-field__help"
        role="status"
      >
        {{ section.message }}
      </p>
      <nav
        v-if="section.groups.length > 1"
        class="case-workspace-group-nav"
        :aria-label="`${section.title}资料分组`"
      >
        <button
          v-for="(group, index) in section.groups"
          :key="group.id"
          type="button"
          :aria-pressed="activeGroup(section) === group.id"
          :aria-label="`${group.title}，第${index + 1}组`"
          @click="selectedGroups[section.key] = group.id"
        >
          {{ group.title }}
        </button>
      </nav>
      <component
        :is="group.historical ? 'details' : 'div'"
        v-for="group in section.groups"
        :key="group.id"
        v-show="activeGroup(section) === group.id"
        class="case-workspace-group"
        :class="{ 'case-workspace-group--history': group.historical }"
      >
        <component
          :is="group.historical ? 'summary' : 'h3'"
          class="case-workspace-group__title"
          >{{ group.title }}</component
        >
        <dl class="case-workspace-fields">
          <div
            v-for="(field, index) in group.fields.filter(
              (value) => !value.technical,
            )"
            :key="`${field.label}:${index}`"
            class="case-workspace-field"
            :class="{ 'case-workspace-field--wide': field.wide }"
          >
            <dt class="case-workspace-field__label">{{ field.label }}</dt>
            <dd class="case-workspace-field__value">
              {{ field.value }}
              <p v-if="field.help" class="case-workspace-field__help">
                {{ field.help }}
              </p>
              <details
                v-if="field.versionId"
                class="case-workspace-field__help"
                data-test="workspace-file-version"
              >
                <summary>文件版本详情</summary>
                <p>版本标识：{{ field.versionId }}</p>
              </details>
            </dd>
          </div>
        </dl>
        <details
          v-if="group.fields.some((field) => field.technical)"
          class="case-workspace-field__help"
          data-test="workspace-technical-details"
        >
          <summary>记录关联详情</summary>
          <dl class="case-workspace-fields">
            <div
              v-for="field in group.fields.filter((value) => value.technical)"
              :key="field.label"
              class="case-workspace-field case-workspace-field--wide"
            >
              <dt class="case-workspace-field__label">{{ field.label }}</dt>
              <dd class="case-workspace-field__value">{{ field.value }}</dd>
            </div>
          </dl>
        </details>
      </component>
      <ol v-if="section.key === 'timeline'" class="case-workspace-timeline">
        <li
          v-for="event in events"
          :key="`${event.source}:${event.id}`"
          class="case-workspace-timeline__event"
        >
          <h3 class="case-workspace-group__title">{{ event.title }}</h3>
          <dl class="case-workspace-fields">
            <div class="case-workspace-field">
              <dt class="case-workspace-field__label">业务日期／时间</dt>
              <dd class="case-workspace-field__value">
                {{ workspaceDate(event.businessAt) }}
              </dd>
            </div>
            <div class="case-workspace-field">
              <dt class="case-workspace-field__label">记录时间</dt>
              <dd class="case-workspace-field__value">
                {{ workspaceDate(event.recordedAt) }}
              </dd>
            </div>
            <div
              v-for="(field, index) in event.fields.filter(
                (value) => !value.technical,
              )"
              :key="`${field.label}:${index}`"
              class="case-workspace-field"
              :class="{ 'case-workspace-field--wide': field.wide }"
            >
              <dt class="case-workspace-field__label">{{ field.label }}</dt>
              <dd class="case-workspace-field__value">
                {{ field.value }}
                <p v-if="field.help" class="case-workspace-field__help">
                  {{ field.help }}
                </p>
                <details
                  v-if="field.versionId"
                  class="case-workspace-field__help"
                  data-test="workspace-file-version"
                >
                  <summary>文件版本详情</summary>
                  <p>版本标识：{{ field.versionId }}</p>
                </details>
              </dd>
            </div>
          </dl>
          <details
            v-if="event.fields.some((field) => field.technical)"
            class="case-workspace-field__help"
            data-test="workspace-technical-details"
          >
            <summary>记录关联详情</summary>
            <dl class="case-workspace-fields">
              <div
                v-for="field in event.fields.filter((value) => value.technical)"
                :key="field.label"
                class="case-workspace-field case-workspace-field--wide"
              >
                <dt class="case-workspace-field__label">{{ field.label }}</dt>
                <dd class="case-workspace-field__value">{{ field.value }}</dd>
              </div>
            </dl>
          </details>
        </li>
      </ol>
      <details
        class="case-workspace-field__help"
        data-test="workspace-section-note"
      >
        <summary>资料说明</summary>
        <p>{{ section.help }}</p>
      </details>
    </CaseWorkspaceSection>
  </div>
</template>
