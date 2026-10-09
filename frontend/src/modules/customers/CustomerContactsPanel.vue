<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import {
  createCustomerContact,
  endCustomerContact,
  getCustomer,
  listCustomerContactVersions,
  listCustomerContacts,
  setCustomerContactPrimary,
  updateCustomerContact,
  type CustomerContact,
  type CustomerContactVersion,
  type CustomerDetail,
} from '../../api/customers';
import {
  clearPendingCustomerContact,
  listPendingCustomerContacts,
  savePendingCustomerContact,
  type ContactAction,
  type PendingCustomerContact,
} from './customer-contacts-pending';

type Actor = {
  userId: string;
  departmentId: string;
  authorizationRevision?: number;
} | null;
const props = defineProps<{
  customer: CustomerDetail;
  actor: Actor;
  blockedByOtherMaintenance: boolean;
}>();
const emit = defineEmits<{
  refreshed: [customerId: string, actorKey: string, customer: CustomerDetail];
  'pending-changed': [customerId: string, actorKey: string, pending: boolean];
  'projection-stale': [customerId: string, actorKey: string, stale: boolean];
  unavailable: [customerId: string, actorKey: string];
}>();
const status = ref<'ACTIVE' | 'ENDED'>('ACTIVE');
const page = ref(1);
const pageSize = 20;
const contacts = ref<CustomerContact[]>([]);
const total = ref(0);
const versions = ref<CustomerContactVersion[]>([]);
const versionsTotal = ref(0);
const versionsPage = ref(1);
const selected = ref<CustomerContact>();
const editingId = ref<string>();
const name = ref('');
const phone = ref('');
const email = ref('');
const duty = ref('');
const primary = ref(false);
const endReason = ref('');
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const frozen = ref<PendingCustomerContact>();
const readOnlyStale = ref(false);
const unavailable = ref(false);
let contextGeneration = 0;
let listGeneration = 0;
let versionGeneration = 0;
let refreshGeneration = 0;
let confirmedWriteRefresh = false;
let listController: AbortController | undefined;
let versionController: AbortController | undefined;
let refreshController: AbortController | undefined;
const actorKey = computed(() =>
  props.actor
    ? `${props.actor.userId}:${props.actor.departmentId}:${props.actor.authorizationRevision ?? 0}`
    : '',
);
const blocked = computed(
  () => props.blockedByOtherMaintenance || readOnlyStale.value,
);
const canWrite = computed(
  () =>
    Boolean(props.actor && props.customer.capabilities.editRoutine) &&
    !blocked.value,
);
function current(context: number, customerId: string, who: string): boolean {
  return (
    contextGeneration === context &&
    props.customer.id === customerId &&
    actorKey.value === who
  );
}
function setProjectionStale(stale: boolean, forceEmit = false): void {
  if (readOnlyStale.value === stale && !forceEmit) return;
  readOnlyStale.value = stale;
  emit('projection-stale', props.customer.id, actorKey.value, stale);
}
function clearVisibleData(): void {
  listGeneration++;
  versionGeneration++;
  contacts.value = [];
  total.value = 0;
  versions.value = [];
  versionsTotal.value = 0;
  selected.value = undefined;
  resetForm();
}
function handleDeniedRead(): void {
  listController?.abort();
  versionController?.abort();
  clearVisibleData();
  unavailable.value = true;
  loading.value = false;
  setProjectionStale(true);
  error.value = '联系人资料当前不可用，请恢复访问后刷新';
  emit('unavailable', props.customer.id, actorKey.value);
}
function announcePending(): void {
  emit(
    'pending-changed',
    props.customer.id,
    actorKey.value,
    Boolean(frozen.value),
  );
}
function recoverPending(): void {
  frozen.value = undefined;
  if (props.actor) {
    const all = listPendingCustomerContacts(props.actor, props.customer.id);
    frozen.value = all[0];
  }
  announcePending();
}
function resetForm(contact?: CustomerContact): void {
  editingId.value = contact?.id;
  name.value = contact?.name ?? '';
  phone.value = contact?.phone ?? '';
  email.value = contact?.email ?? '';
  duty.value = contact?.duty ?? '';
  primary.value = contact?.isPrimary ?? false;
  endReason.value = '';
}
async function load(): Promise<boolean> {
  listController?.abort();
  listController = new AbortController();
  const signal = listController.signal;
  const context = contextGeneration;
  const read = ++listGeneration;
  const customerId = props.customer.id;
  const who = actorKey.value;
  loading.value = true;
  error.value = '';
  selected.value = undefined;
  versions.value = [];
  resetForm();
  try {
    const result = await listCustomerContacts(
      customerId,
      status.value,
      page.value,
      pageSize,
      { signal },
    );
    if (!current(context, customerId, who) || read !== listGeneration)
      return false;
    contacts.value = result.items;
    total.value = result.total;
    if (
      selected.value &&
      !result.items.some((c) => c.id === selected.value?.id)
    )
      selected.value = undefined;
    if (
      frozen.value?.contactId &&
      result.items.some((c) => c.id === frozen.value?.contactId)
    )
      selected.value = result.items.find(
        (c) => c.id === frozen.value?.contactId,
      );
    setProjectionStale(false, true);
    return true;
  } catch (cause) {
    if (
      current(context, customerId, who) &&
      read === listGeneration &&
      cause instanceof ApiError &&
      (cause.status === 403 || cause.status === 404)
    ) {
      handleDeniedRead();
    } else if (current(context, customerId, who) && read === listGeneration) {
      error.value = '联系人列表暂时无法读取';
    }
    return false;
  } finally {
    if (current(context, customerId, who) && read === listGeneration)
      loading.value = false;
  }
}
async function loadVersions(contact: CustomerContact): Promise<void> {
  versionController?.abort();
  versionController = new AbortController();
  const signal = versionController.signal;
  const context = contextGeneration;
  const read = ++versionGeneration;
  const customerId = props.customer.id;
  const who = actorKey.value;
  selected.value = contact;
  versionsPage.value = 1;
  try {
    const result = await listCustomerContactVersions(
      customerId,
      contact.id,
      1,
      pageSize,
      { signal },
    );
    if (
      !current(context, customerId, who) ||
      read !== versionGeneration ||
      selected.value?.id !== contact.id
    )
      return;
    versions.value = result.items;
    versionsTotal.value = result.total;
  } catch (cause) {
    if (
      current(context, customerId, who) &&
      read === versionGeneration &&
      cause instanceof ApiError &&
      (cause.status === 403 || cause.status === 404)
    ) {
      handleDeniedRead();
    } else if (
      current(context, customerId, who) &&
      read === versionGeneration
    ) {
      error.value = '联系人历史暂时无法读取';
    }
  }
}
async function loadVersionPage(next: number): Promise<void> {
  if (!selected.value) return;
  versionController?.abort();
  versionController = new AbortController();
  const signal = versionController.signal;
  const context = contextGeneration;
  const read = ++versionGeneration;
  const customerId = props.customer.id;
  const who = actorKey.value;
  const contactId = selected.value.id;
  try {
    const result = await listCustomerContactVersions(
      customerId,
      contactId,
      next,
      pageSize,
      { signal },
    );
    if (
      !current(context, customerId, who) ||
      read !== versionGeneration ||
      selected.value?.id !== contactId
    )
      return;
    versions.value = result.items;
    versionsPage.value = next;
    versionsTotal.value = result.total;
  } catch (cause) {
    if (
      current(context, customerId, who) &&
      read === versionGeneration &&
      cause instanceof ApiError &&
      (cause.status === 403 || cause.status === 404)
    ) {
      handleDeniedRead();
    } else if (
      current(context, customerId, who) &&
      read === versionGeneration
    ) {
      error.value = '联系人历史暂时无法读取';
    }
  }
}
async function refreshReadonly(): Promise<void> {
  refreshController?.abort();
  refreshController = new AbortController();
  const signal = refreshController.signal;
  const context = contextGeneration,
    request = ++refreshGeneration,
    customerId = props.customer.id,
    who = actorKey.value;
  try {
    const latest = await getCustomer(customerId, { signal });
    if (!current(context, customerId, who) || request !== refreshGeneration)
      return;
    const active = await listCustomerContacts(
      customerId,
      'ACTIVE',
      status.value === 'ACTIVE' ? page.value : 1,
      pageSize,
      { signal },
    );
    const ended = await listCustomerContacts(
      customerId,
      'ENDED',
      status.value === 'ENDED' ? page.value : 1,
      pageSize,
      { signal },
    );
    if (!current(context, customerId, who) || request !== refreshGeneration)
      return;
    contacts.value = status.value === 'ACTIVE' ? active.items : ended.items;
    total.value = status.value === 'ACTIVE' ? active.total : ended.total;
    unavailable.value = false;
    emit('refreshed', customerId, who, latest);
    setProjectionStale(false, true);
  } catch (cause) {
    if (
      current(context, customerId, who) &&
      request === refreshGeneration &&
      cause instanceof ApiError &&
      (cause.status === 403 || cause.status === 404)
    ) {
      handleDeniedRead();
      return;
    }
    if (current(context, customerId, who) && request === refreshGeneration)
      error.value = '当前资料仍未刷新成功，联系人保持只读';
  }
}
function bodyFor(action: ContactAction): Record<string, unknown> | undefined {
  const expectedCustomerVersion = props.customer.version;
  if (action === 'create' || action === 'update') {
    const n = name.value.trim(),
      p = phone.value.trim(),
      e = email.value.trim(),
      d = duty.value.trim();
    if (
      !n ||
      n.length > 100 ||
      (!p && !e) ||
      p.length > 30 ||
      e.length > 254 ||
      d.length > 500 ||
      (p && !/^(?=(?:\D*\d){6,20}\D*$)[+()\d\s-]+$/u.test(p)) ||
      (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(e))
    ) {
      error.value = '请检查姓名、电话、邮箱和负责事项';
      return;
    }
    return action === 'create'
      ? {
          expectedCustomerVersion,
          name: n,
          ...(p ? { phone: p } : {}),
          ...(e ? { email: e } : {}),
          ...(d ? { duty: d } : {}),
          ...(primary.value ? { isPrimary: true } : {}),
        }
      : {
          expectedCustomerVersion,
          expectedContactVersion: selected.value!.version,
          name: n,
          phone: p || null,
          email: e || null,
          duty: d || null,
        };
  }
  if (!selected.value) return;
  if (action === 'primary')
    return {
      expectedCustomerVersion,
      expectedContactVersion: selected.value.version,
      primary: !selected.value.isPrimary,
    };
  const reason = endReason.value.trim();
  if (reason.length > 500) {
    error.value = '结束原因不能超过500字';
    return;
  }
  return {
    expectedCustomerVersion,
    expectedContactVersion: selected.value.version,
    ...(reason ? { reason } : {}),
  };
}
function pendingCommand(
  action: ContactAction,
  body: Record<string, unknown>,
): PendingCustomerContact {
  if (!props.actor) throw new Error('当前账号不能维护联系人');
  return {
    action,
    userId: props.actor.userId,
    departmentId: props.actor.departmentId,
    customerId: props.customer.id,
    contactId: action === 'create' ? null : selected.value!.id,
    expectedCustomerVersion: props.customer.version,
    expectedContactVersion:
      action === 'create' ? null : selected.value!.version,
    body,
    key: globalThis.crypto.randomUUID(),
  };
}
async function send(command: PendingCustomerContact): Promise<void> {
  const context = contextGeneration,
    customerId = command.customerId,
    who = actorKey.value;
  saving.value = true;
  error.value = '';
  try {
    const id = command.contactId;
    const body = command.body as import('../../api/http').JsonValue;
    if (command.action === 'create')
      await createCustomerContact(customerId, body, command.key);
    else if (command.action === 'update' && id)
      await updateCustomerContact(customerId, id, body, command.key);
    else if (command.action === 'primary' && id)
      await setCustomerContactPrimary(customerId, id, body, command.key);
    else if (command.action === 'end' && id)
      await endCustomerContact(customerId, id, body, command.key);
    else throw new Error('联系人请求状态无效');
    if (!current(context, customerId, who)) return;
    setProjectionStale(true);
    clearPendingCustomerContact(command);
    frozen.value = undefined;
    announcePending();
    try {
      const latest = await getCustomer(customerId);
      if (!current(context, customerId, who)) return;
      confirmedWriteRefresh = true;
      emit('refreshed', customerId, who, latest);
      try {
        const contactsRefreshed = await load();
        if (!current(context, customerId, who)) return;
        if (contactsRefreshed) {
          setProjectionStale(false);
        } else {
          setProjectionStale(true);
          error.value =
            '联系人已保存，但联系人列表刷新失败。刷新完成前只允许只读重试。';
        }
      } finally {
        confirmedWriteRefresh = false;
      }
    } catch {
      setProjectionStale(true);
      error.value =
        '联系人已保存，但当前资料刷新失败。刷新完成前只允许只读重试。';
    }
  } catch (cause) {
    if (!current(context, customerId, who)) return;
    if (
      cause instanceof ApiError &&
      cause.status === 409 &&
      [
        'CUSTOMER_VERSION_CONFLICT',
        'CUSTOMER_CONTACT_VERSION_CONFLICT',
        'CUSTOMER_CONTACT_ENDED',
        'CUSTOMER_CONTACT_STATE_CONFLICT',
      ].includes(cause.code)
    ) {
      const draft = {
        editingId: editingId.value,
        name: name.value,
        phone: phone.value,
        email: email.value,
        duty: duty.value,
        primary: primary.value,
        endReason: endReason.value,
      };
      clearPendingCustomerContact(command);
      frozen.value = undefined;
      announcePending();
      error.value = '联系人资料已变化，已保留表单。请刷新并核对后再提交。';
      try {
        const latest = await getCustomer(customerId);
        if (current(context, customerId, who))
          emit('refreshed', customerId, who, latest);
        await load();
      } catch {
        /* Keep the draft visible while the refresh remains available. */
      }
      if (props.customer.id === customerId && actorKey.value === who) {
        editingId.value = draft.editingId;
        name.value = draft.name;
        phone.value = draft.phone;
        email.value = draft.email;
        duty.value = draft.duty;
        primary.value = draft.primary;
        endReason.value = draft.endReason;
      }
      return;
    }
    frozen.value = command;
    announcePending();
    error.value =
      '结果尚未确认，已保留原请求和幂等键。恢复访问后可按原请求重试。';
  } finally {
    if (current(context, customerId, who)) saving.value = false;
  }
}
async function submit(): Promise<void> {
  if (!canWrite.value || saving.value || frozen.value) return;
  const action: ContactAction = editingId.value ? 'update' : 'create';
  const body = bodyFor(action);
  if (!body) return;
  try {
    const command = pendingCommand(action, body);
    savePendingCustomerContact(command);
    frozen.value = command;
    announcePending();
    await send(command);
  } catch {
    error.value =
      '无法安全保存联系人请求，未发送请求。请检查浏览器会话存储后重试。';
  }
}
async function retry(): Promise<void> {
  if (frozen.value) await send(frozen.value);
}
async function setPrimary(): Promise<void> {
  if (!canWrite.value || !selected.value || frozen.value) return;
  const body = bodyFor('primary');
  if (!body) return;
  try {
    const command = pendingCommand('primary', body);
    savePendingCustomerContact(command);
    frozen.value = command;
    announcePending();
    await send(command);
  } catch {
    error.value = '无法安全保存联系人请求，未发送请求。';
  }
}
async function end(): Promise<void> {
  if (!canWrite.value || !selected.value || frozen.value) return;
  const body = bodyFor('end');
  if (!body) return;
  try {
    const command = pendingCommand('end', body);
    savePendingCustomerContact(command);
    frozen.value = command;
    announcePending();
    await send(command);
  } catch {
    error.value = '无法安全保存联系人请求，未发送请求。';
  }
}
watch(
  [() => props.customer.id, actorKey],
  () => {
    listController?.abort();
    versionController?.abort();
    refreshController?.abort();
    contextGeneration++;
    confirmedWriteRefresh = false;
    contacts.value = [];
    unavailable.value = false;
    selected.value = undefined;
    frozen.value = undefined;
    setProjectionStale(false);
    page.value = 1;
    status.value = 'ACTIVE';
    recoverPending();
    void load();
  },
  { immediate: true },
);
watch(
  () => [props.customer.version, props.blockedByOtherMaintenance],
  () => {
    if (props.customer.id && !confirmedWriteRefresh) void load();
  },
);
watch([status, page], () => void load());
onBeforeUnmount(() => {
  contextGeneration++;
  listGeneration++;
  versionGeneration++;
  refreshGeneration++;
  listController?.abort();
  versionController?.abort();
  refreshController?.abort();
});
</script>

<template>
  <section
    class="ledger-panel detail-card"
    data-test="customer-contacts-panel"
    aria-labelledby="contacts-title"
  >
    <div class="section-heading">
      <div>
        <p class="section-kicker">客户联系人</p>
        <h2 id="contacts-title">联系人关系</h2>
      </div>
      <ElButton v-if="canWrite" data-test="contact-new" @click="resetForm()"
        >新增联系人</ElButton
      >
    </div>
    <p v-if="blocked" role="status">
      其他维护结果尚未确认或客户资料需要刷新。联系人暂时只读。
    </p>
    <p v-if="frozen" role="alert">
      联系人请求结果尚未确认。此请求会冻结同客户的其他维护；重试会使用原请求。
    </p>
    <ElButton
      v-if="readOnlyStale"
      data-test="contact-refresh-readonly"
      @click="refreshReadonly"
      >只读刷新联系人</ElButton
    >
    <div class="detail-actions">
      <button
        type="button"
        :aria-pressed="status === 'ACTIVE'"
        @click="
          status = 'ACTIVE';
          page = 1;
        "
      >
        活动联系人</button
      ><button
        type="button"
        :aria-pressed="status === 'ENDED'"
        @click="
          status = 'ENDED';
          page = 1;
        "
      >
        已结束
      </button>
    </div>
    <p v-if="!props.customer.primaryContactId">当前未指定主要联系人</p>
    <p v-else>主要联系人已从当前授权数据确认。</p>
    <p
      v-if="!unavailable && props.customer.admissionContactSnapshot"
      data-test="admission-contact-snapshot"
    >
      准入时登记的联系人资料：{{
        props.customer.admissionContactSnapshot.name
      }}；{{
        props.customer.admissionContactSnapshot.phone || '未填写电话'
      }}；{{
        props.customer.admissionContactSnapshot.email || '未填写邮箱'
      }}；{{
        props.customer.admissionContactSnapshot.source === 'FALLBACK_CURRENT'
          ? '迁移时保存，原准入时内容无法确认'
          : '准入时保存'
      }}（{{
        new Date(
          props.customer.admissionContactSnapshot.frozenAt,
        ).toLocaleDateString('zh-CN')
      }}）
    </p>
    <p v-else-if="!unavailable && props.customer.profileStatus === 'admitted'">
      准入联系人历史快照暂不可用。
    </p>
    <p v-if="loading">正在读取联系人…</p>
    <p v-else-if="!contacts.length && !error">
      暂无{{ status === 'ACTIVE' ? '活动' : '已结束' }}联系人
    </p>
    <ul>
      <li
        v-for="contact in contacts"
        :key="contact.id"
        :data-test="`contact-${contact.id}`"
      >
        <button type="button" @click="loadVersions(contact)">
          {{ contact.name }} · {{ contact.phone || contact.email
          }}<span v-if="contact.isPrimary">（主要）</span></button
        ><small
          >{{ contact.origin === 'LEGACY_BACKFILL' ? '系统记录时间：' : ''
          }}{{ new Date(contact.createdAt).toLocaleDateString('zh-CN') }}</small
        ><ElButton
          v-if="canWrite && !contact.endedAt"
          @click="
            selected = contact;
            resetForm(contact);
          "
          >编辑</ElButton
        >
      </li>
    </ul>
    <div v-if="total > pageSize">
      <ElButton :disabled="page <= 1" @click="page--">上一页</ElButton
      ><span>{{ page }} / {{ Math.ceil(total / pageSize) }}</span
      ><ElButton :disabled="page * pageSize >= total" @click="page++"
        >下一页</ElButton
      >
    </div>
    <div v-if="selected">
      <h3>联系人历史：{{ selected.name }}</h3>
      <ol>
        <li v-for="version in versions" :key="version.id">
          {{
            version.action === 'CREATED'
              ? '创建'
              : version.action === 'UPDATED'
                ? '更新'
                : version.action === 'PRIMARY_SET'
                  ? '设为主要'
                  : version.action === 'PRIMARY_UNSET'
                    ? '取消主要'
                    : '结束'
          }}
          · {{ version.after.name }} ·
          {{ new Date(version.occurredAt).toLocaleString('zh-CN') }} ·
          {{ version.actor.kind === 'HUMAN' ? '人工办理' : '迁移记录' }}
        </li>
      </ol>
      <div v-if="versionsTotal > pageSize">
        <ElButton
          :disabled="versionsPage <= 1"
          @click="loadVersionPage(versionsPage - 1)"
          >上一页</ElButton
        ><ElButton
          :disabled="versionsPage * pageSize >= versionsTotal"
          @click="loadVersionPage(versionsPage + 1)"
          >下一页</ElButton
        >
      </div>
    </div>
    <form v-if="canWrite && (editingId || !frozen)" @submit.prevent="submit">
      <h3>{{ editingId ? '编辑联系人' : '新增联系人' }}</h3>
      <label>姓名<input v-model="name" maxlength="100" required /></label
      ><label>电话<input v-model="phone" maxlength="30" /></label
      ><label>邮箱<input v-model="email" maxlength="254" type="email" /></label
      ><label>负责事项<input v-model="duty" maxlength="500" /></label
      ><label v-if="!editingId"
        ><input v-model="primary" type="checkbox" />设为主要联系人</label
      ><label v-if="editingId && selected?.endedAt === null"
        >结束原因（选填）<input v-model="endReason" maxlength="500" /></label
      ><ElButton native-type="submit" :disabled="saving || Boolean(frozen)"
        >保存联系人</ElButton
      ><ElButton
        v-if="editingId && selected?.endedAt === null"
        native-type="button"
        :disabled="saving || Boolean(frozen)"
        @click="end"
        >结束关系</ElButton
      ><ElButton
        v-if="editingId && selected?.endedAt === null"
        native-type="button"
        :disabled="saving || Boolean(frozen)"
        @click="setPrimary"
        >{{ selected?.isPrimary ? '取消主要' : '设为主要' }}</ElButton
      >
    </form>
    <p v-if="error" role="alert">{{ error }}</p>
    <ElButton
      v-if="frozen"
      data-test="contact-retry"
      :loading="saving"
      @click="retry"
      >按原请求重试</ElButton
    >
  </section>
</template>
