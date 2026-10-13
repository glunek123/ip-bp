export declare function calendarCaseSourceIds(caseId: string): Promise<{
  first: string | null;
  second: string | null;
}>;
export declare function setCalendarCaseReadGrant(
  enabled: boolean,
): Promise<void>;
export declare function setCalendarUserActive(
  userId: string,
  active: boolean,
): Promise<void>;
export declare function disconnectCalendarSourcesDatabase(): Promise<void>;
export declare function replaceCalendarPrimaryLawyer(
  caseId: string,
  oldProfileId: string,
  newProfileId: string,
): Promise<void>;
export declare function probeSecondCalendarSource(
  request: import('@playwright/test').APIRequestContext,
  firstDate: string,
  revisedDate: string,
): Promise<{
  caseId: string;
  firstProgressId: string;
  currentProgressId: string;
  before: unknown;
  firstView: unknown;
  currentView: unknown;
  summary: unknown;
}>;
