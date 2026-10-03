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
  @ApiProperty({ enum: ['INTERNAL', 'CLIENT'] }) actorType!: 'INTERNAL' | 'CLIENT';
  @ApiProperty({ type: [CaseCertificateFileDto] }) receiptFiles!: CaseCertificateFileDto[];
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
    ],
  })
  @IsOptional()
  @IsIn([
    'PENDING_MATCH',
    'WAITING_COMPLAINT',
    'WAITING_COMPLAINT_CONFIRMATION',
    'WAITING_COMPLAINT_STAMP',
    'WAITING_FILING',
  ])
  stage?:
    | 'PENDING_MATCH'
    | 'WAITING_COMPLAINT'
    | 'WAITING_COMPLAINT_CONFIRMATION'
    | 'WAITING_COMPLAINT_STAMP'
    | 'WAITING_FILING';
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
    ],
  })
  stage!:
    | 'PENDING_MATCH'
    | 'WAITING_COMPLAINT'
    | 'WAITING_COMPLAINT_CONFIRMATION'
    | 'WAITING_COMPLAINT_STAMP'
    | 'WAITING_FILING';
  @ApiProperty() version!: number;
  @ApiProperty() canMatch!: boolean;
  @ApiProperty() canSubmitComplaint!: boolean;
  @ApiProperty() canConfirmComplaint!: boolean;
  @ApiProperty() canMailComplaint!: boolean;
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
  @ApiProperty({ type: CaseComplaintSummaryDto, nullable: true })
  complaint!: CaseComplaintSummaryDto | null;
  @ApiProperty({ type: CaseComplaintConfirmationSummaryDto, nullable: true })
  complaintConfirmation!: CaseComplaintConfirmationSummaryDto | null;
  @ApiProperty({ type: CaseComplaintMailingSummaryDto, nullable: true })
  complaintMailing!: CaseComplaintMailingSummaryDto | null;
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
