export type WorkspaceTab = 'details' | 'files' | 'fees';

export type SectionKey =
  | 'case-info'
  | 'lead-info'
  | 'first-instance'
  | 'second-instance'
  | 'judgment'
  | 'execution'
  | 'closure-info'
  | 'timeline';

export interface SectionAction {
  enabled: boolean;
  label: string;
  hint: string | null;
}
