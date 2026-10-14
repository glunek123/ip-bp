import type { CaseDetail, CaseFile, CaseStage } from '../../api/cases';
import type { LeadDetail } from '../../api/leads';
import type { SectionKey } from './case-workspace-contract';

export type LeadState = 'idle' | 'loading' | 'ready' | 'denied' | 'failed';
export type WorkspaceField = {
  label: string;
  value: string;
  help?: string;
  wide?: boolean;
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

const leadStatusLabels: Record<LeadDetail['status'], string> = {
  WAITING_PUSH: '待推送',
  WAITING_REVIEW: '线索待审核',
  WAITING_EVIDENCE_DECISION: '线索待确认',
  TRANSFERRED_TO_NOTARY: '已移交公证',
  ARCHIVED: '线索已归档',
};
const leadPlatformLabels: Record<LeadDetail['platform'], string> = {
  TAOBAO: '淘宝',
  TMALL: '天猫',
  PINDUODUO: '拼多多',
  JD: '京东',
  DOUYIN: '抖音',
  ALIBABA_1688: '1688',
  XIAOHONGSHU: '小红书',
  KUAISHOU: '快手',
  XIANYU: '闲鱼',
  WECHAT: '微信',
  MEITUAN: '美团',
  DIANPING: '大众点评',
  MAP: '地图',
  OTHER: '其他',
};

const stageLabels: Record<CaseStage, string> = {
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
  VOIDED: '作废',
  SETTLEMENT: '和解',
  MEDIATION: '调解',
  JUDGMENT_PERFORMED: '判决履行',
  EXECUTION_COLLECTED: '执行回款',
  EXECUTION_CLOSED: '执行终结',
};
const caseTypeLabels: Record<LeadDetail['caseType'], string> = {
  CIVIL: '民事',
  CRIMINAL: '刑事',
  ADMINISTRATIVE: '行政',
  INVESTIGATION: '调查',
  NOTARIZATION: '公证',
  HEARING_REPRESENTATION: '开庭代理',
};
const infringementLabels: Record<
  LeadDetail['infringementTypes'][number],
  string
> = {
  TRADEMARK: '商标',
  SOFTWARE_COPYRIGHT: '软件著作权',
  ART_COPYRIGHT: '美术著作权',
  AUDIOVISUAL_COPYRIGHT: '视听作品著作权',
  TEXT_COPYRIGHT: '文字作品著作权',
  INVENTION_PATENT: '发明专利',
  DESIGN_PATENT: '外观设计专利',
  UTILITY_MODEL_PATENT: '实用新型专利',
  UNFAIR_COMPETITION: '不正当竞争',
  NETWORK_DISSEMINATION: '信息网络传播权',
  PORTRAIT_RIGHT: '肖像权',
  OTHER: '其他',
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
function files(label: string, items: readonly CaseFile[]): WorkspaceField[] {
  if (items.length === 0) return [field(label, null)];
  return items.map((item) =>
    field(label, item.originalFilename, `文件版本：${item.contentVersionId}`),
  );
}
function actor(id: string | undefined): WorkspaceField[] {
  return id ? [field('记录人', id, '返回的是用户标识，未返回姓名')] : [];
}
function uniqueById<T extends { id: string }>(
  history: readonly T[],
  current: T | null,
): T[] {
  const values = new Map(history.map((entry) => [entry.id, entry]));
  if (current) values.set(current.id, current);
  return [...values.values()];
}

// Only CaseDetail facts feed this view. No audit mutation, API reads or clock fallback.
export function buildCaseWorkspaceEvents(item: CaseDetail): WorkspaceEvent[] {
  const events: WorkspaceEvent[] = [];
  function add(
    source: string,
    id: string,
    title: string,
    businessAt: string | null,
    recordedAt: string | null,
    fields: WorkspaceField[] = [],
  ): void {
    events.push({ source, id, title, businessAt, recordedAt, fields });
  }
  add('case', item.id, '案件创建', null, item.createdAt);
  if (item.matchedAt !== null || item.matchedOn !== null)
    add('match', item.id, '案件匹配', item.matchedOn, item.matchedAt);
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
  for (const value of uniqueById(item.acceptances, item.acceptance))
    add(
      'acceptance',
      value.id,
      '正式立案',
      value.acceptedAt,
      value.recordedAt,
      [
        field('审理轮次标识', value.trialRoundId),
        field('法院案号', value.courtCaseNo),
        ...files('受理通知书', value.files),
        ...actor(value.recordedByUserId),
      ],
    );
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
        field('更正后阶段', stageLabels[value.resultStage]),
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

function eventGroup(event: WorkspaceEvent, current: boolean): WorkspaceGroup {
  const primaryJudgmentLabels = new Set(['判决金额', '已缴诉讼费']);
  const fields =
    event.source === 'judgment'
      ? [
          date('收到判决日期', event.businessAt),
          ...event.fields.filter((value) =>
            primaryJudgmentLabels.has(value.label),
          ),
          ...event.fields.filter(
            (value) => !primaryJudgmentLabels.has(value.label),
          ),
          date('记录时间', event.recordedAt),
        ]
      : [
          date('业务日期／时间', event.businessAt),
          date('记录时间', event.recordedAt),
          ...event.fields,
        ];
  return {
    id: `${event.source}:${event.id}`,
    title: `${event.title}${current ? '（当前）' : '（历史）'}`,
    fields,
    ...(!current ? { historical: true } : {}),
  };
}

export function buildCaseWorkspaceSections(
  item: CaseDetail,
  lead: LeadDetail | null,
  leadState: LeadState,
): WorkspaceSection[] {
  const events = buildCaseWorkspaceEvents(item);
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
      help,
      message:
        message ??
        (groups.length || key === 'timeline' ? null : '尚未登记相关资料'),
    });
  }
  const currentIds = new Set([
    item.acceptance?.id,
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
  ]);
  function groups(sources: readonly string[]): WorkspaceGroup[] {
    return events
      .filter((event) => sources.includes(event.source))
      .map((event) =>
        eventGroup(
          event,
          currentIds.has(event.id) ||
            [
              'complaint',
              'complaint-confirmation',
              'complaint-mailing',
              'filing',
            ].includes(event.source),
        ),
      );
  }
  section(
    'case-info',
    '案件信息',
    [
      {
        id: 'case',
        title: '基本资料',
        fields: [
          field('案件编号', item.businessNo),
          field('法院案号', item.courtCaseNo),
          field('部门', item.department.name),
          field('客户', item.customer.name),
          field('权利主体', item.rightsHolder.name),
          field('负责人', item.owner.displayName),
          field('当前阶段', stageLabels[item.stage]),
          date('创建时间', item.createdAt),
          date('实际匹配日期', item.matchedOn),
          date('匹配记录时间', item.matchedAt),
          field('来源公证业务号', item.sourceNotaryMatter.businessNo),
        ],
      },
      {
        id: 'certificate',
        title: '来源公证事实',
        fields: [
          field('公证书编号', item.certificate.certificateNo),
          date('公证日期', item.certificate.certificateDate),
          date('出证时间', item.certificate.issuedAt),
          field('需披露', item.certificate.needDisclose ? '是' : '否'),
          ...files('公证文件', item.certificate.files),
          ...files('披露文件', item.certificate.disclosureFiles),
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
      {
        id: 'defendant-state',
        title: '被告登记',
        fields: [field('被告', item.defendants.length ? '已登记' : '未登记')],
      },
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
        id: 'lawyer-state',
        title: '律师分派',
        fields: [field('承办律师', item.lawyers.length ? '已分派' : '未分派')],
      },
      ...groups(['closure', 'archive']),
    ],
    '编号、客户、权利主体、阶段及负责人只读；匹配、结案和归档仅通过已有业务命令登记或更正。',
  );
  const source =
    leadState === 'ready' && lead?.id === item.sourceLead.id ? lead : null;
  const leadMessages: Record<LeadState, string> = {
    idle: '来源线索尚未加载',
    loading: '正在加载来源线索',
    ready: '未取得本案来源线索资料',
    denied: '无来源线索读取权限；案件自身资料仍可查看',
    failed: '来源线索加载失败；不能据此判断资料为空',
  };
  section(
    'lead-info',
    '线索信息',
    [
      {
        id: 'lead-source',
        title: '案件来源',
        fields: [field('来源线索编号', item.sourceLead.businessNo)],
      },
      ...(source
        ? [
            {
              id: 'lead',
              title: '来源线索资料',
              fields: [
                field('状态', leadStatusLabels[source.status]),
                field('来源', source.source === 'ONLINE' ? '线上' : '线下'),
                field('案件类型', caseTypeLabels[source.caseType]),
                field(
                  '侵权类型',
                  source.infringementTypes
                    .map((type) => infringementLabels[type])
                    .join('、') || null,
                ),
                field('平台', leadPlatformLabels[source.platform]),
                field('店铺名称', source.shopName),
                field('店铺外部编号', source.shopExternalId),
                date('发现日期', source.foundAt),
                field('负责人', source.displayNames.responsibleUserName),
                field('需披露', source.needDisclose ? '是' : '否'),
                field('备注', source.remark),
              ],
            },
            ...source.products.map((value) => ({
              id: `product:${value.id}`,
              title: `商品 ${value.position + 1}`,
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
    ],
    source?.capabilities.edit
      ? '编辑进入来源线索的既有表单；受保护字段仍遵守来源状态与权限规则。'
      : '来源线索只读；无来源编辑能力时不能修改，也不能保存为案件副本。',
    source ? null : leadMessages[leadState],
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
  const firstInstanceGroups = groups([
    'complaint',
    'complaint-confirmation',
    'complaint-mailing',
    'filing',
    'acceptance',
    'hearing',
    'hearing-advance',
    'hearing-correction',
  ]);
  if (
    item.acceptance ||
    Object.values(item.acceptanceMaterials).some(
      (value) => value.frozen.length || value.later.length,
    )
  )
    firstInstanceGroups.push({
      id: 'acceptance-files',
      title: '受理材料',
      fields: acceptanceFiles,
    });
  section(
    'first-instance',
    '一审信息',
    firstInstanceGroups,
    '材料、确认、邮寄、立案和开庭使用已有登记／更正命令；受理日期及案号不能通用覆盖。',
  );
  section(
    'second-instance',
    '二审信息',
    [
      ...item.secondInstance.rounds.map((value) => ({
        id: `round:${value.id}`,
        title: `审理轮次 ${value.sequence}`,
        fields: [
          field('轮次标识', value.id),
          field('来源二审结果标识', value.sourceResultId),
          date('撤销时间', value.revokedAt),
        ],
      })),
      ...groups(['second-progress', 'second-result', 'second-revocation']),
    ],
    '复用二审资料、结果登记及带原因撤销；历史记录只读。',
  );
  section(
    'judgment',
    '判决信息',
    [
      {
        id: 'judgment-state',
        title: '当前有效判决',
        fields: [
          field('登记状态', item.judgment.current ? '已登记' : '未登记'),
        ],
      },
      ...groups([
        'judgment',
        'judgment-next-step',
        'judgment-next-step-revocation',
      ]),
    ],
    '判决及后续选择仅使用已有登记、带原因更正与撤销命令；未登记金额不按零展示。',
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
      'closure',
    ]),
    '复用执行提交、确认、邮寄、立案、结束及结案命令；冻结材料和历史记录只读。',
  );
  section(
    'timeline',
    '流程时间轴',
    [],
    '仅展示本案已返回的事实；业务日期与记录时间分开，不补日期或操作人，不支持通用新增、编辑或删除审计记录。',
    events.length ? null : '尚无可读记录',
  );
  return sections;
}
