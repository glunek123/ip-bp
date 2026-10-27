import { caseArchiveTypes } from './case-archive.dto';
import { ExecutionFilingFollowupsDto } from './case-execution-filing-followup-read.dto';
import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  ValidateIf,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  caseListSortBy,
  caseListCaseTypes,
  caseListSortDirections,
  CaseListTextQuery,
} from './case-list-query';
import { LeadCaseType } from '../../generated/prisma/enums';
import {
  ClosureRecordEditsDto,
  ExecutionFilingRecordEditsDto,
  ExecutionFinishRecordEditsDto,
  ExecutionMailingRecordEditsDto,
  HearingRecordEditsDto,
  JudgmentRecordEditsDto,
} from './case-section-record-edit-read.dto';

class CaseCertificateFileDto {
  @ApiProperty({ format: 'uuid' }) materialId!: string;
  @ApiProperty({ format: 'uuid' }) contentVersionId!: string;
  @ApiProperty() originalFilename!: string;
  @ApiProperty() mimeType!: string;
}
class CaseCertificateSummaryDto {
  @ApiProperty() certificateNo!: string;
  @ApiProperty({ format: 'date' }) certificateDate!: string;
  @ApiProperty({ format: 'date-time' }) issuedAt!: string;
  @ApiProperty() needDisclose!: boolean;
  @ApiProperty({ type: [CaseCertificateFileDto] })
  files!: CaseCertificateFileDto[];
  @ApiProperty({ type: [CaseCertificateFileDto] })
  disclosureFiles!: CaseCertificateFileDto[];
}
class CaseComplaintSummaryDto {
  @ApiProperty({ enum: ['KNOWN', 'PENDING'] }) amountState!:
    'KNOWN' | 'PENDING';
  @ApiProperty({ type: String, nullable: true }) amount!: string | null;
  @ApiProperty({ type: String, nullable: true }) pendingReason!: string | null;
  @ApiProperty({ format: 'date-time' }) submittedAt!: string;
  @ApiProperty({ format: 'uuid' }) submittedByUserId!: string;
  @ApiProperty({ type: [CaseCertificateFileDto] })
  complaintFiles!: CaseCertificateFileDto[];
  @ApiProperty({ type: [CaseCertificateFileDto] })
  authorizationFiles!: CaseCertificateFileDto[];
}
class CaseComplaintConfirmationSummaryDto {
  @ApiProperty({ format: 'uuid' }) confirmedComplaintContentVersionId!: string;
  @ApiProperty({ enum: ['KNOWN', 'PENDING'] }) amountState!:
    'KNOWN' | 'PENDING';
  @ApiProperty({ type: String, nullable: true }) amount!: string | null;
  @ApiProperty({ type: String, nullable: true }) pendingReason!: string | null;
  @ApiProperty({ type: String, nullable: true }) changeNote!: string | null;
  @ApiProperty() confirmDisclose!: boolean;
  @ApiProperty({ format: 'date-time' }) confirmedAt!: string;
  @ApiProperty({ format: 'uuid' }) confirmedByUserId!: string;
  @ApiProperty({ type: CaseCertificateFileDto, nullable: true })
  complaintFile!: CaseCertificateFileDto | null;
}
class CaseComplaintMailingSummaryDto {
  @ApiProperty({ format: 'date' }) mailedAt!: string;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
  @ApiProperty({ format: 'uuid' }) recordedByUserId!: string;
  @ApiProperty({ enum: ['INTERNAL', 'CLIENT', 'LAWYER'] }) actorType!:
    'INTERNAL' | 'CLIENT' | 'LAWYER';
  @ApiProperty({ type: [CaseCertificateFileDto] })
  receiptFiles!: CaseCertificateFileDto[];
}
class CaseFilingCourtDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
}
class CaseFilingSubmissionSummaryDto {
  @ApiProperty({ type: CaseFilingCourtDto }) court!: CaseFilingCourtDto;
  @ApiProperty({ format: 'date' }) submittedAt!: string;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
  @ApiProperty({ format: 'uuid' }) recordedByUserId!: string;
  @ApiProperty({ type: String, nullable: true }) mediationNo!: string | null;
  @ApiProperty({ type: [CaseCertificateFileDto] })
  evidenceFiles!: CaseCertificateFileDto[];
  @ApiProperty({ type: [CaseCertificateFileDto] })
  screenshotFiles!: CaseCertificateFileDto[];
}
class CaseAcceptanceFileDto extends CaseCertificateFileDto {
  @ApiProperty({
    enum: ['ACCEPTANCE_NOTICE', 'PAYMENT_LIST', 'SERVICE_DOCUMENT'],
  })
  category!: 'ACCEPTANCE_NOTICE' | 'PAYMENT_LIST' | 'SERVICE_DOCUMENT';
}
class CaseAcceptanceSummaryDto {
  @ApiPropertyOptional({ type: String, nullable: true, format: 'date' })
  paymentDueAt?: string | null;
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) trialRoundId!: string;
  @ApiProperty({ format: 'date' }) acceptedAt!: string;
  @ApiProperty() courtCaseNo!: string;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
  @ApiProperty({ format: 'uuid', required: false }) recordedByUserId?: string;
  @ApiProperty({ type: [CaseAcceptanceFileDto] })
  files!: CaseAcceptanceFileDto[];
}
class CaseAcceptanceMaterialGroupDto {
  @ApiProperty({ type: [CaseCertificateFileDto] })
  available!: CaseCertificateFileDto[];
  @ApiProperty({ type: [CaseCertificateFileDto] })
  frozen!: CaseCertificateFileDto[];
  @ApiProperty({ type: [CaseCertificateFileDto] })
  later!: CaseCertificateFileDto[];
}
class CaseAcceptanceMaterialsDto {
  @ApiProperty({ type: CaseAcceptanceMaterialGroupDto })
  ACCEPTANCE_NOTICE!: CaseAcceptanceMaterialGroupDto;
  @ApiProperty({ type: CaseAcceptanceMaterialGroupDto })
  PAYMENT_LIST!: CaseAcceptanceMaterialGroupDto;
  @ApiProperty({ type: CaseAcceptanceMaterialGroupDto })
  SERVICE_DOCUMENT!: CaseAcceptanceMaterialGroupDto;
}

class CaseHearingArrangementDto {
  @ApiPropertyOptional({ type: String, nullable: true }) hearingPlace?:
    string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) judgeName?:
    string | null;
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) trialRoundId!: string;
  @ApiProperty({ type: String, nullable: true, format: 'date' }) hearingAt!:
    string | null;
  @ApiProperty({ enum: ['SCHEDULE', 'CORRECTION'] }) source!:
    'SCHEDULE' | 'CORRECTION';
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
  @ApiPropertyOptional({ format: 'uuid' }) recordedByUserId?: string;
}
class CaseHearingAdvanceDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) trialRoundId!: string;
  @ApiProperty({ format: 'uuid' }) arrangementId!: string;
  @ApiProperty({ format: 'date-time' }) dueAt!: string;
  @ApiProperty({ format: 'date-time' }) executedAt!: string;
}
class CaseHearingCorrectionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) priorArrangementId!: string;
  @ApiProperty({ format: 'uuid' }) priorAdvanceId!: string;
  @ApiProperty({ format: 'uuid' }) newArrangementId!: string;
  @ApiProperty({ enum: ['WAITING_HEARING', 'WAITING_JUDGMENT'] }) resultStage!:
    'WAITING_HEARING' | 'WAITING_JUDGMENT';
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
  @ApiPropertyOptional() reason?: string;
  @ApiPropertyOptional({ format: 'uuid' }) recordedByUserId?: string;
}
class CaseHearingDto {
  @ApiProperty({ type: CaseHearingArrangementDto, nullable: true })
  currentArrangement!: CaseHearingArrangementDto | null;
  @ApiProperty({ type: CaseHearingAdvanceDto, nullable: true })
  currentAdvance!: CaseHearingAdvanceDto | null;
  @ApiProperty({ type: [CaseHearingArrangementDto] })
  arrangements!: CaseHearingArrangementDto[];
  @ApiProperty({ type: [CaseHearingAdvanceDto] })
  advances!: CaseHearingAdvanceDto[];
  @ApiProperty({ type: [CaseHearingCorrectionDto] })
  corrections!: CaseHearingCorrectionDto[];
}

class CaseJudgmentFactDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) trialRoundId!: string;
  @ApiProperty({ enum: ['REGISTER', 'CORRECT'] }) kind!: 'REGISTER' | 'CORRECT';
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) priorFactId!:
    string | null;
  @ApiProperty({ format: 'date' }) judgmentReceivedAt!: string;
  @ApiProperty({ enum: ['KNOWN', 'PENDING'] }) judgmentAmountState!:
    'KNOWN' | 'PENDING';
  @ApiProperty({ type: String, nullable: true }) judgmentAmount!: string | null;
  @ApiProperty({ enum: ['KNOWN', 'PENDING'] }) paidLitigationFeeState!:
    'KNOWN' | 'PENDING';
  @ApiProperty({ type: String, nullable: true }) paidLitigationFee!:
    string | null;
  @ApiProperty() fromVersion!: number;
  @ApiProperty() toVersion!: number;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) reason?: string | null;
  @ApiPropertyOptional({ format: 'uuid' }) recordedByUserId?: string;
  @ApiProperty({ type: [CaseCertificateFileDto] })
  files!: CaseCertificateFileDto[];
}
class CaseJudgmentDto {
  @ApiProperty({ type: CaseJudgmentFactDto, nullable: true })
  current!: CaseJudgmentFactDto | null;
  @ApiProperty({ type: [CaseJudgmentFactDto] }) history!: CaseJudgmentFactDto[];
  @ApiProperty({ type: [CaseCertificateFileDto] })
  availableFiles!: CaseCertificateFileDto[];
}

class CaseJudgmentAppealDefendantDto {
  @ApiProperty({ format: 'uuid' }) defendantId!: string;
  @ApiProperty() nameSnapshot!: string;
}
class CaseJudgmentNextStepChoiceDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) trialRoundId!: string;
  @ApiProperty({ format: 'uuid' }) judgmentId!: string;
  @ApiProperty({ enum: ['APPEAL', 'EXECUTION'] }) next!: 'APPEAL' | 'EXECUTION';
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  plaintiffRightsHolderId!: string | null;
  @ApiProperty({ type: String, nullable: true }) plaintiffName!: string | null;
  @ApiProperty({ type: [CaseJudgmentAppealDefendantDto] })
  defendants!: CaseJudgmentAppealDefendantDto[];
  @ApiProperty() executionReadinessConfirmed!: boolean;
  @ApiProperty() fromVersion!: number;
  @ApiProperty() toVersion!: number;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
  @ApiPropertyOptional({ format: 'uuid' }) recordedByUserId?: string;
}
class CaseJudgmentNextStepRevocationDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) choiceId!: string;
  @ApiProperty() fromVersion!: number;
  @ApiProperty() toVersion!: number;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
  @ApiPropertyOptional() reason?: string;
  @ApiPropertyOptional({ format: 'uuid' }) recordedByUserId?: string;
}
class CaseJudgmentNextStepDto {
  @ApiProperty({ type: CaseJudgmentNextStepChoiceDto, nullable: true })
  current!: CaseJudgmentNextStepChoiceDto | null;
  @ApiProperty({ type: [CaseJudgmentNextStepChoiceDto] })
  history!: CaseJudgmentNextStepChoiceDto[];
  @ApiProperty({ type: [CaseJudgmentNextStepRevocationDto] })
  revocations!: CaseJudgmentNextStepRevocationDto[];
}

class CaseSecondInstanceProgressSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) trialRoundId!: string;
  @ApiProperty({ format: 'uuid' }) choiceId!: string;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  priorProgressId!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date' }) hearingAt!:
    string | null;
  @ApiProperty({ type: String, nullable: true }) hearingPlace!: string | null;
  @ApiProperty({ type: String, nullable: true }) judgeName!: string | null;
  @ApiProperty() fromVersion!: number;
  @ApiProperty() toVersion!: number;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
  @ApiPropertyOptional({ format: 'uuid' }) recordedByUserId?: string;
  @ApiProperty({ type: [CaseCertificateFileDto] })
  documentFiles!: CaseCertificateFileDto[];
  @ApiProperty({ type: [CaseCertificateFileDto] })
  serviceFiles!: CaseCertificateFileDto[];
}
class CaseSecondInstanceResultSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) trialRoundId!: string;
  @ApiProperty({ format: 'uuid' }) choiceId!: string;
  @ApiProperty({ format: 'uuid' }) judgmentId!: string;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) progressId!:
    string | null;
  @ApiProperty({ enum: ['REMAND', 'CHANGE', 'AFFIRM'] }) result!:
    'REMAND' | 'CHANGE' | 'AFFIRM';
  @ApiProperty({ format: 'date' }) resultReceivedAt!: string;
  @ApiProperty({ enum: ['KNOWN', 'PENDING'], nullable: true })
  judgmentAmountState!: 'KNOWN' | 'PENDING' | null;
  @ApiProperty({ type: String, nullable: true }) judgmentAmount!: string | null;
  @ApiProperty({ enum: ['KNOWN', 'PENDING'] }) paidLitigationFeeState!:
    'KNOWN' | 'PENDING';
  @ApiProperty({ type: String, nullable: true }) paidLitigationFee!:
    string | null;
  @ApiProperty() fromVersion!: number;
  @ApiProperty() toVersion!: number;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
  @ApiPropertyOptional({ format: 'uuid' }) recordedByUserId?: string;
  @ApiProperty({ type: [CaseCertificateFileDto] })
  files!: CaseCertificateFileDto[];
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  childTrialRoundId!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) revocationId!:
    string | null;
}
class CaseSecondInstanceRevocationSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) resultId!: string;
  @ApiProperty() fromVersion!: number;
  @ApiProperty() toVersion!: number;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
  @ApiPropertyOptional() reason?: string;
  @ApiPropertyOptional({ format: 'uuid' }) recordedByUserId?: string;
}
class CaseSecondInstanceRoundDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() sequence!: number;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  sourceResultId!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  revokedAt!: string | null;
}
class CaseSecondInstanceAcceptanceSummaryDto {
  @ApiProperty({ format: 'uuid' }) choiceId!: string;
  @ApiProperty({ format: 'uuid' }) trialRoundId!: string;
  @ApiProperty({ type: String, nullable: true, format: 'date' }) acceptedAt!:
    string | null;
  @ApiProperty({ type: String, nullable: true }) courtCaseNo!: string | null;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
}
class CaseSecondInstanceDto {
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  currentTrialRoundId!: string | null;
  @ApiProperty({ type: CaseSecondInstanceProgressSummaryDto, nullable: true })
  currentProgress!: CaseSecondInstanceProgressSummaryDto | null;
  @ApiProperty({ type: CaseSecondInstanceResultSummaryDto, nullable: true })
  currentResult!: CaseSecondInstanceResultSummaryDto | null;
  @ApiProperty({ type: [CaseSecondInstanceRoundDto] })
  rounds!: CaseSecondInstanceRoundDto[];
  @ApiProperty({ type: [CaseSecondInstanceProgressSummaryDto] })
  progresses!: CaseSecondInstanceProgressSummaryDto[];
  @ApiProperty({ type: [CaseSecondInstanceResultSummaryDto] })
  results!: CaseSecondInstanceResultSummaryDto[];
  @ApiProperty({ type: [CaseSecondInstanceRevocationSummaryDto] })
  revocations!: CaseSecondInstanceRevocationSummaryDto[];
  @ApiPropertyOptional({ type: [CaseSecondInstanceAcceptanceSummaryDto] })
  acceptances?: CaseSecondInstanceAcceptanceSummaryDto[];
}

export class CasePageQueryDto implements CaseListTextQuery {
  @ApiPropertyOptional({ maxLength: 200 })
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(200)
  shopName?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(200)
  defendantName?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(200)
  courtName?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(200)
  lawyerName?: string;

  @ApiPropertyOptional({ enum: caseListCaseTypes })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @IsIn(caseListCaseTypes)
  caseType?: LeadCaseType;

  @ApiPropertyOptional({ enum: ['mine', 'department'], default: 'department' })
  @IsOptional()
  @IsIn(['mine', 'department'])
  view: 'mine' | 'department' = 'department';
  @ApiPropertyOptional({
    enum: [
      'PENDING_MATCH',
      'WAITING_COMPLAINT',
      'WAITING_COMPLAINT_CONFIRMATION',
      'WAITING_COMPLAINT_STAMP',
      'WAITING_FILING',
      'WAITING_FORMAL_ACCEPTANCE',
      'WAITING_HEARING',
      'WAITING_JUDGMENT',
      'SECOND_INSTANCE',
      'WAITING_EXECUTION_DOCUMENTS',
      'WAITING_EXECUTION_CONFIRMATION',
      'WAITING_EXECUTION_STAMP',
      'WAITING_EXECUTION_FILING',
      'EXECUTING',
      'WAITING_ARCHIVE',
      'ARCHIVED',
    ],
  })
  @IsOptional()
  @IsIn([
    'PENDING_MATCH',
    'WAITING_COMPLAINT',
    'WAITING_COMPLAINT_CONFIRMATION',
    'WAITING_COMPLAINT_STAMP',
    'WAITING_FILING',
    'WAITING_FORMAL_ACCEPTANCE',
    'WAITING_HEARING',
    'WAITING_JUDGMENT',
    'SECOND_INSTANCE',
    'WAITING_EXECUTION_DOCUMENTS',
    'WAITING_EXECUTION_CONFIRMATION',
    'WAITING_EXECUTION_STAMP',
    'WAITING_EXECUTION_FILING',
    'EXECUTING',
    'WAITING_ARCHIVE',
    'ARCHIVED',
  ])
  stage?:
    | 'PENDING_MATCH'
    | 'WAITING_COMPLAINT'
    | 'WAITING_COMPLAINT_CONFIRMATION'
    | 'WAITING_COMPLAINT_STAMP'
    | 'WAITING_FILING'
    | 'WAITING_FORMAL_ACCEPTANCE'
    | 'WAITING_HEARING'
    | 'WAITING_JUDGMENT'
    | 'SECOND_INSTANCE'
    | 'WAITING_EXECUTION_DOCUMENTS'
    | 'WAITING_EXECUTION_CONFIRMATION'
    | 'WAITING_EXECUTION_STAMP'
    | 'WAITING_EXECUTION_FILING'
    | 'EXECUTING'
    | 'WAITING_ARCHIVE'
    | 'ARCHIVED';
  @ApiPropertyOptional({
    enum: ['COMPLAINT_PREPARATION', 'EXECUTION_PREPARATION'],
  })
  @IsOptional()
  @IsIn(['COMPLAINT_PREPARATION', 'EXECUTION_PREPARATION'])
  stageGroup?: 'COMPLAINT_PREPARATION' | 'EXECUTION_PREPARATION';
  @ApiPropertyOptional({
    maxLength: 200,
    description: '编号、案号、客户、权利主体、被告',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(200)
  q?: string;
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(200)
  customerName?: string;
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(200)
  rightsHolderName?: string;
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(200)
  courtCaseNo?: string;
  @ApiPropertyOptional({ enum: caseListSortBy, default: 'createdAt' })
  @IsOptional()
  @IsIn(caseListSortBy)
  sortBy?: (typeof caseListSortBy)[number];
  @ApiPropertyOptional({ enum: caseListSortDirections, default: 'desc' })
  @IsOptional()
  @IsIn(caseListSortDirections)
  sortDirection?: (typeof caseListSortDirections)[number];
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
class CaseSourceDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() businessNo!: string;
}
class CaseNamedDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
}
class CaseDisplayAmountDto {
  @ApiProperty({ enum: ['UNRECORDED', 'PENDING', 'KNOWN'] }) state!:
    'UNRECORDED' | 'PENDING' | 'KNOWN';
  @ApiProperty({ type: String, nullable: true }) amount!: string | null;
  @ApiProperty({
    enum: [
      'COMPLAINT_CONFIRMATION',
      'COMPLAINT_SUBMISSION',
      'FIRST_INSTANCE_JUDGMENT',
      'FIRST_INSTANCE_JUDGMENT_RECORD_CORRECTION',
      'SECOND_INSTANCE_RESULT',
      'CASE_CLOSURE_VERSION',
      'CASE_CLOSURE_RECORD_CORRECTION',
    ],
    nullable: true,
  })
  sourceType!:
    | 'COMPLAINT_CONFIRMATION'
    | 'COMPLAINT_SUBMISSION'
    | 'FIRST_INSTANCE_JUDGMENT'
    | 'FIRST_INSTANCE_JUDGMENT_RECORD_CORRECTION'
    | 'SECOND_INSTANCE_RESULT'
    | 'CASE_CLOSURE_VERSION'
    | 'CASE_CLOSURE_RECORD_CORRECTION'
    | null;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) sourceId!:
    string | null;
}
class CaseDisplaySourceDto {
  @ApiProperty({
    enum: [
      'TAOBAO',
      'TMALL',
      'PINDUODUO',
      'JD',
      'DOUYIN',
      'ALIBABA_1688',
      'XIAOHONGSHU',
      'KUAISHOU',
      'XIANYU',
      'WECHAT',
      'MEITUAN',
      'DIANPING',
      'MAP',
      'OTHER',
    ],
  })
  platform!: string;
  @ApiProperty() shopName!: string;
  @ApiProperty({ type: String, nullable: true }) shopExternalId!: string | null;
}
class CaseDisplayPartyDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
}
class CaseDisplayLawyerDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() fullName!: string;
}
class CaseDisplaySummaryDto {
  @ApiProperty() customerName!: string;
  @ApiProperty() rightsHolderName!: string;
  @ApiProperty({ type: CaseDisplaySourceDto }) source!: CaseDisplaySourceDto;
  @ApiProperty({ type: [CaseDisplayPartyDto] })
  defendants!: CaseDisplayPartyDto[];
  @ApiProperty({ type: [CaseDisplayLawyerDto] })
  lawyers!: CaseDisplayLawyerDto[];
  @ApiProperty({ type: CaseFilingCourtDto, nullable: true })
  court!: CaseFilingCourtDto | null;
  @ApiProperty({ type: String, nullable: true }) courtCaseNo!: string | null;
  @ApiProperty({ type: CaseDisplayAmountDto })
  claimAmount!: CaseDisplayAmountDto;
  @ApiProperty({ type: CaseDisplayAmountDto })
  judgmentAmount!: CaseDisplayAmountDto;
  @ApiProperty({ type: CaseDisplayAmountDto })
  closureAmount!: CaseDisplayAmountDto;
}
class CaseClosureVersionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['REGISTER', 'CORRECT'] }) kind!: 'REGISTER' | 'CORRECT';
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  priorVersionId!: string | null;
  @ApiProperty({ format: 'uuid' }) finishId!: string;
  @ApiProperty() fromVersion!: number;
  @ApiProperty() toVersion!: number;
  @ApiProperty({ type: String, nullable: true, format: 'date' }) closeAt!:
    string | null;
  @ApiProperty({ enum: ['KNOWN', 'PENDING'] }) closeAmountState!:
    'KNOWN' | 'PENDING';
  @ApiProperty({ type: String, nullable: true }) closeAmt!: string | null;
  @ApiProperty({ type: String, nullable: true }) note!: string | null;
  @ApiProperty({ type: String, nullable: true }) correctionReason!:
    string | null;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
  @ApiProperty({ format: 'uuid' }) recordedByUserId!: string;
  @ApiProperty({ type: [CaseCertificateFileDto] })
  files!: CaseCertificateFileDto[];
}
class CaseArchiveVersionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['ARCHIVE', 'CORRECT'] }) kind!: 'ARCHIVE' | 'CORRECT';
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  priorVersionId!: string | null;
  @ApiProperty({ format: 'uuid' }) closureVersionId!: string;
  @ApiProperty() fromVersion!: number;
  @ApiProperty() toVersion!: number;
  @ApiProperty({ format: 'date' }) archiveAt!: string;
  @ApiProperty({ enum: caseArchiveTypes })
  archiveType!: (typeof caseArchiveTypes)[number];
  @ApiProperty() archiveReason!: string;
  @ApiProperty({ type: String, nullable: true }) correctionReason!:
    string | null;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
  @ApiProperty({ format: 'uuid' }) recordedByUserId!: string;
}
class CaseArchiveDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) closureId!: string;
  @ApiProperty({ format: 'uuid' }) closureVersionId!: string;
  @ApiProperty({ type: CaseArchiveVersionDto }) current!: CaseArchiveVersionDto;
  @ApiProperty({ type: [CaseArchiveVersionDto] })
  history!: CaseArchiveVersionDto[];
}
class CaseEarlyArchiveDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() fromStage!: string;
  @ApiProperty() fromVersion!: number;
  @ApiProperty() toVersion!: number;
  @ApiProperty({ format: 'date' }) archiveAt!: string;
  @ApiProperty() reason!: string;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
  @ApiProperty({ format: 'uuid' }) recordedByUserId!: string;
}
class CaseClosureDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) finishId!: string;
  @ApiProperty({ type: CaseClosureVersionDto }) current!: CaseClosureVersionDto;
  @ApiProperty({ type: [CaseClosureVersionDto] })
  history!: CaseClosureVersionDto[];
}
class CaseOwnerDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
}
class CaseListItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() businessNo!: string;
  @ApiProperty({
    enum: [
      'PENDING_MATCH',
      'WAITING_COMPLAINT',
      'WAITING_COMPLAINT_CONFIRMATION',
      'WAITING_COMPLAINT_STAMP',
      'WAITING_FILING',
      'WAITING_FORMAL_ACCEPTANCE',
      'WAITING_HEARING',
      'WAITING_JUDGMENT',
      'SECOND_INSTANCE',
      'WAITING_EXECUTION_DOCUMENTS',
      'WAITING_EXECUTION_CONFIRMATION',
      'WAITING_EXECUTION_STAMP',
      'WAITING_EXECUTION_FILING',
      'EXECUTING',
      'WAITING_ARCHIVE',
      'ARCHIVED',
    ],
  })
  stage!:
    | 'PENDING_MATCH'
    | 'WAITING_COMPLAINT'
    | 'WAITING_COMPLAINT_CONFIRMATION'
    | 'WAITING_COMPLAINT_STAMP'
    | 'WAITING_FILING'
    | 'WAITING_FORMAL_ACCEPTANCE'
    | 'WAITING_HEARING'
    | 'WAITING_JUDGMENT'
    | 'SECOND_INSTANCE'
    | 'WAITING_EXECUTION_DOCUMENTS'
    | 'WAITING_EXECUTION_CONFIRMATION'
    | 'WAITING_EXECUTION_STAMP'
    | 'WAITING_EXECUTION_FILING'
    | 'EXECUTING'
    | 'WAITING_ARCHIVE'
    | 'ARCHIVED';
  @ApiProperty() version!: number;
  @ApiProperty() canMatch!: boolean;
  @ApiProperty() canSubmitComplaint!: boolean;
  @ApiProperty() canConfirmComplaint!: boolean;
  @ApiProperty() canMailComplaint!: boolean;
  @ApiProperty() canSubmitFiling!: boolean;
  @ApiProperty() canRegisterAcceptance!: boolean;
  @ApiProperty() canUploadAcceptanceMaterials!: boolean;
  @ApiProperty() canScheduleHearing!: boolean;
  @ApiProperty() canCorrectHearing!: boolean;
  @ApiProperty() canRegisterJudgment!: boolean;
  @ApiProperty() canCorrectJudgment!: boolean;
  @ApiProperty() canChooseJudgmentNextStep!: boolean;
  @ApiProperty() canRevokeJudgmentNextStep!: boolean;
  @ApiProperty() canSaveSecondInstance!: boolean;
  @ApiProperty() canRegisterSecondInstanceResult!: boolean;
  @ApiProperty() canRevokeSecondInstanceResult!: boolean;
  @ApiProperty() canSubmitExecution!: boolean;
  @ApiPropertyOptional() canUploadDirectExecutionMaterials?: boolean;
  @ApiProperty() canConfirmExecution!: boolean;
  @ApiProperty() canMailExecution!: boolean;
  @ApiProperty() canSubmitExecutionFiling!: boolean;
  @ApiProperty() canFinishExecution!: boolean;
  @ApiProperty() canRecordClosure!: boolean;
  @ApiProperty() canCorrectClosure!: boolean;
  @ApiProperty() canArchive!: boolean;
  @ApiProperty() canEarlyArchive!: boolean;
  @ApiProperty() canCorrectArchive!: boolean;
  @ApiProperty({ type: CaseDisplaySummaryDto })
  displaySummary!: CaseDisplaySummaryDto;
  @ApiProperty({ type: CaseOwnerDto }) owner!: CaseOwnerDto;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: CaseSourceDto, nullable: true })
  sourceLead!: CaseSourceDto | null;
  @ApiProperty({ type: CaseSourceDto, nullable: true })
  sourceNotaryMatter!: CaseSourceDto | null;
  @ApiProperty() origin!:
    | { kind: 'NOTARY' }
    | {
        kind: 'EXTERNAL_ENTRY';
        entryId: string;
        entryKind: 'EXTERNAL_TRANSFER' | 'HISTORICAL_BACKFILL';
        initialStage: string;
        stageReachedOn: string;
        source: string;
        reason: string;
        recordedAt: string;
        recordedByUserId: string;
        known: unknown;
      };
}
export class CaseListResponseDto {
  @ApiProperty({ type: [CaseListItemDto] }) items!: CaseListItemDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() counts!: {
    PENDING_MATCH: number;
    WAITING_COMPLAINT: number;
    WAITING_COMPLAINT_CONFIRMATION: number;
    WAITING_COMPLAINT_STAMP: number;
    WAITING_FILING: number;
    WAITING_FORMAL_ACCEPTANCE: number;
    WAITING_HEARING: number;
    WAITING_JUDGMENT: number;
    SECOND_INSTANCE: number;
    WAITING_EXECUTION_DOCUMENTS: number;
    WAITING_EXECUTION_CONFIRMATION: number;
    WAITING_EXECUTION_STAMP: number;
    WAITING_EXECUTION_FILING: number;
    EXECUTING: number;
    WAITING_ARCHIVE: number;
    ARCHIVED: number;
  };
}
class CaseExecutionMailingDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) confirmationId!: string;
  @ApiProperty({ format: 'date' }) mailedAt!: string;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
  @ApiProperty({ type: [CaseCertificateFileDto] })
  files!: CaseCertificateFileDto[];
}
class CaseExecutionFinishDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) filingId!: string;
  @ApiProperty({ format: 'date' }) finishedAt!: string;
  @ApiProperty() reason!: string;
  @ApiProperty({ type: String, nullable: true }) basisNote!: string | null;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
  @ApiProperty({ type: [CaseCertificateFileDto] })
  files!: CaseCertificateFileDto[];
}
class CaseExecutionFilingDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) mailingId!: string;
  @ApiProperty({ format: 'date' }) submittedAt!: string;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
  @ApiProperty({ type: [CaseCertificateFileDto] })
  files!: CaseCertificateFileDto[];
}
class ExecutionSubmissionFileDto extends CaseCertificateFileDto {
  @ApiProperty({ format: 'date-time' }) uploadedAt!: string;
}
class ExecutionSubmissionSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) trialRoundId!: string;
  @ApiProperty({ format: 'uuid' }) judgmentNextStepId!: string;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  secondInstanceResultId!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  priorSubmissionId!: string | null;
  @ApiProperty({ type: String, nullable: true }) changeReason!: string | null;
  @ApiProperty() fromVersion!: number;
  @ApiProperty() toVersion!: number;
  @ApiProperty({ format: 'date-time' }) submittedAt!: string;
  @ApiProperty({ type: [ExecutionSubmissionFileDto] })
  files!: ExecutionSubmissionFileDto[];
}
class CaseExecutionSubmissionDto {
  @ApiProperty({ type: ExecutionSubmissionSummaryDto, nullable: true })
  current!: ExecutionSubmissionSummaryDto | null;
  @ApiProperty({ type: [ExecutionSubmissionSummaryDto] })
  submissions!: ExecutionSubmissionSummaryDto[];
  @ApiProperty({ type: [ExecutionSubmissionFileDto] })
  availableFiles!: ExecutionSubmissionFileDto[];
}
class CaseExecutionConfirmationDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) submissionId!: string;
  @ApiProperty({ format: 'date-time' }) confirmedAt!: string;
  @ApiProperty({ format: 'uuid' }) confirmedByUserId!: string;
  @ApiProperty({ type: [ExecutionSubmissionFileDto] })
  files!: ExecutionSubmissionFileDto[];
}
class CaseDefendantDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['PERSON', 'ORGANIZATION'] }) kind!:
    'PERSON' | 'ORGANIZATION';
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) idNo!: string | null;
  @ApiProperty({ type: String, nullable: true }) phone!: string | null;
  @ApiProperty({ type: String, nullable: true }) address!: string | null;
}
class CaseDefendantContactChangeDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() fromRevision!: number;
  @ApiProperty() toRevision!: number;
  @ApiProperty({ type: String, nullable: true }) beforePhone!: string | null;
  @ApiProperty({ type: String, nullable: true }) beforeAddress!: string | null;
  @ApiProperty({ type: String, nullable: true }) phone!: string | null;
  @ApiProperty({ type: String, nullable: true }) address!: string | null;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
  @ApiProperty({ format: 'uuid' }) recordedByUserId!: string;
}
class CaseDefendantContactHistoryDto {
  @ApiProperty({ format: 'uuid' }) defendantId!: string;
  @ApiProperty() contactRevision!: number;
  @ApiProperty({ type: [CaseDefendantContactChangeDto] })
  history!: CaseDefendantContactChangeDto[];
}
class CaseAcceptanceCorrectionHistoryItemDto {
  @ApiPropertyOptional({ type: String, nullable: true, format: 'date' })
  paymentDueAt?: string | null;
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  priorCorrectionId!: string | null;
  @ApiProperty() fromRevision!: number;
  @ApiProperty() toRevision!: number;
  @ApiProperty({ format: 'date' }) acceptedAt!: string;
  @ApiProperty() courtCaseNo!: string;
  @ApiProperty() reason!: string;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
  @ApiProperty({ format: 'uuid' }) recordedByUserId!: string;
}
class CaseAcceptanceCorrectionHistoryDto {
  @ApiPropertyOptional({ type: String, nullable: true, format: 'date' })
  originalPaymentDueAt?: string | null;
  @ApiProperty({ format: 'uuid' }) acceptanceId!: string;
  @ApiProperty({ format: 'uuid' }) trialRoundId!: string;
  @ApiProperty() acceptanceRevision!: number;
  @ApiProperty({ format: 'date' }) originalAcceptedAt!: string;
  @ApiProperty() originalCourtCaseNo!: string;
  @ApiProperty({ type: [CaseAcceptanceCorrectionHistoryItemDto] })
  history!: CaseAcceptanceCorrectionHistoryItemDto[];
}
class CaseSecondAcceptanceHistoryItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  priorChangeId!: string | null;
  @ApiProperty() fromRevision!: number;
  @ApiProperty() toRevision!: number;
  @ApiProperty({ type: String, nullable: true, format: 'date' }) acceptedAt!:
    string | null;
  @ApiProperty({ type: String, nullable: true }) courtCaseNo!: string | null;
  @ApiProperty({ type: String, nullable: true }) reason!: string | null;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
  @ApiProperty({ format: 'uuid' }) recordedByUserId!: string;
}
class CaseSecondAcceptanceHistoryDto {
  @ApiProperty({ format: 'uuid' }) choiceId!: string;
  @ApiProperty({ format: 'uuid' }) trialRoundId!: string;
  @ApiProperty() acceptanceRevision!: number;
  @ApiProperty({ type: String, nullable: true, format: 'date' }) acceptedAt!:
    string | null;
  @ApiProperty({ type: String, nullable: true }) courtCaseNo!: string | null;
  @ApiProperty() canEdit!: boolean;
  @ApiProperty({ type: [CaseSecondAcceptanceHistoryItemDto] })
  history!: CaseSecondAcceptanceHistoryItemDto[];
}
class CaseRecordEditsDto {
  @ApiProperty({ type: [ExecutionMailingRecordEditsDto] })
  executionMailings!: ExecutionMailingRecordEditsDto[];
  @ApiProperty({ type: [ExecutionFilingRecordEditsDto] })
  executionFilings!: ExecutionFilingRecordEditsDto[];
  @ApiProperty({ type: [ExecutionFinishRecordEditsDto] })
  executionFinishes!: ExecutionFinishRecordEditsDto[];
  @ApiProperty({ type: [HearingRecordEditsDto] })
  hearings!: HearingRecordEditsDto[];
  @ApiProperty({ type: [JudgmentRecordEditsDto] })
  judgments!: JudgmentRecordEditsDto[];
  @ApiProperty({ type: [ClosureRecordEditsDto] })
  closures!: ClosureRecordEditsDto[];
  @ApiProperty() canUpdateDefendantContact!: boolean;
  @ApiProperty() canCorrectAcceptance!: boolean;
  @ApiProperty({ type: [CaseDefendantContactHistoryDto] })
  defendantContacts!: CaseDefendantContactHistoryDto[];
  @ApiProperty({ type: [CaseAcceptanceCorrectionHistoryDto] })
  acceptanceCorrections!: CaseAcceptanceCorrectionHistoryDto[];
  @ApiPropertyOptional() canSaveSecondInstanceAcceptance?: boolean;
  @ApiPropertyOptional({ type: [CaseSecondAcceptanceHistoryDto] })
  secondInstanceAcceptances?: CaseSecondAcceptanceHistoryDto[];
}
class CaseLawyerDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() fullName!: string;
  @ApiProperty({ type: String, nullable: true }) lawFirm!: string | null;
  @ApiProperty({ type: String, nullable: true }) phone!: string | null;
  @ApiProperty({ enum: ['PRIMARY'] }) role!: 'PRIMARY';
  @ApiProperty({ format: 'date-time' }) assignedAt!: string;
}
class CaseFeeDto {
  @ApiProperty({ enum: ['NOTARY', 'SAMPLE', 'INVESTIGATION', 'DISCLOSURE'] })
  category!: 'NOTARY' | 'SAMPLE' | 'INVESTIGATION' | 'DISCLOSURE';
  @ApiProperty({ enum: ['KNOWN', 'PENDING'] }) state!: 'KNOWN' | 'PENDING';
  @ApiProperty({ type: String, nullable: true }) amount!: string | null;
  @ApiProperty({ enum: ['NOTARY_CERTIFICATE_FEE', 'NOTARY_MATTER_EVIDENCE'] })
  sourceType!: 'NOTARY_CERTIFICATE_FEE' | 'NOTARY_MATTER_EVIDENCE';
  @ApiProperty({ format: 'uuid' }) sourceId!: string;
}
export class CaseDetailResponseDto extends OmitType(CaseListItemDto, [
  'displaySummary',
] as const) {
  @ApiPropertyOptional({ type: CaseRecordEditsDto })
  recordEdits?: CaseRecordEditsDto;
  @ApiProperty({ type: CaseClosureDto, nullable: true })
  closure!: CaseClosureDto | null;
  @ApiProperty({ type: CaseArchiveDto, nullable: true })
  archive!: CaseArchiveDto | null;
  @ApiProperty({ type: CaseEarlyArchiveDto, nullable: true })
  earlyArchive!: CaseEarlyArchiveDto | null;
  @ApiProperty({ type: CaseExecutionConfirmationDto, nullable: true })
  executionConfirmation!: CaseExecutionConfirmationDto | null;
  @ApiProperty({ type: CaseExecutionSubmissionDto })
  executionSubmission!: CaseExecutionSubmissionDto;
  @ApiProperty({ type: CaseExecutionMailingDto, nullable: true })
  executionMailing!: CaseExecutionMailingDto | null;
  @ApiProperty({ type: CaseExecutionFilingDto, nullable: true })
  executionFiling!: CaseExecutionFilingDto | null;
  @ApiProperty({ type: ExecutionFilingFollowupsDto, nullable: true })
  executionFilingFollowups!: ExecutionFilingFollowupsDto | null;
  @ApiProperty({ type: CaseExecutionFinishDto, nullable: true })
  executionFinish!: CaseExecutionFinishDto | null;
  @ApiProperty({ type: CaseHearingDto }) hearing!: CaseHearingDto;
  @ApiProperty({ type: CaseJudgmentDto }) judgment!: CaseJudgmentDto;
  @ApiProperty({ type: CaseJudgmentNextStepDto })
  judgmentNextStep!: CaseJudgmentNextStepDto;
  @ApiProperty({ type: CaseSecondInstanceDto })
  secondInstance!: CaseSecondInstanceDto;
  @ApiProperty({ type: CaseComplaintSummaryDto, nullable: true })
  complaint!: CaseComplaintSummaryDto | null;
  @ApiProperty({ type: CaseComplaintConfirmationSummaryDto, nullable: true })
  complaintConfirmation!: CaseComplaintConfirmationSummaryDto | null;
  @ApiProperty({ type: CaseComplaintMailingSummaryDto, nullable: true })
  complaintMailing!: CaseComplaintMailingSummaryDto | null;
  @ApiProperty({ type: CaseFilingSubmissionSummaryDto, nullable: true })
  filingSubmission!: CaseFilingSubmissionSummaryDto | null;
  @ApiProperty({ type: CaseAcceptanceSummaryDto, nullable: true })
  acceptance!: CaseAcceptanceSummaryDto | null;
  @ApiProperty({ type: [CaseAcceptanceSummaryDto] })
  acceptances!: CaseAcceptanceSummaryDto[];
  @ApiProperty({ type: CaseAcceptanceMaterialsDto })
  acceptanceMaterials!: CaseAcceptanceMaterialsDto;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  matchedAt!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date' })
  matchedOn!: string | null;
  @ApiProperty({ type: String, nullable: true }) courtCaseNo!: string | null;
  @ApiProperty({ type: CaseNamedDto }) department!: CaseNamedDto;
  @ApiProperty({ type: CaseNamedDto }) customer!: CaseNamedDto;
  @ApiProperty({ type: CaseNamedDto }) rightsHolder!: CaseNamedDto;
  @ApiProperty({ type: CaseCertificateSummaryDto, nullable: true })
  certificate!: CaseCertificateSummaryDto | null;
  @ApiProperty({ type: [CaseFeeDto] }) fees!: CaseFeeDto[];
  @ApiProperty({ type: [CaseDefendantDto] }) defendants!: CaseDefendantDto[];
  @ApiProperty({ type: [CaseLawyerDto] }) lawyers!: CaseLawyerDto[];
}
