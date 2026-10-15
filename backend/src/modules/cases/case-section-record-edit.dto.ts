import { ApiProperty, OmitType } from '@nestjs/swagger';
import {
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MailCaseExecutionDto } from './case-execution-mailing.dto';
import { SubmitCaseExecutionFilingDto } from './case-execution-filing.dto';
import { FinishCaseExecutionDto } from './case-execution-finish.dto';
import { SaveCaseHearingDto } from './case-hearing.dto';
import { RegisterCaseJudgmentDto } from './case-judgment.dto';
import { RecordCaseClosureInput } from './case-closure.dto';

export class CorrectExecutionMailingRecordDto extends OmitType(
  MailCaseExecutionDto,
  ['expectedVersion', 'expectedConfirmationId'] as const,
) {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') mailingId!: string;
  @ApiProperty({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedMailingRevision!: number;
  @ApiProperty({ minLength: 1, maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  @Matches(/\S/u)
  reason!: string;
}
export class CorrectExecutionFilingRecordDto extends OmitType(
  SubmitCaseExecutionFilingDto,
  ['expectedVersion', 'expectedMailingId'] as const,
) {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') filingId!: string;
  @ApiProperty({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedFilingRevision!: number;
  @ApiProperty({ minLength: 1, maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  @Matches(/\S/u)
  reason!: string;
}
export class CorrectExecutionFinishRecordDto extends OmitType(
  FinishCaseExecutionDto,
  ['expectedVersion', 'expectedFilingId'] as const,
) {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') finishId!: string;
  @ApiProperty({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedFinishRevision!: number;
  @ApiProperty({ minLength: 1, maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  @Matches(/\S/u)
  correctionReason!: string;
}
export class CorrectHearingRecordDto extends OmitType(SaveCaseHearingDto, [
  'expectedVersion',
] as const) {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') arrangementId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') trialRoundId!: string;
  @ApiProperty({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedHearingRevision!: number;
  @ApiProperty({ minLength: 1, maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  @Matches(/\S/u)
  reason!: string;
}
export class CorrectJudgmentRecordDto extends OmitType(
  RegisterCaseJudgmentDto,
  ['expectedVersion'] as const,
) {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') judgmentId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') trialRoundId!: string;
  @ApiProperty({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedJudgmentRevision!: number;
  @ApiProperty({ minLength: 1, maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  @Matches(/\S/u)
  reason!: string;
}
export class CorrectClosureRecordDto extends OmitType(RecordCaseClosureInput, [
  'expectedVersion',
  'expectedFinishId',
] as const) {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') closureId!: string;
  @ApiProperty({
    format: 'uuid',
    description:
      '表单读取时的真实结案版本ID；保存时在同案锁内精确核对，不以案件版本或资料revision替代',
  })
  @IsUUID('4')
  expectedClosureVersionId!: string;
  @ApiProperty({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedClosureRevision!: number;
  @ApiProperty({ minLength: 1, maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  @Matches(/\S/u)
  correctionReason!: string;
}

class RecordCorrectionResultDto {
  @ApiProperty({ format: 'uuid' }) caseId!: string;
  @ApiProperty({ format: 'uuid' }) correctionId!: string;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
}
export class ExecutionMailingRecordCorrectionResultDto extends RecordCorrectionResultDto {
  @ApiProperty({ format: 'uuid' }) mailingId!: string;
  @ApiProperty() mailingRevision!: number;
  @ApiProperty({ format: 'date' }) mailedAt!: string;
}
export class ExecutionFilingRecordCorrectionResultDto extends RecordCorrectionResultDto {
  @ApiProperty({ format: 'uuid' }) filingId!: string;
  @ApiProperty() filingRevision!: number;
  @ApiProperty({ format: 'date' }) submittedAt!: string;
}
export class ExecutionFinishRecordCorrectionResultDto extends RecordCorrectionResultDto {
  @ApiProperty({ format: 'uuid' }) finishId!: string;
  @ApiProperty() finishRevision!: number;
  @ApiProperty({ format: 'date' }) finishedAt!: string;
}
export class HearingRecordCorrectionResultDto extends RecordCorrectionResultDto {
  @ApiProperty({ format: 'uuid' }) arrangementId!: string;
  @ApiProperty({ format: 'uuid' }) trialRoundId!: string;
  @ApiProperty() hearingRevision!: number;
  @ApiProperty({ type: String, nullable: true, format: 'date' }) hearingAt!:
    string | null;
}
export class JudgmentRecordCorrectionResultDto extends RecordCorrectionResultDto {
  @ApiProperty({ format: 'uuid' }) judgmentId!: string;
  @ApiProperty({ format: 'uuid' }) trialRoundId!: string;
  @ApiProperty() judgmentRevision!: number;
  @ApiProperty({ format: 'date' }) judgmentReceivedAt!: string;
}
export class ClosureRecordCorrectionResultDto extends RecordCorrectionResultDto {
  @ApiProperty({ format: 'uuid' }) closureId!: string;
  @ApiProperty() closureRevision!: number;
  @ApiProperty({ type: String, nullable: true, format: 'date' }) closeAt!:
    string | null;
}
