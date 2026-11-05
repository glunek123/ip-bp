import type { CaseDetail, CaseFile, CaseStage } from '../../api/cases';
import type { LeadDetail } from '../../api/leads';
import type { CaseRoutineProfile } from '../../api/case-routine';
import type { CaseClosureWorkspace } from '../../api/case-closure-workspace';
import type { CaseSupplementWorkspace } from '../../api/case-supplements';
import type { EvidenceGroup } from '../../api/evidence';
import type { OwnerMaterial } from '../../api/materials';
import type { CaseSettlement } from '../../api/settlements';
import {
  leadCaseTypeLabels as caseTypeLabels,
  leadInfringementTypeLabels as infringementLabels,
  leadPlatformLabels,
  leadSourceLabels,
  leadStatusLabels,
} from '../leads';
import type { SectionKey } from './case-workspace-contract';

export type LeadState = 'idle' | 'loading' | 'ready' | 'denied' | 'failed';
export type WorkspaceField = {
  label: string;
  value: string;
  help?: string;
  wide?: boolean;
  technical?: boolean;
  versionId?: string;
  fileVersions?: Array<{
    materialId: string;
    contentVersionId: string;
    filename: string;
  }>;
};
export type WorkspaceGroup = {
  id: string;
  title: string;
  fields: WorkspaceField[];
  historical?: boolean;
};
export type WorkspaceSection = {
  key: SectionKey;
  title: string;
  groups: WorkspaceGroup[];
  summary: WorkspaceField[];
  message: string | null;
  help: string;
};
export type WorkspaceEvent = {
  id: string;
  source: string;
  title: string;
  businessAt: string | null;
  recordedAt: string | null;
  fields: WorkspaceField[];
};

export const caseStageLabels: Record<CaseStage, string> = {
  PENDING_MATCH: '待匹配',
  WAITING_COMPLAINT: '待写诉状',
  WAITING_COMPLAINT_CONFIRMATION: '诉状待确认',
  WAITING_COMPLAINT_STAMP: '诉状待盖章',
  WAITING_FILING: '待提交立案',
  WAITING_FORMAL_ACCEPTANCE: '待正式立案',
  WAITING_HEARING: '待开庭',
  WAITING_JUDGMENT: '待判决',
  SECOND_INSTANCE: '二审',
  WAITING_EXECUTION_DOCUMENTS: '待写执行材料',
  WAITING_EXECUTION_CONFIRMATION: '执行材料待确认',
  WAITING_EXECUTION_STAMP: '执行材料待盖章',
  WAITING_EXECUTION_FILING: '待申请执行',
  EXECUTING: '强制执行中',
  WAITING_ARCHIVE: '待归档',
  ARCHIVED: '已归档',
};
const archiveLabels: Record<
  NonNullable<CaseDetail['archive']>['current']['archiveType'],
  string
> = {
  VOIDED: '案件作废',
  SETTLEMENT: '和解结案',
  MEDIATION: '调解结案',
  JUDGMENT_PERFORMED: '判决履行',
  EXECUTION_COLLECTED: '执行到款',
  EXECUTION_CLOSED: '执行终本',
};

export function workspaceDate(value: string | null): string {
  if (value === null) return '未记录';
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value));
}
function field(
  label: string,
  value: string | null,
  help?: string,
): WorkspaceField {
  const wide =
    /备注|原因|说明|地址|链接|文件|材料|文书|依据|意见/u.test(label) ||
    (value?.length ?? 0) > 80;
  return {
    label,
    value: value ?? '未登记',
    ...(help ? { help } : {}),
    ...(wide ? { wide: true } : {}),
    ...(/标识$/u.test(label) ? { technical: true } : {}),
  };
}
function date(label: string, value: string | null): WorkspaceField {
  return field(label, workspaceDate(value));
}
function money(
  label: string,
  state: 'KNOWN' | 'PENDING',
  value: string | null,
): WorkspaceField {
  return field(
    label,
    state === 'PENDING' ? '待确认' : value === null ? '未登记' : `${value} 元`,
  );
}
function sumMoney(values: readonly string[]): string {
  const cents = values.reduce((sum, value) => {
    const [units, fraction] = value.split('.');
    return sum + BigInt(units!) * 100n + BigInt(fraction!);
  }, 0n);
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')} 元`;
}
function files(label: string, items: readonly CaseFile[]): WorkspaceField[] {
  if (items.length === 0) return [field(label, null)];
  return items.map((item) => ({
    ...field(label, item.originalFilename),
    versionId: item.contentVersionId,
  }));
}
function actor(id: string | undefined): WorkspaceField[] {
  return id
    ? [
        field('记录人', '姓名未提供；真实账号标识见关联详情'),
        { ...field('记录人标识', id), technical: true },
      ]
    : [];
}
function uniqueById<T extends { id: string }>(
  history: readonly T[],
  current: T | null,
): T[] {
  const values = new Map(history.map((entry) => [entry.id, entry]));
  if (current) values.set(current.id, current);
  return [...values.values()];
}

function trialRoundName(item: CaseDetail, trialRoundId: string): string {
  const round = item.secondInstance.rounds.find(
    (value) => value.id === trialRoundId,
  );
  if (round?.sourceResultId) return `发回重审第 ${round.sequence} 轮`;
  return round ? '初次一审' : '未能匹配审理轮次';
}

// Only CaseDetail facts feed this view. No audit mutation, API reads or clock fallback.
export function buildCaseWorkspaceEvents(
  item: CaseDetail,
  supplementWorkspace?: CaseSupplementWorkspace | null,
): WorkspaceEvent[] {
  const events: WorkspaceEvent[] = [];
  function add(
    source: string,
    id: string,
    title: string,
    businessAt: string | null,
    recordedAt: string | null,
    fields: WorkspaceField[] = [],
  ): void {
    const round = fields.find((value) => value.label === '审理轮次标识');
    events.push({
      source,
      id,
      title,
      businessAt,
      recordedAt,
      fields: [
        ...(round && round.value !== '未登记'
          ? [field('审理轮次', trialRoundName(item, round.value))]
          : []),
        ...fields,
      ],
    });
  }
  add('case', item.id, '案件创建', null, item.createdAt);
  if (item.matchedAt !== null || item.matchedOn !== null)
    add('match', item.id, '案件匹配', item.matchedOn, item.matchedAt);
  for (const entry of item.recordEdits?.defendantContacts ?? []) {
    const defendant = item.defendants.find(
      (value) => value.id === entry.defendantId,
    );
    for (const edit of entry.history)
      add(
        'defendant-contact',
        edit.id,
        '被告联系方式更正',
        null,
        edit.recordedAt,
        [
          field('被告', defendant?.name ?? '无法匹配的被告'),
          field('更正前电话', edit.beforePhone),
          field('更正后电话', edit.phone),
          field('更正前地址', edit.beforeAddress),
          field('更正后地址', edit.address),
          ...actor(edit.recordedByUserId),
        ],
      );
  }
  for (const edit of item.recordEdits?.acceptanceCorrections ?? []) {
    let beforeAcceptedAt = edit.originalAcceptedAt;
    let beforeCourtCaseNo = edit.originalCourtCaseNo;
    for (const correction of edit.history) {
      add(
        'acceptance-correction',
        correction.id,
        '一审受理更正',
        correction.acceptedAt,
        correction.recordedAt,
        [
          field('审理轮次标识', edit.trialRoundId),
          field('更正前受理日期', beforeAcceptedAt),
          field('更正前法院案号', beforeCourtCaseNo),
          field('更正后受理日期', correction.acceptedAt),
          field('更正后法院案号', correction.courtCaseNo),
          field('更正原因', correction.reason),
          ...actor(correction.recordedByUserId),
        ],
      );
      beforeAcceptedAt = correction.acceptedAt;
      beforeCourtCaseNo = correction.courtCaseNo;
    }
  }
  for (const entry of item.recordEdits?.secondInstanceAcceptances ?? []) {
    let beforeAcceptedAt: string | null = null;
    let beforeCourtCaseNo: string | null = null;
    for (const change of entry.history) {
      add(
        'second-instance-acceptance',
        change.id,
        '二审受理信息更正',
        change.acceptedAt,
        change.recordedAt,
        [
          field('choice标识', entry.choiceId),
          field('二审前受理日期', beforeAcceptedAt),
          field('二审前案号', beforeCourtCaseNo),
          field('二审受理日期', change.acceptedAt),
          field('二审案号', change.courtCaseNo),
          field('更正原因', change.reason),
          ...actor(change.recordedByUserId),
        ],
      );
      beforeAcceptedAt = change.acceptedAt;
      beforeCourtCaseNo = change.courtCaseNo;
    }
  }
  if (item.complaint) {
    const value = item.complaint;
    add('complaint', item.id, '诉状提交', null, value.submittedAt, [
      money('诉请金额', value.amountState, value.amount),
      field('待确认原因', value.pendingReason),
      ...files('诉状', value.complaintFiles),
      ...files('授权材料', value.authorizationFiles),
      ...actor(value.submittedByUserId),
    ]);
  }
  if (item.complaintConfirmation) {
    const value = item.complaintConfirmation;
    add(
      'complaint-confirmation',
      value.confirmedComplaintContentVersionId,
      '诉状确认',
      null,
      value.confirmedAt,
      [
        money('确认诉请金额', value.amountState, value.amount),
        field('待确认原因', value.pendingReason),
        field('变更说明', value.changeNote),
        field('披露确认', value.confirmDisclose ? '是' : '否'),
        ...files('确认诉状', value.complaintFile ? [value.complaintFile] : []),
        ...actor(value.confirmedByUserId),
      ],
    );
  }
  if (item.complaintMailing) {
    const value = item.complaintMailing;
    add(
      'complaint-mailing',
      item.id,
      '诉状邮寄',
      value.mailedAt,
      value.recordedAt,
      [
        ...files('邮寄回执', value.receiptFiles),
        ...actor(value.recordedByUserId),
      ],
    );
  }
  if (item.filingSubmission) {
    const value = item.filingSubmission;
    add('filing', item.id, '法院提交', value.submittedAt, value.recordedAt, [
      field('法院', value.court.name),
      field('诉调号', value.mediationNo),
      ...files('提交证据', value.evidenceFiles),
      ...files('提交截图', value.screenshotFiles),
      ...actor(value.recordedByUserId),
    ]);
  }
  for (const value of uniqueById(item.acceptances, item.acceptance)) {
    const recordEdit = item.recordEdits?.acceptanceCorrections.find(
      (entry) => entry.acceptanceId === value.id,
    );
    const originalAcceptedAt =
      recordEdit?.originalAcceptedAt ?? value.acceptedAt;
    const originalCourtCaseNo =
      recordEdit?.originalCourtCaseNo ?? value.courtCaseNo;
    add(
      'acceptance',
      value.id,
      '正式立案',
      originalAcceptedAt,
      value.recordedAt,
      [
        field('审理轮次标识', value.trialRoundId),
        field('法院案号', originalCourtCaseNo),
        ...files('受理通知书', value.files),
        ...actor(value.recordedByUserId),
      ],
    );
  }
  for (const value of uniqueById(
    item.hearing.arrangements,
    item.hearing.currentArrangement,
  ))
    add(
      'hearing',
      value.id,
      value.source === 'CORRECTION' ? '开庭安排更正' : '开庭登记',
      value.hearingAt,
      value.recordedAt,
      [
        field('审理轮次标识', value.trialRoundId),
        ...actor(value.recordedByUserId),
      ],
    );
  for (const value of uniqueById(
    item.hearing.advances,
    item.hearing.currentAdvance,
  ))
    add(
      'hearing-advance',
      value.id,
      '开庭到期推进',
      value.dueAt,
      value.executedAt,
      [field('开庭安排标识', value.arrangementId)],
    );
  for (const value of item.hearing.corrections)
    add(
      'hearing-correction',
      value.id,
      '开庭推进更正',
      null,
      value.recordedAt,
      [
        ...(value.reason === undefined
          ? []
          : [field('更正原因', value.reason)]),
        field('更正后阶段', caseStageLabels[value.resultStage]),
        field('原安排标识', value.priorArrangementId),
        field('新安排标识', value.newArrangementId),
        ...actor(value.recordedByUserId),
      ],
    );
  for (const value of uniqueById(item.judgment.history, item.judgment.current))
    add(
      'judgment',
      value.id,
      value.kind === 'CORRECT' ? '判决更正' : '判决登记',
      value.judgmentReceivedAt,
      value.recordedAt,
      [
        field('审理轮次标识', value.trialRoundId),
        money('判决金额', value.judgmentAmountState, value.judgmentAmount),
        money(
          '已缴诉讼费',
          value.paidLitigationFeeState,
          value.paidLitigationFee,
        ),
        ...(value.reason === undefined
          ? []
          : [field('更正原因', value.reason)]),
        ...files('判决文件', value.files),
        ...actor(value.recordedByUserId),
      ],
    );
  for (const value of uniqueById(
    item.judgmentNextStep.history,
    item.judgmentNextStep.current,
  ))
    add(
      'judgment-next-step',
      value.id,
      '判决后续选择',
      null,
      value.recordedAt,
      [
        field('后续办理', value.next === 'APPEAL' ? '上诉' : '申请执行'),
        field('判决标识', value.judgmentId),
        field('执行申请人', value.plaintiffName),
        field(
          '执行被告',
          value.defendants.map((entry) => entry.nameSnapshot).join('、') ||
            null,
        ),
        field('执行条件确认', value.executionReadinessConfirmed ? '是' : '否'),
        ...actor(value.recordedByUserId),
      ],
    );
  for (const value of item.judgmentNextStep.revocations)
    add(
      'judgment-next-step-revocation',
      value.id,
      '后续选择撤销',
      null,
      value.recordedAt,
      [
        field('选择标识', value.choiceId),
        ...(value.reason === undefined
          ? []
          : [field('撤销原因', value.reason)]),
        ...actor(value.recordedByUserId),
      ],
    );
  for (const value of uniqueById(
    item.secondInstance.progresses,
    item.secondInstance.currentProgress,
  ))
    add(
      'second-progress',
      value.id,
      '二审资料登记',
      value.hearingAt,
      value.recordedAt,
      [
        field('审理轮次标识', value.trialRoundId),
        field('开庭地点', value.hearingPlace),
        field('法官', value.judgeName),
        ...files('二审文书', value.documentFiles),
        ...files('送达材料', value.serviceFiles),
        ...actor(value.recordedByUserId),
      ],
    );
  for (const value of uniqueById(
    item.secondInstance.results,
    item.secondInstance.currentResult,
  ))
    add(
      'second-result',
      value.id,
      '二审结果登记',
      value.resultReceivedAt,
      value.recordedAt,
      [
        field('审理轮次标识', value.trialRoundId),
        field(
          '结果',
          { REMAND: '发回重审', CHANGE: '改判', AFFIRM: '维持原判' }[
            value.result
          ],
        ),
        ...(value.result === 'REMAND'
          ? [field('判决金额', '不适用（发回重审）')]
          : [
              money(
                '判决金额',
                value.judgmentAmountState,
                value.judgmentAmount,
              ),
            ]),
        money(
          '已缴诉讼费',
          value.paidLitigationFeeState,
          value.paidLitigationFee,
        ),
        field('撤销状态', value.revocationId ? '已撤销' : '未撤销'),
        ...files('二审裁判文件', value.files),
        ...actor(value.recordedByUserId),
      ],
    );
  for (const value of item.secondInstance.revocations)
    add('second-revocation', value.id, '二审结果撤销', null, value.recordedAt, [
      field('结果标识', value.resultId),
      ...(value.reason === undefined ? [] : [field('撤销原因', value.reason)]),
      ...actor(value.recordedByUserId),
    ]);
  for (const value of uniqueById(
    item.executionSubmission.submissions,
    item.executionSubmission.current,
  ))
    add(
      'execution-submission',
      value.id,
      value.priorSubmissionId ? '执行材料重新提交' : '执行材料提交',
      null,
      value.submittedAt,
      [
        field('审理轮次标识', value.trialRoundId),
        field('变更原因', value.changeReason),
        ...files('执行材料', value.files),
      ],
    );
  if (item.executionConfirmation) {
    const value = item.executionConfirmation;
    add(
      'execution-confirmation',
      value.id,
      '执行材料确认',
      null,
      value.confirmedAt,
      [
        ...files('确认执行材料', value.files),
        ...actor(value.confirmedByUserId),
      ],
    );
  }
  if (item.executionMailing) {
    const value = item.executionMailing;
    add(
      'execution-mailing',
      value.id,
      '执行材料邮寄',
      value.mailedAt,
      value.recordedAt,
      [...files('邮寄回执', value.files)],
    );
  }
  if (item.executionFiling) {
    const value = item.executionFiling;
    add(
      'execution-filing',
      value.id,
      '执行立案',
      value.submittedAt,
      value.recordedAt,
      [...files('执行立案凭证', value.files)],
    );
  }
  if (item.executionFinish) {
    const value = item.executionFinish;
    add(
      'execution-finish',
      value.id,
      '执行结束',
      value.finishedAt,
      value.recordedAt,
      [
        field('结束原因', value.reason),
        field('依据说明', value.basisNote),
        ...files('结束依据', value.files),
      ],
    );
  }
  if (item.closure)
    for (const value of uniqueById(item.closure.history, item.closure.current))
      add(
        'closure',
        value.id,
        value.kind === 'CORRECT' ? '结案更正' : '结案登记',
        value.closeAt,
        value.recordedAt,
        [
          money('结案金额', value.closeAmountState, value.closeAmt),
          field('备注', value.note),
          field('更正原因', value.correctionReason),
          ...files('结案材料', value.files),
          ...actor(value.recordedByUserId),
        ],
      );
  if (item.archive)
    for (const value of uniqueById(item.archive.history, item.archive.current))
      add(
        'archive',
        value.id,
        value.kind === 'CORRECT' ? '归档更正' : '归档登记',
        value.archiveAt,
        value.recordedAt,
        [
          field('归档类型', archiveLabels[value.archiveType]),
          field('归档原因', value.archiveReason),
          field('更正原因', value.correctionReason),
          ...actor(value.recordedByUserId),
        ],
      );
  for (const entry of supplementWorkspace?.entries ?? [])
    add(
      'supplement',
      entry.id,
      entry.kind === 'MANUAL_ANNOTATION' ? '人工附记' : '案件补录',
      entry.eventDate,
      entry.recordedAt,
      [
        field('补录类型', entry.kind),
        field('说明', entry.text),
        field('原因', entry.reason),
        field('关联来源', entry.sourceId),
        field('材料版本标识', entry.contentVersionId),
        ...actor(entry.recordedByUserId),
      ],
    );
  const recorderNames = new Map(
    supplementWorkspace?.recorders.map((person) => [
      person.id,
      person.displayName,
    ]) ?? [],
  );
  for (const event of events) {
    const recorderId = event.fields.find(
      (value) => value.label === '记录人标识',
    )?.value;
    if (!recorderId) continue;
    const recorder = event.fields.find((value) => value.label === '记录人');
    if (recorder)
      recorder.value =
        recorderNames.get(recorderId) ?? '姓名未记录；真实账号标识见关联详情';
  }
  return events.sort((left, right) => {
    const byTime =
      (left.recordedAt === null ? Infinity : Date.parse(left.recordedAt)) -
      (right.recordedAt === null ? Infinity : Date.parse(right.recordedAt));
    return (
      (Number.isNaN(byTime) ? 0 : byTime) ||
      left.source.localeCompare(right.source) ||
      left.id.localeCompare(right.id)
    );
  });
}

function eventGroup(event: WorkspaceEvent, latest: boolean): WorkspaceGroup {
  const primaryJudgmentLabels = new Set(['判决金额', '已缴诉讼费']);
  const businessDateLabels: Record<string, string> = {
    filing: '法院提交日期',
    acceptance: '正式立案日期',
    hearing: '开庭日期',
    'hearing-advance': '开庭推进日期',
    'complaint-mailing': '诉状邮寄日期',
    judgment: '一审判决收到日期',
    'second-progress': '二审开庭日期',
    'second-result': '二审结果收到日期',
    'execution-mailing': '执行材料邮寄日期',
    'execution-filing': '执行申请提交日期',
    'execution-finish': '执行结束日期',
    closure: '结案日期',
    archive: '归档日期',
  };
  const fields = [
    ...(event.businessAt !== null
      ? [date(businessDateLabels[event.source] ?? '业务日期', event.businessAt)]
      : []),
    ...(event.source === 'judgment'
      ? [
          ...event.fields.filter((value) =>
            primaryJudgmentLabels.has(value.label),
          ),
          ...event.fields.filter(
            (value) => !primaryJudgmentLabels.has(value.label),
          ),
        ]
      : event.fields),
    ...(event.recordedAt !== null ? [date('记录时间', event.recordedAt)] : []),
  ];
  return {
    id: `${event.source}:${event.id}`,
    title: `${event.title}${latest ? '' : '（历史）'}`,
    fields,
    ...(!latest ? { historical: true } : {}),
  };
}

export function buildCaseWorkspaceSections(
  item: CaseDetail,
  lead: LeadDetail | null,
  leadState: LeadState,
  routine?: CaseRoutineProfile | null,
  closureWorkspace?: CaseClosureWorkspace | null,
  supplementWorkspace?: CaseSupplementWorkspace | null,
  closureReadState: LeadState = 'idle',
  supplementReadState: LeadState = 'idle',
  evidenceGroup?: EvidenceGroup | null,
  evidenceReadState: LeadState = 'idle',
  leadMaterials?: OwnerMaterial[] | null,
  notaryMaterials?: OwnerMaterial[] | null,
  leadMaterialState: LeadState = 'idle',
  notaryMaterialState: LeadState = 'idle',
  settlementWorkspace?: CaseSettlement | null,
  settlementReadState: LeadState = 'idle',
): WorkspaceSection[] {
  const events = buildCaseWorkspaceEvents(item, supplementWorkspace);
  const sections: WorkspaceSection[] = [];
  function section(
    key: SectionKey,
    title: string,
    groups: WorkspaceGroup[],
    help: string,
    message: string | null = null,
  ): void {
    sections.push({
      key,
      title,
      groups,
      summary: [],
      help,
      message:
        message ??
        (groups.length || key === 'timeline' ? null : '尚未登记相关资料'),
    });
  }
  const latestRecordIds = new Set([
    ...(item.acceptance?.id &&
    !item.recordEdits?.acceptanceCorrections.some(
      (entry) =>
        entry.acceptanceId === item.acceptance?.id && entry.history.length > 0,
    )
      ? [item.acceptance.id]
      : []),
    item.hearing.currentArrangement?.id,
    item.hearing.currentAdvance?.id,
    item.judgment.current?.id,
    item.judgmentNextStep.current?.id,
    item.secondInstance.currentProgress?.id,
    item.secondInstance.currentResult?.id,
    item.executionSubmission.current?.id,
    item.executionConfirmation?.id,
    item.executionMailing?.id,
    item.executionFiling?.id,
    item.executionFinish?.id,
    item.closure?.current.id,
    item.archive?.current.id,
    ...(item.recordEdits?.acceptanceCorrections.flatMap((entry) =>
      entry.history.length ? [entry.history.at(-1)!.id] : [],
    ) ?? []),
    ...(item.recordEdits?.secondInstanceAcceptances?.flatMap((entry) =>
      entry.history.length ? [entry.history.at(-1)!.id] : [],
    ) ?? []),
  ]);
  function groups(sources: readonly string[]): WorkspaceGroup[] {
    return events
      .filter((event) => sources.includes(event.source))
      .map((event) =>
        eventGroup(
          event,
          latestRecordIds.has(event.id) ||
            [
              'complaint',
              'complaint-confirmation',
              'complaint-mailing',
              'filing',
            ].includes(event.source),
        ),
      );
  }
  function roundTitle(trialRoundId: string): string {
    return trialRoundName(item, trialRoundId);
  }
  function eventRoundId(event: WorkspaceEvent): string | null {
    const direct = event.fields.find(
      (value) => value.label === '审理轮次标识',
    )?.value;
    if (direct && direct !== '未登记') return direct;
    if (event.source === 'second-revocation') {
      const resultId = event.fields.find(
        (value) => value.label === '结果标识',
      )?.value;
      return (
        item.secondInstance.results.find((value) => value.id === resultId)
          ?.trialRoundId ?? null
      );
    }
    return null;
  }
  section(
    'case-info',
    '案件信息',
    [
      {
        id: 'case',
        title: '基本资料',
        fields: [
          field('案件单号', item.businessNo),
          field('法院案号', item.courtCaseNo),
          field('部门', item.department.name),
          field('客户', item.customer.name),
          field('权利主体', item.rightsHolder.name),
          field('负责运营', item.owner.displayName),
          field(
            '被告',
            item.defendants.map((value) => value.name).join('、') || null,
          ),
          field('当前阶段', caseStageLabels[item.stage]),
          date('创建时间', item.createdAt),
          date('实际匹配日期', item.matchedOn),
          date('匹配记录时间', item.matchedAt),
          field('来源公证业务号', item.sourceNotaryMatter?.businessNo ?? null),
          ...(item.origin?.kind === 'EXTERNAL_ENTRY'
            ? [
                field(
                  '转入／补录类型',
                  item.origin.entryKind === 'EXTERNAL_TRANSFER'
                    ? '外部转入'
                    : '历史补录',
                ),
                date('当前阶段真实业务日期', item.origin.stageReachedOn),
              ]
            : []),
        ],
      },
      ...item.defendants.map((value) => ({
        id: `defendant:${value.id}`,
        title: '被告',
        fields: [
          field('姓名／名称', value.name),
          field('类型', value.kind === 'PERSON' ? '自然人' : '组织'),
          field('证件号', value.idNo),
          field('电话', value.phone),
          field('地址', value.address),
        ],
      })),
      ...item.lawyers.map((value) => ({
        id: `lawyer:${value.id}`,
        title: '当前承办律师',
        fields: [
          field('律师姓名', value.fullName),
          field('律所', value.lawFirm),
          field('电话', value.phone),
          date('分派时间', value.assignedAt),
        ],
      })),
      {
        id: 'archive-summary',
        title: '归档摘要',
        fields: item.archive
          ? [
              date('归档日期', item.archive.current.archiveAt),
              field(
                '归档类型',
                archiveLabels[item.archive.current.archiveType],
              ),
              field('归档原因', item.archive.current.archiveReason),
            ]
          : [field('归档状态', '未归档')],
      },
      ...(item.earlyArchive
        ? [
            {
              id: 'early-archive',
              title: '提前归档记录',
              fields: [
                date('提前归档日期', item.earlyArchive.archiveAt),
                field(
                  '原案件阶段',
                  caseStageLabels[item.earlyArchive.fromStage],
                ),
                field('提前归档原因', item.earlyArchive.reason),
                date('记录时间', item.earlyArchive.recordedAt),
                field(
                  '说明',
                  '提前停止办理并归档，不表示案件已结案或款项已登记',
                ),
              ],
            },
          ]
        : []),
    ],
    '编号、客户、权利主体、阶段及负责人只读；匹配、结案和归档仅通过已有业务命令登记或更正。',
  );
  const isExternalEntry = item.origin?.kind === 'EXTERNAL_ENTRY';
  const source =
    !isExternalEntry &&
    item.sourceLead !== null &&
    leadState === 'ready' &&
    lead?.id === item.sourceLead.id
      ? lead
      : null;
  const leadMessages: Record<LeadState, string> = {
    idle: '来源线索尚未加载',
    loading: '正在加载来源线索',
    ready: '未取得与本案来源编号匹配的线索资料，不能据此判断字段未登记',
    denied: '无来源线索读取权限；案件自身资料仍可查看',
    failed: '来源线索加载失败；不能据此判断资料为空',
  };
  section(
    'lead-info',
    '线索信息',
    [
      ...(isExternalEntry && item.origin?.kind === 'EXTERNAL_ENTRY'
        ? [
            {
              id: 'external-entry',
              title: '转入／补录来源',
              fields: [
                field(
                  '来源类型',
                  item.origin.entryKind === 'EXTERNAL_TRANSFER'
                    ? '外部转入'
                    : '历史补录',
                ),
                field('资料来源', item.origin.source),
                field('转入／补录原因', item.origin.reason),
                date('当前阶段真实业务日期', item.origin.stageReachedOn),
                date('系统记录时间', item.origin.recordedAt),
                field('已知法院案号', item.origin.known.courtCaseNo),
                field(
                  '已知店铺',
                  routine ? routine.shopName : item.origin.known.shopName,
                ),
                field(
                  '已知店铺ID',
                  routine
                    ? routine.shopExternalId
                    : item.origin.known.shopExternalId,
                ),
                ...(routine ? [field('备注', routine.remark)] : []),
              ],
            },
          ]
        : [
            {
              id: 'lead-source',
              title: '案件来源',
              fields: [
                field('来源线索编号', item.sourceLead?.businessNo ?? null),
              ],
            },
            ...(item.certificate
              ? [
                  {
                    id: 'certificate',
                    title: '案件公证资料',
                    fields: [
                      field('公证书编号', item.certificate.certificateNo),
                      date('公证日期', item.certificate.certificateDate),
                      date('出证时间', item.certificate.issuedAt),
                      field(
                        '需披露',
                        item.certificate.needDisclose ? '是' : '否',
                      ),
                      ...files('公证文件', item.certificate.files),
                      ...files('披露文件', item.certificate.disclosureFiles),
                    ],
                  },
                ]
              : []),
          ]),
      ...(source
        ? [
            {
              id: 'lead',
              title: routine ? '案件当前资料' : '来源线索资料',
              fields: [
                field('状态', leadStatusLabels[source.status]),
                field('来源', leadSourceLabels[source.source]),
                field('案件类型', caseTypeLabels[source.caseType]),
                field(
                  '侵权类型',
                  source.infringementTypes
                    .map((type) => infringementLabels[type])
                    .join('、') || null,
                ),
                field('平台', leadPlatformLabels[source.platform]),
                field('店铺名称', routine ? routine.shopName : source.shopName),
                field(
                  '店铺外部编号',
                  routine ? routine.shopExternalId : source.shopExternalId,
                ),
                date('发现日期', source.foundAt),
                field('负责人', source.displayNames.responsibleUserName),
                field('需披露', source.needDisclose ? '是' : '否'),
                field('备注', routine ? routine.remark : source.remark),
                field(
                  '来源截图',
                  source.leadScreenshotContentVersionIds.length
                    ? `${source.leadScreenshotContentVersionIds.length} 个文件版本引用`
                    : '未提供来源截图版本引用',
                  '仅展示来源返回的版本引用，不代表已读取或核对图片内容',
                ),
                field(
                  '来源截图版本标识',
                  source.leadScreenshotContentVersionIds.length
                    ? source.leadScreenshotContentVersionIds.join('、')
                    : '当前无来源截图版本引用',
                  '仅展示来源返回的版本引用，不代表已读取或核对图片内容',
                ),
              ],
            },
            ...(routine ? routine.products : source.products).map((value) => ({
              id: `product:${value.id}`,
              title: `商品 ${value.position}`,
              fields: [
                field('商品标题', value.title),
                field('链接', value.url),
                field('数量', String(value.quantity)),
                field('单价', `${value.unitPrice} 元`),
                field('评论数', String(value.commentCount)),
                field('预估金额', `${value.estimatedAmount} 元`),
              ],
            })),
          ]
        : []),
      ...(routine && !source && !isExternalEntry
        ? [
            {
              id: 'case-current',
              title: '案件当前资料',
              fields: [
                field('店铺名称', routine.shopName),
                field('店铺外部编号', routine.shopExternalId),
                field('备注', routine.remark),
              ],
            },
            ...routine.products.map((value) => ({
              id: `product:${value.id}`,
              title: `商品 ${value.position}`,
              fields: [
                field('商品标题', value.title),
                field('链接', value.url),
                field('数量', String(value.quantity)),
                field('单价', `${value.unitPrice} 元`),
              ],
            })),
          ]
        : []),
    ],
    routine
      ? '案件资料独立保存；来源线索和已形成的证据不随本案修改。'
      : source?.capabilities.edit
        ? '编辑进入来源线索的既有表单；受保护字段仍遵守来源状态与权限规则。来源截图仅显示引用，实物／纸证展示尚未接入。'
        : '来源线索只读；无来源编辑能力时不能修改，也不能保存为案件副本。来源截图仅显示引用，实物／纸证展示尚未接入。',
    source || isExternalEntry || routine ? null : leadMessages[leadState],
  );
  const acceptanceFiles = Object.entries(item.acceptanceMaterials).flatMap(
    ([category, value]) => {
      const label =
        category === 'ACCEPTANCE_NOTICE'
          ? '受理通知书'
          : category === 'PAYMENT_LIST'
            ? '缴费清单'
            : '送达文书';
      return [
        ...files(`${label}（立案时冻结）`, value.frozen),
        ...files(`${label}（后补）`, value.later),
      ];
    },
  );
  const firstInstanceEvents = events.filter((event) =>
    ['acceptance', 'acceptance-correction', 'hearing'].includes(event.source),
  );
  const roundIds = [
    ...new Set(
      firstInstanceEvents
        .map(eventRoundId)
        .filter((value): value is string => value !== null),
    ),
  ];
  const firstInstanceGroups = groups([
    'complaint',
    'complaint-confirmation',
    'complaint-mailing',
    'filing',
    'hearing-advance',
    'hearing-correction',
  ]);
  for (const trialRoundId of roundIds)
    firstInstanceGroups.push(
      ...firstInstanceEvents
        .filter((event) => eventRoundId(event) === trialRoundId)
        .map((event) => {
          const group = eventGroup(event, latestRecordIds.has(event.id));
          return {
            ...group,
            id: `first-instance-round:${trialRoundId}:${event.id}`,
            title: `${roundTitle(trialRoundId)} · ${group.title}`,
          };
        }),
    );
  for (const round of item.secondInstance.rounds.filter(
    (value) => !roundIds.includes(value.id),
  ))
    firstInstanceGroups.push({
      id: `first-instance-round:${round.id}`,
      title: roundTitle(round.id),
      fields: [
        field('本轮资料', '尚未返回本轮正式立案或开庭资料'),
        field('轮次标识', round.id),
        field('来源二审结果标识', round.sourceResultId),
        date('轮次撤销时间', round.revokedAt),
      ],
      ...(round.revokedAt ? { historical: true } : {}),
    });
  if (
    item.acceptance ||
    Object.values(item.acceptanceMaterials).some(
      (value) => value.frozen.length || value.later.length,
    )
  )
    firstInstanceGroups.push({
      id: 'acceptance-files',
      title: '立案材料',
      fields: acceptanceFiles,
    });
  section(
    'first-instance',
    '一审信息',
    firstInstanceGroups,
    '按审理轮次查看已登记的立案及开庭资料。未登记的内容保持空缺。',
  );
  section(
    'second-instance',
    '二审信息',
    [
      ...(item.secondInstance.acceptances ?? []).map((value) => ({
        id: `acceptance:${value.choiceId}:${value.trialRoundId}`,
        title: '二审受理信息',
        fields: [
          field('二审受理日期', value.acceptedAt ?? '未确定'),
          field('二审案号', value.courtCaseNo ?? '未提供'),
          date('记录时间', value.recordedAt),
        ],
      })),
      ...item.secondInstance.rounds.map((value) => ({
        id: `round:${value.id}`,
        title: `审理轮次 ${value.sequence}`,
        fields: [
          field('轮次标识', value.id),
          field('来源二审结果标识', value.sourceResultId),
          date('撤销时间', value.revokedAt),
        ],
      })),
      ...groups(['second-instance-acceptance', 'second-progress']),
    ],
    item.secondInstance.acceptances === undefined
      ? '二审受理资料暂未提供；可查看已有开庭和文书资料。历史办理记录只读。'
      : '查看二审受理、开庭及文书资料；日期和案号按实际记录显示。历史办理记录只读。',
  );
  const judgmentEvents = events.filter((event) =>
    ['judgment', 'second-result', 'second-revocation'].includes(event.source),
  );
  const judgmentRoundIds = [
    ...new Set(
      judgmentEvents
        .map(eventRoundId)
        .filter((value): value is string => value !== null),
    ),
  ];
  const unassignedJudgmentEvents = judgmentEvents.filter(
    (event) => eventRoundId(event) === null,
  );
  section(
    'judgment',
    '判决信息',
    [
      {
        id: 'judgment-state',
        title: '有效判决',
        fields: [
          field('登记状态', item.judgment.current ? '已登记' : '未登记'),
        ],
      },
      ...groups(['judgment-next-step', 'judgment-next-step-revocation']),
      ...judgmentRoundIds.flatMap((trialRoundId) =>
        judgmentEvents
          .filter((event) => eventRoundId(event) === trialRoundId)
          .map((event) => {
            const group = eventGroup(event, latestRecordIds.has(event.id));
            return {
              ...group,
              id: `judgment-round:${trialRoundId}:${event.id}`,
              title: `${roundTitle(trialRoundId)} · ${group.title}`,
            };
          }),
      ),
      ...unassignedJudgmentEvents.map((event) => ({
        ...eventGroup(event, false),
        id: `judgment-round-unmatched:${event.id}`,
        title: `未能匹配审理轮次 · ${event.title}（历史）`,
      })),
    ],
    '按初审及发回重审轮次分段展示一审判决、二审结果金额／实缴诉讼费、精确材料和撤销历史；未登记金额不按零展示。',
  );
  section(
    'execution',
    '执行信息',
    groups([
      'execution-submission',
      'execution-confirmation',
      'execution-mailing',
      'execution-filing',
      'execution-finish',
    ]),
    '查看已登记的执行资料。执行立案日期及案号暂未提供。',
  );
  const closureGroups = [
    ...(item.closure
      ? uniqueById(item.closure.history, item.closure.current).map((value) => ({
          id: `closure:${value.id}`,
          title: value.kind === 'CORRECT' ? '结案更正' : '结案登记',
          fields: [
            date('结案日期', value.closeAt),
            money('结案金额', value.closeAmountState, value.closeAmt),
            field('备注', value.note),
            ...files('结案材料', value.files),
            ...(value.correctionReason
              ? [field('结案更正原因', value.correctionReason)]
              : []),
            ...actor(value.recordedByUserId),
          ],
          ...(value.id !== item.closure?.current.id
            ? { historical: true }
            : {}),
        }))
      : []),
    ...(item.archive
      ? uniqueById(item.archive.history, item.archive.current).map((value) => ({
          id: `archive:${value.id}`,
          title: value.kind === 'CORRECT' ? '归档更正' : '归档登记',
          fields: [
            date('归档日期', value.archiveAt),
            field('归档类型', archiveLabels[value.archiveType]),
            field('归档原因', value.archiveReason),
            ...(value.correctionReason
              ? [field('归档更正原因', value.correctionReason)]
              : []),
            ...actor(value.recordedByUserId),
          ],
          ...(value.id !== item.archive?.current.id
            ? { historical: true }
            : {}),
        }))
      : []),
    {
      id: 'settlement-status',
      title: '收款与结清状态',
      fields: [
        field('案件实收', '尚未接入案件级实收来源'),
        field('实际回款', '尚未接入'),
        field('客户／律师结算', '尚未接入案件级结算公式与事实'),
        field('结清状态', '尚未接入'),
      ],
    },
  ];
  section(
    'closure-info',
    '结案信息',
    closureGroups,
    '只读展示真实结案版本及归档记录；结案金额不表示实收，归档不表示结清。',
    closureGroups.length > 1 ? null : '结案及归档尚未登记',
  );
  section(
    'timeline',
    '流程时间轴',
    [],
    '仅展示本案已返回的事实；业务日期与记录时间分开，不补日期或操作人，不支持通用新增、编辑或删除审计记录。',
    events.length ? null : '尚无可读记录',
  );
  const byKey = new Map(sections.map((value) => [value.key, value]));
  const setSummary = (key: SectionKey, values: WorkspaceField[]) => {
    byKey.get(key)!.summary = values;
  };
  const filenames = (items: readonly CaseFile[]) =>
    items.length
      ? items.map((value) => value.originalFilename).join('、')
      : null;
  const priorSupplementIds = new Set(
    supplementWorkspace?.entries
      .map((entry) => entry.priorEntryId)
      .filter((id): id is string => id !== null) ?? [],
  );
  const supplementHeads = (
    kind: NonNullable<CaseSupplementWorkspace>['entries'][number]['kind'],
    trialRoundId?: string | null,
    sourceId?: string | null,
  ) =>
    supplementWorkspace?.entries.filter(
      (entry) =>
        entry.kind === kind &&
        !priorSupplementIds.has(entry.id) &&
        (trialRoundId === undefined || entry.trialRoundId === trialRoundId) &&
        (sourceId === undefined || entry.sourceId === sourceId),
    ) ?? [];
  const supplement = (
    kind: NonNullable<CaseSupplementWorkspace>['entries'][number]['kind'],
    trialRoundId?: string | null,
    sourceId?: string | null,
  ) => {
    const heads = supplementHeads(kind, trialRoundId, sourceId);
    return heads.length === 1 ? heads[0]! : null;
  };
  const supplementFiles = (
    kind: NonNullable<CaseSupplementWorkspace>['entries'][number]['kind'],
    trialRoundId?: string | null,
    sourceId?: string | null,
  ) => {
    const names = supplementHeads(kind, trialRoundId, sourceId).flatMap(
      (entry) => {
        if (!entry.materialId || !entry.contentVersionId) return [];
        const source = supplementWorkspace?.sources.materials.find(
          (file) =>
            file.materialId === entry.materialId &&
            file.contentVersionId === entry.contentVersionId,
        );
        return [source?.filename ?? `文件版本 ${entry.contentVersionId}`];
      },
    );
    return names.join('、') || null;
  };
  const supplementValue = (value: string | null | undefined, candidates = 0) =>
    value ??
    (candidates > 1
      ? '多份当前补录，需逐条核对'
      : supplementReadState === 'ready'
        ? null
        : '补录来源暂不可读取');
  const closureValue = (value: string | null | undefined) =>
    value ?? (closureReadState === 'ready' ? null : '结案财务来源暂不可读取');
  const sourceUnavailable =
    item.sourceLead && !isExternalEntry && !source
      ? leadMessages[leadState]
      : '未记录';
  const externalKnown =
    item.origin?.kind === 'EXTERNAL_ENTRY' ? item.origin.known : null;
  const sourceVersions = (
    materials: OwnerMaterial[] | null | undefined,
    category: OwnerMaterial['category'],
    allowedIds?: readonly string[],
  ) =>
    (materials ?? [])
      .filter(
        (material) =>
          material.category === category && material.status === 'ACTIVE',
      )
      .flatMap((material) =>
        material.contentVersions
          .filter(
            (version) =>
              version.status === 'AVAILABLE' &&
              (!allowedIds || allowedIds.includes(version.id)),
          )
          .map((version) => ({
            materialId: material.id,
            contentVersionId: version.id,
            filename: version.originalFilename,
          })),
      );
  const screenshotVersions = sourceVersions(
    leadMaterials,
    'LEAD_SCREENSHOT',
    source?.leadScreenshotContentVersionIds ?? [],
  );
  const openingVersions = sourceVersions(
    notaryMaterials,
    'NOTARY_OPENING_PHOTO',
  );
  setSummary('case-info', [
    field('客户', item.customer.name),
    field('权利主体', item.rightsHolder.name),
    field(
      '被告',
      item.defendants.map((value) => value.name).join('、') || null,
    ),
    field(
      '侵权类型',
      source
        ? source.infringementTypes
            .map((value) => infringementLabels[value])
            .join('、')
        : isExternalEntry
          ? (externalKnown?.infringementTypes
              ?.map((value) => infringementLabels[value])
              .join('、') ?? null)
          : sourceUnavailable,
    ),
    field(
      '案件类型',
      source
        ? caseTypeLabels[source.caseType]
        : isExternalEntry
          ? externalKnown?.caseType
            ? caseTypeLabels[externalKnown.caseType]
            : null
          : sourceUnavailable,
    ),
    field('运营', item.owner.displayName),
    field('案件单号', item.businessNo),
    field('案件进展', caseStageLabels[item.stage]),
    date('归档日期', item.archive?.current.archiveAt ?? null),
    field(
      '归档类型',
      item.archive ? archiveLabels[item.archive.current.archiveType] : null,
    ),
    field('归档原因', item.archive?.current.archiveReason ?? null),
  ]);
  setSummary('lead-info', [
    field(
      '平台',
      source
        ? leadPlatformLabels[source.platform]
        : isExternalEntry
          ? externalKnown?.platform
            ? leadPlatformLabels[externalKnown.platform]
            : null
          : sourceUnavailable,
    ),
    field(
      '店铺名',
      routine
        ? routine.shopName
        : (source?.shopName ?? externalKnown?.shopName ?? sourceUnavailable),
    ),
    field(
      '店铺ID',
      routine
        ? routine.shopExternalId
        : (source?.shopExternalId ??
            externalKnown?.shopExternalId ??
            sourceUnavailable),
    ),
    {
      ...field(
        '侵权截图',
        screenshotVersions.length
          ? screenshotVersions.map((value) => value.filename).join('、')
          : source?.leadScreenshotContentVersionIds.length
            ? '来源版本引用暂不可核验'
            : leadMaterialState === 'ready'
              ? null
              : sourceUnavailable,
        '按来源线索精确版本与原材料权限读取',
      ),
      fileVersions: screenshotVersions,
    },
    {
      ...field(
        '开箱照片',
        openingVersions.length
          ? openingVersions.map((value) => value.filename).join('、')
          : notaryMaterialState === 'ready'
            ? null
            : item.sourceNotaryMatter
              ? '公证开箱来源暂不可读取'
              : null,
        '公证来源可读版本；不作为本案入案冻结版本',
      ),
      fileVersions: openingVersions,
    },
    field('公证书编号', item.certificate?.certificateNo ?? null),
    field('公证书', filenames(item.certificate?.files ?? [])),
    field('披露文件', filenames(item.certificate?.disclosureFiles ?? [])),
    field(
      '证物表／证物编号',
      evidenceGroup
        ? evidenceGroup.items
            .map((value) => value.displayCode ?? '未编证物号')
            .join('、') || '未登记'
        : evidenceReadState === 'ready'
          ? '未登记'
          : '证物台账暂不可读取',
    ),
    field(
      '证物表／货架号',
      evidenceGroup
        ? evidenceGroup.items
            .map((value) => value.shelfLocation ?? '未登记货架')
            .join('、') || '未登记'
        : evidenceReadState === 'ready'
          ? '未登记'
          : '证物台账暂不可读取',
    ),
    field(
      '证物表／证物状态',
      evidenceGroup
        ? evidenceGroup.items.map((value) => value.status).join('、') ||
            '未登记'
        : evidenceReadState === 'ready'
          ? '未登记'
          : '证物台账暂不可读取',
    ),
  ]);
  const currentAcceptance = item.acceptance;
  const currentHearing = item.hearing.currentArrangement;
  const currentRoundId =
    item.secondInstance.currentTrialRoundId ??
    item.acceptance?.trialRoundId ??
    item.hearing.currentArrangement?.trialRoundId ??
    supplementWorkspace?.sources.trialRounds.find(
      (round) => round.sequence === 1,
    )?.id ??
    null;
  const prepayment = supplement('COURT_PREPAYMENT_NOTICE', currentRoundId);
  const disclosure = supplement('COURT_DISCLOSURE', currentRoundId);
  setSummary('first-instance', [
    field(
      '办案律师',
      item.lawyers.map((value) => value.fullName).join('、') || null,
    ),
    field(
      '立案法院',
      currentAcceptance
        ? (currentAcceptance.court?.name ?? null)
        : (item.filingSubmission?.court.name ?? null),
      currentAcceptance
        ? '正式受理记录中的法院'
        : '提交立案记录中的法院，正式受理法院尚未登记',
    ),
    field('立案截图', filenames(item.filingSubmission?.screenshotFiles ?? [])),
    field(
      '诉调号／立案编号',
      item.filingSubmission?.mediationNo ?? null,
      '仅取提交立案的诉调号；正式法院案号另列',
    ),
    date('提交立案日期', item.filingSubmission?.submittedAt ?? null),
    date('正式立案日期', currentAcceptance?.acceptedAt ?? null),
    date('开庭日期', currentHearing?.hearingAt ?? null),
    field('开庭地点', currentHearing?.hearingPlace ?? null),
    field(
      '送达文书',
      filenames([
        ...item.acceptanceMaterials.SERVICE_DOCUMENT.frozen,
        ...item.acceptanceMaterials.SERVICE_DOCUMENT.later,
      ]),
    ),
    field(
      '案号',
      currentAcceptance ? currentAcceptance.courtCaseNo : item.courtCaseNo,
    ),
    field(
      '立案受理通知书',
      filenames([
        ...item.acceptanceMaterials.ACCEPTANCE_NOTICE.frozen,
        ...item.acceptanceMaterials.ACCEPTANCE_NOTICE.later,
      ]),
    ),
    field(
      '预缴诉讼费',
      supplementValue(
        prepayment?.amount
          ? `${prepayment.amount} 元（通知金额，非实缴）`
          : null,
        supplementHeads('COURT_PREPAYMENT_NOTICE', currentRoundId).length,
      ),
    ),
    field('承办法官', currentHearing?.judgeName ?? null),
    item.complaintConfirmation
      ? money(
          '标的额（已确认诉请）',
          item.complaintConfirmation.amountState,
          item.complaintConfirmation.amount,
        )
      : item.complaint
        ? money(
            '标的额（原诉请，未确认）',
            item.complaint.amountState,
            item.complaint.amount,
          )
        : field('标的额', null),
    field(
      '披露数据',
      supplementValue(
        disclosure?.text,
        supplementHeads('COURT_DISCLOSURE', currentRoundId).length,
      ),
    ),
    field(
      '披露数据附件',
      supplementValue(supplementFiles('COURT_DISCLOSURE', currentRoundId)),
    ),
    field(
      '调档文件',
      supplementValue(supplementFiles('RECORD_RETRIEVAL_DOCUMENT', null)),
    ),
    field(
      '保全文书',
      supplementValue(supplementFiles('PRESERVATION_DOCUMENT', null)),
    ),
    field(
      '起诉状',
      item.complaintConfirmation?.complaintFile?.originalFilename ??
        filenames(item.complaint?.complaintFiles ?? []),
    ),
  ]);
  const secondProgress = item.secondInstance.currentProgress;
  setSummary('second-instance', [
    field(
      '二审进展',
      item.stage === 'SECOND_INSTANCE'
        ? '二审办理阶段'
        : secondProgress
          ? '有二审办理记录'
          : null,
    ),
    field('二审办理', secondProgress ? '已登记办理记录' : null),
    field(
      '二审裁判结果',
      item.secondInstance.currentResult
        ? ({ REMAND: '发回重审', CHANGE: '改判', AFFIRM: '维持原判' } as const)[
            item.secondInstance.currentResult.result
          ]
        : null,
    ),
    field('二审文书', filenames(secondProgress?.documentFiles ?? [])),
    date('二审开庭日期', secondProgress?.hearingAt ?? null),
    field('二审开庭地点', secondProgress?.hearingPlace ?? null),
    field('二审送达文书', filenames(secondProgress?.serviceFiles ?? [])),
    field('二审法官', secondProgress?.judgeName ?? null),
  ]);
  const firstJudgment = item.judgment.current;
  const secondJudgment = item.secondInstance.currentResult;
  const refundLinks = supplementHeads('REFUND_SOURCE_LINK');
  const refundItems = closureWorkspace?.refund.items ?? [];
  const sourcedRefunds = (
    sourceType: 'JUDGMENT' | 'SECOND_INSTANCE_RESULT',
    sourceId: string | undefined,
  ) => {
    const keys = new Set(
      refundLinks
        .filter(
          (entry) =>
            entry.sourceType === sourceType &&
            entry.sourceId === sourceId &&
            entry.inventoryVersionId === closureWorkspace?.refund.versionId,
        )
        .map((entry) => entry.inventoryItemId),
    );
    return refundItems.filter((entry) => keys.has(entry.itemId));
  };
  const firstRefunds = sourcedRefunds('JUDGMENT', firstJudgment?.id);
  const secondRefunds = sourcedRefunds(
    'SECOND_INSTANCE_RESULT',
    secondJudgment?.id,
  );
  const refundTotal = (items: typeof refundItems) => {
    if (!items.length) return '未关联';
    const unknown = items.filter((entry) => entry.amount === null).length;
    const known = sumMoney(
      items.flatMap((entry) => (entry.amount === null ? [] : [entry.amount])),
    );
    return unknown ? `已知小计 ${known}；${unknown} 笔金额待定` : known;
  };
  const refundPartyLabels = { COURT: '法院', DEFENDANT: '被告' } as const;
  const refundStatusLabels = {
    UNKNOWN: '状态待定',
    PENDING: '待办理',
    SUBMITTED: '已提交',
    RETURNED_UNSETTLED: '已退回未结算',
    SETTLED: '已结算，未标记公司收到',
    RECEIVED: '已标记公司收到',
    CONVERTED_TO_COST: '转作成本',
  } as const;
  const refundDetails = (items: typeof refundItems) =>
    items
      .map(
        (entry) =>
          `${refundPartyLabels[entry.party]}／${refundStatusLabels[entry.status]}／${entry.amount === null ? '金额待定' : `${entry.amount} 元`}／${entry.description}`,
      )
      .join('；') || '未关联';
  const attributedRefundIds = new Set(
    [...firstRefunds, ...secondRefunds].map((entry) => entry.itemId),
  );
  const unattributedRefunds = refundItems.filter(
    (entry) => !attributedRefundIds.has(entry.itemId),
  );
  setSummary('judgment', [
    date('一审／收到判决日期', firstJudgment?.judgmentReceivedAt ?? null),
    firstJudgment
      ? money(
          '一审／判决金额',
          firstJudgment.judgmentAmountState,
          firstJudgment.judgmentAmount,
        )
      : field('一审／判决金额', null),
    field('一审／判决书', filenames(firstJudgment?.files ?? [])),
    firstJudgment
      ? money(
          '一审／实缴诉讼费',
          firstJudgment.paidLitigationFeeState,
          firstJudgment.paidLitigationFee,
        )
      : field('一审／实缴诉讼费', null),
    date('二审／判决收到日期', secondJudgment?.resultReceivedAt ?? null),
    secondJudgment
      ? money(
          '二审／实缴诉讼费',
          secondJudgment.paidLitigationFeeState,
          secondJudgment.paidLitigationFee,
        )
      : field('二审／实缴诉讼费', null),
    field(
      '二审／判决书',
      filenames(secondJudgment?.files ?? []),
      '二审结果可能为裁定，文件名称按原记录保留',
    ),
    field(
      '一审／应退清单金额',
      closureWorkspace && supplementWorkspace
        ? refundTotal(firstRefunds)
        : '退费来源暂不可读取',
    ),
    field(
      '一审／应退清单笔数',
      closureWorkspace && supplementWorkspace
        ? String(firstRefunds.length)
        : '退费来源暂不可读取',
    ),
    field(
      '一审／已标记公司收到（清单状态）金额',
      closureWorkspace && supplementWorkspace
        ? refundTotal(
            firstRefunds.filter((entry) => entry.status === 'RECEIVED'),
          )
        : '退费来源暂不可读取',
    ),
    field(
      '一审／已标记公司收到（清单状态）笔数',
      closureWorkspace && supplementWorkspace
        ? String(
            firstRefunds.filter((entry) => entry.status === 'RECEIVED').length,
          )
        : '退费来源暂不可读取',
    ),
    field(
      '一审／转作成本',
      closureWorkspace && supplementWorkspace
        ? refundTotal(
            firstRefunds.filter(
              (entry) => entry.status === 'CONVERTED_TO_COST',
            ),
          )
        : '退费来源暂不可读取',
    ),
    field(
      '一审／退费清单明细',
      closureWorkspace && supplementWorkspace
        ? refundDetails(firstRefunds)
        : '退费来源暂不可读取',
    ),
    field(
      '二审／应退清单金额',
      closureWorkspace && supplementWorkspace
        ? refundTotal(secondRefunds)
        : '退费来源暂不可读取',
    ),
    field(
      '二审／应退清单笔数',
      closureWorkspace && supplementWorkspace
        ? String(secondRefunds.length)
        : '退费来源暂不可读取',
    ),
    field(
      '二审／已标记公司收到（清单状态）金额',
      closureWorkspace && supplementWorkspace
        ? refundTotal(
            secondRefunds.filter((entry) => entry.status === 'RECEIVED'),
          )
        : '退费来源暂不可读取',
    ),
    field(
      '二审／已标记公司收到（清单状态）笔数',
      closureWorkspace && supplementWorkspace
        ? String(
            secondRefunds.filter((entry) => entry.status === 'RECEIVED').length,
          )
        : '退费来源暂不可读取',
    ),
    field(
      '二审／转作成本',
      closureWorkspace && supplementWorkspace
        ? refundTotal(
            secondRefunds.filter(
              (entry) => entry.status === 'CONVERTED_TO_COST',
            ),
          )
        : '退费来源暂不可读取',
    ),
    field(
      '二审／退费清单明细',
      closureWorkspace && supplementWorkspace
        ? refundDetails(secondRefunds)
        : '退费来源暂不可读取',
    ),
    field(
      '诉讼退费来源',
      !supplementWorkspace
        ? '退费归属来源暂不可读取'
        : refundLinks.length
          ? `${refundLinks.length} 条精确来源关联`
          : closureWorkspace
            ? '未关联判决来源'
            : '退费来源暂不可读取',
    ),
    field(
      '历史审级未标明／清单金额',
      closureWorkspace && supplementWorkspace
        ? refundTotal(unattributedRefunds)
        : '退费归属来源暂不可读取',
    ),
    field(
      '历史审级未标明／清单明细',
      closureWorkspace && supplementWorkspace
        ? refundDetails(unattributedRefunds)
        : '退费归属来源暂不可读取',
    ),
  ]);
  const formalExecution = supplement(
    'EXECUTION_FORMAL_ACCEPTANCE',
    undefined,
    item.executionFiling?.id ?? '__missing__',
  );
  setSummary('execution', [
    date('执行立案日期', item.executionFiling?.submittedAt ?? null),
    field(
      '执行立案截图',
      filenames(item.executionFiling?.files ?? []),
      '原执行申请凭证可包含 PDF',
    ),
    field(
      '执行正式立案日期',
      supplementValue(
        formalExecution?.eventDate,
        supplementHeads(
          'EXECUTION_FORMAL_ACCEPTANCE',
          undefined,
          item.executionFiling?.id ?? '__missing__',
        ).length,
      ),
    ),
    field(
      '执行案号',
      supplementValue(
        formalExecution?.courtCaseNo,
        supplementHeads(
          'EXECUTION_FORMAL_ACCEPTANCE',
          undefined,
          item.executionFiling?.id ?? '__missing__',
        ).length,
      ),
    ),
    field(
      '执行文书',
      supplementValue(
        supplementFiles(
          'EXECUTION_FORMAL_ACCEPTANCE',
          undefined,
          item.executionFiling?.id ?? '__missing__',
        ),
      ),
    ),
  ]);
  const payments = closureWorkspace?.effectivePayments ?? [];
  const paymentTotal = sumMoney(payments.map((value) => value.amount));
  const settlementValue = (value: string | null | undefined) =>
    value ??
    (settlementReadState === 'ready'
      ? '未登记'
      : settlementReadState === 'denied'
        ? '无权读取结算来源'
        : settlementReadState === 'loading'
          ? '正在读取结算来源'
          : '结算来源暂不可读取');
  const lawyerMode = settlementWorkspace?.terms?.lawyerMode;
  const lawyerModeLabels = {
    FULL_RISK: '全风险',
    HALF_RISK: '半风险',
    FIXED_FEE: '固定费用',
  } as const;
  const settlementLaunches = (side: 'CUSTOMER' | 'LAWYER') =>
    settlementWorkspace?.launches.filter((launch) => launch.side === side) ??
    [];
  const launchStatus = (side: 'CUSTOMER' | 'LAWYER') => {
    if (!settlementWorkspace) return settlementValue(null);
    const launches = settlementLaunches(side);
    return launches.length
      ? `${launches.length} 笔发起，合计 ${sumMoney(launches.map((launch) => launch.amount))}；发起不表示实收或实付`
      : '未发起';
  };
  const actualScope =
    closureWorkspace?.actual.scope === 'CONSOLIDATION'
      ? '（主案来源分配范围）'
      : '';
  const assessmentDeclarationLabels = {
    APPLICABLE: '适用',
    NOT_APPLICABLE: '不适用',
    UNKNOWN: '状态待核',
  } as const;
  const settlementReviewStatus = !closureWorkspace
    ? closureReadState === 'denied'
      ? '无权读取结案结算来源'
      : '结案结算来源暂不可读取'
    : closureWorkspace.assessment.matchesCurrent === false
      ? `结算评估与当前结案版本不一致（原声明：${assessmentDeclarationLabels[closureWorkspace.assessment.declaration]}）；发起及实际收付分别核对`
      : closureWorkspace.assessment.declaration === 'UNKNOWN'
        ? '结算评估状态待核；发起及实际收付分别核对'
        : closureWorkspace.assessment.declaration === 'NOT_APPLICABLE'
          ? '结算评估声明不适用；发起及实际收付分别核对'
          : closureWorkspace.assessment.matchesCurrent === true
            ? '结算评估关联当前结案版本；发起及实际收付分别核对'
            : '结算评估版本匹配待核；发起及实际收付分别核对';
  setSummary('closure-info', [
    date('结案日期', item.closure?.current.closeAt ?? null),
    item.closure
      ? money(
          '结案金额',
          item.closure.current.closeAmountState,
          item.closure.current.closeAmt,
        )
      : field('结案金额', null),
    field(
      '已回款（公司登记）',
      closureWorkspace?.actual.customerReceiptState === 'RECORDED'
        ? `${closureWorkspace.actual.customerReceivedAmount} 元${actualScope}`
        : closureWorkspace
          ? '待核实／未登记'
          : '实际回款来源暂不可读取',
    ),
    field(
      '付款类型',
      closureValue(
        closureWorkspace?.closure.paymentType === 'ONE_TIME'
          ? '一次付清'
          : closureWorkspace?.closure.paymentType === 'INSTALLMENTS'
            ? '分期付款'
            : null,
      ),
    ),
    field(
      '客户结算金额',
      closureValue(
        closureWorkspace?.assessment.customerAmount
          ? `${closureWorkspace.assessment.customerAmount} 元`
          : null,
      ),
    ),
    field(
      '结算条件',
      closureWorkspace?.assessment.declaration === 'APPLICABLE'
        ? '适用已登记条款'
        : closureWorkspace?.assessment.declaration === 'NOT_APPLICABLE'
          ? '不适用'
          : null,
    ),
    field(
      '律师结算金额',
      closureValue(
        closureWorkspace?.assessment.lawyerAmount
          ? `${closureWorkspace.assessment.lawyerAmount} 元`
          : null,
      ),
    ),
    field(
      '客户结算公式',
      settlementValue(settlementWorkspace?.terms?.customerFormula),
    ),
    field(
      '律师结算模式',
      settlementValue(lawyerMode ? lawyerModeLabels[lawyerMode] : null),
    ),
    field('客户结算发起', launchStatus('CUSTOMER')),
    field('律师结算发起', launchStatus('LAWYER')),
    field('结算状态', settlementReviewStatus),
    field(
      '律师开票（公司登记）',
      closureWorkspace?.actual.lawyerInvoiceState === 'RECORDED'
        ? `${closureWorkspace.actual.lawyerInvoicedAmount} 元${actualScope}`
        : closureWorkspace
          ? '待核实／未登记'
          : '实际开票来源暂不可读取',
    ),
    field('律师付款结清', '未记录（尚无实际付款登记来源）'),
    field(
      '退费清单核查',
      closureWorkspace
        ? closureWorkspace.refund.declaration === 'COMPLETE'
          ? '清单已声明完整；各项状态和公司收款标记见判决区'
          : closureWorkspace.refund.declaration === 'NOT_APPLICABLE'
            ? '清单声明不适用'
            : '清单状态待核；各项状态和公司收款标记见判决区'
        : '退费清单暂不可读取',
    ),
    field(
      '有效付款记录数',
      closureWorkspace ? String(payments.length) : '付款记录暂不可读取',
    ),
    field(
      '有效付款合计',
      closureWorkspace ? paymentTotal : '付款记录暂不可读取',
    ),
  ]);
  return sections;
}
