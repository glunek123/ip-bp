import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateBy,
} from 'class-validator';
import { CaseStage } from '../../generated/prisma/enums';

export function isHandlingGroupKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    Array.from(value).length >= 1 &&
    Array.from(value).length <= 128
  );
}
const handlingGroupKey = () =>
  ValidateBy({
    name: 'handlingGroupKey',
    validator: { validate: isHandlingGroupKey },
  });

export class CreateCaseHandlingGroupDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() groupId!: string;
  @ApiProperty({ type: [String], minItems: 2, maxItems: 20 })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(20)
  @IsUUID(undefined, { each: true })
  @ArrayUnique((value: unknown) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  caseIds!: string[];
  @ApiProperty({ minLength: 1, maxLength: 128 })
  @IsString()
  @handlingGroupKey()
  idempotencyKey!: string;
}
export class DissolveCaseHandlingGroupDto {
  @ApiProperty({ minimum: 1, maximum: 2147483646 })
  @IsInt()
  @Min(1)
  @Max(2147483646)
  expectedRevision!: number;
  @ApiProperty({ minLength: 1, maxLength: 128 })
  @IsString()
  @handlingGroupKey()
  idempotencyKey!: string;
}
export class CaseHandlingGroupResultDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ minimum: 1 }) revision!: number;
  @ApiProperty({ enum: ['ACTIVE', 'DISSOLVED'] }) status!:
    'ACTIVE' | 'DISSOLVED';
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
}
export class CaseHandlingGroupPageQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}
export class CaseHandlingGroupCandidateQueryDto extends CaseHandlingGroupPageQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string;
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(200)
  q?: string;
}
export class CaseHandlingGroupMemberDto {
  @ApiProperty({ format: 'uuid' }) caseId!: string;
  @ApiProperty() businessNo!: string;
  @ApiProperty({ format: 'uuid' }) customerId!: string;
  @ApiProperty() customerName!: string;
  @ApiProperty({ enum: CaseStage }) stage!: CaseStage;
}
export class CaseHandlingGroupCapabilityDto {
  @ApiProperty() canCreate!: boolean;
}
export class CaseHandlingGroupDetailDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ minimum: 1 }) revision!: number;
  @ApiProperty({ enum: ['ACTIVE', 'DISSOLVED'] }) status!:
    'ACTIVE' | 'DISSOLVED';
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: [CaseHandlingGroupMemberDto] })
  members!: CaseHandlingGroupMemberDto[];
  @ApiProperty() canDissolve!: boolean;
}
export class CaseHandlingGroupListDto {
  @ApiProperty({ type: [CaseHandlingGroupDetailDto] })
  items!: CaseHandlingGroupDetailDto[];
  @ApiProperty({ minimum: 0 }) total!: number;
  @ApiProperty({ minimum: 1 }) page!: number;
  @ApiProperty({ minimum: 1, maximum: 100 }) pageSize!: number;
}
export class CaseHandlingGroupCandidatesDto {
  @ApiProperty({ type: [CaseHandlingGroupMemberDto] })
  items!: CaseHandlingGroupMemberDto[];
  @ApiProperty({ minimum: 0 }) total!: number;
  @ApiProperty({ minimum: 1 }) page!: number;
  @ApiProperty({ minimum: 1, maximum: 100 }) pageSize!: number;
}
