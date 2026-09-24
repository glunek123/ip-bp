import { PermissionAction, PermissionScope } from '../generated/prisma/enums';

export type PermissionCatalogItem = {
  action: InternalAssignablePermissionAction;
  label: string;
  scopes: PermissionScope[];
};

const allScopes: PermissionScope[] = ['SELF', 'TEAM', 'DEPARTMENT'];

export const internalAssignablePermissionActions = [
  'CUSTOMER_READ',
  'CUSTOMER_CREATE_DRAFT',
  'CUSTOMER_EDIT_ROUTINE',
  'CUSTOMER_ADMIT',
  'LEAD_READ',
  'LEAD_CREATE',
  'LEAD_EDIT',
  'LEAD_PUSH',
  'LEAD_WITHDRAW_APPLY',
  'LEAD_EVIDENCE_DECIDE',
  'NOTARY_EVIDENCE_RECORD',
  'NOTARY_UNBOX_RECORD',
  'NOTARY_OFFICE_MANAGE',
  'USER_READ',
  'USER_MANAGE',
  'TEAM_READ',
  'TEAM_MANAGE',
  'ROLE_READ',
  'ROLE_ASSIGN',
  'ROLE_MANAGE',
] as const satisfies readonly PermissionAction[];

export type InternalAssignablePermissionAction =
  (typeof internalAssignablePermissionActions)[number];

const internalAssignablePermissionActionSet = new Set<PermissionAction>(
  internalAssignablePermissionActions,
);

export function isInternalAssignablePermissionAction(
  action: PermissionAction,
): action is InternalAssignablePermissionAction {
  return internalAssignablePermissionActionSet.has(action);
}

const catalog: PermissionCatalogItem[] = [
  { action: 'CUSTOMER_READ', label: '查看客户', scopes: allScopes },
  {
    action: 'CUSTOMER_CREATE_DRAFT',
    label: '创建客户草稿',
    scopes: allScopes,
  },
  {
    action: 'CUSTOMER_EDIT_ROUTINE',
    label: '编辑客户常规信息',
    scopes: allScopes,
  },
  { action: 'CUSTOMER_ADMIT', label: '准入客户', scopes: allScopes },
  { action: 'LEAD_READ', label: '查看线索', scopes: allScopes },
  { action: 'LEAD_CREATE', label: '创建线索', scopes: allScopes },
  { action: 'LEAD_EDIT', label: '编辑线索', scopes: allScopes },
  { action: 'LEAD_PUSH', label: '推送线索', scopes: allScopes },
  { action: 'LEAD_WITHDRAW_APPLY', label: '申请撤回归档', scopes: allScopes },
  {
    action: 'LEAD_EVIDENCE_DECIDE',
    label: '确认取证或不取证',
    scopes: allScopes,
  },
  {
    action: 'NOTARY_EVIDENCE_RECORD',
    label: '登记取证与物流',
    scopes: allScopes,
  },
  {
    action: 'NOTARY_UNBOX_RECORD',
    label: '登记开箱材料',
    scopes: allScopes,
  },
  {
    action: 'NOTARY_OFFICE_MANAGE',
    label: '管理公证处',
    scopes: ['DEPARTMENT'],
  },
  { action: 'USER_READ', label: '查看人员', scopes: allScopes },
  { action: 'USER_MANAGE', label: '管理人员', scopes: allScopes },
  { action: 'TEAM_READ', label: '查看团队', scopes: allScopes },
  { action: 'TEAM_MANAGE', label: '管理团队', scopes: allScopes },
  { action: 'ROLE_READ', label: '查看角色模板', scopes: allScopes },
  { action: 'ROLE_ASSIGN', label: '分配角色', scopes: allScopes },
  { action: 'ROLE_MANAGE', label: '管理角色模板', scopes: allScopes },
];

export const permissionCatalog: PermissionCatalogItem[] = catalog.map(
  (item) => ({ ...item, scopes: [...item.scopes] }),
);
