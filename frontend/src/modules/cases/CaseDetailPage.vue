<script setup lang="ts">
import CaseExecutionMailingPanel from './CaseExecutionMailingPanel.vue';
import CaseExecutionFilingPanel from './CaseExecutionFilingPanel.vue';
import CaseExecutionFinishPanel from './CaseExecutionFinishPanel.vue';
import CaseClosurePanel from './CaseClosurePanel.vue';
import CaseArchivePanel from './CaseArchivePanel.vue';
import {
  parseCaseActionIntent,
  primaryCaseAction,
  resolveCaseDetailActions,
} from './case-workspace-actions';

import {
  computed,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  watch,
} from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ElDrawer } from 'element-plus/es/components/drawer/index.mjs';
import { ApiError, type RequestOptions } from '../../api/http';
import { getLead, type LeadDetail } from '../../api/leads';
import CaseWorkspaceShell from './CaseWorkspaceShell.vue';
import CaseDetailsSections from './CaseDetailsSections.vue';
import CaseWorkspaceFiles from './CaseWorkspaceFiles.vue';
import CaseWorkspaceFees from './CaseWorkspaceFees.vue';
import type {
  SectionKey,
  SectionAction,
  WorkspaceTab,
} from './case-workspace-contract';
import {
  buildCaseWorkspaceEvents,
  workspaceDate,
  type LeadState,
} from './case-workspace-read-model';
import {
  archiveCase,
  caseArchiveSession,
  type ArchiveCaseInput,
  type CorrectCaseArchiveInput,
  type CaseArchiveResult,
  type CaseArchivePendingRequest,
  correctCaseArchive,
  recordCaseClosure,
  correctCaseClosure,
  caseClosureSession,
  type RecordCaseClosureInput,
  type CorrectCaseClosureInput,
  type CaseClosureResult,
  type CaseClosurePendingRequest,
  finishCaseExecution,
  executionFinishSession,
  type FinishCaseExecutionInput,
  type FinishCaseExecutionResult,
  getCase,
  matchCase,
  listLawyerMatchCandidates,
  submitComplaint,
  todayShanghai,
  type CaseFile,
  type CaseDetail,
  type MatchCaseInput,
  type SubmitComplaintInput,
  type LawyerMatchCandidate,
} from '../../api/cases';
import {
  downloadMaterialVersion,
  listOwnerMaterials,
  uploadMaterialFile,
  type MaterialCategory,
} from '../../api/materials';
import { notifyWorkflowChanged } from '../../app/workflow-events';
import { useAuthStore } from '../../stores/auth';
import CaseComplaintConfirmationPanel from './CaseComplaintConfirmationPanel.vue';
import CaseComplaintMailingPanel from './CaseComplaintMailingPanel.vue';
import CaseComplaintSubmissionForm from './CaseComplaintSubmissionForm.vue';
import CaseFilingPanel from './CaseFilingPanel.vue';
import CaseAcceptancePanel from './CaseAcceptancePanel.vue';
import CaseDefendantContactPanel from './CaseDefendantContactPanel.vue';
import CaseAcceptanceCorrectionPanel from './CaseAcceptanceCorrectionPanel.vue';
import CaseSecondInstanceAcceptancePanel from './CaseSecondInstanceAcceptancePanel.vue';
import CaseHearingPanel from './CaseHearingPanel.vue';
import CaseJudgmentPanel from './CaseJudgmentPanel.vue';
import CaseJudgmentNextStepPanel from './CaseJudgmentNextStepPanel.vue';
import CaseSecondInstancePanel from './CaseSecondInstancePanel.vue';
import CaseExecutionSubmissionPanel from './CaseExecutionSubmissionPanel.vue';
import CaseExecutionConfirmationPanel from './CaseExecutionConfirmationPanel.vue';
import {
  pendingSecondInstanceCommand,
  hasUnclearedSecondInstanceUpload,
} from './case-second-instance-recovery';
import {
  pendingExecutionCommand,
  hasUnclearedExecutionUpload,
} from './case-execution-recovery';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
defineOptions({ name: 'CaseDetailPage' });
const props = defineProps<{ id?: string }>();
const id = computed(() => props.id ?? String(route.params.id));
const identity = computed(() =>
  auth.session === null
    ? ''
    : `${auth.session.principalType}:${auth.session.user.id}:${auth.session.department?.id ?? ''}:${auth.session.authorizationRevision}`,
);
const secondInstanceActorKey = computed(() =>
  auth.session === null
    ? ''
    : `${auth.session.principalType}:${auth.session.user.id}:${auth.session.department?.id ?? ''}`,
);
const backTo = computed(() => ({
  path: '/cases',
  query: Object.fromEntries(
    Object.entries(route.query).filter(([key]) =>
      ['view', 'page', 'stage', 'stageGroup'].includes(key),
    ),
  ),
}));
const workspaceContext = computed(() => `${id.value}:${identity.value}`);
const activeTab = computed<WorkspaceTab>(() =>
  route.query.tab === 'files' || route.query.tab === 'fees'
    ? route.query.tab
    : 'details',
);
function selectTab(tab: WorkspaceTab): void {
  if (String(route.params.id) !== id.value) return;
  void router.replace({ path: route.path, query: { ...route.query, tab } });
}
watch(
  () => route.query.tab,
  (tab) => {
    if (String(route.params.id) !== id.value) return;
    if (
      tab !== undefined &&
      tab !== 'details' &&
      tab !== 'files' &&
      tab !== 'fees'
    )
      selectTab('details');
  },
  { immediate: true },
);
const lead = ref<LeadDetail | null>(null);
const leadState = ref<LeadState>('idle');
const drawerOpen = ref(false);
const actionNotice = ref('');
const editorVisible = ref(true);
const editorSection = ref<SectionKey>('case-info');
const selectedCommand = ref('');
const timelineView = ref(false);
// Each command has one instance. Hiding the drawer or switching its view never resets it.
const openedCommands = ref(new Set<string>());
type WorkspaceCommand = { id: string; section: SectionKey; label: string };
const openedCommandEntries = ref(new Map<string, WorkspaceCommand>());
const commands = computed<WorkspaceCommand[]>(() => {
  const current = item.value;
  if (!current) return [];
  const result: WorkspaceCommand[] = resolveCaseDetailActions(current);
  if (finishPending.value && !result.some((entry) => entry.id === 'finish'))
    result.push({
      id: 'finish',
      section: 'execution',
      label: '核对执行结束原请求／显式重试',
    });
  if (closurePending.value && !result.some((entry) => entry.id === 'closure'))
    result.push({
      id: 'closure',
      section: 'closure-info',
      label: '核对结案原请求／显式重试',
    });
  if (archivePending.value && !result.some((entry) => entry.id === 'archive'))
    result.push({
      id: 'archive',
      section: 'closure-info',
      label: '核对归档原请求／显式重试',
    });
  if (
    complaintUnknown.value &&
    !result.some((entry) => entry.id === 'complaint')
  )
    result.push({
      id: 'complaint',
      section: 'first-instance',
      label: '核对起诉材料原请求／显式重试',
    });
  if (matchUnknown.value && !result.some((entry) => entry.id === 'match'))
    result.push({
      id: 'match',
      section: 'case-info',
      label: '核对匹配原请求／显式重试',
    });
  const recoveryIdentity = {
    actor: secondInstanceActorKey.value,
    caseId: current.id,
  };

  if (
    (pendingSecondInstanceCommand(recoveryIdentity) ||
      hasUnclearedSecondInstanceUpload(recoveryIdentity)) &&
    !result.some((entry) => entry.id === 'second-instance')
  )
    result.push({
      id: 'second-instance',
      section: 'second-instance',
      label: '核对二审原请求／上传结果',
    });
  if (
    (pendingExecutionCommand(recoveryIdentity) ||
      hasUnclearedExecutionUpload(recoveryIdentity)) &&
    !result.some((entry) => entry.id === 'execution-submission')
  )
    result.push({
      id: 'execution-submission',
      section: 'execution',
      label: '核对执行材料原请求／上传结果',
    });
  return result;
});
const priorEditors = computed(() =>
  [...openedCommandEntries.value.values()].filter(
    (previous) => !commands.value.some((entry) => entry.id === previous.id),
  ),
);
const businessCommands = computed(() =>
  commands.value.filter(
    (entry) =>
      entry.id !== 'defendant-contact-update' &&
      entry.id !== 'acceptance-correction' &&
      entry.id !== 'second-instance-acceptance',
  ),
);
const sectionActions = computed<Record<SectionKey, SectionAction>>(() => {
  const action = (section: SectionKey): SectionAction => ({
    enabled: commands.value.some((command) => command.section === section),
    label: section === 'timeline' ? '登记／更正' : '编辑',
    hint: commands.value.some((command) => command.section === section)
      ? '使用已有业务命令；字段只读。'
      : '当前无可办命令；字段只读。',
  });
  const hasCommand = (section: SectionKey) =>
    commands.value.some((command) => command.section === section);
  const current = item.value;
  const caseEditHint = !current?.recordEdits
    ? '\u5f53\u524d\u63a5\u53e3\u672a\u63d0\u4f9b\u8054\u7cfb\u65b9\u5f0f\u7248\u672c\u4e0e\u64cd\u4f5c\u6743\u9650\uff0c\u8054\u7cfb\u65b9\u5f0f\u7f16\u8f91\u6682\u4e0d\u53ef\u7528\u3002'
    : !current.recordEdits.canUpdateDefendantContact
      ? '\u5f53\u524d\u8d26\u53f7\u6ca1\u6709\u66f4\u65b0\u88ab\u544a\u8054\u7cfb\u65b9\u5f0f\u7684\u6848\u4ef6\u6743\u9650\u3002'
      : current.defendants.length === 0
        ? '\u5f53\u524d\u6848\u4ef6\u6ca1\u6709\u53ef\u7f16\u8f91\u7684\u88ab\u544a\u8d44\u6599\u3002'
        : current.recordEdits.defendantContacts.length !==
            current.defendants.length
          ? '\u88ab\u544a\u8054\u7cfb\u65b9\u5f0f\u7248\u672c\u4fe1\u606f\u4e0d\u5b8c\u6574\uff0c\u6682\u4e0d\u80fd\u7f16\u8f91\u3002'
          : '\u9009\u62e9\u5339\u914d\u529e\u7406\u6216\u66f4\u65b0\u88ab\u544a\u8054\u7cfb\u65b9\u5f0f\u3002';
  const acceptanceEditHint = !current?.recordEdits
    ? '\u5f53\u524d\u63a5\u53e3\u672a\u63d0\u4f9b\u53d7\u7406\u66f4\u6b63\u7248\u672c\u4e0e\u64cd\u4f5c\u6743\u9650\uff0c\u53d7\u7406\u66f4\u6b63\u6682\u4e0d\u53ef\u7528\u3002'
    : !current.recordEdits.canCorrectAcceptance
      ? '\u5f53\u524d\u8d26\u53f7\u6ca1\u6709\u66f4\u6b63\u4e00\u5ba1\u53d7\u7406\u4fe1\u606f\u7684\u6848\u4ef6\u6743\u9650\u3002'
      : current.acceptances.length === 0
        ? '\u5f53\u524d\u6848\u4ef6\u6ca1\u6709\u5df2\u767b\u8bb0\u7684\u4e00\u5ba1\u53d7\u7406\u4e8b\u5b9e\uff0c\u4e0d\u80fd\u66f4\u6b63\u3002'
        : current.recordEdits.acceptanceCorrections.length !==
            current.acceptances.length
          ? '\u53d7\u7406\u66f4\u6b63\u7248\u672c\u4fe1\u606f\u4e0d\u5b8c\u6574\uff0c\u6682\u4e0d\u80fd\u66f4\u6b63\u3002'
          : '\u9009\u62e9\u4e00\u5ba1\u529e\u7406\u6216\u66f4\u6b63\u5df2\u767b\u8bb0\u53d7\u7406\u3002';
  return {
    'case-info': {
      enabled: hasCommand('case-info'),
      label: '编辑',
      hint: caseEditHint,
    },
    'lead-info': {
      enabled:
        item.value?.origin?.kind !== 'EXTERNAL_ENTRY' &&
        leadState.value === 'ready' &&
        lead.value?.capabilities.edit === true,
      label: '编辑',
      hint:
        leadState.value === 'denied'
          ? '无权读取来源线索；案件仍可查看。'
          : '仅在来源线索可编辑时进入原编辑页。',
    },
    'first-instance': {
      enabled: hasCommand('first-instance'),
      label: '编辑',
      hint: acceptanceEditHint,
    },
    'second-instance': action('second-instance'),
    judgment: action('judgment'),
    execution: action('execution'),
    'closure-info': {
      enabled: false,
      label: '只读',
      hint: '结案与归档记录；不表示财务结清。',
    },
    timeline: {
      enabled: commands.value.length > 0,
      label: '登记／更正',
      hint: '使用已有命令；审计记录只读。',
    },
  };
});
const editorCommands = computed(() => {
  const entries = [...commands.value];
  for (const previous of openedCommandEntries.value.values())
    if (!entries.some((entry) => entry.id === previous.id))
      entries.push(previous);
  return editorSection.value === 'timeline'
    ? entries
    : entries.filter((command) => command.section === editorSection.value);
});
const primaryCommand = computed(() =>
  primaryCaseAction(item.value?.stage, businessCommands.value),
);
const moreCommands = computed(() =>
  businessCommands.value.filter(
    (entry) => entry.id !== primaryCommand.value?.id,
  ),
);
const timelineEvents = computed(() =>
  item.value ? buildCaseWorkspaceEvents(item.value) : [],
);
function openCommand(command: WorkspaceCommand): void {
  if (!commands.value.some((entry) => entry.id === command.id)) return;
  timelineView.value = false;
  editorSection.value = command.section;
  selectedCommand.value = command.id;
  openedCommands.value.add(command.id);
  openedCommandEntries.value.set(command.id, command);
  drawerOpen.value = true;
}
function reopenPriorEditor(previous: WorkspaceCommand): void {
  if (!priorEditors.value.some((entry) => entry.id === previous.id)) return;
  timelineView.value = false;
  editorSection.value = previous.section;
  selectedCommand.value = previous.id;
  drawerOpen.value = true;
}
function editSection(section: SectionKey): void {
  if (!sectionActions.value[section].enabled) return;
  if (section === 'lead-info') {
    if (
      lead.value &&
      lead.value.id === item.value?.sourceLead?.id &&
      lead.value.capabilities.edit
    )
      void router.push(`/leads/${encodeURIComponent(lead.value.id)}/edit`);
    return;
  }
  const choices = commands.value.filter(
    (entry) => section === 'timeline' || entry.section === section,
  );
  if (choices.length === 0) return;
  timelineView.value = false;
  editorSection.value = section;
  if (choices.length === 1) {
    openCommand(choices[0]);
    return;
  }
  selectedCommand.value = '';
  drawerOpen.value = true;
}
function chooseCommand(commandId: string): void {
  const command = editorCommands.value.find((entry) => entry.id === commandId);
  if (!command) return;
  selectedCommand.value = command.id;
  openedCommands.value.add(command.id);
  openedCommandEntries.value.set(command.id, command);
}
function viewTimeline(): void {
  timelineView.value = true;
  drawerOpen.value = true;
}
function recordEditAccessLost(): void {
  contextRevision += 1;
  readRevision += 1;
  request?.abort();
  request = undefined;
  clearContext();
  void load();
}
function closeRecordEdit(): void {
  drawerOpen.value = false;
}
function openUpload(): void {
  const stage = item.value?.stage;
  const uploadCommands: Partial<Record<CaseDetail['stage'], string>> = {
    WAITING_COMPLAINT: 'complaint',
    WAITING_COMPLAINT_STAMP: 'mail-complaint',
    WAITING_FILING: 'filing',
    WAITING_FORMAL_ACCEPTANCE: 'acceptance',
    WAITING_HEARING: 'acceptance',
    WAITING_JUDGMENT: 'judgment',
    SECOND_INSTANCE: 'second-instance',
    WAITING_EXECUTION_DOCUMENTS: 'execution-submission',
    WAITING_EXECUTION_CONFIRMATION:
      item.value?.origin?.kind === 'EXTERNAL_ENTRY' &&
      item.value.origin.initialStage === 'WAITING_EXECUTION_CONFIRMATION' &&
      item.value.executionSubmission.current === null
        ? 'execution-upload'
        : 'execution-submission',
    WAITING_EXECUTION_STAMP: 'execution-mailing',
    WAITING_EXECUTION_FILING: 'execution-filing',
    EXECUTING: 'finish',
    WAITING_ARCHIVE: 'closure',
  };
  const command = commands.value.find(
    (entry) => stage && entry.id === uploadCommands[stage],
  );
  if (command) openCommand(command);
}
function listCaseMaterials(caseId: string, options?: RequestOptions) {
  return listOwnerMaterials('CASE', caseId, options);
}
const state = ref<'loading' | 'ready' | 'missing' | 'failed'>('loading');
const refreshing = ref(false);
const refreshError = ref('');
const item = ref<CaseDetail>();
const accessVerified = ref(false);
const activationRevision = ref(0);
watch(
  [
    workspaceContext,
    () => item.value?.sourceLead?.id,
    () => item.value?.version,
    accessVerified,
  ],
  async ([contextKey, leadId, version], _prior, onCleanup) => {
    const controller = new AbortController();
    onCleanup(() => controller.abort());
    lead.value = null;
    leadState.value = leadId ? 'loading' : 'idle';
    if (!leadId || !accessVerified.value) return;
    try {
      const result = await getLead(leadId, { signal: controller.signal });
      if (
        controller.signal.aborted ||
        workspaceContext.value !== contextKey ||
        item.value?.sourceLead?.id !== leadId ||
        item.value?.version !== version
      )
        return;
      lead.value = result;
      leadState.value = 'ready';
    } catch (reason) {
      if (
        controller.signal.aborted ||
        workspaceContext.value !== contextKey ||
        item.value?.sourceLead?.id !== leadId ||
        item.value?.version !== version
      )
        return;
      leadState.value =
        reason instanceof ApiError && [401, 403, 404].includes(reason.status)
          ? 'denied'
          : 'failed';
    }
  },
  { flush: 'sync' },
);
const error = ref('');
const downloadError = ref('');
const matchError = ref('');
const matchSuccess = ref('');
const submitting = ref(false);
const complaintUploads = ref<CaseFile[]>([]);
const authorizationUploads = ref<CaseFile[]>([]);
const amountState = ref<'KNOWN' | 'PENDING'>('KNOWN');
const amount = ref('');
const pendingReason = ref('');
const uploadErrors = ref<Record<string, string>>({});
const uploadLoading = ref<Record<string, boolean>>({});
const complaintError = ref('');
const complaintSuccess = ref('');
const complaintSubmitting = ref(false);
const complaintUnknown = ref<SubmitComplaintInput | null>(null);
const matchUnknown = ref<MatchCaseInput | null>(null);
let complaintFingerprint = '';
let complaintIdempotencyKey = '';
type DefendantDraft = {
  kind: 'PERSON' | 'ORGANIZATION';
  name: string;
  idNo: string;
  phone: string;
  address: string;
};
const defendants = ref<DefendantDraft[]>([
  { kind: 'PERSON', name: '', idNo: '', phone: '', address: '' },
]);
const lawyerQuery = ref('');
const lawyerCandidates = ref<LawyerMatchCandidate[]>([]);
const selectedLawyer = ref<LawyerMatchCandidate>();
const lawyerCandidatesLoading = ref(false);
const lawyerCandidatesError = ref('');
const matchedOn = ref(todayShanghai());
let submissionFingerprint = '';
let idempotencyKey = '';
let request: AbortController | undefined;
let contextRevision = 0;
let readRevision = 0;
let candidateRequest: AbortController | undefined;
let active = true;
let firstActivation = true;

type OperationContext = {
  caseId: string;
  identity: string;
  revision: number;
  version: number | undefined;
};

function operationContext(): OperationContext {
  return {
    caseId: id.value,
    identity: identity.value,
    revision: contextRevision,
    version: item.value?.version,
  };
}

function isCurrentOperation(
  context: OperationContext,
  checkVersion = true,
): boolean {
  return (
    active &&
    context.revision === contextRevision &&
    context.caseId === id.value &&
    context.identity === identity.value &&
    (!checkVersion || context.version === item.value?.version)
  );
}

async function readCommandDetail(
  context: OperationContext,
): Promise<CaseDetail> {
  try {
    return await getCase(context.caseId);
  } catch (reason) {
    if (
      isCurrentOperation(context) &&
      reason instanceof ApiError &&
      [401, 403, 404].includes(reason.status)
    ) {
      contextRevision += 1;
      readRevision += 1;
      request?.abort();
      finishSession.clear();
      closureSession.clear();
      archiveSession.clear();
      clearContext();
      state.value = reason.status === 404 ? 'missing' : 'failed';
      error.value =
        reason.status === 403
          ? '当前账号无权读取该案件。'
          : '案件不存在或已不可访问。';
    }
    throw reason;
  }
}

const finishSession = executionFinishSession(auth, () => identity.value);
const finishPending = computed(() => finishSession.pending(id.value));
const finishCallbacks = computed(() => {
  const caseId = item.value?.id ?? id.value;
  const contextKey = identity.value;
  const revision = contextRevision;
  const version = item.value?.version;
  const current = () =>
    caseId === id.value &&
    contextKey === identity.value &&
    revision === contextRevision &&
    version === item.value?.version;
  const denied = async (reason: unknown) => {
    if (
      current() &&
      reason instanceof ApiError &&
      (reason.status === 401 || reason.status === 403)
    ) {
      contextRevision += 1;
      readRevision += 1;
      request?.abort();
      finishSession.clear();
      closureSession.clear();
      archiveSession.clear();
      clearContext();
      await load();
    }
    throw reason;
  };
  return {
    pending: (input: FinishCaseExecutionInput | null) => {
      if (current()) finishSession.setPending(caseId, input);
    },
    submit: async (targetId: string, input: FinishCaseExecutionInput) => {
      if (!current() || targetId !== caseId)
        throw new ApiError(
          '案件办理身份已变化，请重新读取',
          409,
          'INVALID_STATE',
        );
      // Store before transport as well as pending-change, without changing the original body.
      finishSession.setPending(caseId, input);
      try {
        return await finishCaseExecution(caseId, input, 'internal');
      } catch (reason) {
        return denied(reason);
      }
    },
    list: async (targetId: string): Promise<CaseFile[]> => {
      if (!current() || targetId !== caseId)
        throw new ApiError(
          '案件办理身份已变化，请重新读取',
          409,
          'INVALID_STATE',
        );
      const materials = await listOwnerMaterials('CASE', caseId);
      if (!current())
        throw new ApiError(
          '案件办理身份已变化，请重新读取',
          409,
          'INVALID_STATE',
        );
      return materials.items
        .filter(
          (material) =>
            material.status === 'ACTIVE' &&
            material.category === 'EXECUTION_FINISH_BASIS',
        )
        .flatMap((material) => {
          const version = material.contentVersions.find(
            (entry) => entry.id === material.currentVersionId,
          );
          return version
            ? [
                {
                  materialId: material.id,
                  contentVersionId: version.id,
                  originalFilename: version.originalFilename,
                  mimeType: version.mimeType,
                },
              ]
            : [];
        });
    },
    upload: async (
      targetId: string,
      file: globalThis.File,
    ): Promise<CaseFile> => {
      if (!current() || targetId !== caseId)
        throw new ApiError(
          '案件办理身份已变化，请重新读取',
          409,
          'INVALID_STATE',
        );
      const result = await uploadMaterialFile({
        ownerType: 'CASE',
        ownerId: caseId,
        category: 'EXECUTION_FINISH_BASIS',
        purpose: 'EXECUTION_FINISH_BASIS',
        file,
      });
      if (!current())
        throw new ApiError(
          '案件办理身份已变化，请重新读取',
          409,
          'INVALID_STATE',
        );
      return {
        materialId: result.materialId,
        contentVersionId: result.contentVersionId,
        originalFilename: result.originalFilename,
        mimeType: result.mimeType,
      };
    },
    download: async (
      targetId: string,
      file: CaseFile,
      signal: globalThis.AbortSignal,
    ) => {
      if (!current() || targetId !== caseId)
        throw new ApiError(
          '案件办理身份已变化，请重新读取',
          409,
          'INVALID_STATE',
        );
      return await downloadMaterialVersion(
        file.materialId,
        file.contentVersionId,
        signal,
      );
    },
    changed: (result: FinishCaseExecutionResult) => {
      if (!current() || result.id !== caseId) return;
      finishSession.setPending(caseId, null);
      if (finishSession.markChanged(result.finishId)) {
        notifyWorkflowChanged();
        void load();
      }
    },
    refresh: () => {
      if (current()) void load();
    },
  };
});

const archiveSession = caseArchiveSession(auth, () => identity.value);
const archivePending = computed(() => archiveSession.pending(id.value));
const archiveCallbacks = computed(() => {
  const caseId = item.value?.id ?? id.value;
  const closureId = item.value?.closure?.id;
  const archiveId = item.value?.archive?.id;
  const contextKey = identity.value;
  const revision = contextRevision;
  const version = item.value?.version;
  const current = () =>
    caseId === id.value &&
    contextKey === identity.value &&
    revision === contextRevision &&
    version === item.value?.version;
  const denied = async (reason: unknown) => {
    if (
      current() &&
      reason instanceof ApiError &&
      (reason.status === 401 || reason.status === 403)
    ) {
      contextRevision += 1;
      readRevision += 1;
      request?.abort();
      finishSession.clear();
      closureSession.clear();
      archiveSession.clear();
      clearContext();
      await load();
    }
    throw reason;
  };
  return {
    pending: (request: CaseArchivePendingRequest | null) => {
      if (current()) archiveSession.setPending(caseId, request);
    },
    archive: async (targetId: string, input: ArchiveCaseInput) => {
      if (!current() || targetId !== caseId)
        throw new ApiError(
          '案件办理身份已变化，请重新读取',
          409,
          'INVALID_STATE',
        );
      archiveSession.setPending(caseId, { command: 'ARCHIVE', input });
      try {
        const result = await archiveCase(caseId, input, 'internal');
        if (!current())
          throw new ApiError(
            '案件办理身份已变化，请重新读取',
            409,
            'INVALID_STATE',
          );
        if (
          result.closureId !== closureId ||
          (archiveId && result.archiveId !== archiveId)
        )
          throw new ApiError(
            '服务返回了无效的归档锚点',
            200,
            'INVALID_RESPONSE',
          );
        return result;
      } catch (reason) {
        return denied(reason);
      }
    },
    correct: async (targetId: string, input: CorrectCaseArchiveInput) => {
      if (!current() || targetId !== caseId)
        throw new ApiError('当前身份不能更正该案件', 403, 'ACTION_FORBIDDEN');
      archiveSession.setPending(caseId, { command: 'CORRECT', input });
      try {
        const result = await correctCaseArchive(caseId, input);
        if (!current())
          throw new ApiError(
            '案件办理身份已变化，请重新读取',
            409,
            'INVALID_STATE',
          );
        if (
          result.closureId !== closureId ||
          (archiveId && result.archiveId !== archiveId)
        )
          throw new ApiError(
            '服务返回了无效的归档锚点',
            200,
            'INVALID_RESPONSE',
          );
        return result;
      } catch (reason) {
        return denied(reason);
      }
    },
    changed: (result: CaseArchiveResult) => {
      if (!current() || result.id !== caseId) return;
      archiveSession.setPending(caseId, null);
      if (archiveSession.markChanged(result.archiveVersionId)) {
        notifyWorkflowChanged();
        void load();
      }
    },
    refresh: () => {
      if (current()) void load();
    },
  };
});

const closureSession = caseClosureSession(auth, () => identity.value);
const closurePending = computed(() => closureSession.pending(id.value));
const closureCallbacks = computed(() => {
  const caseId = item.value?.id ?? id.value;
  const contextKey = identity.value;
  const revision = contextRevision;
  const version = item.value?.version;
  const current = () =>
    caseId === id.value &&
    contextKey === identity.value &&
    revision === contextRevision &&
    version === item.value?.version;
  const denied = async (reason: unknown) => {
    if (
      current() &&
      reason instanceof ApiError &&
      (reason.status === 401 || reason.status === 403)
    ) {
      contextRevision += 1;
      readRevision += 1;
      request?.abort();
      finishSession.clear();
      closureSession.clear();
      archiveSession.clear();
      clearContext();
      await load();
    }
    throw reason;
  };
  return {
    pending: (input: CaseClosurePendingRequest | null) => {
      if (current()) closureSession.setPending(caseId, input);
    },
    record: async (targetId: string, input: RecordCaseClosureInput) => {
      if (!current() || targetId !== caseId)
        throw new ApiError(
          '案件办理身份已变化，请重新读取',
          409,
          'INVALID_STATE',
        );
      closureSession.setPending(caseId, { command: 'RECORD', input });
      try {
        const result = await recordCaseClosure(caseId, input, 'internal');
        if (!current())
          throw new ApiError(
            '案件办理身份已变化，请重新读取',
            409,
            'INVALID_STATE',
          );
        return result;
      } catch (reason) {
        return denied(reason);
      }
    },
    correct: async (targetId: string, input: CorrectCaseClosureInput) => {
      if (!current() || targetId !== caseId)
        throw new ApiError('当前身份不能更正该案件', 403, 'ACTION_FORBIDDEN');
      closureSession.setPending(caseId, { command: 'CORRECT', input });
      try {
        const result = await correctCaseClosure(caseId, input);
        if (!current())
          throw new ApiError(
            '案件办理身份已变化，请重新读取',
            409,
            'INVALID_STATE',
          );
        return result;
      } catch (reason) {
        return denied(reason);
      }
    },
    list: async (targetId: string): Promise<CaseFile[]> => {
      if (!current() || targetId !== caseId)
        throw new ApiError(
          '案件办理身份已变化，请重新读取',
          409,
          'INVALID_STATE',
        );
      const materials = await listOwnerMaterials('CASE', caseId);
      if (!current())
        throw new ApiError(
          '案件办理身份已变化，请重新读取',
          409,
          'INVALID_STATE',
        );
      return materials.items
        .filter(
          (material) =>
            material.status === 'ACTIVE' &&
            material.category === 'CASE_CLOSURE_DOCUMENT',
        )
        .flatMap((material) => {
          const version = material.contentVersions.find(
            (entry) => entry.id === material.currentVersionId,
          );
          return version
            ? [
                {
                  materialId: material.id,
                  contentVersionId: version.id,
                  originalFilename: version.originalFilename,
                  mimeType: version.mimeType,
                },
              ]
            : [];
        });
    },
    upload: async (
      targetId: string,
      file: globalThis.File,
    ): Promise<CaseFile> => {
      if (!current() || targetId !== caseId)
        throw new ApiError(
          '案件办理身份已变化，请重新读取',
          409,
          'INVALID_STATE',
        );
      const result = await uploadMaterialFile({
        ownerType: 'CASE',
        ownerId: caseId,
        category: 'CASE_CLOSURE_DOCUMENT',
        purpose: 'CASE_CLOSURE_DOCUMENT',
        file,
      });
      if (!current())
        throw new ApiError(
          '案件办理身份已变化，请重新读取',
          409,
          'INVALID_STATE',
        );
      return {
        materialId: result.materialId,
        contentVersionId: result.contentVersionId,
        originalFilename: result.originalFilename,
        mimeType: result.mimeType,
      };
    },
    download: async (
      targetId: string,
      file: CaseFile,
      signal: globalThis.AbortSignal,
    ) => {
      if (!current() || targetId !== caseId)
        throw new ApiError(
          '案件办理身份已变化，请重新读取',
          409,
          'INVALID_STATE',
        );
      return await downloadMaterialVersion(
        file.materialId,
        file.contentVersionId,
        signal,
      );
    },
    changed: (result: CaseClosureResult) => {
      if (!current() || result.id !== caseId) return;
      closureSession.setPending(caseId, null);
      if (closureSession.markChanged(result.closureVersionId)) {
        notifyWorkflowChanged();
        void load();
      }
    },
    refresh: () => {
      if (current()) void load();
    },
  };
});

async function load() {
  if (!active) return;
  request?.abort();
  const controller = new AbortController();
  request = controller;
  const targetId = id.value;
  const targetIdentity = identity.value;
  const targetContextRevision = contextRevision;
  const thisReadRevision = ++readRevision;
  const requestedAction = route.query.action;
  actionNotice.value = '';
  const preserveCurrent =
    state.value === 'ready' && item.value?.id === targetId;
  const isCurrentRead = () =>
    active &&
    !controller.signal.aborted &&
    thisReadRevision === readRevision &&
    targetContextRevision === contextRevision &&
    targetId === id.value &&
    targetIdentity === identity.value;
  if (preserveCurrent) {
    refreshing.value = true;
    refreshError.value = '';
  } else {
    state.value = 'loading';
    error.value = '';
    refreshError.value = '';
  }
  try {
    const result = await getCase(targetId, { signal: controller.signal });
    if (!isCurrentRead()) return;
    item.value = result;
    if (!accessVerified.value) activationRevision.value += 1;
    accessVerified.value = true;
    if (
      result.stage === 'WAITING_COMPLAINT' &&
      result.canSubmitComplaint &&
      !complaintUnknown.value
    ) {
      const materials = await listOwnerMaterials('CASE', result.id, {
        signal: controller.signal,
      }).catch((reason) => {
        if (!isCurrentRead()) throw reason;
        uploadErrors.value = {
          COMPLAINT: '本案上传池暂不可访问；案件资料仍可查看。',
        };
        return { items: [], total: 0 };
      });
      if (!isCurrentRead()) return;
      complaintUploads.value = materials.items
        .filter(
          (material) =>
            material.status === 'ACTIVE' &&
            material.currentVersionId !== null &&
            material.category === 'COMPLAINT',
        )
        .flatMap((material) => {
          const version = material.contentVersions.find(
            (entry) => entry.id === material.currentVersionId,
          );
          if (!version) return [];
          const file = {
            materialId: material.id,
            contentVersionId: version.id,
            originalFilename: version.originalFilename,
            mimeType: version.mimeType,
          };
          return material.category === 'COMPLAINT' ? [file] : [];
        });
      authorizationUploads.value = materials.items
        .filter(
          (material) =>
            material.status === 'ACTIVE' &&
            material.currentVersionId !== null &&
            material.category === 'AUTHORIZATION',
        )
        .flatMap((material) => {
          const version = material.contentVersions.find(
            (entry) => entry.id === material.currentVersionId,
          );
          return version
            ? [
                {
                  materialId: material.id,
                  contentVersionId: version.id,
                  originalFilename: version.originalFilename,
                  mimeType: version.mimeType,
                },
              ]
            : [];
        });
    }
    state.value = 'ready';
    refreshError.value = '';
    await consumeActionIntent(result);
  } catch (reason) {
    if (!isCurrentRead()) return;
    await consumeActionIntent();
    if (!isCurrentRead()) return;
    if (
      reason instanceof ApiError &&
      (reason.status === 401 || reason.status === 403 || reason.status === 404)
    ) {
      contextRevision += 1;
      readRevision += 1;
      request?.abort();
      request = undefined;
      finishSession.clear();
      closureSession.clear();
      archiveSession.clear();
      clearContext();
      state.value = reason.status === 404 ? 'missing' : 'failed';
      error.value =
        reason.status === 403
          ? '当前账号无权读取该案件。'
          : '案件不存在或已不可访问。';
      return;
    }
    if (preserveCurrent && item.value?.id === targetId) {
      state.value = 'ready';
      refreshError.value = '详情读取失败，已保留当前案件与待核对请求；请重试。';
      return;
    }
    state.value =
      reason instanceof ApiError && reason.status === 404
        ? 'missing'
        : 'failed';
    error.value =
      reason instanceof ApiError && reason.status === 403
        ? '当前账号无权读取该案件。'
        : '案件暂时无法读取，请刷新重试。';
  } finally {
    if (isCurrentRead()) {
      refreshing.value = false;
      request = undefined;
    }
  }

  async function consumeActionIntent(fresh?: CaseDetail): Promise<void> {
    if (
      requestedAction === undefined ||
      !isCurrentRead() ||
      route.query.action !== requestedAction ||
      String(route.params.id) !== targetId
    )
      return;
    const intent = parseCaseActionIntent(requestedAction);
    const command =
      fresh && fresh.id === targetId && intent
        ? resolveCaseDetailActions(fresh).find(
            (entry) => entry.intent === intent,
          )
        : undefined;
    const query = { ...route.query };
    delete query.action;
    // Replace rather than push: Back and a refresh must not replay an intent.
    await router.replace({ path: route.path, query });
    if (!isCurrentRead() || route.query.action !== undefined) return;
    if (
      command &&
      accessVerified.value &&
      item.value?.version === fresh?.version
    ) {
      openCommand(command);
    } else {
      actionNotice.value = fresh
        ? '此办理入口已失效，请查看当前案件可用操作。'
        : '此办理入口暂时无法核验，请刷新详情后重新选择操作。';
    }
  }
}

function clearContext(): void {
  actionNotice.value = '';
  accessVerified.value = false;
  drawerOpen.value = false;
  openedCommands.value = new Set();
  openedCommandEntries.value = new Map();
  selectedCommand.value = '';
  lead.value = null;
  leadState.value = 'idle';
  item.value = undefined;
  state.value = 'loading';
  refreshing.value = false;
  refreshError.value = '';
  error.value = '';
  downloadError.value = '';
  matchError.value = '';
  matchSuccess.value = '';
  submitting.value = false;
  complaintUploads.value = [];
  authorizationUploads.value = [];
  amountState.value = 'KNOWN';
  amount.value = '';
  pendingReason.value = '';
  uploadErrors.value = {};
  uploadLoading.value = {};
  complaintError.value = '';
  complaintSuccess.value = '';
  complaintSubmitting.value = false;
  complaintUnknown.value = null;
  matchUnknown.value = null;
  complaintFingerprint = '';
  complaintIdempotencyKey = '';
  defendants.value = [
    { kind: 'PERSON', name: '', idNo: '', phone: '', address: '' },
  ];
  lawyerQuery.value = '';
  lawyerCandidates.value = [];
  selectedLawyer.value = undefined;
  lawyerCandidatesError.value = '';
  matchedOn.value = todayShanghai();
  submissionFingerprint = '';
  idempotencyKey = '';
}

watch(
  [id, identity],
  ([caseId], [priorCaseId]) => {
    if (caseId !== priorCaseId && route.params.id !== undefined) {
      closureSession.clear();
      archiveSession.clear();
    }
    contextRevision += 1;
    readRevision += 1;
    request?.abort();
    request = undefined;
    clearContext();
    void load();
  },
  { flush: 'sync' },
);

watch(
  () => route.query.action,
  (intent) => {
    if (intent === undefined || !active || String(route.params.id) !== id.value)
      return;
    drawerOpen.value = false;
    void load();
  },
);

watch(
  [
    id,
    lawyerQuery,
    () => item.value?.stage,
    () => item.value?.canMatch,
    accessVerified,
  ],
  async ([caseId], [previousCaseId, previousQuery], onCleanup) => {
    candidateRequest?.abort();
    const controller = new AbortController();
    candidateRequest = controller;
    let current = true;
    onCleanup(() => {
      current = false;
      controller.abort();
    });
    lawyerCandidates.value = [];
    const selectedAccountId =
      caseId === previousCaseId && lawyerQuery.value === previousQuery
        ? selectedLawyer.value?.lawyerAccountId
        : undefined;
    if (accessVerified.value) selectedLawyer.value = undefined;
    lawyerCandidatesError.value = '';
    if (
      !caseId ||
      !accessVerified.value ||
      item.value?.stage !== 'PENDING_MATCH' ||
      !item.value.canMatch
    )
      return;
    lawyerCandidatesLoading.value = true;
    try {
      const candidates = await listLawyerMatchCandidates(
        caseId,
        lawyerQuery.value,
        { signal: controller.signal },
      );
      if (!current || controller.signal.aborted) return;
      lawyerCandidates.value = candidates;
      selectedLawyer.value =
        candidates.find(
          (candidate) => candidate.lawyerAccountId === selectedAccountId,
        ) ?? (candidates.length === 1 ? candidates[0] : undefined);
    } catch (reason) {
      if (current && !controller.signal.aborted)
        lawyerCandidatesError.value =
          reason instanceof ApiError && reason.status === 403
            ? '当前账号无权读取该案的律师账号。'
            : '律师账号候选暂时无法加载。';
    } finally {
      if (current) lawyerCandidatesLoading.value = false;
    }
  },
  { flush: 'post' },
);
function addDefendant() {
  if (defendants.value.length >= 20) return;
  defendants.value.push({
    kind: 'PERSON',
    name: '',
    idNo: '',
    phone: '',
    address: '',
  });
}
function stageLabel(stage: CaseDetail['stage']): string {
  if (stage === 'PENDING_MATCH') return '待匹配';
  if (stage === 'WAITING_COMPLAINT') return '待写诉状';
  if (stage === 'WAITING_COMPLAINT_CONFIRMATION') return '诉状待确认';
  if (stage === 'WAITING_COMPLAINT_STAMP') return '诉状待盖章';
  if (stage === 'WAITING_FILING') return '待提交立案';
  if (stage === 'WAITING_FORMAL_ACCEPTANCE') return '待正式立案';
  if (stage === 'WAITING_JUDGMENT') return '待判决';
  if (stage === 'SECOND_INSTANCE') return '二审';
  if (stage === 'WAITING_EXECUTION_DOCUMENTS') return '待写执行材料';
  if (stage === 'WAITING_EXECUTION_CONFIRMATION') return '执行材料待确认';
  if (stage === 'WAITING_EXECUTION_STAMP') return '执行材料待盖章';
  if (stage === 'WAITING_EXECUTION_FILING') return '待申请执行';
  if (stage === 'EXECUTING') return '强制执行中';
  if (stage === 'WAITING_ARCHIVE') return '待归档';
  if (stage === 'ARCHIVED') return '已归档';
  return '待开庭';
}
function removeDefendant(index: number) {
  if (defendants.value.length > 1) defendants.value.splice(index, 1);
}
function makeKey(): string {
  return typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
async function uploadComplaintFiles(
  category: Extract<MaterialCategory, 'COMPLAINT' | 'AUTHORIZATION'>,
  event: unknown,
) {
  if (
    complaintUnknown.value ||
    item.value?.stage !== 'WAITING_COMPLAINT' ||
    !item.value.canSubmitComplaint
  )
    return;
  if (
    typeof event !== 'object' ||
    event === null ||
    !('target' in event) ||
    !(event.target instanceof globalThis.HTMLInputElement)
  ) {
    return;
  }
  const input = event.target;
  const files = Array.from(input.files ?? []);
  input.value = '';
  const uploads =
    category === 'COMPLAINT' ? complaintUploads : authorizationUploads;
  const label = category === 'COMPLAINT' ? '起诉状' : '授权材料';
  uploadErrors.value = { ...uploadErrors.value, [category]: '' };
  complaintError.value = '';
  if (uploads.value.length + files.length > 10) {
    uploadErrors.value[category] = `${label}最多上传 10 份。`;
    return;
  }
  uploadLoading.value = { ...uploadLoading.value, [category]: true };
  const context = operationContext();
  for (const file of files) {
    try {
      const result = await uploadMaterialFile({
        ownerType: 'CASE',
        ownerId: context.caseId,
        category,
        purpose: category,
        file,
      });
      if (!isCurrentOperation(context)) return;
      uploads.value.push({
        materialId: result.materialId,
        contentVersionId: result.contentVersionId,
        originalFilename: result.originalFilename,
        mimeType: result.mimeType,
      });
      complaintFingerprint = '';
    } catch (reason) {
      if (!isCurrentOperation(context)) return;
      uploadErrors.value[category] =
        reason instanceof ApiError && reason.code === 'VALIDATION_ERROR'
          ? `${label}格式不支持或超过 50MB。`
          : `${label}上传未完成，请检查连接后重试。`;
      break;
    }
  }
  if (isCurrentOperation(context, false))
    uploadLoading.value = { ...uploadLoading.value, [category]: false };
}
function downloadComplaintFile(file: CaseFile): void {
  void download(file.materialId, file.contentVersionId);
}
function removeComplaintUpload(
  category: 'COMPLAINT' | 'AUTHORIZATION',
  index: number,
): void {
  if (
    complaintUnknown.value ||
    item.value?.stage !== 'WAITING_COMPLAINT' ||
    !item.value.canSubmitComplaint
  )
    return;
  const uploads =
    category === 'COMPLAINT' ? complaintUploads : authorizationUploads;
  uploads.value.splice(index, 1);
  complaintFingerprint = '';
  complaintIdempotencyKey = '';
}
function complaintErrorMessage(reason: unknown): string {
  if (
    reason instanceof ApiError &&
    (reason.code === 'VERSION_CONFLICT' || reason.code === 'INVALID_STATE')
  ) {
    return '案件阶段或版本已变化，正在读取最新信息。';
  }
  if (
    reason instanceof ApiError &&
    (reason.code === 'NETWORK_ERROR' || reason.code === 'TIMEOUT')
  ) {
    return '提交结果暂时未知；表单和请求键已保留，可安全重试或刷新核实。';
  }
  if (reason instanceof ApiError && reason.code === 'IDEMPOTENCY_CONFLICT') {
    complaintIdempotencyKey = '';
    complaintFingerprint = '';
    return '请求键已用于不同的起诉材料，请刷新案件后重新提交。';
  }
  if (reason instanceof ApiError && reason.status === 403) {
    return '当前账号无权办理此案件。';
  }
  return '起诉材料提交未能完成，请检查信息后重试。';
}
async function submitComplaintMaterials() {
  const current = item.value;
  if (
    !current ||
    (!complaintUnknown.value &&
      (current.stage !== 'WAITING_COMPLAINT' || !current.canSubmitComplaint)) ||
    complaintSubmitting.value
  )
    return;
  complaintError.value = '';
  complaintSuccess.value = '';
  if (
    !complaintUnknown.value &&
    (complaintUploads.value.length < 1 || authorizationUploads.value.length < 1)
  ) {
    complaintError.value = '请至少上传 1 份起诉状和 1 份授权材料。';
    return;
  }
  const trimmedAmount = amount.value.trim();
  const trimmedReason = pendingReason.value.trim();
  if (
    !complaintUnknown.value &&
    (amountState.value === 'KNOWN'
      ? !/^\d+(\.\d+)?$/u.test(trimmedAmount)
      : !trimmedReason)
  ) {
    complaintError.value =
      amountState.value === 'KNOWN'
        ? '请输入非负精确金额。'
        : '请填写待确认原因。';
    return;
  }
  const input: SubmitComplaintInput = complaintUnknown.value ?? {
    expectedVersion: current.version,
    idempotencyKey: '',
    amountState: amountState.value,
    amount: amountState.value === 'KNOWN' ? trimmedAmount : null,
    pendingReason: amountState.value === 'PENDING' ? trimmedReason : null,
    complaintContentVersionIds: complaintUploads.value.map(
      (file) => file.contentVersionId,
    ),
    authorizationContentVersionIds: authorizationUploads.value.map(
      (file) => file.contentVersionId,
    ),
  };
  const fingerprint = JSON.stringify({ ...input, idempotencyKey: undefined });
  if (fingerprint !== complaintFingerprint) {
    complaintFingerprint = fingerprint;
    complaintIdempotencyKey = makeKey();
  }
  complaintSubmitting.value = true;
  const context = operationContext();
  const requestInput = complaintUnknown.value ?? {
    ...input,
    idempotencyKey: complaintIdempotencyKey,
  };
  complaintUnknown.value = requestInput;
  try {
    await submitComplaint(current.id, requestInput);
    if (!isCurrentOperation(context)) return;
    const fresh = await readCommandDetail(context);
    if (!isCurrentOperation(context)) return;
    item.value = fresh;
    if (fresh.stage === 'WAITING_COMPLAINT_CONFIRMATION' && fresh.complaint) {
      complaintSuccess.value = '起诉材料已确认提交，提交完成时为诉状待确认。';
      complaintUnknown.value = null;
      openedCommands.value.delete('complaint');
      openedCommandEntries.value.delete('complaint');
      drawerOpen.value = false;
      complaintFingerprint = '';
      complaintIdempotencyKey = '';
      notifyWorkflowChanged();
    } else {
      complaintError.value =
        '请求已提交，但尚未能从案件详情确认结果；请刷新核实。';
    }
  } catch (reason) {
    if (!isCurrentOperation(context)) return;
    complaintError.value = complaintErrorMessage(reason);
    if (
      reason instanceof ApiError &&
      !['NETWORK_ERROR', 'TIMEOUT'].includes(reason.code) &&
      reason.status < 500 &&
      reason.status !== 0
    )
      complaintUnknown.value = null;
    if (
      reason instanceof ApiError &&
      (reason.code === 'VERSION_CONFLICT' || reason.code === 'INVALID_STATE')
    ) {
      try {
        const fresh = await readCommandDetail(context);
        if (isCurrentOperation(context)) item.value = fresh;
      } catch {
        /* retain the last confirmed detail */
      }
      complaintFingerprint = '';
      complaintIdempotencyKey = '';
    }
  } finally {
    if (isCurrentOperation(context, false)) complaintSubmitting.value = false;
  }
}
async function submitMatch() {
  const current = item.value;
  if (
    !current ||
    (!matchUnknown.value &&
      (current.stage !== 'PENDING_MATCH' || !current.canMatch)) ||
    submitting.value
  )
    return;
  matchError.value = '';
  matchSuccess.value = '';
  if (
    !matchUnknown.value &&
    defendants.value.some(({ name }) => !name.trim())
  ) {
    matchError.value = '请填写每位被告的名称。';
    return;
  }
  if (!matchUnknown.value && !selectedLawyer.value) {
    matchError.value =
      '请选择已创建的律师账号；没有候选时请联系有权限的管理员创建账号。';
    return;
  }
  if (
    !matchUnknown.value &&
    (!matchedOn.value || matchedOn.value > todayShanghai())
  ) {
    matchError.value = '请选择真实的实际匹配日期，不能晚于今天。';
    return;
  }
  const input: MatchCaseInput = matchUnknown.value ?? {
    expectedVersion: current.version,
    idempotencyKey: '',
    matchedOn: matchedOn.value,
    defendants: defendants.value.map(
      ({ kind, name, idNo, phone, address }) => ({
        kind,
        name,
        idNo,
        phone,
        address,
      }),
    ),
    lawyerAccountId: selectedLawyer.value?.lawyerAccountId ?? '',
    lawyerProfileId: selectedLawyer.value?.lawyerProfileId ?? '',
  };
  const fingerprint = JSON.stringify({ ...input, idempotencyKey: undefined });
  if (fingerprint !== submissionFingerprint) {
    submissionFingerprint = fingerprint;
    idempotencyKey = makeKey();
  }
  if (!matchUnknown.value) input.idempotencyKey = idempotencyKey;
  matchUnknown.value = input;
  submitting.value = true;
  const context = operationContext();
  try {
    await matchCase(current.id, input);
    if (!isCurrentOperation(context)) return;
    const fresh = await readCommandDetail(context);
    if (!isCurrentOperation(context)) return;
    item.value = fresh;
    if (
      fresh.stage === 'WAITING_COMPLAINT' &&
      fresh.matchedAt !== null &&
      fresh.matchedOn === input.matchedOn
    ) {
      matchSuccess.value = '案件匹配已完成，匹配完成时为待写诉状。';
      matchUnknown.value = null;
      openedCommands.value.delete('match');
      openedCommandEntries.value.delete('match');
      drawerOpen.value = false;
      submissionFingerprint = '';
      idempotencyKey = '';
      notifyWorkflowChanged();
    } else {
      matchError.value =
        '请求已提交，但尚未能从案件详情确认匹配结果；请刷新核实。';
    }
  } catch (reason) {
    if (!isCurrentOperation(context)) return;
    if (
      reason instanceof ApiError &&
      !['NETWORK_ERROR', 'TIMEOUT'].includes(reason.code) &&
      reason.status < 500 &&
      reason.status !== 0
    )
      matchUnknown.value = null;
    if (
      reason instanceof ApiError &&
      (reason.code === 'VERSION_CONFLICT' || reason.code === 'INVALID_STATE')
    ) {
      matchError.value = '案件状态或版本已变化，正在读取最新信息。';
      try {
        const fresh = await readCommandDetail(context);
        if (isCurrentOperation(context)) item.value = fresh;
      } catch {
        /* Keep the confirmed prior detail visible. */
      }
      submissionFingerprint = '';
      idempotencyKey = '';
    } else if (
      reason instanceof ApiError &&
      (reason.status === 403 ||
        ['ACTION_FORBIDDEN', 'CASE_ACTION_FORBIDDEN', 'FORBIDDEN'].includes(
          reason.code,
        ))
    ) {
      matchError.value = '当前账号无权办理此案件。';
    } else if (
      reason instanceof ApiError &&
      ['RESOURCE_NOT_FOUND', 'NOT_FOUND'].includes(reason.code)
    ) {
      matchError.value = '案件不存在或当前账号不可访问。';
    } else if (
      reason instanceof ApiError &&
      reason.code === 'IDEMPOTENCY_CONFLICT'
    ) {
      matchError.value = '请求键已用于不同的匹配信息，请刷新案件后重新提交。';
      submissionFingerprint = '';
      idempotencyKey = '';
    } else if (
      reason instanceof ApiError &&
      reason.code === 'VALIDATION_ERROR'
    ) {
      matchError.value = '匹配信息未通过校验，请检查日期、必填项和字段长度。';
    } else if (
      reason instanceof ApiError &&
      (reason.code === 'NETWORK_ERROR' || reason.code === 'TIMEOUT')
    ) {
      matchError.value =
        '提交结果暂时未知；表单已保留，可安全重试或刷新详情核实。';
    } else {
      matchError.value = '案件匹配未能完成，请检查信息后重试。';
    }
  } finally {
    if (isCurrentOperation(context, false)) submitting.value = false;
  }
}
async function download(materialId: string, versionId: string) {
  const context = operationContext();
  downloadError.value = '';
  try {
    await downloadMaterialVersion(materialId, versionId);
  } catch {
    if (isCurrentOperation(context))
      downloadError.value = '文件下载失败，请稍后重试。';
  }
}
onMounted(() => void load());
onActivated(() => {
  if (firstActivation) {
    firstActivation = false;
    return;
  }
  active = true;
  editorVisible.value = true;
  // The retained editor remains mounted, but no cached case projection is
  // rendered until the server confirms this session can still read it.
  accessVerified.value = false;
  state.value = 'loading';
  void load();
});
onDeactivated(() => {
  active = false;
  editorVisible.value = false;
  contextRevision += 1;
  readRevision += 1;
  request?.abort();
  candidateRequest?.abort();
  request = undefined;
  accessVerified.value = false;
  state.value = 'loading';
  drawerOpen.value = false;
  submitting.value = false;
  complaintSubmitting.value = false;
});
onBeforeUnmount(() => {
  active = false;
  contextRevision += 1;
  readRevision += 1;
  request?.abort();
});
</script>

<template>
  <div class="page-view">
    <p v-if="actionNotice" role="status" data-test="case-action-notice">
      {{ actionNotice }}
    </p>
    <section
      v-if="!accessVerified || state !== 'ready' || !item"
      class="state-panel ledger-panel"
    >
      <p><RouterLink :to="backTo">返回案件列表</RouterLink></p>
      <h1 v-if="state === 'loading'">正在读取案件</h1>
      <h1 v-else-if="state === 'missing'">案件不存在或已不可访问</h1>
      <template v-else>
        <h1>案件暂时无法读取</h1>
        <p class="submit-error" role="alert">{{ error }}</p>
        <ElButton type="primary" @click="load">重新加载</ElButton>
      </template>
    </section>
    <CaseWorkspaceShell
      v-if="item"
      v-show="accessVerified && state === 'ready'"
      :business-no="item.businessNo"
      :subtitle="`${item.courtCaseNo ?? '法院案号未登记'} · ${item.customer.name} · ${stageLabel(item.stage)}`"
      :active-tab="activeTab"
      :context-key="workspaceContext"
      @update:active-tab="selectTab"
    >
      <template #back
        ><RouterLink :to="backTo">返回案件列表</RouterLink></template
      >
      <template #actions>
        <div class="detail-actions">
          <span class="pill">{{ stageLabel(item.stage) }}</span>
          <ElButton
            v-if="primaryCommand"
            :type="
              primaryCommand.label.startsWith('撤销') ? 'danger' : 'primary'
            "
            data-test="workspace-primary-action"
            @click="openCommand(primaryCommand)"
            >{{ primaryCommand.label }}</ElButton
          >
          <details
            v-if="moreCommands.length > 0"
            data-test="workspace-more-actions"
          >
            <summary>更多操作</summary>
            <ElButton
              v-for="command in moreCommands"
              :key="command.id"
              :type="command.label.startsWith('撤销') ? 'danger' : 'primary'"
              plain
              :data-command="command.id"
              @click="openCommand(command)"
              >{{ command.label }}</ElButton
            >
          </details>
          <ElButton
            plain
            data-test="case-refresh"
            :loading="refreshing"
            @click="load"
            >刷新</ElButton
          >
        </div>
      </template>
      <template #details>
        <div
          v-if="priorEditors.length > 0"
          class="case-workspace-field__help"
          data-test="workspace-prior-forms"
        >
          <span>先前打开的表单：</span>
          <ElButton
            v-for="previous in priorEditors"
            :key="previous.id"
            text
            data-test="workspace-prior-editor"
            :data-command="previous.id"
            @click="reopenPriorEditor(previous)"
            >{{ previous.label }}</ElButton
          >
        </div>
        <p
          v-if="commands.length === 0"
          data-test="case-read-only"
          class="case-workspace-field__help"
        >
          可以查看案件和下载获准材料；当前账号不能办理此案。{{
            item.stage === 'WAITING_COMPLAINT' ? '匹配已完成。' : ''
          }}
        </p>
        <p v-if="refreshing" role="status">正在刷新案件详情…</p>
        <p v-if="refreshError" class="submit-error" role="alert">
          {{ refreshError }}
        </p>
        <p v-if="matchSuccess" role="status">{{ matchSuccess }}</p>
        <CaseDetailsSections
          :item="item"
          :lead="lead"
          :lead-state="leadState"
          :actions="sectionActions"
          :context-key="workspaceContext"
          @edit="editSection"
          @view-timeline="viewTimeline"
        />
      </template>
      <template #files>
        <CaseWorkspaceFiles
          :item="item"
          :context-key="`${workspaceContext}:${item.version}:${activationRevision}`"
          :list-case-materials="listCaseMaterials"
          :download-version="downloadMaterialVersion"
          @open-upload="openUpload"
        />
      </template>
      <template #fees><CaseWorkspaceFees :item="item" /></template>
      <template #editors>
        <ElDrawer
          v-model="drawerOpen"
          :modal-class="
            editorVisible ? undefined : 'case-workspace-editors--inactive'
          "
          class="case-workspace-editors"
          :title="timelineView ? '流程时间轴记录' : '登记／更正案件资料'"
          size="min(720px, 100vw)"
          append-to-body
          :destroy-on-close="false"
        >
          <p class="field-help">
            通用字段编辑、手工时间轴保存和完整案件收付尚未提供。仅使用下方真实业务命令；关闭抽屉不提交、不清除待核对请求。
          </p>
          <div v-show="timelineView" class="case-workspace-timeline">
            <p>仅展示本案已返回的真实记录，不能修改或删除审计。</p>
            <ol>
              <li
                v-for="event in timelineEvents"
                :key="`${event.source}:${event.id}`"
              >
                <h3>{{ event.title }}</h3>
                <p>业务日期／时间：{{ workspaceDate(event.businessAt) }}</p>
                <p>记录时间：{{ workspaceDate(event.recordedAt) }}</p>
                <p v-for="field in event.fields" :key="field.label">
                  {{ field.label }}：{{ field.value }}
                </p>
              </li>
            </ol>
          </div>
          <label v-show="!timelineView"
            >业务命令
            <select
              class="text-input"
              :value="selectedCommand"
              data-test="workspace-command"
              @change="
                chooseCommand(($event.target as HTMLSelectElement).value)
              "
            >
              <option v-if="!selectedCommand" value="" disabled>
                请选择具体操作
              </option>
              <option
                v-for="command in editorCommands"
                :key="command.id"
                :value="command.id"
              >
                {{ command.label }}
              </option>
              <option
                v-if="
                  !editorCommands.some(
                    (command) => command.id === selectedCommand,
                  )
                "
                :value="selectedCommand"
                disabled
              >
                原请求待核对；请使用原表单刷新／显式重试
              </option>
            </select>
          </label>

          <div
            v-if="openedCommands.has('confirm-complaint')"
            v-show="!timelineView && selectedCommand === 'confirm-complaint'"
          >
            <CaseComplaintConfirmationPanel
              :item="item"
              :read-revision="activationRevision"
              @changed="load"
              @refresh="load"
            />
          </div>
          <div
            v-if="openedCommands.has('mail-complaint')"
            v-show="!timelineView && selectedCommand === 'mail-complaint'"
          >
            <CaseComplaintMailingPanel
              :item="item"
              :read-revision="activationRevision"
              @changed="load"
              @refresh="load"
            />
          </div>
          <div
            v-if="openedCommands.has('filing')"
            v-show="!timelineView && selectedCommand === 'filing'"
          >
            <CaseFilingPanel
              :item="item"
              :read-revision="activationRevision"
              :context-key="identity"
              @changed="load"
              @refresh="load"
            />
          </div>
          <div
            v-if="openedCommands.has('acceptance')"
            v-show="!timelineView && selectedCommand === 'acceptance'"
          >
            <CaseAcceptancePanel
              :item="item"
              :context-key="identity"
              @changed="load"
              @refresh="load"
            />
          </div>
          <div
            v-if="openedCommands.has('defendant-contact-update')"
            v-show="
              !timelineView && selectedCommand === 'defendant-contact-update'
            "
          >
            <CaseDefendantContactPanel
              :item="item"
              :context-key="workspaceContext"
              @changed="load"
              @refresh="load"
              @access-lost="recordEditAccessLost"
              @cancel="closeRecordEdit"
            />
          </div>
          <div
            v-if="openedCommands.has('acceptance-correction')"
            v-show="
              !timelineView && selectedCommand === 'acceptance-correction'
            "
          >
            <CaseAcceptanceCorrectionPanel
              :item="item"
              :context-key="workspaceContext"
              @changed="load"
              @refresh="load"
              @access-lost="recordEditAccessLost"
              @cancel="closeRecordEdit"
            />
          </div>
          <div
            v-if="openedCommands.has('hearing')"
            v-show="!timelineView && selectedCommand === 'hearing'"
          >
            <CaseHearingPanel
              :item="item"
              :context-key="identity"
              @changed="load"
              @refresh="load"
            />
          </div>
          <div
            v-if="openedCommands.has('judgment')"
            v-show="!timelineView && selectedCommand === 'judgment'"
          >
            <CaseJudgmentPanel
              :item="item"
              :context-key="identity"
              @changed="load"
              @refresh="load"
            />
          </div>
          <div
            v-if="openedCommands.has('next-step')"
            v-show="!timelineView && selectedCommand === 'next-step'"
          >
            <CaseJudgmentNextStepPanel
              :item="item"
              :context-key="identity"
              @changed="load"
              @refresh="load"
            />
          </div>
          <div
            v-if="openedCommands.has('second-instance')"
            v-show="!timelineView && selectedCommand === 'second-instance'"
          >
            <CaseSecondInstancePanel
              :item="item"
              :context-key="identity"
              :actor-key="secondInstanceActorKey"
              @changed="load"
              @refresh="load"
            />
          </div>
          <div
            v-if="openedCommands.has('second-instance-acceptance')"
            v-show="
              !timelineView && selectedCommand === 'second-instance-acceptance'
            "
          >
            <CaseSecondInstanceAcceptancePanel
              :item="item"
              :context-key="workspaceContext"
              @changed="load"
              @refresh="load"
              @access-lost="recordEditAccessLost"
              @cancel="closeRecordEdit"
            />
          </div>
          <div
            v-if="openedCommands.has('execution-upload')"
            v-show="!timelineView && selectedCommand === 'execution-upload'"
          >
            <CaseExecutionSubmissionPanel
              :item="item"
              :context-key="identity"
              :actor-key="secondInstanceActorKey"
              :read-revision="activationRevision"
              upload-only
              @changed="load"
              @refresh="load"
            />
          </div>
          <div
            v-if="openedCommands.has('execution-submission')"
            v-show="!timelineView && selectedCommand === 'execution-submission'"
          >
            <CaseExecutionSubmissionPanel
              :item="item"
              :context-key="identity"
              :actor-key="secondInstanceActorKey"
              :read-revision="activationRevision"
              @changed="load"
              @refresh="load"
            />
          </div>
          <div
            v-if="openedCommands.has('execution-mailing')"
            v-show="!timelineView && selectedCommand === 'execution-mailing'"
          >
            <CaseExecutionMailingPanel
              :item="item"
              :read-revision="activationRevision"
              :context-key="identity"
              @changed="load"
              @refresh="load"
            />
          </div>
          <div
            v-if="openedCommands.has('finish')"
            v-show="!timelineView && selectedCommand === 'finish'"
          >
            <CaseExecutionFinishPanel
              :item="item"
              :read-revision="activationRevision"
              :context-key="identity"
              :pending-request="finishPending"
              :submit-finish="finishCallbacks.submit"
              :list-basis-files="finishCallbacks.list"
              :upload-basis-file="finishCallbacks.upload"
              :download-basis-file="finishCallbacks.download"
              @pending-change="finishCallbacks.pending"
              @changed="finishCallbacks.changed"
              @refresh="finishCallbacks.refresh"
            />
          </div>
          <div
            v-if="openedCommands.has('archive')"
            v-show="!timelineView && selectedCommand === 'archive'"
          >
            <CaseArchivePanel
              :item="item"
              :context-key="identity"
              :pending-request="archivePending"
              :archive-case="archiveCallbacks.archive"
              :correct-archive="archiveCallbacks.correct"
              @pending-change="archiveCallbacks.pending"
              @changed="archiveCallbacks.changed"
              @refresh="archiveCallbacks.refresh"
            />
          </div>
          <div
            v-if="openedCommands.has('closure')"
            v-show="!timelineView && selectedCommand === 'closure'"
          >
            <CaseClosurePanel
              :item="item"
              :read-revision="activationRevision"
              :context-key="identity"
              :pending-request="closurePending"
              :record-closure="closureCallbacks.record"
              :correct-closure="closureCallbacks.correct"
              :list-closure-files="closureCallbacks.list"
              :upload-closure-file="closureCallbacks.upload"
              :download-closure-file="closureCallbacks.download"
              @pending-change="closureCallbacks.pending"
              @changed="closureCallbacks.changed"
              @refresh="closureCallbacks.refresh"
            />
          </div>
          <div
            v-if="openedCommands.has('execution-filing')"
            v-show="!timelineView && selectedCommand === 'execution-filing'"
          >
            <CaseExecutionFilingPanel
              :item="item"
              :read-revision="activationRevision"
              :context-key="identity"
              @changed="load"
              @refresh="load"
            />
          </div>
          <div
            v-if="openedCommands.has('execution-confirmation')"
            v-show="
              !timelineView && selectedCommand === 'execution-confirmation'
            "
          >
            <CaseExecutionConfirmationPanel
              :item="item"
              :context-key="identity"
              :actor-key="secondInstanceActorKey"
              @changed="load"
              @refresh="load"
            />
          </div>
          <section
            v-if="openedCommands.has('match')"
            v-show="!timelineView && selectedCommand === 'match'"
            class="demo-card demo-card--pad"
            data-test="case-match-form"
            :inert="
              !!matchUnknown || item.stage !== 'PENDING_MATCH' || !item.canMatch
            "
          >
            <h2 class="form-section-title">匹配当事人与承办律师</h2>
            <p class="field-help">
              提交后将保存全部被告和主办律师，并把案件推进到“待写诉状”。上述信息与阶段变更会一并保存。
            </p>
            <div class="demo-form-grid">
              <label
                >实际匹配日期 <span aria-hidden="true">*</span
                ><input
                  v-model="matchedOn"
                  type="date"
                  class="text-input"
                  :max="todayShanghai()"
                  required
                  :aria-required="true"
              /></label>
              <p class="field-help">
                默认今天；补录时可改为真实的过去日期。系统会另记本次登记时间。
              </p>
            </div>
            <div
              v-for="(defendant, index) in defendants"
              :key="index"
              class="demo-form-grid"
            >
              <h3>被告 {{ index + 1 }}</h3>
              <label
                >主体类型
                <select v-model="defendant.kind" class="text-input">
                  <option value="PERSON">自然人</option>
                  <option value="ORGANIZATION">组织</option>
                </select></label
              >
              <label
                >名称 <span aria-hidden="true">*</span
                ><input
                  v-model="defendant.name"
                  class="text-input"
                  required
                  :aria-required="true"
              /></label>
              <label
                >身份证号（选填）<input
                  v-model="defendant.idNo"
                  class="text-input"
              /></label>
              <label
                >电话（选填）<input
                  v-model="defendant.phone"
                  class="text-input"
              /></label>
              <label
                >地址（选填）<input
                  v-model="defendant.address"
                  class="text-input"
              /></label>
              <ElButton
                v-if="defendants.length > 1"
                text
                @click="removeDefendant(index)"
                >移除此被告</ElButton
              >
            </div>
            <ElButton
              text
              :disabled="defendants.length >= 20"
              @click="addDefendant"
              >添加被告（最多 20 位）</ElButton
            >
            <div class="demo-form-grid">
              <h3>主办律师账号</h3>
              <label
                >按姓名或用户名搜索<input
                  v-model="lawyerQuery"
                  class="text-input"
                  autocomplete="off"
              /></label>
              <label
                >账号 <span aria-hidden="true">*</span
                ><select
                  v-model="selectedLawyer"
                  class="text-input"
                  :disabled="
                    lawyerCandidatesLoading || lawyerCandidates.length === 0
                  "
                >
                  <option :value="undefined">
                    {{
                      lawyerCandidatesLoading
                        ? '正在读取律师账号'
                        : '请选择姓名（用户名）'
                    }}
                  </option>
                  <option
                    v-for="candidate in lawyerCandidates"
                    :key="candidate.lawyerAccountId"
                    :value="candidate"
                  >
                    {{ candidate.displayName }}（{{ candidate.username }}）
                  </option>
                </select></label
              >
              <p v-if="lawyerCandidatesError" class="submit-error" role="alert">
                {{ lawyerCandidatesError }}
              </p>
              <p
                v-else-if="
                  !lawyerCandidatesLoading && lawyerCandidates.length === 0
                "
                class="field-help"
              >
                没有有效律师账号候选。请联系有权限的管理员先创建律师账号。
              </p>
              <p v-else-if="lawyerCandidates.length === 1" class="field-help">
                已自动选择唯一候选账号。
              </p>
            </div>
            <p v-if="matchError" class="submit-error" role="alert">
              {{ matchError }}
            </p>
            <ElButton
              type="primary"
              :loading="submitting"
              :disabled="submitting"
              @click="submitMatch"
              >确认匹配并进入待写诉状</ElButton
            >
          </section>
          <ElButton
            v-if="matchUnknown && !timelineView && selectedCommand === 'match'"
            :disabled="submitting"
            data-test="match-retry-original"
            @click="submitMatch"
            >显式重试匹配原请求</ElButton
          >
          <p
            v-if="matchUnknown && !timelineView && selectedCommand === 'match'"
            class="field-help"
          >
            原请求：案件版本 {{ matchUnknown.expectedVersion }}；实际匹配日期
            {{ matchUnknown.matchedOn }}；被告
            {{
              matchUnknown.defendants.map((entry) => entry.name).join('、')
            }}；律师账号
            {{ matchUnknown.lawyerAccountId }}。重试沿用原内容及请求键。
          </p>
          <ElButton
            v-if="
              complaintUnknown &&
              !timelineView &&
              selectedCommand === 'complaint'
            "
            :disabled="complaintSubmitting"
            data-test="complaint-retry-original"
            @click="submitComplaintMaterials"
            >显式重试起诉材料原请求</ElButton
          >
          <p
            v-if="
              complaintUnknown &&
              !timelineView &&
              selectedCommand === 'complaint'
            "
            class="field-help"
          >
            原请求：案件版本 {{ complaintUnknown.expectedVersion }}；诉请金额
            {{
              complaintUnknown.amountState === 'KNOWN'
                ? complaintUnknown.amount
                : `待确认（${complaintUnknown.pendingReason}）`
            }}；起诉状
            {{ complaintUnknown.complaintContentVersionIds.length }}
            份，授权材料
            {{ complaintUnknown.authorizationContentVersionIds.length }}
            份。重试沿用原内容及请求键。
          </p>
          <CaseComplaintSubmissionForm
            v-if="openedCommands.has('complaint')"
            v-show="!timelineView && selectedCommand === 'complaint'"
            :inert="
              !!complaintUnknown ||
              item.stage !== 'WAITING_COMPLAINT' ||
              !item.canSubmitComplaint
            "
            :complaint-files="complaintUploads"
            :authorization-files="authorizationUploads"
            v-model:amount-state="amountState"
            v-model:amount="amount"
            v-model:pending-reason="pendingReason"
            :upload-loading="uploadLoading"
            :upload-errors="uploadErrors"
            :error="complaintError"
            :success="complaintSuccess"
            :submitting="complaintSubmitting"
            :locked="uploadLoading.COMPLAINT || uploadLoading.AUTHORIZATION"
            @upload="uploadComplaintFiles"
            @download="downloadComplaintFile"
            @remove="removeComplaintUpload"
            @submit="submitComplaintMaterials"
          />
        </ElDrawer>
      </template>
    </CaseWorkspaceShell>
  </div>
</template>

<style>
.case-workspace-editors--inactive {
  display: none !important;
}
</style>
