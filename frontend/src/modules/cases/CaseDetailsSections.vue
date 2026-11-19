<script setup lang="ts">
import { computed, onBeforeUnmount, onDeactivated, ref, watch } from 'vue';
import type { CaseDetail } from '../../api/cases';
import type { LeadDetail } from '../../api/leads';
import type { CaseRoutineProfile } from '../../api/case-routine';
import type { CaseClosureWorkspace } from '../../api/case-closure-workspace';
import type {
  CaseSupplementWorkspace,
  CaseSupplementKind,
} from '../../api/case-supplements';
import type { EvidenceGroup } from '../../api/evidence';
import type { CaseSettlement } from '../../api/settlements';
import type { RefundWorkspace } from '../../api/litigation-refunds';
import {
  downloadMaterialVersion,
  type OwnerMaterial,
} from '../../api/materials';
import CaseSupplementalWorkspacePanel from './CaseSupplementalWorkspacePanel.vue';
import CaseWorkspaceSection from './CaseWorkspaceSection.vue';
import type { SectionAction, SectionKey } from './case-workspace-contract';
import {
  buildCaseWorkspaceEvents,
  buildCaseWorkspaceSections,
  workspaceDate,
  type LeadState,
  type WorkspaceSection,
  type WorkspaceField,
} from './case-workspace-read-model';

const props = defineProps<{
  item: CaseDetail;
  lead: LeadDetail | null;
  leadState: LeadState;
  routine?: CaseRoutineProfile | null;
  closureWorkspace?: CaseClosureWorkspace | null;
  supplementWorkspace?: CaseSupplementWorkspace | null;
  evidenceGroup?: EvidenceGroup | null;
  settlementWorkspace?: CaseSettlement | null;
  refundWorkspace?: RefundWorkspace | null;
  leadMaterials?: OwnerMaterial[] | null;
  notaryMaterials?: OwnerMaterial[] | null;
  closureReadState?: LeadState;
  supplementReadState?: LeadState;
  evidenceReadState?: LeadState;
  settlementReadState?: LeadState;
  leadMaterialState?: LeadState;
  notaryMaterialState?: LeadState;
  actions: Record<SectionKey, SectionAction>;
  contextKey: string;
  editingSection?: SectionKey | null;
  editFields?: Record<
    string,
    {
      kind: 'text' | 'textarea' | 'select' | 'multi';
      value: string | string[];
      options?: Array<{ value: string; label: string }>;
    }
  > | null;
  supplementActorKey: string;
}>();
const emit = defineEmits<{
  edit: [sectionKey: SectionKey];
  'view-timeline': [];
  'supplement-changed': [];
  'open-files': [];
  'update-field': [label: string, value: string | string[]];
}>();
const sections = computed(() =>
  buildCaseWorkspaceSections(
    props.item,
    props.lead,
    props.leadState,
    props.routine,
    props.closureWorkspace,
    props.supplementWorkspace,
    props.closureReadState,
    props.supplementReadState,
    props.evidenceGroup,
    props.evidenceReadState,
    props.leadMaterials,
    props.notaryMaterials,
    props.leadMaterialState,
    props.notaryMaterialState,
    props.settlementWorkspace,
    props.settlementReadState,
    props.refundWorkspace,
  ),
);
const events = computed(() =>
  buildCaseWorkspaceEvents(props.item, props.supplementWorkspace),
);
const selectedGroups = ref<Partial<Record<SectionKey, string>>>({});
const supplementKind = ref<CaseSupplementKind | null>(null);
const fileDownloadError = ref<{ section: SectionKey; message: string } | null>(
  null,
);
const fileDownloads = new Set<AbortController>();
function cancelFileDownloads(): void {
  for (const controller of fileDownloads) controller.abort();
  fileDownloads.clear();
}
function isFileField(label: string): boolean {
  return (
    label === '公证书' ||
    /文件|文书|截图|照片|起诉状|通知书|判决书/u.test(label)
  );
}
const defendantNames = ['被告一', '被告二', '被告三', '被告四', '被告五', '被告六'];
function summaryGroups(
  section: WorkspaceSection,
): Array<{ id?: string; title: string | null; fields: WorkspaceField[] }> {
  if (section.key === 'case-info') {
    const defendants = section.groups
      .filter((group) => group.id.startsWith('defendant:'))
      .map((group, index) => ({
        id: group.id,
        title: defendantNames[index] ?? `被告${index + 1}`,
        fields: group.fields.filter((field) => field.value !== null),
      }));
    return [{ title: null, fields: section.summary }, ...defendants];
  }
  if (section.key !== 'judgment')
    return [{ title: null, fields: section.summary }];
  return [
    {
      title: '一审判决信息',
      fields: section.summary.filter((field) =>
        field.label.startsWith('一审／'),
      ),
    },
    {
      title: '二审判决信息',
      fields: section.summary.filter((field) =>
        field.label.startsWith('二审／'),
      ),
    },
    {
      title: '历史审级与退费归属',
      fields: section.summary.filter(
        (field) =>
          !field.label.startsWith('一审／') &&
          !field.label.startsWith('二审／'),
      ),
    },
  ];
}
async function downloadSummaryFile(
  section: SectionKey,
  materialId: string,
  contentVersionId: string,
): Promise<void> {
  fileDownloadError.value = null;
  const contextKey = props.contextKey;
  const controller = new AbortController();
  fileDownloads.add(controller);
  try {
    await downloadMaterialVersion(
      materialId,
      contentVersionId,
      controller.signal,
    );
  } catch {
    if (!controller.signal.aborted && contextKey === props.contextKey)
      fileDownloadError.value = {
        section,
        message: '该文件版本暂不可下载，请核对原记录权限。',
      };
  } finally {
    fileDownloads.delete(controller);
  }
}
function editField(label: string, groupId?: string) {
  if (groupId?.startsWith('defendant:')) {
    const defendantId = groupId.slice('defendant:'.length);
    return props.editFields?.[`${label}@${defendantId}`] ?? null;
  }
  return props.editFields?.[label] ?? null;
}
function toggleMulti(label: string, option: string, checked: boolean): void {
  const current = editField(label);
  const values = Array.isArray(current?.value) ? [...current.value] : [];
  const next = checked
    ? [...new Set([...values, option])]
    : values.filter((entry) => entry !== option);
  emit('update-field', label, next);
}
function inputValue(event: Event): string {
  return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
}

function hiddenWhileEditing(key: SectionKey, label: string): boolean {
  if (props.editingSection !== key) return false;
  if (key === 'lead-info') return label === '店铺名';
  return false;
}
const supplementsBySection: Partial<Record<SectionKey, CaseSupplementKind[]>> =
  {
    'first-instance': [
      'COURT_PREPAYMENT_NOTICE',
      'COURT_DISCLOSURE',
      'RECORD_RETRIEVAL_DOCUMENT',
      'PRESERVATION_DOCUMENT',
    ],
    execution: ['EXECUTION_FORMAL_ACCEPTANCE'],
    judgment: ['REFUND_SOURCE_LINK'],
    timeline: ['MANUAL_ANNOTATION'],
  };
const supplementLabels: Record<CaseSupplementKind, string> = {
  COURT_PREPAYMENT_NOTICE: '补录预缴通知',
  COURT_DISCLOSURE: '补录法院披露',
  RECORD_RETRIEVAL_DOCUMENT: '补录调档文件',
  PRESERVATION_DOCUMENT: '补录保全文书',
  EXECUTION_FORMAL_ACCEPTANCE: '补录执行受理',
  REFUND_SOURCE_LINK: '关联退费归属',
  MANUAL_ANNOTATION: '添加记录',
};
watch(
  () => props.contextKey,
  () => {
    cancelFileDownloads();
    selectedGroups.value = {};
    supplementKind.value = null;
    fileDownloadError.value = null;
  },
  { flush: 'sync' },
);
onDeactivated(cancelFileDownloads);
onBeforeUnmount(cancelFileDownloads);
function activeGroup(
  section: (typeof sections.value)[number],
): string | undefined {
  const selected = selectedGroups.value[section.key];
  if (section.groups.some((group) => group.id === selected)) return selected;
  return (
    section.groups.find(
      (group) => !group.historical && group.id !== 'judgment-state',
    ) ?? section.groups[0]
  )?.id;
}
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
      :action-label="
        section.key === 'timeline' ? actions[section.key].label : '编辑'
      "
      :default-expanded="section.key === 'case-info'"
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
      <div
        v-if="section.summary.length"
        class="case-workspace-main-summary"
        data-test="workspace-main-summary"
      >
        <div
          v-for="group in summaryGroups(section)"
          :key="group.title ?? section.key"
          class="case-workspace-summary-group"
        >
          <h3 v-if="group.title">{{ group.title }}</h3>
          <dl class="case-workspace-fields">
            <div
              v-for="(field, index) in group.fields"
              v-show="!hiddenWhileEditing(section.key, field.label)"
              :key="`${field.label}:${index}`"
              class="case-workspace-field"
              :class="{ 'case-workspace-field--wide': field.wide }"
            >
              <dt class="case-workspace-field__label">
                {{ field.label }}
              </dt>
              <dd class="case-workspace-field__value">
                <template v-if="editField(field.label, group.id)">
                  <textarea
                    v-if="editField(field.label, group.id)!.kind === 'textarea'"
                    class="text-input"
                    rows="2"
                    :data-test="`edit-field-${field.label}`"
                    :value="String(editField(field.label, group.id)!.value ?? '')"
                    @input="
                      emit('update-field', field.label, inputValue($event))
                    "
                  />
                  <select
                    v-else-if="editField(field.label, group.id)!.kind === 'select'"
                    class="text-input"
                    :data-test="`edit-field-${field.label}`"
                    :value="String(editField(field.label, group.id)!.value ?? '')"
                    @change="
                      emit('update-field', field.label, inputValue($event))
                    "
                  >
                    <option
                      v-for="option in editField(field.label, group.id)!.options ?? []"
                      :key="option.value"
                      :value="option.value"
                    >
                      {{ option.label }}
                    </option>
                  </select>
                  <span
                    v-else-if="editField(field.label, group.id)!.kind === 'multi'"
                    class="case-workspace-multi"
                    :data-test="`edit-field-${field.label}`"
                  >
                    <label
                      v-for="option in editField(field.label, group.id)!.options ?? []"
                      :key="option.value"
                    >
                      <input
                        type="checkbox"
                        :value="option.value"
                        :checked="
                          (editField(field.label, group.id)!.value as string[]).includes(
                            option.value,
                          )
                        "
                        @change="
                          toggleMulti(
                            field.label,
                            option.value,
                            ($event.target as HTMLInputElement).checked,
                          )
                        "
                      />
                      {{ option.label }}
                    </label>
                  </span>
                  <input
                    v-else
                    class="text-input"
                    :data-test="`edit-field-${field.label}`"
                    :value="String(editField(field.label, group.id)!.value ?? '')"
                    @input="
                      emit('update-field', field.label, inputValue($event))
                    "
                  />
                </template>
                <template v-else>{{ field.value }}</template>
                <button
                  v-for="file in field.fileVersions ?? []"
                  :key="`${file.materialId}:${file.contentVersionId}`"
                  type="button"
                  class="case-workspace-section__view"
                  @click="
                    downloadSummaryFile(
                      section.key,
                      file.materialId,
                      file.contentVersionId,
                    )
                  "
                >
                  下载 {{ file.filename }} 版本
                </button>
                <button
                  v-if="
                    isFileField(field.label) &&
                    !field.fileVersions?.length &&
                    !['未登记', '未记录'].includes(field.value) &&
                    !field.value.includes('暂不可读取') &&
                    !field.value.includes('暂不可核验')
                  "
                  type="button"
                  class="case-workspace-section__view"
                  @click="emit('open-files')"
                >
                  查看文件管理中的版本
                </button>
              </dd>
            </div>
          </dl>
        </div>
      </div>
      <slot :name="`edit-${section.key}`" />
      <p v-if="fileDownloadError?.section === section.key" role="alert">
        {{ fileDownloadError.message }}
      </p>
      <div
        v-if="section.key === 'closure-info' && closureWorkspace"
        class="case-workspace-payment-table"
        data-test="workspace-effective-payments"
      >
        <h3>有效付款记录</h3>
        <table>
          <thead>
            <tr>
              <th>序号</th>
              <th>付款日期</th>
              <th>付款金额</th>
              <th>付款人</th>
              <th>收款人</th>
              <th>付款凭证</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(payment, index) in closureWorkspace.effectivePayments"
              :key="payment.paymentId"
            >
              <td>{{ index + 1 }}</td>
              <td>{{ payment.paidOn }}</td>
              <td>{{ payment.amount }} 元</td>
              <td>{{ payment.payer }}</td>
              <td>{{ payment.payee }}</td>
              <td>
                <template v-if="payment.documents.length"
                  ><button
                    v-for="doc in payment.documents"
                    :key="`${doc.materialId}:${doc.contentVersionId}`"
                    type="button"
                    @click="
                      downloadSummaryFile(
                        section.key,
                        doc.materialId,
                        doc.contentVersionId,
                      )
                    "
                  >
                    下载截图版本 {{ doc.contentVersionId }}
                  </button></template
                ><span v-else>未记录</span>
              </td>
            </tr>
            <tr v-if="!closureWorkspace.effectivePayments.length">
              <td colspan="6">未登记有效付款记录</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p
        v-if="
          section.key === 'closure-info' &&
          closureReadState &&
          closureReadState !== 'ready'
        "
        class="case-workspace-field__help"
        role="status"
      >
        {{
          closureReadState === 'loading'
            ? '正在读取结案、付款和回款来源…'
            : closureReadState === 'denied'
              ? '当前账号无权读取结案财务来源。'
              : '结案财务来源暂不可读取。'
        }}
      </p>
      <p
        v-if="
          ['first-instance', 'execution', 'judgment', 'timeline'].includes(
            section.key,
          ) &&
          supplementReadState &&
          supplementReadState !== 'ready'
        "
        class="case-workspace-field__help"
        role="status"
      >
        {{
          supplementReadState === 'loading'
            ? '正在读取补录来源…'
            : supplementReadState === 'denied'
              ? '当前账号无权读取补录来源。'
              : '补录来源暂不可读取。'
        }}
      </p>
      <div
        v-if="
          supplementWorkspace?.canEdit &&
          supplementsBySection[section.key]?.length
        "
        class="case-workspace-supplement-actions"
      >
        <button
          v-for="kind in supplementsBySection[section.key]"
          :key="kind"
          type="button"
          @click="supplementKind = kind"
        >
          {{ supplementLabels[kind] }}
        </button>
      </div>
      <CaseSupplementalWorkspacePanel
        v-if="
          supplementKind &&
          supplementsBySection[section.key]?.includes(supplementKind) &&
          supplementWorkspace
        "
        :key="`${contextKey}:${supplementKind}`"
        :case-id="item.id"
        :actor-key="supplementActorKey"
        :initial-kind="supplementKind"
        :workspace="supplementWorkspace"
        @changed="emit('supplement-changed')"
      />
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
              v-for="(field, index) in event.fields.filter(
                (value) => !value.technical,
              )"
              :key="`${field.label}:${index}`"
              class="case-workspace-field"
              :class="{ 'case-workspace-field--wide': field.wide }"
            >
              <dt class="case-workspace-field__label">{{ field.label }}</dt>
              <dd class="case-workspace-field__value">
                {{ field.value }}
                <p v-if="field.help" class="case-workspace-field__help">
                  {{ field.help }}
                </p>
                <details
                  v-if="field.versionId"
                  class="case-workspace-field__help"
                  data-test="workspace-file-version"
                >
                  <summary>文件版本详情</summary>
                  <p>版本标识：{{ field.versionId }}</p>
                </details>
              </dd>
            </div>
          </dl>
          <details
            v-if="event.fields.some((field) => field.technical)"
            class="case-workspace-field__help"
            data-test="workspace-technical-details"
          >
            <summary>记录关联详情</summary>
            <dl class="case-workspace-fields">
              <div
                v-for="field in event.fields.filter((value) => value.technical)"
                :key="field.label"
                class="case-workspace-field case-workspace-field--wide"
              >
                <dt class="case-workspace-field__label">{{ field.label }}</dt>
                <dd class="case-workspace-field__value">{{ field.value }}</dd>
              </div>
            </dl>
          </details>
        </li>
      </ol>
    </CaseWorkspaceSection>
  </div>
</template>
