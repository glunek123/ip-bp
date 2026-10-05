<script setup lang="ts">
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import type { CaseFile } from '../../api/cases';

type UploadCategory = 'COMPLAINT' | 'AUTHORIZATION';

defineProps<{
  complaintFiles: CaseFile[];
  authorizationFiles: CaseFile[];
  amountState: 'KNOWN' | 'PENDING';
  amount: string;
  pendingReason: string;
  uploadLoading: Partial<Record<UploadCategory, boolean>>;
  uploadErrors: Partial<Record<UploadCategory, string>>;
  error: string;
  success: string;
  submitting: boolean;
  locked?: boolean;
}>();

const emit = defineEmits<{
  upload: [
    category: UploadCategory,
    event: InstanceType<typeof globalThis.Event>,
  ];
  download: [file: CaseFile];
  remove: [category: UploadCategory, index: number];
  submit: [];
  'update:amountState': [value: 'KNOWN' | 'PENDING'];
  'update:amount': [value: string];
  'update:pendingReason': [value: string];
}>();
</script>

<template>
  <section class="demo-card demo-card--pad" data-test="complaint-submit-form">
    <h2 class="form-section-title">提交起诉材料</h2>
    <p class="field-help">
      上传材料与确认提交是两个独立动作。上传不会推进案件；确认后将固定本次选择的文件版本并进入“诉状待确认”。
    </p>
    <div class="demo-form-grid">
      <label>
        起诉状 <span aria-hidden="true">*</span>
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
        授权材料 <span aria-hidden="true">*</span>
        <input
          type="file"
          class="text-input"
          accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          multiple
          :disabled="
            uploadLoading.AUTHORIZATION || authorizationFiles.length >= 10
          "
          @change="emit('upload', 'AUTHORIZATION', $event)"
        />
      </label>
      <p class="field-help">PDF、DOC 或 DOCX，单份不超过 50MB；1～10 份。</p>
      <p v-if="uploadLoading.AUTHORIZATION" role="status">正在上传授权材料…</p>
      <p v-if="uploadErrors.AUTHORIZATION" class="submit-error" role="alert">
        {{ uploadErrors.AUTHORIZATION }}
      </p>
      <ul>
        <li
          v-for="(file, index) in authorizationFiles"
          :key="file.contentVersionId"
        >
          {{ file.originalFilename }}（{{ file.mimeType }}）
          <ElButton text @click="emit('download', file)">下载</ElButton>
          <ElButton text @click="emit('remove', 'AUTHORIZATION', index)"
            >移除</ElButton
          >
        </li>
      </ul>
      <label>
        金额状态
        <select
          :value="amountState"
          class="text-input"
          @change="
            emit(
              'update:amountState',
              ($event.target as HTMLSelectElement).value as 'KNOWN' | 'PENDING',
            )
          "
        >
          <option value="KNOWN">已确认</option>
          <option value="PENDING">待补充</option>
        </select>
      </label>
      <label v-if="amountState === 'KNOWN'">
        金额
        <input
          :value="amount"
          class="text-input"
          inputmode="decimal"
          @input="
            emit('update:amount', ($event.target as HTMLInputElement).value)
          "
        />
      </label>
      <label v-else>
        待补充原因
        <input
          :value="pendingReason"
          class="text-input"
          @input="
            emit(
              'update:pendingReason',
              ($event.target as HTMLInputElement).value,
            )
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
