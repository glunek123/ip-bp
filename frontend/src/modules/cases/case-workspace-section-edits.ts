import type { CaseDetail } from '../../api/cases';
import {
  resolveCaseDetailActions,
  type CaseWorkspaceAction,
} from './case-workspace-actions';

// Section edits only address existing records. Workflow commands and retained
// unknown requests have their own entry points and must never appear here.
export function resolveCaseSectionEdits(
  item: CaseDetail,
): CaseWorkspaceAction[] {
  return resolveCaseDetailActions(item).filter((action) => {
    switch (action.intent) {
      case 'defendant-contact-update':
      case 'acceptance-correction':
      case 'correct-judgment':
      case 'correct-closure':
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
  });
}
