import type { CaseDetail, CaseSummary } from '../../api/cases';
import type { SectionKey } from './case-workspace-contract';

// URL values are identifiers for existing forms, never stage targets or command bodies.
const actionIntents = [
  'match',
  'complaint',
  'confirm-complaint',
  'mail-complaint',
  'filing',
  'acceptance',
  'hearing',
  'register-judgment',
  'correct-judgment',
  'choose-next-step',
  'revoke-next-step',
  'second-instance',
  'revoke-second-instance-result',
  'second-instance-acceptance',
  'execution-upload',
  'execution-submission',
  'execution-confirmation',
  'execution-mailing',
  'execution-filing',
  'finish',
  'record-closure',
  'correct-closure',
  'archive',
  'correct-archive',
  'defendant-contact-update',
  'acceptance-correction',
] as const;
export type CaseActionIntent = (typeof actionIntents)[number];
export type CaseWorkspaceAction = {
  id: string;
  section: SectionKey;
  label: string;
  intent: CaseActionIntent;
};
const actionDefinitions = {
  match: {
    id: 'match',
    section: 'case-info',
    label: '匹配当事人与承办律师',
  },
  complaint: {
    id: 'complaint',
    section: 'first-instance',
    label: '提交起诉材料',
  },
  'confirm-complaint': {
    id: 'confirm-complaint',
    section: 'first-instance',
    label: '确认诉状',
  },
  'mail-complaint': {
    id: 'mail-complaint',
    section: 'first-instance',
    label: '登记诉状邮寄',
  },
  filing: {
    id: 'filing',
    section: 'first-instance',
    label: '提交立案',
  },
  acceptance: {
    id: 'acceptance',
    section: 'first-instance',
    label: '正式立案／受理材料',
  },
  hearing: {
    id: 'hearing',
    section: 'first-instance',
    label: '开庭登记／更正',
  },
  'register-judgment': {
    id: 'judgment',
    section: 'judgment',
    label: '登记判决',
  },
  'correct-judgment': {
    id: 'judgment',
    section: 'judgment',
    label: '更正判决',
  },
  'choose-next-step': {
    id: 'next-step',
    section: 'judgment',
    label: '选择判决后续流程',
  },
  'revoke-next-step': {
    id: 'next-step',
    section: 'judgment',
    label: '撤销后续选择',
  },
  'second-instance': {
    id: 'second-instance',
    section: 'second-instance',
    label: '二审登记／结果',
  },
  'revoke-second-instance-result': {
    id: 'second-instance',
    section: 'second-instance',
    label: '撤销二审结果',
  },
  'execution-upload': {
    id: 'execution-upload',
    section: 'execution',
    label: '上传执行材料',
  },
  'execution-submission': {
    id: 'execution-submission',
    section: 'execution',
    label: '提交执行材料',
  },
  'execution-confirmation': {
    id: 'execution-confirmation',
    section: 'execution',
    label: '确认执行材料',
  },
  'execution-mailing': {
    id: 'execution-mailing',
    section: 'execution',
    label: '登记执行邮寄',
  },
  'execution-filing': {
    id: 'execution-filing',
    section: 'execution',
    label: '登记执行立案',
  },
  finish: {
    id: 'finish',
    section: 'execution',
    label: '登记执行结束',
  },
  'record-closure': {
    id: 'closure',
    section: 'closure-info',
    label: '登记结案资料',
  },
  'correct-closure': {
    id: 'closure',
    section: 'closure-info',
    label: '更正结案资料',
  },
  archive: {
    id: 'archive',
    section: 'closure-info',
    label: '归档案件',
  },
  'correct-archive': {
    id: 'archive',
    section: 'closure-info',
    label: '更正归档原因',
  },
  'second-instance-acceptance': {
    id: 'second-instance-acceptance',
    section: 'second-instance',
    label: '登记或更正二审受理信息',
  },
  'defendant-contact-update': {
    id: 'defendant-contact-update',
    section: 'case-info',
    label: '更新被告联系方式',
  },
  'acceptance-correction': {
    id: 'acceptance-correction',
    section: 'first-instance',
    label: '更正一审受理信息',
  },
} satisfies Record<
  CaseActionIntent,
  { id: string; section: SectionKey; label: string }
>;
function actionForIntent(intent: CaseActionIntent): CaseWorkspaceAction {
  return { ...actionDefinitions[intent], intent };
}
type CaseActionCapabilities = Pick<
  CaseSummary,
  Extract<keyof CaseSummary, `can${string}`> | 'origin'
>;

export function parseCaseActionIntent(
  value: unknown,
): CaseActionIntent | undefined {
  return actionIntents.find((intent) => intent === value);
}
function commandIntent(command: string, current: CaseDetail): CaseActionIntent {
  if (command === 'judgment')
    return current.judgment.current ? 'correct-judgment' : 'register-judgment';
  if (command === 'next-step')
    return current.judgmentNextStep.current
      ? 'revoke-next-step'
      : 'choose-next-step';
  if (command === 'second-instance')
    return current.canRevokeSecondInstanceResult &&
      current.secondInstance.currentResult
      ? 'revoke-second-instance-result'
      : 'second-instance';
  if (command === 'closure')
    return current.closure ? 'correct-closure' : 'record-closure';
  if (command === 'archive')
    return current.archive ? 'correct-archive' : 'archive';
  const intent = parseCaseActionIntent(command);
  if (!intent) throw new Error('Unrecognized case workspace command');
  return intent;
}
export function resolveCaseDetailActions(
  current: CaseDetail,
): CaseWorkspaceAction[] {
  const result: CaseWorkspaceAction[] = [];
  const add = (enabled: boolean, command: string) => {
    if (enabled) result.push(actionForIntent(commandIntent(command, current)));
  };
  const stage = current.stage;
  add(stage === 'PENDING_MATCH' && current.canMatch, 'match');
  add(stage === 'WAITING_COMPLAINT' && current.canSubmitComplaint, 'complaint');
  add(
    stage === 'WAITING_COMPLAINT_CONFIRMATION' && current.canConfirmComplaint,
    'confirm-complaint',
  );
  add(
    stage === 'WAITING_COMPLAINT_STAMP' &&
      current.canMailComplaint &&
      !current.complaintMailing,
    'mail-complaint',
  );
  add(stage === 'WAITING_FILING' && current.canSubmitFiling, 'filing');
  add(
    (stage === 'WAITING_FORMAL_ACCEPTANCE' &&
      current.canRegisterAcceptance &&
      !current.acceptance) ||
      ((stage === 'WAITING_FORMAL_ACCEPTANCE' || stage === 'WAITING_HEARING') &&
        current.canUploadAcceptanceMaterials),
    'acceptance',
  );
  add(
    ((!!current.acceptance ||
      (current.origin?.kind === 'EXTERNAL_ENTRY' &&
        current.origin.initialStage === 'WAITING_HEARING')) &&
      stage === 'WAITING_HEARING' &&
      current.canScheduleHearing) ||
      (!!current.acceptance &&
        (stage === 'WAITING_HEARING' || stage === 'WAITING_JUDGMENT') &&
        current.canCorrectHearing),
    'hearing',
  );
  add(
    stage === 'WAITING_JUDGMENT' &&
      ((!current.judgment.current && current.canRegisterJudgment) ||
        (!!current.judgment.current &&
          !current.judgmentNextStep.current &&
          current.canCorrectJudgment)),
    'judgment',
  );
  add(
    !!current.judgment.current &&
      ((stage === 'WAITING_JUDGMENT' &&
        current.canChooseJudgmentNextStep &&
        !current.judgmentNextStep.current) ||
        (current.canRevokeJudgmentNextStep &&
          !!current.judgmentNextStep.current &&
          (stage === 'SECOND_INSTANCE' ||
            stage === 'WAITING_EXECUTION_DOCUMENTS'))),
    'next-step',
  );
  add(
    (stage === 'SECOND_INSTANCE' &&
      !!current.secondInstance.currentTrialRoundId &&
      ((current.judgmentNextStep.current?.next === 'APPEAL' &&
        current.judgmentNextStep.current.trialRoundId ===
          current.secondInstance.currentTrialRoundId) ||
        (current.origin?.kind === 'EXTERNAL_ENTRY' &&
          current.origin.initialStage === 'SECOND_INSTANCE' &&
          current.secondInstance.rounds.some(
            (round) =>
              round.id === current.secondInstance.currentTrialRoundId &&
              round.sequence === 1 &&
              round.sourceResultId === null,
          ))) &&
      (current.canSaveSecondInstance ||
        (current.canRegisterSecondInstanceResult &&
          !current.secondInstance.currentResult))) ||
      (current.canRevokeSecondInstanceResult &&
        !!current.secondInstance.currentResult),
    'second-instance',
  );
  add(
    current.recordEdits?.canSaveSecondInstanceAcceptance === true &&
      (current.recordEdits.secondInstanceAcceptances?.some(
        (entry) => entry.canEdit && entry.choiceId !== null,
      ) === true ||
        (current.origin?.kind === 'EXTERNAL_ENTRY' &&
          current.origin.initialStage === 'SECOND_INSTANCE' &&
          current.recordEdits.secondInstanceAcceptances?.some(
            (entry) =>
              entry.canEdit &&
              entry.choiceId === null &&
              entry.trialRoundId ===
                current.secondInstance.currentTrialRoundId &&
              current.secondInstance.rounds.some(
                (round) =>
                  round.id === entry.trialRoundId &&
                  round.sequence === 1 &&
                  round.sourceResultId === null,
              ),
          ) === true)),
    'second-instance-acceptance',
  );
  add(
    stage === 'WAITING_EXECUTION_CONFIRMATION' &&
      current.origin?.kind === 'EXTERNAL_ENTRY' &&
      current.origin.initialStage === 'WAITING_EXECUTION_CONFIRMATION' &&
      'canUploadDirectExecutionMaterials' in current &&
      current.canUploadDirectExecutionMaterials === true &&
      current.executionSubmission.current === null &&
      !current.executionConfirmation,
    'execution-upload',
  );
  add(
    (stage === 'WAITING_EXECUTION_DOCUMENTS' ||
      (stage === 'SECOND_INSTANCE' &&
        current.origin?.kind === 'EXTERNAL_ENTRY' &&
        current.origin.initialStage === 'SECOND_INSTANCE' &&
        ['AFFIRM', 'CHANGE'].includes(
          String(current.secondInstance.currentResult?.result),
        )) ||
      stage === 'WAITING_EXECUTION_CONFIRMATION') &&
      current.canSubmitExecution &&
      !(
        current.origin?.kind === 'EXTERNAL_ENTRY' &&
        current.origin.initialStage === 'WAITING_EXECUTION_CONFIRMATION' &&
        current.executionSubmission.current === null
      ) &&
      !current.executionConfirmation,
    'execution-submission',
  );
  add(
    stage === 'WAITING_EXECUTION_CONFIRMATION' &&
      current.canConfirmExecution &&
      (!!current.executionSubmission.current ||
        (current.origin?.kind === 'EXTERNAL_ENTRY' &&
          current.origin.initialStage === 'WAITING_EXECUTION_CONFIRMATION')) &&
      !current.executionConfirmation,
    'execution-confirmation',
  );
  add(
    stage === 'WAITING_EXECUTION_STAMP' &&
      current.canMailExecution &&
      (!!current.executionConfirmation ||
        (current.origin?.kind === 'EXTERNAL_ENTRY' &&
          current.origin.initialStage === 'WAITING_EXECUTION_STAMP')) &&
      !current.executionMailing,
    'execution-mailing',
  );
  add(
    stage === 'WAITING_EXECUTION_FILING' &&
      current.canSubmitExecutionFiling &&
      (!!current.executionMailing ||
        (current.origin?.kind === 'EXTERNAL_ENTRY' &&
          current.origin.initialStage === 'WAITING_EXECUTION_FILING')) &&
      !current.executionFiling,
    'execution-filing',
  );
  add(
    stage === 'EXECUTING' &&
      current.canFinishExecution &&
      (!!current.executionFiling ||
        (current.origin?.kind === 'EXTERNAL_ENTRY' &&
          current.origin.initialStage === 'EXECUTING')) &&
      !current.executionFinish,
    'finish',
  );
  add(
    stage === 'WAITING_ARCHIVE' &&
      (!!current.executionFinish ||
        (current.origin?.kind === 'EXTERNAL_ENTRY' &&
          current.origin.initialStage === 'WAITING_ARCHIVE')) &&
      ((!current.closure && current.canRecordClosure) ||
        (!!current.closure && current.canCorrectClosure)),
    'closure',
  );
  add(
    !!current.closure &&
      ((stage === 'WAITING_ARCHIVE' &&
        current.canArchive &&
        !current.archive) ||
        (stage === 'ARCHIVED' &&
          current.canCorrectArchive &&
          !!current.archive)),
    'archive',
  );

  add(
    current.recordEdits?.canUpdateDefendantContact === true &&
      current.defendants.length > 0 &&
      current.recordEdits.defendantContacts.length ===
        current.defendants.length,
    'defendant-contact-update',
  );
  add(
    current.recordEdits?.canCorrectAcceptance === true &&
      current.acceptances.length > 0 &&
      current.recordEdits.acceptanceCorrections.length ===
        current.acceptances.length,
    'acceptance-correction',
  );
  return result;
}

// List capabilities already include server-side stage and fact checks. The list
// does not infer missing facts from amounts, source type, or a user's role.
export function resolveCaseListActions(
  current: CaseActionCapabilities,
): CaseWorkspaceAction[] {
  const result: CaseWorkspaceAction[] = [];
  const add = (enabled: boolean | undefined, intent: CaseActionIntent) => {
    if (enabled === true) result.push(actionForIntent(intent));
  };
  add(current.canMatch, 'match');
  add(current.canSubmitComplaint, 'complaint');
  add(current.canConfirmComplaint, 'confirm-complaint');
  add(current.canMailComplaint, 'mail-complaint');
  add(current.canSubmitFiling, 'filing');
  add(
    current.canRegisterAcceptance || current.canUploadAcceptanceMaterials,
    'acceptance',
  );
  add(current.canScheduleHearing || current.canCorrectHearing, 'hearing');
  add(current.canRegisterJudgment, 'register-judgment');
  add(current.canCorrectJudgment, 'correct-judgment');
  add(current.canChooseJudgmentNextStep, 'choose-next-step');
  add(current.canRevokeJudgmentNextStep, 'revoke-next-step');
  add(
    current.canSaveSecondInstance || current.canRegisterSecondInstanceResult,
    'second-instance',
  );
  add(current.canRevokeSecondInstanceResult, 'revoke-second-instance-result');
  add(current.canUploadDirectExecutionMaterials, 'execution-upload');
  add(
    current.canSubmitExecution &&
      !(
        current.canUploadDirectExecutionMaterials &&
        current.origin?.kind === 'EXTERNAL_ENTRY' &&
        current.origin.initialStage === 'WAITING_EXECUTION_CONFIRMATION'
      ),
    'execution-submission',
  );
  add(current.canConfirmExecution, 'execution-confirmation');
  add(current.canMailExecution, 'execution-mailing');
  add(current.canSubmitExecutionFiling, 'execution-filing');
  add(current.canFinishExecution, 'finish');
  add(current.canRecordClosure, 'record-closure');
  add(current.canCorrectClosure, 'correct-closure');
  add(current.canArchive, 'archive');
  add(current.canCorrectArchive, 'correct-archive');
  return result;
}

export function primaryCaseAction<T extends { id: string }>(
  stage: CaseDetail['stage'] | undefined,
  commands: T[],
): T | undefined {
  const stageCommands: Partial<Record<CaseDetail['stage'], string>> = {
    PENDING_MATCH: 'match',
    WAITING_COMPLAINT: 'complaint',
    WAITING_COMPLAINT_CONFIRMATION: 'confirm-complaint',
    WAITING_COMPLAINT_STAMP: 'mail-complaint',
    WAITING_FILING: 'filing',
    WAITING_FORMAL_ACCEPTANCE: 'acceptance',
    WAITING_HEARING: 'hearing',
    WAITING_JUDGMENT: 'judgment',
    SECOND_INSTANCE: 'second-instance',
    WAITING_EXECUTION_DOCUMENTS: 'execution-submission',
    WAITING_EXECUTION_CONFIRMATION: 'execution-confirmation',
    WAITING_EXECUTION_STAMP: 'execution-mailing',
    WAITING_EXECUTION_FILING: 'execution-filing',
    EXECUTING: 'finish',
    ARCHIVED: 'archive',
  };
  if (stage === 'WAITING_ARCHIVE')
    return (
      commands.find((entry) => entry.id === 'archive') ??
      commands.find((entry) => entry.id === 'closure')
    );
  return (
    commands.find((entry) => stage && entry.id === stageCommands[stage]) ??
    commands.find((entry) => entry.id !== 'next-step') ??
    commands[0]
  );
}
