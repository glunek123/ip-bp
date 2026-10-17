export type MinimalPageKind = 'EF_FEEDBACK' | 'LEAD_BATCH';
export type MinimalPageWindow = { runId: string; deadlineIso: string };
export type MinimalPageActor = {
  userId: string;
  departmentId: string;
  username: string;
  password: string;
};
export type MinimalPagePrepared = MinimalPageWindow & {
  actor: MinimalPageActor;
  fixture: { customerId: string; rightsHolderId: string };
};
export type MinimalPageSession = {
  id: string;
  tokenDigest: string;
  userId: string;
  departmentId: string;
  createdAt: string;
  expiresAt: string;
};
export const minimalPageScopes: Readonly<
  Record<
    MinimalPageKind,
    Readonly<{
      kind: MinimalPageKind;
      userId: string;
      roleId: string;
      assignmentId: string;
      membershipId: string;
      credentialId: string;
      departmentId: string;
      actions: readonly string[];
      privateCredential: Readonly<{ path: string; sha256: string }>;
    }>
  >
>;
export function assertMinimalPageR2Binding(
  environment: NodeJS.ProcessEnv,
): true;
export function assertMinimalPageSourceAndLedger(value: {
  source: unknown;
  identity: unknown;
  applied: unknown;
  resolveReceipt: unknown;
  resolveStdout: Buffer;
  resolveStderr: Buffer;
}): true;
export function assertMinimalPageActor(
  kind: MinimalPageKind,
  rows: unknown,
  sealedGrants: unknown[],
): unknown;
export function assertMinimalPageStartupWindow(input: {
  startIso: string;
  deadlineIso: string;
  hearingCandidates: number;
  cleanupCandidates: number;
  throttleRows: number;
  sameShanghaiDay: boolean;
}): true;
export function assertMinimalPageDatabaseDiff(
  kind: MinimalPageKind,
  before: Map<string, Map<string, string>>,
  after: Map<string, Map<string, string>>,
  counterBefore: Map<string, number>,
  counterAfter: Map<string, number>,
  verified: boolean,
  registered: string | string[] | false,
): true;
export function bindMinimalPageSession(
  kind: MinimalPageKind,
  before: unknown[],
  after: unknown[],
  cookieValue: string,
  startIso: string,
  endIso: string,
): MinimalPageSession;
export function closeMinimalPageSession(
  kind: MinimalPageKind,
  binding: MinimalPageSession,
  delegates: {
    readSession(binding: MinimalPageSession): Promise<unknown>;
    logout(): Promise<void>;
    guardedRevoke(binding: MinimalPageSession): Promise<number>;
  },
): Promise<{ revoked: true; fallback: boolean; logoutSucceeded: boolean }>;
export function createMinimalPageRequestBudget(
  kind: MinimalPageKind,
): Readonly<{
  admit(method: string, url: string, rawBody?: unknown): void;
  setRunId(runId: string, username: string): void;
  setCase(id: string): void;
  setFiling(id: string): void;
  setFeedbackRoot(id: string): void;
  setDraft(id: string): void;
  setProof(
    category: 'MAIL_RECEIPT' | 'EXECUTION_FILING_PROOF',
    contentVersionId: string,
  ): void;
  setMailing(id: string): void;
  setLeads(ids: string[]): void;
  counts(): Readonly<Record<string, number>>;
  assertComplete(): true;
}>;
type MinimalPageOptions = {
  root?: string;
  environment?: NodeJS.ProcessEnv;
  window?: MinimalPageWindow;
  runId?: string;
};
type MinimalPageRuntime<T extends MinimalPageWindow> = Readonly<{
  prepare(): Promise<T>;
  beforeLogin(): Promise<{ count: number }>;
  bindSession(cookieValue: string): Promise<MinimalPageSession>;
  closeSession(logoutCallback: () => Promise<void>): Promise<{
    revoked: true;
    fallback: boolean;
    logoutSucceeded: boolean;
  }>;
  registerCase(caseId: string): Promise<true>;
  registerLeads(ids: string[]): Promise<true>;
  verifyEfResult(
    caseId: string,
    feedbackId: string,
    filingId: string,
  ): Promise<true>;
  verifyLeadResult(ids: string[]): Promise<true>;
  dispose(): Promise<void>;
}>;
export function createMinimalPageAcceptance(
  kind: MinimalPageKind,
  options: MinimalPageOptions & { preflightOnly: true },
): MinimalPageRuntime<MinimalPageWindow>;
export function createMinimalPageAcceptance(
  kind: MinimalPageKind,
  options?: MinimalPageOptions & { preflightOnly?: false },
): MinimalPageRuntime<MinimalPagePrepared>;
