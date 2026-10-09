export function setCustomerSettlementGrant(
  roleTemplateId: string,
  action:
    | 'CUSTOMER_SETTLEMENT_READ'
    | 'CUSTOMER_SETTLEMENT_REGISTER'
    | 'CUSTOMER_SETTLEMENT_CORRECT',
  enabled: boolean,
  scope?: 'SELF' | 'TEAM' | 'DEPARTMENT',
): Promise<void>;
export function getCustomerSettlementState(customerId: string): Promise<{
  customerVersion: number | undefined;
  customerDeletedAt: Date | null | undefined;
  records: Array<{
    id: string;
    version: number;
    versions: Array<{ version: number }>;
    receipts: Array<{ action: string }>;
  }>;
  versionCount: number;
  receiptCount: number;
  audits: Array<{ id: string; action: string }>;
}>;
export function exerciseCustomerSettlementDeletionRace<T>(
  customerId: string,
  issueFirst: () => Promise<T>,
  issueSecond: () => Promise<T>,
): Promise<{
  first: T;
  second: T;
  firstQueued: boolean;
  secondQueued: boolean;
}>;
export function disconnectCustomerSettlementDatabase(): Promise<void>;
export function rejectCustomerSettlementAudit(): Promise<void>;
export function allowCustomerSettlementAudit(): Promise<void>;
export function cleanupCustomerSettlementExternalActors(
  departmentId: string,
): Promise<void>;
