<script setup lang="ts">
import { computed } from 'vue';
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
      <div
        v-for="group in section.groups"
        :key="group.id"
        class="case-workspace-group"
      >
        <h3 class="case-workspace-group__title">{{ group.title }}</h3>
        <dl class="case-workspace-fields">
          <div
            v-for="(field, index) in group.fields"
            :key="`${field.label}:${index}`"
            class="case-workspace-field"
          >
            <dt class="case-workspace-field__label">{{ field.label }}</dt>
            <dd class="case-workspace-field__value">
              {{ field.value }}
              <p v-if="field.help" class="case-workspace-field__help">
                {{ field.help }}
              </p>
            </dd>
          </div>
        </dl>
      </div>
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
              v-for="(field, index) in event.fields"
              :key="`${field.label}:${index}`"
              class="case-workspace-field"
            >
              <dt class="case-workspace-field__label">{{ field.label }}</dt>
              <dd class="case-workspace-field__value">
                {{ field.value }}
                <p v-if="field.help" class="case-workspace-field__help">
                  {{ field.help }}
                </p>
              </dd>
            </div>
          </dl>
        </li>
      </ol>
      <p class="case-workspace-field__help">{{ section.help }}</p>
    </CaseWorkspaceSection>
  </div>
</template>
