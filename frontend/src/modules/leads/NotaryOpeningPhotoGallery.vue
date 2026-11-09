<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { ApiError, getBlob } from '../../api/http';
import type { NotaryOpeningPhoto } from '../../api/notary';

const props = defineProps<{ photos: NotaryOpeningPhoto[]; scopeKey: string }>();
const emit = defineEmits<{
  preview: [photo: NotaryOpeningPhoto];
  download: [photo: NotaryOpeningPhoto];
}>();
const sources = ref<Record<string, string>>({});
const errors = ref<Record<string, string>>({});
let generation = 0;
let controller: AbortController | undefined;

function clearSources(): void {
  Object.values(sources.value).forEach((url) =>
    globalThis.URL.revokeObjectURL(url),
  );
  sources.value = {};
}

watch(
  () => [
    props.scopeKey,
    props.photos.map((photo) => photo.contentVersionId).join('|'),
  ],
  async () => {
    controller?.abort();
    clearSources();
    errors.value = {};
    const currentGeneration = ++generation;
    const activeController = new AbortController();
    controller = activeController;
    let nextIndex = 0;
    const loadNext = async (): Promise<void> => {
      while (nextIndex < props.photos.length) {
        const photo = props.photos[nextIndex++];
        try {
          const file = await getBlob(
            `/materials/${encodeURIComponent(photo.materialId)}/versions/${encodeURIComponent(photo.contentVersionId)}/content`,
            { signal: activeController.signal },
          );
          if (
            currentGeneration !== generation ||
            activeController.signal.aborted
          )
            return;
          sources.value = {
            ...sources.value,
            [photo.contentVersionId]: globalThis.URL.createObjectURL(file.blob),
          };
        } catch (error) {
          if (
            currentGeneration !== generation ||
            activeController.signal.aborted
          )
            return;
          errors.value = {
            ...errors.value,
            [photo.contentVersionId]:
              error instanceof ApiError ? error.message : '照片暂不可预览',
          };
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(4, props.photos.length) }, loadNext),
    );
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  generation += 1;
  controller?.abort();
  clearSources();
});
</script>

<template>
  <div class="notary-opening-photo-gallery" data-test="opening-photo-gallery">
    <div
      v-for="photo in photos"
      :key="photo.contentVersionId"
      class="notary-opening-photo-tile"
    >
      <button
        type="button"
        class="notary-opening-photo"
        :data-test="`opening-photo-${photo.contentVersionId}`"
        @click="emit('preview', photo)"
      >
        <img
          v-if="sources[photo.contentVersionId]"
          :src="sources[photo.contentVersionId]"
          :alt="photo.originalFilename"
          loading="lazy"
        />
        <span v-else>{{ errors[photo.contentVersionId] || '载入中' }}</span>
        <span>{{ photo.originalFilename }}</span>
      </button>
      <button
        type="button"
        :data-test="`download-opening-photo-${photo.contentVersionId}`"
        :aria-label="`下载 ${photo.originalFilename}`"
        @click="emit('download', photo)"
      >
        下载
      </button>
    </div>
  </div>
</template>

<style scoped>
.notary-opening-photo-gallery {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 12px;
}
.notary-opening-photo-tile {
  display: grid;
  gap: 4px;
}
.notary-opening-photo {
  display: grid;
  gap: 6px;
  padding: 6px;
  text-align: left;
}
.notary-opening-photo img {
  width: 100%;
  height: 120px;
  object-fit: cover;
}
</style>
