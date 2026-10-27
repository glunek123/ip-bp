export interface V6CustomerPermissionUiFixture {
  operatorUsername: string;
  operatorPassword: string;
  selfUsername: string;
  selfPassword: string;
  operatorUserId: string;
  selfUserId: string;
  departmentId: string;
  foreignCustomerId: string;
  selfCustomerId: string;
}

export interface V6CustomerPermissionFacts {
  customer:
    | {
        department_id: string;
        responsible_user_id: string;
        profile_status: string;
        version: number;
      }
    | undefined;
  reference: Array<{
    material_id: string;
    content_version_id: string;
    purpose: string;
  }>;
  account: Array<{
    binding_active: boolean;
    binding_version: number;
    account_active: boolean;
  }>;
}

export interface V6ArchivedSettlementCase {
  id: string;
  business_no: string;
  stage: 'ARCHIVED';
  version: number;
  archive_id: string;
  from_version: number;
  to_version: number;
}

export interface V6ArchivedSettlementFacts {
  archive: {
    case_id: string;
    business_no: string;
    stage: 'ARCHIVED';
    version: number;
    archive_id: string;
    from_version: number;
    to_version: number;
  };
  closureCount: number;
  terms: Array<{
    version: number;
    customer_formula: string | null;
    customer_manual_amount: string | null;
    lawyer_manual_amount: string | null;
  }>;
  launches: Array<{
    id: string;
    side: 'CUSTOMER' | 'LAWYER';
    nth: number;
    amount: string;
    bill_id: string | null;
    actor_user_id: string;
  }>;
  audits: Array<{ action: string; count: number }>;
}

export function prepareV6CustomerPermissionsUi(): Promise<V6CustomerPermissionUiFixture>;
export function readV6CustomerPermissionFacts(
  customerId: string,
  accountUserId: string,
  contentVersionId: string,
): Promise<V6CustomerPermissionFacts>;
export function selectV6ArchivedSettlementCase(): Promise<V6ArchivedSettlementCase>;
export function readV6ArchivedSettlementFacts(
  caseId: string,
): Promise<V6ArchivedSettlementFacts>;
