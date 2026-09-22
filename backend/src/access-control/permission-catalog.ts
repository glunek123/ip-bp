import { PermissionAction, PermissionScope } from '../generated/prisma/enums';

export type PermissionCatalogItem = {
  action: PermissionAction;
  label: string;
  scopes: PermissionScope[];
};

const allScopes: PermissionScope[] = ['SELF', 'TEAM', 'DEPARTMENT'];

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
