import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LAWYER_BACKFILL_STAGES } from './case-lawyer-assignable';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class AssignCaseLawyerDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ minLength: 1, maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      '承办律师档案；与 lawyerAccountId 至少提供一个，同时提供时必须指向同一律师',
  })
  @IsOptional()
  @IsString()
  @Matches(uuid)
  lawyerProfileId?: string;
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      '律师登录账号；仅用于兼容旧调用方，无账号律师不传。账号停用不参与承办校验',
  })
  @IsOptional()
  @IsString()
  @Matches(uuid)
  lawyerAccountId?: string;
}

export class AssignmentViewDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) lawyerProfileId!: string;
  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: '未开通账号的律师为 null',
  })
  lawyerAccountId!: string | null;
  @ApiProperty({ format: 'date-time' }) assignedAt!: string;
}

export class AssignCaseLawyerResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({
    enum: [...LAWYER_BACKFILL_STAGES],
    description: '指派不推进阶段；补指派可发生在任一阶段',
  })
  stage!: (typeof LAWYER_BACKFILL_STAGES)[number];
  @ApiProperty() version!: number;
  @ApiProperty({ enum: ['ASSIGNED', 'NO_CHANGE', 'SKIPPED', 'REASSIGNED'] })
  outcome!: 'ASSIGNED' | 'NO_CHANGE' | 'SKIPPED' | 'REASSIGNED';
  @ApiProperty({ format: 'uuid' }) requestedLawyerProfileId!: string;
  @ApiProperty({ format: 'uuid', nullable: true })
  requestedLawyerAccountId!: string | null;
  @ApiProperty({ type: AssignmentViewDto, nullable: true })
  currentAssignment!: AssignmentViewDto | null;
  @ApiProperty({ type: AssignmentViewDto, nullable: true })
  previousAssignment!: AssignmentViewDto | null;
}
