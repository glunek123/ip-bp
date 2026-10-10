import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

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
class CaseAcceptanceSummaryDto {
  @ApiProperty({ format: 'date' }) acceptedAt!: string;
  @ApiProperty() courtCaseNo!: string;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
  @ApiProperty({ format: 'uuid', required: false }) recordedByUserId?: string;
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
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, nullable: true, format: 'date' }) hearingAt!:
    string | null;
  @ApiProperty({ enum: ['SCHEDULE', 'CORRECTION'] }) source!:
    'SCHEDULE' | 'CORRECTION';
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
  @ApiPropertyOptional({ format: 'uuid' }) recordedByUserId?: string;
}
class CaseHearingAdvanceDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
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

export class CasePageQueryDto {
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
    | 'WAITING_EXECUTION_DOCUMENTS';
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
    | 'WAITING_EXECUTION_DOCUMENTS';
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
  @ApiProperty({ type: CaseOwnerDto }) owner!: CaseOwnerDto;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: CaseSourceDto }) sourceLead!: CaseSourceDto;
  @ApiProperty({ type: CaseSourceDto }) sourceNotaryMatter!: CaseSourceDto;
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
  };
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
export class CaseDetailResponseDto extends CaseListItemDto {
  @ApiProperty({ type: CaseHearingDto }) hearing!: CaseHearingDto;
  @ApiProperty({ type: CaseJudgmentDto }) judgment!: CaseJudgmentDto;
  @ApiProperty({ type: CaseJudgmentNextStepDto })
  judgmentNextStep!: CaseJudgmentNextStepDto;
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
  @ApiProperty({ type: CaseCertificateSummaryDto })
  certificate!: CaseCertificateSummaryDto;
  @ApiProperty({ type: [CaseFeeDto] }) fees!: CaseFeeDto[];
  @ApiProperty({ type: [CaseDefendantDto] }) defendants!: CaseDefendantDto[];
  @ApiProperty({ type: [CaseLawyerDto] }) lawyers!: CaseLawyerDto[];
}
