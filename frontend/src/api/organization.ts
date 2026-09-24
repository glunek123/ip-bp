import { ApiError, getJson, requestJson, type RequestOptions } from './http';

export type OrganizationCapabilities = {
  createUser: boolean;
  manageUsers: boolean;
  createTeam: boolean;
  manageTeams: boolean;
  assignDepartmentRoles: boolean;
  assignTeamRoles: boolean;
  manageRoleTemplates: boolean;
};

export type OrganizationTeam = {
  id: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
};

export type OrganizationRole = {
  id: string;
  name: string;
  version: number;
  activeAssignmentCount: number;
  grants: OrganizationGrant[];
};

export type OrganizationContextRole = OrganizationRole & {
  assignable: boolean;
};

export const permissionActionValues = [
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
  'USER_READ',
  'USER_MANAGE',
  'TEAM_READ',
  'TEAM_MANAGE',
  'ROLE_READ',
  'ROLE_ASSIGN',
  'ROLE_MANAGE',
] as const;
export const permissionScopeValues = ['SELF', 'TEAM', 'DEPARTMENT'] as const;

export type PermissionAction = (typeof permissionActionValues)[number];
export type PermissionScope = (typeof permissionScopeValues)[number];
export type OrganizationGrant = {
  action: PermissionAction;
  scope: PermissionScope;
};
export type OrganizationPermissionCatalogItem = {
  action: PermissionAction;
  label: string;
  scopes: PermissionScope[];
};

export type RoleTemplateImpact = {
  roleTemplateId: string;
  version: number;
  activeAssignmentCount: number;
  affectedUsers: Array<{ id: string; displayName: string }>;
};

export type CopyRoleTemplateInput = {
  sourceRoleTemplateId: string;
  name: string;
  grants: OrganizationGrant[];
};

export type UpdateRoleTemplateInput = {
  name: string;
  expectedVersion: number;
  grants: OrganizationGrant[];
};

export type OrganizationRoleAssignment = {
  id: string;
  roleTemplateId: string;
  roleName: string;
  teamId: string | null;
  active: boolean;
  version: number;
};

export type OrganizationUser = {
  id: string;
  displayName: string;
  username: string;
  accountActive: boolean;
  membership: { id: string; active: boolean; teamId: string | null };
  assignments: OrganizationRoleAssignment[];
};

export type OrganizationManagementContext = {
  capabilities: OrganizationCapabilities;
  users: OrganizationUser[];
  teams: OrganizationTeam[];
  roles: OrganizationContextRole[];
  permissionCatalog: OrganizationPermissionCatalogItem[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

const permissionActions = new Set<string>(permissionActionValues);
const permissionScopes = new Set<string>(permissionScopeValues);

function isTeam(value: unknown): value is OrganizationTeam {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['id', 'name', 'status']) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    (value.status === 'ACTIVE' || value.status === 'INACTIVE')
  );
}

function isAssignment(value: unknown): value is OrganizationRoleAssignment {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'id',
      'roleTemplateId',
      'roleName',
      'teamId',
      'active',
      'version',
    ]) &&
    typeof value.id === 'string' &&
    typeof value.roleTemplateId === 'string' &&
    typeof value.roleName === 'string' &&
    isNullableString(value.teamId) &&
    typeof value.active === 'boolean' &&
    Number.isInteger(value.version)
  );
}

function isUser(value: unknown): value is OrganizationUser {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'id',
      'displayName',
      'username',
      'accountActive',
      'membership',
      'assignments',
    ]) &&
    typeof value.id === 'string' &&
    typeof value.displayName === 'string' &&
    typeof value.username === 'string' &&
    typeof value.accountActive === 'boolean' &&
    isRecord(value.membership) &&
    hasExactKeys(value.membership, ['id', 'active', 'teamId']) &&
    typeof value.membership.id === 'string' &&
    typeof value.membership.active === 'boolean' &&
    isNullableString(value.membership.teamId) &&
    Array.isArray(value.assignments) &&
    value.assignments.every(isAssignment)
  );
}

function isRole(value: unknown): value is OrganizationRole {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'id',
      'name',
      'version',
      'activeAssignmentCount',
      'grants',
    ]) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    Number.isInteger(value.version) &&
    Number(value.version) >= 1 &&
    Number.isInteger(value.activeAssignmentCount) &&
    Number(value.activeAssignmentCount) >= 0 &&
    Array.isArray(value.grants) &&
    value.grants.every(isGrant)
  );
}

function isContextRole(value: unknown): value is OrganizationContextRole {
  if (!isRecord(value) || typeof value.assignable !== 'boolean') return false;
  const role = { ...value };
  delete role.assignable;
  return isRole(role);
}

function isGrant(value: unknown): value is OrganizationGrant {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['action', 'scope']) &&
    typeof value.action === 'string' &&
    permissionActions.has(value.action) &&
    typeof value.scope === 'string' &&
    permissionScopes.has(value.scope)
  );
}

function isPermissionCatalog(
  value: unknown,
): value is OrganizationPermissionCatalogItem[] {
  if (!Array.isArray(value) || value.length !== permissionActionValues.length) {
    return false;
  }
  const actions = new Set<string>();
  for (const item of value) {
    if (
      !isRecord(item) ||
      !hasExactKeys(item, ['action', 'label', 'scopes']) ||
      typeof item.action !== 'string' ||
      !permissionActions.has(item.action) ||
      typeof item.label !== 'string' ||
      item.label.length === 0 ||
      !Array.isArray(item.scopes) ||
      item.scopes.length === 0 ||
      !item.scopes.every(
        (scope) => typeof scope === 'string' && permissionScopes.has(scope),
      ) ||
      new Set(item.scopes).size !== item.scopes.length
    ) {
      return false;
    }
    actions.add(item.action);
  }
  return actions.size === permissionActionValues.length;
}

function isCapabilities(value: unknown): value is OrganizationCapabilities {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'createUser',
      'manageUsers',
      'createTeam',
      'manageTeams',
      'assignDepartmentRoles',
      'assignTeamRoles',
      'manageRoleTemplates',
    ]) &&
    typeof value.createUser === 'boolean' &&
    typeof value.manageUsers === 'boolean' &&
    typeof value.createTeam === 'boolean' &&
    typeof value.manageTeams === 'boolean' &&
    typeof value.assignDepartmentRoles === 'boolean' &&
    typeof value.assignTeamRoles === 'boolean' &&
    typeof value.manageRoleTemplates === 'boolean'
  );
}

function invalidResponse(): ApiError {
  return new ApiError('服务返回了无效的人员管理数据', 200, 'INVALID_RESPONSE');
}

function ensureMutationResult(value: unknown): void {
  if (!isRecord(value) || typeof value.id !== 'string') throw invalidResponse();
}

export async function getOrganizationManagementContext(
  options: RequestOptions = {},
): Promise<OrganizationManagementContext> {
  const data = await getJson('/organization/management-context', options);
  if (
    !isRecord(data) ||
    !hasExactKeys(data, [
      'capabilities',
      'users',
      'teams',
      'roles',
      'permissionCatalog',
    ]) ||
    !isCapabilities(data.capabilities) ||
    !Array.isArray(data.users) ||
    !data.users.every(isUser) ||
    !Array.isArray(data.teams) ||
    !data.teams.every(isTeam) ||
    !Array.isArray(data.roles) ||
    !data.roles.every(isContextRole) ||
    !isPermissionCatalog(data.permissionCatalog)
  ) {
    throw invalidResponse();
  }
  return data as OrganizationManagementContext;
}

function isRoleTemplateImpact(value: unknown): value is RoleTemplateImpact {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'roleTemplateId',
      'version',
      'activeAssignmentCount',
      'affectedUsers',
    ]) &&
    typeof value.roleTemplateId === 'string' &&
    Number.isInteger(value.version) &&
    Number(value.version) >= 1 &&
    Number.isInteger(value.activeAssignmentCount) &&
    Number(value.activeAssignmentCount) >= 0 &&
    Array.isArray(value.affectedUsers) &&
    value.affectedUsers.every(
      (user) =>
        isRecord(user) &&
        hasExactKeys(user, ['id', 'displayName']) &&
        typeof user.id === 'string' &&
        typeof user.displayName === 'string',
    ) &&
    value.affectedUsers.length === value.activeAssignmentCount
  );
}

export async function getRoleTemplateImpact(
  roleTemplateId: string,
  options: RequestOptions = {},
): Promise<RoleTemplateImpact> {
  const data = await getJson(
    `/organization/role-templates/${encodeURIComponent(roleTemplateId)}/impact`,
    options,
  );
  if (!isRoleTemplateImpact(data)) throw invalidResponse();
  return data;
}

export async function copyRoleTemplate(
  input: CopyRoleTemplateInput,
): Promise<OrganizationRole> {
  const data = await requestJson('/organization/role-templates', {
    method: 'POST',
    body: input,
  });
  if (!isRole(data)) throw invalidResponse();
  return data;
}

export async function updateRoleTemplate(
  roleTemplateId: string,
  input: UpdateRoleTemplateInput,
): Promise<OrganizationRole> {
  const data = await requestJson(
    `/organization/role-templates/${encodeURIComponent(roleTemplateId)}`,
    { method: 'PATCH', body: input },
  );
  if (!isRole(data)) throw invalidResponse();
  return data;
}

export async function createOrganizationUser(input: {
  displayName: string;
  username: string;
  password: string;
  teamId: string | null;
  roleTemplateId: string;
}): Promise<void> {
  ensureMutationResult(
    await requestJson('/organization/users', { method: 'POST', body: input }),
  );
}

export async function setOrganizationUserStatus(
  userId: string,
  active: boolean,
): Promise<void> {
  ensureMutationResult(
    await requestJson(
      `/organization/users/${encodeURIComponent(userId)}/status`,
      { method: 'PATCH', body: { active } },
    ),
  );
}

export async function resetOrganizationUserPassword(
  userId: string,
  newPassword: string,
): Promise<void> {
  const result = await requestJson(
    `/organization/users/${encodeURIComponent(userId)}/password-reset`,
    { method: 'POST', body: { newPassword } },
  );
  if (
    !isRecord(result) ||
    typeof result.id !== 'string' ||
    result.passwordReset !== true
  ) {
    throw invalidResponse();
  }
}

export async function updateOrganizationMembership(
  userId: string,
  change: { active: boolean } | { teamId: string | null },
): Promise<void> {
  ensureMutationResult(
    await requestJson(
      `/organization/users/${encodeURIComponent(userId)}/membership`,
      { method: 'PATCH', body: change },
    ),
  );
}

export async function assignOrganizationRole(
  userId: string,
  input: { roleTemplateId: string; teamId: string | null },
): Promise<void> {
  ensureMutationResult(
    await requestJson(
      `/organization/users/${encodeURIComponent(userId)}/role-assignments`,
      { method: 'POST', body: input },
    ),
  );
}

export async function setOrganizationRoleAssignmentStatus(
  userId: string,
  assignmentId: string,
  active: boolean,
): Promise<void> {
  ensureMutationResult(
    await requestJson(
      `/organization/users/${encodeURIComponent(userId)}/role-assignments/${encodeURIComponent(assignmentId)}`,
      { method: 'PATCH', body: { active } },
    ),
  );
}

export async function createOrganizationTeam(name: string): Promise<void> {
  ensureMutationResult(
    await requestJson('/organization/teams', {
      method: 'POST',
      body: { name },
    }),
  );
}

export async function setOrganizationTeamStatus(
  teamId: string,
  status: 'ACTIVE' | 'INACTIVE',
): Promise<void> {
  ensureMutationResult(
    await requestJson(
      `/organization/teams/${encodeURIComponent(teamId)}/status`,
      { method: 'PATCH', body: { status } },
    ),
  );
}
