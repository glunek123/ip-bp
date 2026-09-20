import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const permissionActions = [
  'CUSTOMER_READ',
  'CUSTOMER_CREATE_DRAFT',
  'CUSTOMER_EDIT_ROUTINE',
  'USER_READ',
  'USER_MANAGE',
  'TEAM_READ',
  'TEAM_MANAGE',
  'ROLE_READ',
  'ROLE_ASSIGN',
  'ROLE_MANAGE',
] as const;

export class OrganizationCapabilitiesResponseDto {
  @ApiProperty() createUser!: boolean;
  @ApiProperty() manageUsers!: boolean;
  @ApiProperty() createTeam!: boolean;
  @ApiProperty() manageTeams!: boolean;
  @ApiProperty() assignDepartmentRoles!: boolean;
  @ApiProperty() assignTeamRoles!: boolean;
  @ApiProperty() manageRoleTemplates!: boolean;
}

export class OrganizationGrantResponseDto {
  @ApiProperty({ enum: permissionActions }) action!: string;
  @ApiProperty({ enum: ['SELF', 'TEAM', 'DEPARTMENT'] }) scope!: string;
}

export class OrganizationRoleResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiProperty({ minimum: 0 }) activeAssignmentCount!: number;
  @ApiProperty({ type: () => [OrganizationGrantResponseDto] })
  grants!: OrganizationGrantResponseDto[];
}

export class OrganizationPermissionCatalogResponseDto {
  @ApiProperty({ enum: permissionActions }) action!: string;
  @ApiProperty() label!: string;
  @ApiProperty({ enum: ['SELF', 'TEAM', 'DEPARTMENT'], isArray: true })
  scopes!: string[];
}

export class OrganizationTeamResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) departmentId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] })
  status!: 'ACTIVE' | 'INACTIVE';
}

export class OrganizationContextTeamResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] })
  status!: 'ACTIVE' | 'INACTIVE';
}

export class OrganizationMembershipResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiPropertyOptional({ format: 'uuid' }) departmentId?: string;
  @ApiProperty() active!: boolean;
  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  teamId!: string | null;
}

export class OrganizationRoleAssignmentResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() active!: boolean;
  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  teamId!: string | null;
  @ApiProperty({ minimum: 1 }) version!: number;
}

export class OrganizationContextAssignmentResponseDto extends OrganizationRoleAssignmentResponseDto {
  @ApiProperty({ format: 'uuid' }) roleTemplateId!: string;
  @ApiProperty() roleName!: string;
}

export class OrganizationContextUserResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty() username!: string;
  @ApiProperty() accountActive!: boolean;
  @ApiProperty({ type: () => OrganizationMembershipResponseDto })
  membership!: OrganizationMembershipResponseDto;
  @ApiProperty({ type: () => [OrganizationContextAssignmentResponseDto] })
  assignments!: OrganizationContextAssignmentResponseDto[];
}

export class OrganizationManagementContextResponseDto {
  @ApiProperty({ type: () => OrganizationCapabilitiesResponseDto })
  capabilities!: OrganizationCapabilitiesResponseDto;
  @ApiProperty({ type: () => [OrganizationContextUserResponseDto] })
  users!: OrganizationContextUserResponseDto[];
  @ApiProperty({ type: () => [OrganizationContextTeamResponseDto] })
  teams!: OrganizationContextTeamResponseDto[];
  @ApiProperty({ type: () => [OrganizationRoleResponseDto] })
  roles!: OrganizationRoleResponseDto[];
  @ApiProperty({ type: () => [OrganizationPermissionCatalogResponseDto] })
  permissionCatalog!: OrganizationPermissionCatalogResponseDto[];
}

export class RoleTemplateAffectedUserResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
}

export class RoleTemplateImpactResponseDto {
  @ApiProperty({ format: 'uuid' }) roleTemplateId!: string;
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiProperty({ minimum: 0 }) activeAssignmentCount!: number;
  @ApiProperty({ type: () => [RoleTemplateAffectedUserResponseDto] })
  affectedUsers!: RoleTemplateAffectedUserResponseDto[];
}

export class CreateOrganizationUserResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty() username!: string;
  @ApiProperty() accountActive!: boolean;
  @ApiProperty({ type: () => OrganizationMembershipResponseDto })
  membership!: OrganizationMembershipResponseDto;
  @ApiProperty({ type: () => OrganizationRoleAssignmentResponseDto })
  assignment!: OrganizationRoleAssignmentResponseDto;
}

export class OrganizationUserStatusResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() active!: boolean;
  @ApiProperty({ minimum: 1 }) authorizationRevision!: number;
}

export class OrganizationPasswordResetResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: [true] }) passwordReset!: true;
}
