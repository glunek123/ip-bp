<script setup lang="ts">
import { ref, useId, watch } from 'vue';
import type { SectionAction, SectionKey } from './case-workspace-contract';

const props = defineProps<{
  sectionKey: SectionKey;
  title: string;
  contextKey: string;
  action: SectionAction;
  actionLabel?: string;
}>();
const emit = defineEmits<{ edit: [sectionKey: SectionKey] }>();
const expanded = ref(false);
const id = useId();

watch(
  () => props.contextKey,
  () => {
    expanded.value = false;
  },
  { flush: 'sync' },
);

function edit(): void {
  if (props.action.enabled) emit('edit', props.sectionKey);
}
</script>

<template>
  <section class="case-workspace-section" :data-section="sectionKey">
    <div class="case-workspace-section__header">
      <h2 class="case-workspace-section__title">
        <button
          :id="`${id}-toggle`"
          type="button"
          class="case-workspace-section__toggle"
          :aria-expanded="expanded"
          :aria-controls="`${id}-body`"
          @click="expanded = !expanded"
        >
          <span class="case-workspace-section__indicator" aria-hidden="true">
            {{ expanded ? '−' : '+' }}
          </span>
          {{ title }}
        </button>
      </h2>
      <div class="case-workspace-section__tools">
        <slot name="tools" />
        <button
          v-if="sectionKey !== 'closure-info'"
          type="button"
          class="case-workspace-section__edit"
          :disabled="!action.enabled"
          :aria-label="`${title}：${actionLabel ?? action.label}`"
          :aria-describedby="action.hint ? `${id}-hint` : undefined"
          @click="edit"
        >
          {{ actionLabel ?? action.label }}
        </button>
        <span
          v-if="action.hint"
          :id="`${id}-hint`"
          :title="action.hint"
          class="case-workspace-field__help"
        >
          {{ action.hint }}
        </span>
      </div>
    </div>
    <div
      :id="`${id}-body`"
      v-show="expanded"
      class="case-workspace-section__body"
      role="region"
      :aria-labelledby="`${id}-toggle`"
    >
      <slot />
    </div>
  </section>
</template>
