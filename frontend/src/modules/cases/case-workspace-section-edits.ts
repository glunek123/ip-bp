import type { CaseDetail } from '../../api/cases';
import {
  resolveCaseDetailActions,
  type CaseWorkspaceAction,
} from './case-workspace-actions';
import type { SectionKey } from './case-workspace-contract';
import type { CaseSectionRecordKind } from './CaseSectionRecordCorrectionPanel.vue';

export const sectionRecordCommands = [
  {
    id: 'record-execution-mailing',
    kind: 'execution-mailing',
    section: 'execution',
    label: '更正执行邮寄资料',
  },
  {
    id: 'record-execution-filing',
    kind: 'execution-filing',
    section: 'execution',
    label: '更正申请执行资料',
  },
  {
    id: 'record-execution-finish',
    kind: 'execution-finish',
    section: 'execution',
    label: '更正执行结束资料',
  },
  {
    id: 'record-hearing-first',
    kind: 'hearing',
    section: 'first-instance',
    label: '更正一审开庭资料',
  },
  {
    id: 'record-judgment',
    kind: 'judgment',
    section: 'judgment',
    label: '更正判决资料',
  },
  {
    id: 'record-closure',
    kind: 'closure',
    section: 'closure-info',
    label: '更正结案资料',
  },
] as const satisfies ReadonlyArray<{
  id: string;
  kind: CaseSectionRecordKind;
  section: SectionKey;
  label: string;
}>;
type SectionEditAction = Pick<CaseWorkspaceAction, 'id' | 'section' | 'label'>;

// Section edits only address existing records. Workflow commands and retained
// unknown requests have their own entry points and must never appear here.
export function resolveCaseSectionEdits(item: CaseDetail): SectionEditAction[] {
  const result: SectionEditAction[] = resolveCaseDetailActions(item).filter(
    (action) => {
      switch (action.intent) {
        case 'defendant-contact-update':
        case 'acceptance-correction':
        case 'correct-archive':
          return true;
        case 'second-instance-acceptance':
          return (
            item.recordEdits?.secondInstanceAcceptances?.some(
              (entry) => entry.canEdit && entry.acceptanceRevision > 0,
            ) === true
          );
        default:
          return false;
      }
    },
  );
  const edits = item.recordEdits;
  for (const command of sectionRecordCommands) {
    let enabled = false;
    switch (command.kind) {
      case 'execution-mailing':
        enabled =
          edits?.executionMailings?.some((entry) => entry.canEdit) === true;
        break;
      case 'execution-filing':
        enabled =
          edits?.executionFilings?.some((entry) => entry.canEdit) === true;
        break;
      case 'execution-finish':
        enabled =
          edits?.executionFinishes?.some((entry) => entry.canEdit) === true;
        break;
      case 'hearing':
        // Trial rounds include remanded first-instance trials. Their sequence
        // never identifies second-instance progress, which has another source.
        enabled = edits?.hearings?.some((entry) => entry.canEdit) === true;
        break;
      case 'judgment':
        enabled = edits?.judgments?.some((entry) => entry.canEdit) === true;
        break;
      case 'closure':
        enabled = edits?.closures?.some((entry) => entry.canEdit) === true;
        break;
    }
    if (enabled) result.push(command);
  }
  return result;
}
