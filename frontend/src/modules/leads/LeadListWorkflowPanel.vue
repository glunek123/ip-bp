<script lang="ts">
import type { CreateNotaryMatterInput } from '../../api/notary';

export type FrozenLeadPush = {
  leadId: string;
  expectedVersion: number;
  idempotencyKey: string;
  identity: string;
};
export type FrozenLeadCommand = FrozenLeadPush &
  (
    | { action: 'push'; body: { expectedVersion: number } }
    | { action: 'transfer'; body: CreateNotaryMatterInput }
    | { action: 'withdraw'; body: { reason: string; expectedVersion: number } }
    | {
        action: 'no-evidence';
        body: {
          result: 'NO_EVIDENCE';
          reason: string;
          expectedVersion: number;
        };
      }
  );
export type LeadWorkflowResult = {
  attempt: FrozenLeadCommand;
  matter?: { id: string; businessNo: string };
};
const storageKey = 'dev-cor:lead-workflow:pending';
const legacyKey = 'dev-cor:lead-quick-actions:pending-push';
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function stringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}
function isAttempt(value: unknown): value is FrozenLeadCommand {
  if (
    !isRecord(value) ||
    typeof value.leadId !== 'string' ||
    typeof value.identity !== 'string' ||
    typeof value.idempotencyKey !== 'string' ||
    !Number.isInteger(value.expectedVersion) ||
    !isRecord(value.body) ||
    value.body.expectedVersion !== value.expectedVersion
  )
    return false;
  switch (value.action) {
    case 'push':
      return Object.keys(value.body).length === 1;
    case 'withdraw':
      return typeof value.body.reason === 'string';
    case 'no-evidence':
      return (
        value.body.result === 'NO_EVIDENCE' &&
        typeof value.body.reason === 'string'
      );
    case 'transfer':
      return (
        stringArray(value.body.selectedProductIds) &&
        stringArray(value.body.selectedContentVersionIds) &&
        typeof value.body.notaryOfficeId === 'string' &&
        value.body.evidenceMode === 'ONLINE_PURCHASE' &&
        typeof value.body.batchPurpose === 'string' &&
        (value.body.createNewBatch === undefined ||
          value.body.createNewBatch === true)
      );
    default:
      return false;
  }
}
export function sameLeadAttempt(
  left: FrozenLeadPush,
  right: FrozenLeadPush,
): boolean {
  return (
    left.identity === right.identity &&
    left.leadId === right.leadId &&
    left.expectedVersion === right.expectedVersion &&
    left.idempotencyKey === right.idempotencyKey
  );
}
function readLegacy(): Record<string, FrozenLeadPush & { status: string }> {
  const parsed: unknown = JSON.parse(
    globalThis.sessionStorage.getItem(legacyKey) ?? '{}',
  );
  if (!isRecord(parsed)) throw new Error('Invalid pending push storage');
  const entries: Record<string, FrozenLeadPush & { status: string }> = {};
  for (const [identity, value] of Object.entries(parsed)) {
    if (
      !isRecord(value) ||
      value.identity !== identity ||
      typeof value.leadId !== 'string' ||
      typeof value.idempotencyKey !== 'string' ||
      typeof value.expectedVersion !== 'number' ||
      !Number.isInteger(value.expectedVersion) ||
      (value.status !== 'PENDING' && value.status !== 'SETTLED')
    )
      throw new Error('Invalid pending push');
    entries[identity] = {
      identity,
      leadId: value.leadId,
      expectedVersion: value.expectedVersion,
      idempotencyKey: value.idempotencyKey,
      status: value.status,
    };
  }
  return entries;
}
export function readPendingLeadCommands(): Record<
  string,
  FrozenLeadCommand
> | null {
  try {
    const parsed: unknown = JSON.parse(
      globalThis.sessionStorage.getItem(storageKey) ?? '{}',
    );
    if (!isRecord(parsed)) return null;
    const entries: Record<string, FrozenLeadCommand> = {};
    for (const [identity, value] of Object.entries(parsed)) {
      if (!isAttempt(value) || value.identity !== identity) return null;
      entries[identity] = value;
    }
    for (const [identity, value] of Object.entries(readLegacy())) {
      if (value.status !== 'PENDING') continue;
      if (entries[identity] && !sameLeadAttempt(entries[identity], value))
        return null;
      entries[identity] ??= {
        leadId: value.leadId,
        identity,
        expectedVersion: value.expectedVersion,
        idempotencyKey: value.idempotencyKey,
        action: 'push',
        body: { expectedVersion: value.expectedVersion },
      };
    }
    return entries;
  } catch {
    return null;
  }
}
function storeAttempt(attempt: FrozenLeadCommand, settled = false): boolean {
  try {
    const entries = readPendingLeadCommands();
    if (!entries) return false;
    const existing = entries[attempt.identity];
    if (existing && !sameLeadAttempt(existing, attempt)) return false;
    if (settled) {
      if (!existing) return false;
      delete entries[attempt.identity];
    } else entries[attempt.identity] = attempt;
    const legacy = readLegacy();
    const old = legacy[attempt.identity];
    if (old && sameLeadAttempt(old, attempt)) {
      // Keep the legacy record until the new frozen body is durably written.
      globalThis.sessionStorage.setItem(storageKey, JSON.stringify(entries));
      delete legacy[attempt.identity];
      globalThis.sessionStorage.setItem(legacyKey, JSON.stringify(legacy));
    } else
      globalThis.sessionStorage.setItem(storageKey, JSON.stringify(entries));
    return true;
  } catch {
    return false;
  }
}
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import RequiredFieldMark from '../../app/RequiredFieldMark.vue';
import type { ListWorkflowSession } from '../../app/list-workflow-context';
import { ApiError } from '../../api/http';
import {
  getLead,
  pushLead,
  applyLeadWithdrawal,
  decideLeadNoEvidence,
  type LeadDetail,
} from '../../api/leads';
import {
  createNotaryMatter,
  listNotaryOffices,
  createNotaryOffice,
  type NotaryOffice,
} from '../../api/notary';
import {
  listOwnerMaterials,
  downloadMaterialVersion,
} from '../../api/materials';

const props = defineProps<{
  detail: LeadDetail;
  session: ListWorkflowSession;
}>();
const emit = defineEmits<{
  pending: [];
  completed: [result: LeadWorkflowResult];
}>();
const choice = ref<'' | 'transfer' | 'no-evidence'>('');
const reason = ref('');
const productIds = ref<string[]>([]);
const contentVersionIds = ref<string[]>([]);
const officeId = ref('');
const purpose = ref('');
const offices = ref<NotaryOffice[]>([]);
const canCreateOffice = ref(false);
const newOfficeName = ref('');
const creatingOffice = ref(false);
const resourcesReady = ref(false);
const resourceError = ref('');
const message = ref('');
const busy = ref(false);
const frozen = ref<FrozenLeadCommand | null>(null);
const screenshots = ref<
  Array<{ materialId: string; versionId: string; filename: string }>
>([]);
const controller = new AbortController();
const downloads = new Set<AbortController>();
const storageUnavailable = ref(false);
const denied = ref(false);
const conflict = ref(false);
const transferAllowed = computed(
  () =>
    props.detail.capabilities.transferToNotary ||
    props.detail.capabilities.createEvidenceBatch,
);
const action = computed(() => {
  if (props.detail.status === 'WAITING_PUSH' && props.detail.capabilities.push)
    return 'push';
  if (props.detail.status === 'WAITING_EVIDENCE_DECISION') {
    if (choice.value === 'transfer' && transferAllowed.value) return 'transfer';
    if (
      choice.value === 'no-evidence' &&
      props.detail.capabilities.evidenceDecide
    )
      return 'no-evidence';
  }
  if (
    props.detail.status === 'TRANSFERRED_TO_NOTARY' &&
    props.detail.capabilities.createEvidenceBatch
  )
    return 'transfer';
  if (
    props.detail.status === 'ARCHIVED' &&
    props.detail.capabilities.withdrawApply
  )
    return 'withdraw';
  return '';
});
const hasAction = computed(
  () =>
    props.detail.capabilities.push ||
    transferAllowed.value ||
    props.detail.capabilities.evidenceDecide ||
    props.detail.capabilities.withdrawApply,
);
const locked = computed(
  () => busy.value || !!frozen.value || denied.value || conflict.value,
);
const reasonLength = computed(() => [...reason.value.trim()].length);
const valid = computed(() => {
  if (
    !action.value ||
    locked.value ||
    storageUnavailable.value ||
    creatingOffice.value
  )
    return false;
  if (action.value === 'push') return true;
  if (action.value !== 'transfer')
    return reasonLength.value > 0 && reasonLength.value <= 5000;
  return (
    resourcesReady.value &&
    productIds.value.length > 0 &&
    !!officeId.value &&
    [...purpose.value.trim()].length > 0 &&
    [...purpose.value.trim()].length <= 500
  );
});
const submitLabel = computed(
  () =>
    ({
      push: '推送给客户审核',
      transfer: props.detail.capabilities.createEvidenceBatch
        ? '新建取证批次'
        : '移交公证并保留只读线索',
      'no-evidence': '不取证并归档',
      withdraw: '提交撤回申请，等待客户确认',
      '': '请先选择取证去向',
    })[action.value],
);
const frozenLabel = computed(() =>
  frozen.value
    ? {
        push: '推送给客户审核',
        transfer:
          frozen.value.action === 'transfer' && frozen.value.body.createNewBatch
            ? '新建取证批次'
            : '移交公证',
        'no-evidence': '不取证并归档',
        withdraw: '申请撤回归档',
      }[frozen.value.action]
    : '',
);

async function loadResources() {
  if (!transferAllowed.value || frozen.value) return;
  resourcesReady.value = false;
  resourceError.value = '';
  try {
    const [officeResult, materials] = await Promise.all([
      listNotaryOffices({ signal: controller.signal }),
      listOwnerMaterials('LEAD', props.detail.id, {
        signal: controller.signal,
      }),
    ]);
    if (!props.session.isCurrent() || controller.signal.aborted) return;
    offices.value = officeResult.items;
    canCreateOffice.value = officeResult.capabilities.create;
    screenshots.value = materials.items.flatMap((material) => {
      if (
        material.status !== 'ACTIVE' ||
        !material.currentVersionId ||
        !props.detail.leadScreenshotContentVersionIds.includes(
          material.currentVersionId,
        )
      )
        return [];
      const version = material.contentVersions.find(
        (item) => item.id === material.currentVersionId,
      );
      return version
        ? [
            {
              materialId: material.id,
              versionId: version.id,
              filename: version.originalFilename,
            },
          ]
        : [];
    });
    resourcesReady.value = true;
  } catch {
    if (props.session.isCurrent() && !controller.signal.aborted)
      resourceError.value = '公证处或截图无法读取，尚不能移交。请重新读取。';
  }
}
async function download(materialId: string, versionId: string) {
  const downloadController = new AbortController();
  downloads.add(downloadController);
  try {
    await downloadMaterialVersion(
      materialId,
      versionId,
      downloadController.signal,
    );
  } catch {
    if (props.session.isCurrent() && !downloadController.signal.aborted)
      message.value = '截图下载失败，请重试。';
  } finally {
    downloads.delete(downloadController);
  }
}
async function addOffice() {
  if (
    !props.session.isCurrent() ||
    !canCreateOffice.value ||
    locked.value ||
    creatingOffice.value ||
    !newOfficeName.value.trim()
  )
    return;
  creatingOffice.value = true;
  try {
    const office = await createNotaryOffice(newOfficeName.value.trim());
    if (!props.session.isCurrent()) return;
    offices.value = [...offices.value, office];
    officeId.value = office.id;
    newOfficeName.value = '';
  } catch {
    if (props.session.isCurrent())
      message.value = '新增公证处未确认，请重新读取公证处核对后再操作。';
  } finally {
    if (props.session.isCurrent()) creatingOffice.value = false;
  }
}
function capability(
  detail: LeadDetail,
  operation: FrozenLeadCommand['action'],
): boolean {
  switch (operation) {
    case 'push':
      return detail.capabilities.push;
    case 'transfer':
      return (
        detail.capabilities.transferToNotary ||
        detail.capabilities.createEvidenceBatch
      );
    case 'no-evidence':
      return (
        detail.status === 'WAITING_EVIDENCE_DECISION' &&
        detail.capabilities.evidenceDecide
      );
    case 'withdraw':
      return detail.status === 'ARCHIVED' && detail.capabilities.withdrawApply;
  }
}
function unknown(error: unknown) {
  return (
    !(error instanceof ApiError) ||
    error.status === 0 ||
    error.status === 408 ||
    error.status >= 500 ||
    error.code === 'INVALID_RESPONSE'
  );
}
async function send(attempt: FrozenLeadCommand) {
  try {
    let matter: LeadWorkflowResult['matter'];
    switch (attempt.action) {
      case 'push':
        await pushLead(
          attempt.leadId,
          attempt.body.expectedVersion,
          attempt.idempotencyKey,
        );
        break;
      case 'withdraw':
        await applyLeadWithdrawal(
          attempt.leadId,
          attempt.body.reason,
          attempt.body.expectedVersion,
          attempt.idempotencyKey,
        );
        break;
      case 'no-evidence':
        await decideLeadNoEvidence(
          attempt.leadId,
          attempt.body.reason,
          attempt.body.expectedVersion,
          attempt.idempotencyKey,
        );
        break;
      case 'transfer': {
        const result = await createNotaryMatter(
          attempt.leadId,
          attempt.body,
          attempt.idempotencyKey,
        );
        matter = { id: result.id, businessNo: result.businessNo };
        break;
      }
    }
    // Settlement is durable even after navigation; stale callbacks never refresh the new page.
    if (!storeAttempt(attempt, true)) {
      if (props.session.isCurrent()) {
        props.session.endSubmit('unknown');
        message.value = '请求已返回，但未决记录无法安全清理。请按原请求核对。';
      }
      return;
    }
    if (!props.session.isCurrent()) return;
    frozen.value = null;
    emit('pending');
    emit('completed', { attempt, ...(matter ? { matter } : {}) });
    props.session.endSubmit('success');
  } catch (error) {
    if (unknown(error)) {
      if (props.session.isCurrent()) {
        props.session.endSubmit('unknown');
        message.value =
          '提交结果尚未确认，已锁定原内容和请求键，请按原请求重试核对。';
      }
      return;
    }
    if (!storeAttempt(attempt, true)) {
      if (props.session.isCurrent()) props.session.endSubmit('unknown');
      return;
    }
    if (!props.session.isCurrent()) return;
    frozen.value = null;
    emit('pending');
    props.session.endSubmit('failed');
    denied.value =
      error instanceof ApiError && [401, 403, 404].includes(error.status);
    conflict.value =
      error instanceof ApiError &&
      (error.status === 409 ||
        ['VERSION_CONFLICT', 'INVALID_STATE'].includes(error.code));
    message.value = denied.value
      ? '权限或可访问范围已变化，已停止办理。请关闭后重新核对。'
      : conflict.value
        ? '线索状态或版本已变化，未提交输入已保留；请关闭并重新读取后办理。'
        : '提交未成功，已保留输入，请核对后重试。';
  } finally {
    if (props.session.isCurrent()) busy.value = false;
  }
}
async function submit() {
  const operation = action.value;
  if (!operation || !valid.value || !props.session.beginSubmit()) return;
  busy.value = true;
  message.value = '';
  try {
    const latest = await getLead(props.detail.id, {
      signal: controller.signal,
    });
    if (!props.session.isCurrent()) return;
    if (latest.id !== props.detail.id || !capability(latest, operation)) {
      denied.value = true;
      message.value = '当前线索已不能执行此操作，请关闭后核对最新权限和状态。';
      props.session.endSubmit('failed');
      return;
    }
    if (operation !== 'push' && latest.version !== props.detail.version) {
      conflict.value = true;
      message.value = '线索版本已变化，未发起提交。请关闭后重新读取。';
      props.session.endSubmit('failed');
      return;
    }
    const base = {
      identity: props.session.context.actorKey,
      leadId: latest.id,
      expectedVersion: latest.version,
      idempotencyKey: globalThis.crypto.randomUUID(),
    };
    let attempt: FrozenLeadCommand;
    if (operation === 'push')
      attempt = {
        ...base,
        action: operation,
        body: { expectedVersion: latest.version },
      };
    else if (operation === 'transfer')
      attempt = {
        ...base,
        action: operation,
        body: {
          expectedVersion: latest.version,
          selectedProductIds: [...productIds.value],
          selectedContentVersionIds: [...contentVersionIds.value],
          notaryOfficeId: officeId.value,
          evidenceMode: 'ONLINE_PURCHASE',
          batchPurpose: purpose.value.trim(),
          ...(latest.capabilities.createEvidenceBatch
            ? { createNewBatch: true }
            : {}),
        },
      };
    else if (operation === 'no-evidence')
      attempt = {
        ...base,
        action: operation,
        body: {
          result: 'NO_EVIDENCE',
          reason: reason.value.trim(),
          expectedVersion: latest.version,
        },
      };
    else
      attempt = {
        ...base,
        action: operation,
        body: { reason: reason.value.trim(), expectedVersion: latest.version },
      };
    if (!storeAttempt(attempt)) {
      storageUnavailable.value = true;
      message.value = '无法安全保存原请求，尚未提交。';
      props.session.endSubmit('failed');
      return;
    }
    frozen.value = attempt;
    emit('pending');
    await send(attempt);
  } catch {
    if (props.session.isCurrent()) {
      props.session.endSubmit('failed');
      message.value = '无法核对最新线索，尚未发起提交，已保留输入。';
    }
  } finally {
    if (props.session.isCurrent()) busy.value = false;
  }
}
async function retry() {
  const attempt = frozen.value;
  if (
    !attempt ||
    busy.value ||
    attempt.identity !== props.session.context.actorKey ||
    attempt.leadId !== props.detail.id ||
    !props.session.beginSubmit({ recovery: true })
  )
    return;
  busy.value = true;
  await send(attempt);
}
onMounted(() => {
  const entries = readPendingLeadCommands();
  storageUnavailable.value = entries === null;
  const pending = entries?.[props.session.context.actorKey];
  if (pending) {
    if (pending.leadId !== props.detail.id || !props.session.restoreUnknown()) {
      storageUnavailable.value = true;
      return;
    }
    frozen.value = pending;
    if (pending.action === 'transfer') {
      choice.value = 'transfer';
      productIds.value = [...pending.body.selectedProductIds];
      contentVersionIds.value = [...pending.body.selectedContentVersionIds];
      officeId.value = pending.body.notaryOfficeId;
      purpose.value = pending.body.batchPurpose;
    } else if (pending.action !== 'push') {
      reason.value = pending.body.reason;
      if (pending.action === 'no-evidence') choice.value = 'no-evidence';
    }
  } else void loadResources();
});
onBeforeUnmount(() => {
  controller.abort();
  for (const request of downloads) request.abort();
});
</script>

<template>
  <section class="workflow-panel" data-test="lead-workflow-form">
    <section class="workflow-card" aria-label="线索信息">
      <h2>线索信息</h2>
      <dl class="workflow-facts">
        <div>
          <dt>线索编号</dt>
          <dd>{{ detail.businessNo }}</dd>
        </div>
        <div>
          <dt>客户</dt>
          <dd>{{ detail.displayNames.customerName }}</dd>
        </div>
        <div class="workflow-facts__wide">
          <dt>店铺名称</dt>
          <dd>{{ detail.shopName }}</dd>
        </div>
      </dl>
    </section>
    <p v-if="storageUnavailable" role="alert">
      无法安全读取未决请求，暂不能提交。
    </p>
    <p v-if="message" role="alert">{{ message }}</p>
    <template v-if="frozen">
      <p>正在核对：{{ frozenLabel }}。本次提交内容已锁定。</p>
      <template v-if="frozen.action === 'transfer'">
        <p>本批次用途：{{ frozen.body.batchPurpose }}</p>
        <p>
          已选 {{ frozen.body.selectedProductIds.length }} 件商品、{{
            frozen.body.selectedContentVersionIds.length
          }}
          份截图。
        </p>
      </template>
      <p v-else-if="frozen.action !== 'push'">原因：{{ frozen.body.reason }}</p>
      <ElButton
        data-test="retry-unknown-lead"
        :disabled="busy || storageUnavailable"
        @click="retry"
        >按原请求重试核对</ElButton
      >
    </template>
    <template v-else-if="hasAction">
      <fieldset
        v-if="detail.status === 'WAITING_EVIDENCE_DECISION'"
        :disabled="locked"
        data-test="evidence-direction"
      >
        <legend>本次取证去向<RequiredFieldMark /></legend>
        <label v-if="transferAllowed"
          ><input
            v-model="choice"
            type="radio"
            value="transfer"
            data-test="choose-transfer"
          />取证并移交公证</label
        >
        <label v-if="detail.capabilities.evidenceDecide"
          ><input
            v-model="choice"
            type="radio"
            value="no-evidence"
            data-test="choose-no-evidence"
          />不取证并归档</label
        >
      </fieldset>
      <template v-if="action === 'transfer'">
        <p>
          {{
            detail.capabilities.createEvidenceBatch
              ? '新建独立取证批次，保留已有批次。'
              : '提交后移交公证，原线索保留只读。'
          }}
        </p>
        <p v-if="resourceError" role="alert">
          {{ resourceError }}
          <ElButton :disabled="locked" @click="loadResources"
            >重新读取材料和公证处</ElButton
          >
        </p>
        <p v-else-if="!resourcesReady" role="status">正在读取材料和公证处…</p>
        <fieldset :disabled="locked || !resourcesReady">
          <legend>本次取证商品<RequiredFieldMark /></legend>
          <label v-for="product in detail.products" :key="product.id"
            ><input
              v-model="productIds"
              type="checkbox"
              :value="product.id"
              :data-test="`select-product-${product.id}`"
            />{{ product.title || product.url || '未命名商品' }}</label
          >
        </fieldset>
        <fieldset v-if="screenshots.length" :disabled="locked">
          <legend>本次提供的截图（可选）</legend>
          <label v-for="screenshot in screenshots" :key="screenshot.versionId"
            ><input
              v-model="contentVersionIds"
              type="checkbox"
              :value="screenshot.versionId"
              :data-test="`select-evidence-${screenshot.versionId}`"
            />{{ screenshot.filename
            }}<ElButton
              text
              @click.prevent="
                download(screenshot.materialId, screenshot.versionId)
              "
              >查看附件</ElButton
            ></label
          >
        </fieldset>
        <label class="field-label"
          >公证处<RequiredFieldMark /><select
            v-model="officeId"
            data-test="notary-office"
            class="text-input"
            :disabled="locked || !resourcesReady"
            aria-required="true"
          >
            <option value="">请选择公证处</option>
            <option
              v-for="office in offices"
              :key="office.id"
              :value="office.id"
            >
              {{ office.name }}
            </option>
          </select></label
        >
        <div v-if="canCreateOffice">
          <label
            >新增公证处<input
              v-model="newOfficeName"
              data-test="new-notary-office-name"
              class="text-input"
              maxlength="200"
              :disabled="locked || creatingOffice" /></label
          ><ElButton
            data-test="create-notary-office"
            :disabled="locked || creatingOffice || !newOfficeName.trim()"
            @click="addOffice"
            >新增并选择</ElButton
          >
        </div>
        <label class="field-label"
          >本批次用途<RequiredFieldMark /><textarea
            v-model="purpose"
            data-test="batch-purpose"
            class="text-area"
            :disabled="locked"
            aria-required="true"
          />
        </label>
        <p>取证方式：线上购买。用途必填，最多500个字符。</p>
      </template>
      <template v-else-if="action === 'no-evidence' || action === 'withdraw'">
        <p>
          {{
            action === 'withdraw'
              ? '提交后线索仍保持归档，只有原客户企业确认后才回到待审核。'
              : '提交后线索立即归档，决定及原因保留为历史记录，当前页面不能撤回。'
          }}
        </p>
        <label class="field-label"
          >{{ action === 'withdraw' ? '撤回原因' : '不取证原因'
          }}<RequiredFieldMark /><textarea
            v-model="reason"
            class="text-area"
            :data-test="
              action === 'withdraw' ? 'withdrawal-reason' : 'no-evidence-reason'
            "
            aria-required="true"
            :disabled="locked"
          />
        </label>
        <p>已输入 {{ reasonLength }} / 5000 个字符（Unicode码点）。</p>
        <p v-if="reasonLength > 5000" role="alert">
          原因最多5000个字符，请删减后提交。
        </p>
      </template>
      <p v-else-if="action === 'push'">
        推送后线索进入待客户审核，客户下一次读取即可查看，当前阶段不能继续编辑。
      </p>
      <p v-if="action !== 'push'">
        尚未提交的输入只保留在当前表单，关闭会丢失；当前没有流程资料暂存功能。
      </p>
      <ElButton
        type="primary"
        data-test="submit-lead-workflow"
        :disabled="!valid"
        :loading="busy"
        @click="submit"
        >{{ submitLabel }}</ElButton
      >
    </template>
    <p v-else>
      当前账号没有可办理的下一步；请核对最新状态和权限。客户审核及确认须由客户在客户办理端完成。
    </p>
  </section>
</template>

<style scoped>
fieldset {
  margin: 16px 0;
  border: 1px solid var(--el-border-color);
}
fieldset label {
  display: block;
  margin: 8px 0;
}
.field-label {
  display: block;
  margin-top: 16px;
}
</style>
