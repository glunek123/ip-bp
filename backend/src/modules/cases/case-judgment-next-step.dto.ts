import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class ChooseJudgmentNextStepDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ minLength: 1, maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') judgmentId!: string;
  @ApiProperty({ enum: ['APPEAL', 'EXECUTION'] })
  @IsIn(['APPEAL', 'EXECUTION'])
  next!: 'APPEAL' | 'EXECUTION';
  @ApiPropertyOptional({ type: Boolean })
  @ValidateIf((input: ChooseJudgmentNextStepDto) => input.next === 'EXECUTION')
  @IsBoolean()
  executionReadinessConfirmed?: boolean;
  @ApiPropertyOptional({ type: Boolean })
  @ValidateIf((input: ChooseJudgmentNextStepDto) => input.next === 'APPEAL')
  @IsBoolean()
  plaintiffAppeals?: boolean;
  @ApiPropertyOptional({ type: [String] })
  @ValidateIf((input: ChooseJudgmentNextStepDto) => input.next === 'APPEAL')
  @IsArray()
  @IsUUID('4', { each: true })
  defendantIds?: string[];
}

export class RevokeJudgmentNextStepDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ minLength: 1, maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') choiceId!: string;
  @ApiProperty({ minLength: 1, maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

export class JudgmentNextStepResultDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['SECOND_INSTANCE', 'WAITING_EXECUTION_DOCUMENTS'] })
  stage!: 'SECOND_INSTANCE' | 'WAITING_EXECUTION_DOCUMENTS';
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'uuid' }) choiceId!: string;
  @ApiProperty({ format: 'uuid' }) judgmentId!: string;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
}

export class RevokeJudgmentNextStepResultDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['WAITING_JUDGMENT'] }) stage!: 'WAITING_JUDGMENT';
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'uuid' }) choiceId!: string;
  @ApiProperty({ format: 'uuid' }) revocationId!: string;
  @ApiProperty({ format: 'uuid' }) judgmentId!: string;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
}
