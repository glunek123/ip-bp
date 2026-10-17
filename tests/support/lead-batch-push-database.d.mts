export const leadBatchPushLimits: Readonly<{
  maxItemsPerBatch: 20;
  maxNewLeads: 40;
  maxBatchReceipts: 10;
  maxCreateReceipts: 40;
  maxLeadCreateAudits: 40;
  maxLeadPushAudits: 40;
}>;

export type LeadBatchPushIdentity = Readonly<{
  userId: string;
  roleId: string;
  assignmentId: string;
  membershipId: string;
  credentialId: string;
  departmentId: string;
}>;

export type LeadBatchPushTerminalManifest = LeadBatchPushIdentity &
  Readonly<{
    grantIds: Readonly<Record<string, string>>;
  }>;

export type LeadBatchPushManifest = Readonly<{
  version: 1;
  cohort: 'uxq03-lead-batch-push-20261016';
  runId: string;
  creationReceiptSha256: string;
  main: LeadBatchPushIdentity;
  terminal: LeadBatchPushTerminalManifest;
}>;

export type LeadBatchPushFixture = Readonly<{
  customerId: string;
  rightsHolderId: string;
  departmentId: string;
}>;

export function validateLeadBatchPushBinding(
  environment: NodeJS.ProcessEnv,
): Readonly<Record<string, string | number>>;
export function validateLeadBatchPushMigrationSource(
  migrations: ReadonlyArray<{ name: string; checksum: string }>,
): Array<{ name: string; checksum: string }>;
export function validateLeadBatchPushMigrationLedger(
  applied: ReadonlyArray<Record<string, unknown>>,
  migrations: ReadonlyArray<{ name: string; checksum: string }>,
  evidence: {
    receipt: Record<string, unknown>;
    stdout: Buffer;
    stderr: Buffer;
  },
): true;
export function validateLeadBatchPushManifest(
  manifest: unknown,
): LeadBatchPushManifest;
export function validateLeadBatchPushCreationReceipt(
  receipt: unknown,
  receiptSha256: string,
  options: {
    runId: string;
    creationReceiptSha256: string;
    candidateCommit: string;
  },
): unknown;
export function validateLeadBatchPushFaultScope(
  scope: {
    actorUserId: string;
    departmentId: string;
    idempotencyKey: string;
    leadIds: ReadonlyArray<string>;
  },
  preparedIdentity: { actorUserId: string; departmentId: string },
  allowedFreshLeadIds: ReadonlySet<string>,
): Readonly<{
  actorUserId: string;
  departmentId: string;
  idempotencyKey: string;
  leadIds: ReadonlyArray<string>;
}>;
export function validateLeadBatchPushFaultMarker(
  before: { last_value: string | number; is_called: boolean },
  after: { last_value: string | number; is_called: boolean },
): true;
export function validateLeadBatchPushFixture(
  rows: ReadonlyArray<{
    customerId: string;
    rightsHolderId: string;
    departmentId: string;
    profileStatus: string;
    cooperationStatus: string;
    clientBindingActive: boolean;
  }>,
): LeadBatchPushFixture;

export function createLeadBatchPushDatabaseSupport(overrides?: {
  migrations?: () => Promise<Array<{ name: string; checksum: string }>>;
  capture?: () => Promise<{ childEnvironment: NodeJS.ProcessEnv }>;
  open?: (connectionString: string) => {
    connect(): Promise<void>;
    end(): Promise<void>;
    query(
      sql: string,
      parameters?: unknown[],
    ): Promise<{
      rows: Array<Record<string, unknown>>;
      rowCount?: number | null;
    }>;
  };
}): Readonly<{
  prepare(): Promise<{
    fixture: LeadBatchPushFixture;
    manifest: LeadBatchPushManifest;
    credentials: {
      main: { username: string; password: string };
      terminal: { username: string; password: string };
    };
    h42: { actorId: string; roleId: string };
  }>;
  beginLeadCreation(idempotencyKey: string): Promise<void>;
  registerCreatedLead(idempotencyKey: string, leadId: string): Promise<void>;
  readFacts(
    leadIds: ReadonlyArray<string>,
    actorUserId: string,
    keys?: ReadonlyArray<string>,
  ): Promise<{
    leads: Array<{ id: string; status: string; version: number }>;
    receipts: Array<{
      id: string;
      idempotency_key: string;
      original_request: unknown;
      result_snapshot: unknown;
    }>;
    audits: Array<{ lead_id: string; action: string; count: number }>;
  }>;
  revokeTerminalAssignment(manifest: LeadBatchPushManifest): Promise<void>;
  withReceiptInsertFailure<T>(
    scope: {
      actorUserId: string;
      departmentId: string;
      idempotencyKey: string;
      leadIds: ReadonlyArray<string>;
    },
    run: () => Promise<T>,
  ): Promise<T>;
}>;
