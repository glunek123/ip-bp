<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import RequiredFieldMark from '../../app/RequiredFieldMark.vue';
import {
  createNotaryOffice,
  listNotaryOffices,
  type NotaryOffice,
} from '../../api/notary';

const state = ref<'loading' | 'ready' | 'forbidden' | 'failed'>('loading');
const offices = ref<NotaryOffice[]>([]);
const canCreate = ref(false);
const officeName = ref('');
const creating = ref(false);
const createError = ref('');
const createSuccess = ref('');
let request: AbortController | undefined;

async function load(): Promise<void> {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  state.value = 'loading';
  try {
    const result = await listNotaryOffices({ signal: controller.signal });
    if (controller.signal.aborted) return;
    offices.value = result.items;
    canCreate.value = result.capabilities.create;
    state.value = 'ready';
    createError.value = '';
  } catch (error) {
    if (controller.signal.aborted) return;
    state.value =
      error instanceof ApiError &&
      (error.status === 403 || error.code === 'ACTION_FORBIDDEN')
        ? 'forbidden'
        : 'failed';
  }
}

function creationError(error: unknown): string {
  if (!(error instanceof ApiError))
    return '新增结果暂时未知，请刷新公证处列表确认后再操作';
  if (error.code === 'OFFICE_EXISTS')
    return '该公证处已存在，请检查名称或联系管理员';
  if (error.code === 'ACTION_FORBIDDEN' || error.status === 403)
    return '当前账号没有维护公证处的权限，请联系部门管理员';
  if (error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT')
    return '新增结果暂时未知，请刷新列表确认后再操作';
  return '新增公证处失败，请检查名称后重试';
}

async function addOffice(): Promise<void> {
  const name = officeName.value.trim();
  if (!canCreate.value || creating.value || !name) return;
  creating.value = true;
  createError.value = '';
  createSuccess.value = '';
  try {
    const office = await createNotaryOffice(name);
    offices.value = [...offices.value, office].sort((left, right) =>
      left.name.localeCompare(right.name, 'zh-CN'),
    );
    officeName.value = '';
    createSuccess.value = '公证处已新增，可在移交线索时选择';
  } catch (error) {
    createError.value = creationError(error);
  } finally {
    creating.value = false;
  }
}

onMounted(() => void load());
onBeforeUnmount(() => request?.abort());
</script>

<template>
  <div class="page-view page-view--narrow">
    <main>
      <section v-if="state === 'loading'" class="state-panel ledger-panel">
        <h1>正在读取公证处</h1>
      </section>
      <section
        v-else-if="state === 'forbidden'"
        class="state-panel ledger-panel"
      >
        <h1>当前账号无权查看公证处</h1>
        <p>如需维护或查看，请联系部门管理员分配相应权限。</p>
      </section>
      <section v-else-if="state === 'failed'" class="state-panel ledger-panel">
        <h1>公证处列表暂时无法加载</h1>
        <ElButton
          data-test="refresh-notary-offices"
          type="primary"
          @click="load"
          >重新加载</ElButton
        >
      </section>
      <template v-else>
        <div class="page-head">
          <div>
            <p class="eyebrow">部门业务设置</p>
            <h1>公证处</h1>
            <p>维护本部门可选公证处，后续移交线索时可从本部门公证处中选择。</p>
          </div>
          <ElButton
            data-test="refresh-notary-offices"
            text
            :loading="creating"
            @click="load"
            >刷新</ElButton
          >
        </div>
        <p v-if="createSuccess" class="submit-success" role="status">
          {{ createSuccess }}
        </p>
        <p v-if="createError" class="submit-error" role="alert">
          {{ createError }}
        </p>
        <section
          class="demo-card demo-card--pad"
          data-test="notary-offices-list"
        >
          <h2 class="form-section-title">可用公证处</h2>
          <p v-if="offices.length === 0" class="field-help">
            当前部门还没有可用公证处。{{
              canCreate
                ? '新增一项后即可在移交时选择。'
                : '如需新增公证处，请联系部门管理员。'
            }}
          </p>
          <ul v-else class="notary-offices-list">
            <li v-for="office in offices" :key="office.id">
              <span>{{ office.name }}</span>
              <span class="pill">可用</span>
            </li>
          </ul>
        </section>
        <section
          v-if="canCreate"
          class="demo-card demo-card--pad"
          data-test="notary-office-create-form"
        >
          <h2 class="form-section-title">新增公证处</h2>
          <p>名称将加入本部门可选列表，之后可以用于线索移交。</p>
          <label
            class="field-label field-label--spaced"
            for="new-notary-office-name"
          >
            公证处名称<RequiredFieldMark />
          </label>
          <div class="notary-office-create__row">
            <input
              id="new-notary-office-name"
              v-model="officeName"
              class="text-input"
              data-test="new-notary-office-name"
              maxlength="200"
              aria-required="true"
              placeholder="填写公证处名称"
              :disabled="creating"
            />
            <ElButton
              type="primary"
              data-test="create-notary-office"
              :loading="creating"
              :disabled="!officeName.trim() || creating"
              @click="addOffice"
              >新增</ElButton
            >
          </div>
          <p class="field-help">
            仅新增当前部门的公证处名称；不影响已创建的取证批次。
          </p>
        </section>
        <p v-else class="field-help">如需新增公证处，请联系部门管理员。</p>
      </template>
    </main>
  </div>
</template>
