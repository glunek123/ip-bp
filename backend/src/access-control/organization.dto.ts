import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateOrganizationUserDto {
  @ApiProperty({ maxLength: 100 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  displayName!: string;

  @ApiProperty({ minLength: 3, maxLength: 64 })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  username!: string;

  @ApiProperty({ minLength: 12, maxLength: 128 })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsUUID('4')
  teamId?: string | null;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  roleTemplateId!: string;
}

class ReasonDto {
  @ApiProperty({ maxLength: 500 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

export class SetUserStatusDto extends ReasonDto {
  @ApiProperty()
  @IsBoolean()
  active!: boolean;
}

export class ResetUserPasswordDto extends ReasonDto {
  @ApiProperty({ minLength: 12, maxLength: 128 })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  currentPassword!: string;

  @ApiProperty({ minLength: 12, maxLength: 128 })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  newPassword!: string;
}

export class UpdateMembershipDto extends ReasonDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsUUID('4')
  teamId?: string | null;
}

export class AssignRoleDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  roleTemplateId!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsUUID('4')
  teamId?: string | null;
}

export class SetRoleAssignmentStatusDto extends ReasonDto {
  @ApiProperty()
  @IsBoolean()
  active!: boolean;
}
