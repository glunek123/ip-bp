<script setup lang="ts">
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { todayShanghai, type CaseFile } from '../../api/cases';

type UploadCategory = 'COMPLAINT' | 'AUTHORIZATION';

defineProps<{
  complaintFiles: CaseFile[];
  authorizationFiles: CaseFile[];
  amount: string;
  uploadLoading: Partial<Record<UploadCategory, boolean>>;
  uploadErrors: Partial<Record<UploadCategory, string>>;
  error: string;
  success: string;
  submitting: boolean;
  locked?: boolean;
  submittedOn?: string;
}>();

const emit = defineEmits<{
  upload: [
    category: UploadCategory,
    event: InstanceType<typeof globalThis.Event>,
  ];
  download: [file: CaseFile];
  remove: [category: UploadCategory, index: number];
  submit: [];
  'update:amount': [value: string];
  'update:submittedOn': [value: string];
}>();
</script>

<template>
  <section class="demo-card demo-card--pad" data-test="complaint-submit-form">
    <h2 class="form-section-title">上传诉状</h2>
    <p class="field-help">上传不推进案件；确认后进入诉状待确认。</p>
    <div class="demo-form-grid">
      <label>
        上传诉状日期 <span aria-hidden="true">*</span>
        <input
          :value="submittedOn || todayShanghai()"
          type="date"
          class="text-input"
          data-test="complaint-submitted-on"
          :max="todayShanghai()"
          required
          @input="
            emit(
              'update:submittedOn',
              ($event.target as HTMLInputElement).value,
            )
          "
        />
      </label>
      <label>
        授权委托书 / 起诉状 <span aria-hidden="true">*</span>
        <input
          type="file"
          class="text-input"
          accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          multiple
          :disabled="uploadLoading.COMPLAINT || complaintFiles.length >= 10"
          @change="emit('upload', 'COMPLAINT', $event)"
        />
      </label>
      <p class="field-help">PDF、DOC 或 DOCX，单份不超过 50MB；1～10 份。</p>
      <p v-if="uploadLoading.COMPLAINT" role="status">正在上传起诉状…</p>
      <p v-if="uploadErrors.COMPLAINT" class="submit-error" role="alert">
        {{ uploadErrors.COMPLAINT }}
      </p>
      <ul>
        <li
          v-for="(file, index) in complaintFiles"
          :key="file.contentVersionId"
        >
          {{ file.originalFilename }}（{{ file.mimeType }}）
          <ElButton text @click="emit('download', file)">下载</ElButton>
          <ElButton text @click="emit('remove', 'COMPLAINT', index)"
            >移除</ElButton
          >
        </li>
      </ul>
      <label>
        标的额（元） <span aria-hidden="true">*</span>
        <input
          :value="amount"
          class="text-input"
          inputmode="decimal"
          data-test="complaint-amount"
          placeholder="如 6500"
          @input="
            emit('update:amount', ($event.target as HTMLInputElement).value)
          "
        />
      </label>
    </div>
    <p v-if="error" class="submit-error" role="alert">{{ error }}</p>
    <p v-if="success" role="status">{{ success }}</p>
    <ElButton
      type="primary"
      :loading="submitting"
      :disabled="submitting || locked"
      data-test="submit-complaint"
      @click="emit('submit')"
      >确认提交</ElButton
    >
  </section>
</template>
