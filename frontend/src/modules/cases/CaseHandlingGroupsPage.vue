<script lang="ts">
import {
  isCaseHandlingGroupAttempt,
  isCaseHandlingGroupCommandResult,
  type CaseHandlingGroupAttempt,
  type CaseHandlingGroupCommandContext,
  type CaseHandlingGroupCommandOutcome,
} from '../../api/case-handling-groups';

const pendingStorageKey = 'case-handling-group-pending-v1';
export function readPendingCaseHandlingGroups(): Record<
  string,
  CaseHandlingGroupAttempt
> | null {
  try {
    const raw = globalThis.localStorage.getItem(pendingStorageKey);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      !Object.entries(parsed).every(
        ([actor, attempt]) =>
          isCaseHandlingGroupAttempt(attempt) && attempt.actorKey === actor,
      )
    )
      return null;
    return parsed as Record<string, CaseHandlingGroupAttempt>;
  } catch {
    return null;
  }
}
export function savePendingCaseHandlingGroups(
  entries: Record<string, CaseHandlingGroupAttempt>,
): boolean {
  try {
    if (
      !Object.entries(entries).every(
        ([actor, attempt]) =>
          isCaseHandlingGroupAttempt(attempt) && attempt.actorKey === actor,
      )
    )
      return false;
    globalThis.localStorage.setItem(pendingStorageKey, JSON.stringify(entries));
    return true;
  } catch {
    return false;
  }
}
export function sameCaseHandlingGroupAttempt(
  left: CaseHandlingGroupAttempt,
  right: CaseHandlingGroupAttempt,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
export function clearPendingCaseHandlingGroup(
  attempt: CaseHandlingGroupAttempt,
): boolean {
  const entries = readPendingCaseHandlingGroups();
  const stored = entries?.[attempt.actorKey];
  if (!entries || !stored || !sameCaseHandlingGroupAttempt(stored, attempt))
    return false;
  delete entries[attempt.actorKey];
  return savePendingCaseHandlingGroups(entries);
}
function copyAttempt(
  attempt: CaseHandlingGroupAttempt,
): CaseHandlingGroupAttempt {
  return attempt.kind === 'CREATE'
    ? {
        ...attempt,
        input: { ...attempt.input, caseIds: [...attempt.input.caseIds] },
      }
    : { ...attempt, input: { ...attempt.input } };
}
export async function runCaseHandlingGroupAttempt(
  original: CaseHandlingGroupAttempt,
  context: CaseHandlingGroupCommandContext,
  isCurrent: () => boolean,
  command: (
    attempt: CaseHandlingGroupAttempt,
    signal: CaseHandlingGroupCommandContext['signal'],
  ) => Promise<unknown>,
): Promise<CaseHandlingGroupCommandOutcome> {
  const unknown = (): CaseHandlingGroupCommandOutcome => ({
    kind: 'unknown',
    message: '结果待核对，完整原请求及请求键已保留，请原样显式重试。',
  });
  if (
    !isCaseHandlingGroupAttempt(original) ||
    original.actorKey !== context.actorKey ||
    context.signal.aborted ||
    !isCurrent()
  )
    return { kind: 'rejected', message: '当前身份或页面已变化，请重新读取。' };
  const attempt = copyAttempt(original);
  const entries = readPendingCaseHandlingGroups();
  if (
    !entries ||
    (entries[attempt.actorKey] &&
      !sameCaseHandlingGroupAttempt(entries[attempt.actorKey]!, attempt))
  )
    return {
      kind: 'rejected',
      message: '已有不同原请求或存储不可读，请先核对原请求。',
    };
  entries[attempt.actorKey] = attempt;
  if (!savePendingCaseHandlingGroups(entries))
    return { kind: 'rejected', message: '无法安全保存原请求，操作未发送。' };
  if (context.signal.aborted || !isCurrent()) return unknown();
  try {
    const result = await command(copyAttempt(attempt), context.signal);
    if (
      context.signal.aborted ||
      !isCurrent() ||
      !isCaseHandlingGroupCommandResult(result, attempt)
    )
      return unknown();
    if (!clearPendingCaseHandlingGroup(attempt)) return unknown();
    return { kind: 'confirmed', result };
  } catch {
    return unknown();
  }
}
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import { useAuthStore } from '../../stores/auth';
import {
  createCaseHandlingGroup,
  dissolveCaseHandlingGroup,
  getCaseHandlingGroup,
  getCaseHandlingGroupCapability,
  listCaseHandlingGroupCandidates,
  listCaseHandlingGroups,
  type CaseHandlingGroupDetail,
  type CaseHandlingGroupMember,
  type PrepareCaseHandlingGroupSelection,
  type SubmitCaseHandlingGroupAttempt,
  type CaseHandlingGroupCommandResult,
} from '../../api/case-handling-groups';
import CaseHandlingGroupCreatePanel from './CaseHandlingGroupCreatePanel.vue';
import CaseHandlingGroupDetailPanel from './CaseHandlingGroupDetailPanel.vue';
import {
  getCaseHandlingGroupMaterials,
  getCaseHandlingGroupFees,
} from '../../api/case-handling-group-resources';
import { downloadMaterialVersion } from '../../api/materials';
import CaseHandlingGroupResourcesPanel, {
  type LoadGroupResourcePage,
  type DownloadGroupMaterial,
} from './CaseHandlingGroupResourcesPanel.vue';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const sessionEpoch = ref(0);
watch(
  () => auth.session,
  () => {
    sessionEpoch.value += 1;
  },
  { flush: 'sync' },
);
const actorKey = computed(() =>
  auth.session?.principalType === 'INTERNAL' && auth.session.department
    ? `${auth.session.user.id}:INTERNAL:${auth.session.department.id}`
    : '',
);
const pageContext = computed(
  () =>
    `${actorKey.value}:${auth.session?.authorizationRevision ?? ''}:${sessionEpoch.value}:${route.fullPath}`,
);
const returnTo = computed(() => {
  const value = route.query.returnTo;
  return typeof value === 'string' && /^\/cases(?:[?#]|$)/u.test(value)
    ? value
    : '/cases';
});
const page = computed(() =>
  typeof route.query.page === 'string' &&
  /^[1-9]\d*$/u.test(route.query.page) &&
  Number.isSafeInteger(Number(route.query.page))
    ? Number(route.query.page)
    : 1,
);
const invalidPage = computed(
  () =>
    route.query.page !== undefined &&
    (typeof route.query.page !== 'string' ||
      String(page.value) !== route.query.page),
);
const state = ref<'loading' | 'ready' | 'failed'>('loading');
const error = ref('');
const message = ref('');
const groups = ref<CaseHandlingGroupDetail[]>([]);
const total = ref(0);
const canCreate = ref(false);
const detail = ref<CaseHandlingGroupDetail | null>(null);
const detailError = ref('');
const detailOpen = ref(false);
const resourcesOpen = ref(false);
const loadResources: LoadGroupResourcePage = async (request) => {
  if (
    !actorKey.value ||
    !detailOpen.value ||
    !detail.value ||
    request.groupId !== detail.value.id
  )
    throw new ApiError('当前无法读取办理组资料', 403, 'FORBIDDEN');
  const snapshot = {
    groupId: detail.value.id,
    revision: detail.value.revision,
    status: detail.value.status,
  };
  const query = {
    page: request.section === 'notary-summary' ? 1 : request.page,
    pageSize: request.pageSize,
  };
  const options = { signal: request.signal };
  if (request.section === 'materials') {
    const result = await getCaseHandlingGroupMaterials(
      snapshot,
      query,
      options,
    );
    return {
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      items: result.items.map((item) => ({
        kind: 'material' as const,
        caseId: item.caseId,
        businessNo: item.businessNo,
        materialId: item.materialId,
        contentVersionId: item.contentVersionId,
        fileName: item.originalFilename,
        versionLabel: item.isCurrent ? '当前版本' : '历史版本',
        metadata: `${item.category} · ${item.purpose} · ${item.mimeType} · ${item.sizeBytes} bytes · SHA256 ${item.sha256}`,
      })),
    };
  }
  const result = await getCaseHandlingGroupFees(snapshot, query, options);
  if (request.section === 'notary-summary') {
    const labels = {
      NOTARY: '公证费',
      SAMPLE: '样品费',
      INVESTIGATION: '调查费',
      DISCLOSURE: '披露费',
    };
    return {
      page: 1,
      pageSize: Math.max(20, result.notarySummaries.length),
      total: result.notarySummaries.length,
      items: result.notarySummaries.map((item) => ({
        kind: 'notary-summary' as const,
        caseId: item.caseId,
        businessNo: item.businessNo,
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        category: item.category,
        label: labels[item.category],
        amount: item.amount,
        stateLabel: item.state === 'PENDING' ? '待确认' : '已知',
      })),
    };
  }
  if (!result.canReadLedger)
    throw new ApiError('无费用账读取权限', 403, 'FORBIDDEN');
  return {
    page: result.ledger.page,
    pageSize: result.ledger.pageSize,
    total: result.ledger.total,
    items: result.ledger.items.map((item) => ({
      kind: 'ledger' as const,
      caseId: item.caseId,
      businessNo: item.businessNo,
      sourceId: item.feeId,
      label: `${item.type} · ${item.direction} · ${item.feeDate} · ${item.source}`,
      amount: item.amount,
      stateLabel: item.status,
    })),
  };
};
const downloadResource: DownloadGroupMaterial = async (
  material,
  { signal },
) => {
  if (!actorKey.value || !detailOpen.value || !detail.value)
    throw new ApiError('当前无法下载', 403, 'FORBIDDEN');
  signal.throwIfAborted();
  await downloadMaterialVersion(
    material.materialId,
    material.contentVersionId,
    signal,
  );
};
const entries = ref(readPendingCaseHandlingGroups());
const pending = computed(() => entries.value?.[actorKey.value] ?? null);
const createOpen = ref(false);
const candidateEpoch = ref(0);
const createContext = computed(
  () => `${pageContext.value}:selection:${candidateEpoch.value}`,
);
const candidates = ref<CaseHandlingGroupMember[]>([]);
const candidatePage = ref(0);
const candidateTotal = ref(0);
const candidateBusy = ref(false);
const candidateError = ref('');
const queryDraft = ref('');
const appliedQuery = ref('');
const recoveryConfirmed = ref(false);
const recoveryBusy = ref(false);
const pendingCreate = computed(() =>
  pending.value?.kind === 'CREATE' ? pending.value : null,
);
const pendingDissolve = computed(() =>
  pending.value?.kind === 'DISSOLVE' ? pending.value : null,
);
const displayedDetail = computed(() =>
  detail.value
    ? {
        ...detail.value,
        canDissolve:
          entries.value !== null &&
          detail.value.canDissolve &&
          (!pending.value ||
            (pendingDissolve.value !== null &&
              pendingDissolve.value.groupId.toLowerCase() ===
                detail.value.id.toLowerCase())),
      }
    : null,
);
let mounted = true;
let loadController: AbortController | undefined;
let candidateController: AbortController | undefined;
let recoveryController: AbortController | undefined;
async function loadPage(): Promise<void> {
  loadController?.abort();
  candidateController?.abort();
  recoveryController?.abort();
  const controller = new AbortController();
  loadController = controller;
  const key = pageContext.value;
  const current = () =>
    mounted &&
    !controller.signal.aborted &&
    pageContext.value === key &&
    loadController === controller;
  createOpen.value = false;
  detailOpen.value = false;
  resourcesOpen.value = false;
  detail.value = null;
  groups.value = [];
  total.value = 0;
  canCreate.value = false;
  candidates.value = [];
  candidateEpoch.value += 1;
  candidateBusy.value = false;
  recoveryBusy.value = false;
  recoveryConfirmed.value = false;
  entries.value = readPendingCaseHandlingGroups();
  state.value = 'loading';
  error.value = '';
  detailError.value = '';
  if (!actorKey.value || invalidPage.value) {
    state.value = 'failed';
    error.value = invalidPage.value
      ? '分页参数无效，请返回案件列表重新进入。'
      : '当前账号无法读取案件办理组。';
    return;
  }
  const options = { signal: controller.signal };
  const tasks: Promise<unknown>[] = [
    getCaseHandlingGroupCapability(options)
      .then((value) => {
        if (current()) canCreate.value = value.canCreate;
      })
      .catch(() => {
        if (current()) canCreate.value = false;
      }),
    listCaseHandlingGroups({ page: page.value, pageSize: 20 }, options)
      .then((value) => {
        if (current()) {
          groups.value = value.items;
          total.value = value.total;
          state.value = 'ready';
        }
      })
      .catch(() => {
        if (current()) {
          state.value = 'failed';
          error.value = '办理组暂时无法读取，请重试。';
        }
      }),
  ];
  if (typeof route.params.id === 'string' && route.params.id.length > 0)
    tasks.push(
      getCaseHandlingGroup(route.params.id, options)
        .then((value) => {
          if (current()) {
            detail.value = value;
            detailOpen.value = true;
          }
        })
        .catch(() => {
          if (current())
            detailError.value = '当前办理组不存在或不可读取，原请求仍会保留。';
        }),
    );
  await Promise.allSettled(tasks);
}
async function readCandidates(append: boolean): Promise<void> {
  if (
    !createOpen.value ||
    pendingCreate.value ||
    candidateBusy.value ||
    !canCreate.value
  )
    return;
  if (!append) {
    appliedQuery.value = queryDraft.value;
    candidates.value = [];
    candidatePage.value = 0;
    candidateTotal.value = 0;
    candidateEpoch.value += 1;
  }
  candidateController?.abort();
  const controller = new AbortController();
  candidateController = controller;
  const key = createContext.value;
  const next = append ? candidatePage.value + 1 : 1;
  candidateBusy.value = true;
  candidateError.value = '';
  try {
    const value = await listCaseHandlingGroupCandidates(
      { page: next, pageSize: 100, q: appliedQuery.value },
      { signal: controller.signal },
    );
    if (
      !mounted ||
      controller.signal.aborted ||
      createContext.value !== key ||
      !createOpen.value
    )
      return;
    const byId = new Map(
      (append ? candidates.value : []).map((member) => [
        member.caseId.toLowerCase(),
        member,
      ]),
    );
    value.items.forEach((member) =>
      byId.set(member.caseId.toLowerCase(), member),
    );
    candidates.value = [...byId.values()];
    candidatePage.value = value.page;
    candidateTotal.value = value.total;
  } catch {
    if (mounted && !controller.signal.aborted && createContext.value === key)
      candidateError.value = '无法读取当前可选案件，请重新查询。';
  } finally {
    if (candidateController === controller) candidateBusy.value = false;
  }
}
function openCreate(): void {
  entries.value = readPendingCaseHandlingGroups();
  if (
    !actorKey.value ||
    !canCreate.value ||
    entries.value === null ||
    pending.value ||
    createOpen.value ||
    detailOpen.value ||
    recoveryBusy.value
  )
    return;
  createOpen.value = true;
  queryDraft.value = '';
  appliedQuery.value = '';
  candidatePage.value = 0;
  candidateTotal.value = 0;
  candidates.value = [];
  void readCandidates(false);
}
const prepareSelection: PrepareCaseHandlingGroupSelection = async (
  caseIds,
  options,
) => {
  const key = createContext.value;
  const selected = caseIds.map((id) =>
    candidates.value.find(
      (member) => member.caseId.toLowerCase() === id.toLowerCase(),
    ),
  );
  if (selected.some((member) => member === undefined))
    return { allowed: false, members: [] };
  const known = selected as CaseHandlingGroupMember[];
  if (
    new Set(known.map((member) => member.customerId.toLowerCase())).size !== 1
  )
    return { allowed: true, members: known };
  try {
    const capability = await getCaseHandlingGroupCapability(options);
    if (
      createContext.value !== key ||
      !createOpen.value ||
      options.signal?.aborted
    )
      return { allowed: false, members: [] };
    canCreate.value = capability.canCreate;
    if (!capability.canCreate) return { allowed: false, members: [] };
    const found = new Map<string, CaseHandlingGroupMember>();
    let next = 1;
    let pages = 1;
    while (next <= pages && found.size < caseIds.length) {
      const result = await listCaseHandlingGroupCandidates(
        { page: next, pageSize: 100, customerId: known[0]!.customerId },
        options,
      );
      if (
        createContext.value !== key ||
        !createOpen.value ||
        options.signal?.aborted
      )
        return { allowed: false, members: [] };
      pages = Math.max(1, Math.ceil(result.total / result.pageSize));
      for (const member of result.items)
        if (
          caseIds.some((id) => id.toLowerCase() === member.caseId.toLowerCase())
        )
          found.set(member.caseId.toLowerCase(), member);
      next += 1;
    }
    return {
      allowed: found.size === caseIds.length,
      members: caseIds.flatMap((id) => {
        const member = found.get(id.toLowerCase());
        return member ? [member] : [];
      }),
    };
  } catch (cause) {
    if (
      createContext.value === key &&
      cause instanceof ApiError &&
      [401, 403].includes(cause.status)
    )
      canCreate.value = false;
    throw cause;
  }
};
const submitAttempt: SubmitCaseHandlingGroupAttempt = async (
  attempt,
  context,
) => {
  const wasRecovery =
    !!pending.value && sameCaseHandlingGroupAttempt(pending.value, attempt);
  const lane =
    attempt.kind === 'CREATE'
      ? 'create'
      : detailOpen.value
        ? 'detail'
        : 'recovery';
  const current = () =>
    mounted &&
    actorKey.value === context.actorKey &&
    context.actorKey === attempt.actorKey &&
    context.contextKey ===
      (lane === 'create' ? createContext.value : pageContext.value) &&
    !context.signal.aborted &&
    (lane === 'create'
      ? createOpen.value
      : lane === 'detail'
        ? detailOpen.value
        : recoveryBusy.value) &&
    (wasRecovery ||
      (attempt.kind === 'CREATE'
        ? canCreate.value
        : detail.value?.canDissolve === true));
  const response = runCaseHandlingGroupAttempt(
    attempt,
    context,
    current,
    async (captured, signal) => {
      try {
        return captured.kind === 'CREATE'
          ? await createCaseHandlingGroup(captured.input, { signal })
          : await dissolveCaseHandlingGroup(captured.groupId, captured.input, {
              signal,
            });
      } catch (cause) {
        if (
          current() &&
          cause instanceof ApiError &&
          [401, 403].includes(cause.status)
        ) {
          canCreate.value = false;
          if (detail.value)
            detail.value = { ...detail.value, canDissolve: false };
        }
        throw cause;
      }
    },
  );
  entries.value = readPendingCaseHandlingGroups();
  const outcome = await response;
  if (
    mounted &&
    actorKey.value === context.actorKey &&
    context.contextKey ===
      (lane === 'create' ? createContext.value : pageContext.value)
  )
    entries.value = readPendingCaseHandlingGroups();
  return outcome;
};
function handleConfirmed(result: CaseHandlingGroupCommandResult): void {
  entries.value = readPendingCaseHandlingGroups();
  createOpen.value = false;
  detailOpen.value = false;
  recoveryConfirmed.value = false;
  message.value = '办理组操作已确认，原案归属保持完整。';
  if (route.params.id === result.id) void loadPage();
  else
    void router.push({
      path: `/case-handling-groups/${encodeURIComponent(result.id)}`,
      query: { ...route.query },
    });
}
function openPendingCreate(): void {
  if (pendingCreate.value && !detailOpen.value && !recoveryBusy.value) {
    candidateEpoch.value += 1;
    candidates.value = [];
    createOpen.value = true;
  }
}
async function recoverDissolve(): Promise<void> {
  const attempt = pendingDissolve.value;
  if (
    !attempt ||
    !recoveryConfirmed.value ||
    recoveryBusy.value ||
    createOpen.value ||
    detailOpen.value
  )
    return;
  recoveryController?.abort();
  const controller = new AbortController();
  recoveryController = controller;
  const key = pageContext.value;
  recoveryBusy.value = true;
  const outcome = await submitAttempt(attempt, {
    actorKey: actorKey.value,
    contextKey: key,
    signal: controller.signal,
  });
  if (!mounted || controller.signal.aborted || pageContext.value !== key)
    return;
  recoveryBusy.value = false;
  if (outcome.kind === 'confirmed') handleConfirmed(outcome.result);
  else error.value = outcome.message;
}
function closeDetail(): void {
  detailOpen.value = false;
  resourcesOpen.value = false;
  if (route.params.id !== undefined)
    void router.push({
      path: '/case-handling-groups',
      query: { ...route.query },
    });
}
function goPage(next: number): void {
  if (next >= 1 && next <= Math.max(1, Math.ceil(total.value / 20)))
    void router.push({ query: { ...route.query, page: String(next) } });
}
function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}
watch(
  pageContext,
  () => {
    message.value = '';
    void loadPage();
  },
  { immediate: true, flush: 'sync' },
);
onBeforeUnmount(() => {
  mounted = false;
  loadController?.abort();
  candidateController?.abort();
  recoveryController?.abort();
});
</script>

<template>
  <div class="page-view">
    <main :inert="createOpen || detailOpen">
      <div class="page-head">
        <div>
          <h1>案件办理组</h1>
          <p>按当前权限集中查看同一客户的源案，原案归属与历史保留。</p>
        </div>
        <div class="group-page-actions">
          <RouterLink :to="returnTo" data-test="group-return-to-cases"
            >返回案件列表</RouterLink
          ><ElButton
            v-if="canCreate"
            data-test="open-create-group"
            :disabled="!!pending || entries === null || recoveryBusy"
            @click="openCreate"
            >建立办理组</ElButton
          ><ElButton data-test="refresh-groups" @click="loadPage"
            >刷新</ElButton
          >
        </div>
      </div>
      <p v-if="state === 'loading'" role="status">正在读取办理组…</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <p v-if="detailError" role="alert">{{ detailError }}</p>
      <p v-if="message" role="status">{{ message }}</p>
      <p v-if="entries === null" role="alert">
        原请求记录不可读，写入暂不可用。
      </p>
      <ul
        v-if="state === 'ready'"
        class="handling-group-list"
        aria-label="当前可读办理组"
      >
        <li v-for="group in groups" :key="group.id" class="demo-card">
          <RouterLink
            :to="{
              path: `/case-handling-groups/${encodeURIComponent(group.id)}`,
              query: { ...route.query },
            }"
            :data-test="`open-group-${group.id}`"
            >{{ group.status === 'ACTIVE' ? '办理中' : '已解除' }} ·
            {{ formatTime(group.createdAt) }}</RouterLink
          >
          <ul aria-label="当前可读源案">
            <li v-for="member in group.members" :key="member.caseId">
              {{ member.businessNo }} · {{ member.customerName }}
            </li>
          </ul>
        </li>
      </ul>
      <p v-if="state === 'ready' && !groups.length">当前没有可显示的办理组。</p>
      <nav v-if="state === 'ready'" aria-label="办理组分页">
        <ElButton
          data-test="previous-group-page"
          :disabled="page <= 1"
          @click="goPage(page - 1)"
          >上一页</ElButton
        ><span>第 {{ page }} 页</span
        ><ElButton
          data-test="next-group-page"
          :disabled="page * 20 >= total"
          @click="goPage(page + 1)"
          >下一页</ElButton
        >
      </nav>
      <section
        v-if="pending && !createOpen && !detailOpen"
        role="alert"
        data-test="group-pending"
      >
        <p>
          有一项办理组原请求待核对。原内容与请求键已保留，当前权限由服务器重新核验。
        </p>
        <ElButton
          v-if="pendingCreate"
          data-test="recover-create-group"
          @click="openPendingCreate"
          >核对原建立请求</ElButton
        ><template v-if="pendingDissolve"
          ><label
            ><input
              v-model="recoveryConfirmed"
              type="checkbox"
              data-test="confirm-recover-dissolve"
              :disabled="recoveryBusy"
            />确认核对原解除请求，原案及历史继续保留。</label
          ><ElButton
            data-test="recover-dissolve-group"
            :disabled="!recoveryConfirmed || recoveryBusy"
            @click="recoverDissolve"
            >核对原解除请求</ElButton
          ></template
        >
      </section>
    </main>
    <section v-if="createOpen">
      <CaseHandlingGroupCreatePanel
        :key="createContext"
        :candidates="candidates"
        :actor-key="actorKey"
        :context-key="createContext"
        :pending="pendingCreate"
        :prepare-selection="prepareSelection"
        :submit-attempt="submitAttempt"
        @close="createOpen = false"
        @confirmed="handleConfirmed"
      >
        <template #candidate-controls>
          <form
            role="search"
            class="group-candidate-search"
            @submit.prevent="readCandidates(false)"
          >
            <label
              >查找案件<input
                v-model="queryDraft"
                data-test="group-candidate-search"
                :disabled="candidateBusy" /></label
            ><ElButton native-type="submit" :disabled="candidateBusy"
              >查询案件</ElButton
            >
          </form>
          <p v-if="candidateError" role="alert">{{ candidateError }}</p>
          <p v-if="candidateBusy" role="status">正在读取可选案件…</p>
          <ElButton
            v-if="candidatePage * 100 < candidateTotal"
            data-test="more-group-candidates"
            :disabled="candidateBusy"
            @click="readCandidates(true)"
            >读取更多可选案件</ElButton
          >
        </template>
      </CaseHandlingGroupCreatePanel>
    </section>
    <section
      v-if="detailOpen && displayedDetail"
      role="dialog"
      aria-modal="true"
      aria-label="案件办理组详情"
    >
      <CaseHandlingGroupDetailPanel
        role="region"
        :aria-modal="undefined"
        :key="pageContext"
        :detail="displayedDetail"
        :actor-key="actorKey"
        :context-key="pageContext"
        :pending="
          pendingDissolve?.groupId.toLowerCase() ===
          displayedDetail.id.toLowerCase()
            ? pendingDissolve
            : null
        "
        :submit-attempt="submitAttempt"
        @close="closeDetail"
        @confirmed="handleConfirmed"
      />
      <section class="demo-card" aria-label="办理组资源入口">
        <ElButton
          v-if="!resourcesOpen"
          data-test="open-group-resources"
          @click="resourcesOpen = true"
          >查看组内材料与费用</ElButton
        >
        <CaseHandlingGroupResourcesPanel
          v-else
          :key="pageContext"
          :group="displayedDetail"
          :actor-key="actorKey"
          :context-key="pageContext"
          :load-page="loadResources"
          :download-material="downloadResource"
        />
      </section>
    </section>
  </div>
</template>

<style scoped>
.group-page-actions,
.group-candidate-search {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s-3);
}
.handling-group-list {
  display: grid;
  gap: var(--s-4);
  list-style: none;
  padding: 0;
}
.handling-group-list > li {
  padding: var(--s-4);
}
.handling-group-list ul {
  margin-top: var(--s-3);
}
.group-candidate-search {
  margin-block: var(--s-4);
}
.group-candidate-search input {
  margin-inline-start: var(--s-2);
  font: inherit;
}
</style>
