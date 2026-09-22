import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PermissionScope } from '../generated/prisma/enums';
import {
  internalAssignablePermissionActions,
  type InternalAssignablePermissionAction,
} from './permission-catalog';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class RoleGrantInputDto {
  @ApiProperty({ enum: internalAssignablePermissionActions })
  @IsIn(internalAssignablePermissionActions)
  action!: InternalAssignablePermissionAction;

  @ApiProperty({ enum: PermissionScope })
  @IsEnum(PermissionScope)
  scope!: PermissionScope;
}

export class CopyRoleTemplateDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  sourceRoleTemplateId!: string;

  @ApiProperty({ minLength: 1, maxLength: 100 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ type: () => [RoleGrantInputDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RoleGrantInputDto)
  grants!: RoleGrantInputDto[];
}

export class UpdateRoleTemplateDto {
  @ApiProperty({ minLength: 1, maxLength: 100 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ type: () => [RoleGrantInputDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RoleGrantInputDto)
  grants!: RoleGrantInputDto[];

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
