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
  records: Array<{
    id: string;
    version: number;
    versions: Array<{ version: number }>;
    receipts: Array<{ action: string }>;
  }>;
  audits: Array<{ id: string; action: string }>;
}>;
export function disconnectCustomerSettlementDatabase(): Promise<void>;
export function rejectCustomerSettlementAudit(): Promise<void>;
export function allowCustomerSettlementAudit(): Promise<void>;
export function cleanupCustomerSettlementExternalActors(
  departmentId: string,
): Promise<void>;
