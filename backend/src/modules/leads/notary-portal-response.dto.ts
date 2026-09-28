import { ApiProperty } from '@nestjs/swagger';

class NotaryPortalListItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() businessNo!: string;
  @ApiProperty({ enum: ['WAITING_UNBOX', 'WAITING_CERTIFICATE', 'ARCHIVED'] })
  stage!: 'WAITING_UNBOX' | 'WAITING_CERTIFICATE' | 'ARCHIVED';
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class NotaryPortalListResponseDto {
  @ApiProperty({ type: [NotaryPortalListItemDto] })
  items!: NotaryPortalListItemDto[];
  @ApiProperty({ minimum: 0 }) total!: number;
  @ApiProperty({ minimum: 1 }) page!: number;
  @ApiProperty({ minimum: 1, maximum: 100 }) pageSize!: number;
}

class NotaryPortalLogisticsDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['PRESENT', 'NONE'] }) companyState!: 'PRESENT' | 'NONE';
  @ApiProperty({ type: String, nullable: true }) companyValue!: string | null;
  @ApiProperty({ enum: ['PRESENT', 'NONE'] }) trackingState!:
    'PRESENT' | 'NONE';
  @ApiProperty({ type: String, nullable: true }) trackingValue!: string | null;
}

class NotaryPortalEvidenceDto {
  @ApiProperty({ format: 'date' }) evidenceAt!: string;
  @ApiProperty({ enum: ['KNOWN', 'PENDING'] }) sampleFeeState!:
    'KNOWN' | 'PENDING';
  @ApiProperty({ type: String, nullable: true }) sampleFeeAmount!:
    string | null;
  @ApiProperty({ type: [NotaryPortalLogisticsDto] })
  logistics!: NotaryPortalLogisticsDto[];
}

class NotaryPortalPhotoDto {
  @ApiProperty({ format: 'uuid' }) materialId!: string;
  @ApiProperty({ format: 'uuid' }) contentVersionId!: string;
  @ApiProperty() originalFilename!: string;
  @ApiProperty() mimeType!: string;
}

export class NotaryPortalOpeningDto {
  @ApiProperty({ type: String, nullable: true }) senderName!: string | null;
  @ApiProperty({ type: String, nullable: true }) senderPhone!: string | null;
  @ApiProperty({ type: String, nullable: true }) senderAddress!: string | null;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
  @ApiProperty({ type: [NotaryPortalPhotoDto] })
  photos!: NotaryPortalPhotoDto[];
}

export class NotaryPortalCapabilitiesDto {
  @ApiProperty() recordOpening!: boolean;
  @ApiProperty() issueCertificate!: boolean;
}

class NotaryPortalIssuanceDecisionDto {
  @ApiProperty({ enum: ['ISSUE'] }) decision!: 'ISSUE';
  @ApiProperty() actorDisplayName!: string;
  @ApiProperty({ format: 'date-time' }) decidedAt!: string;
}

class NotaryPortalCertificateDto {
  @ApiProperty() certificateNo!: string;
  @ApiProperty({ format: 'date' }) certificateDate!: string;
  @ApiProperty({ format: 'date-time' }) issuedAt!: string;
  @ApiProperty() needDisclose!: boolean;
  @ApiProperty({ type: [NotaryPortalPhotoDto] }) files!: NotaryPortalPhotoDto[];
  @ApiProperty({ type: [NotaryPortalPhotoDto] })
  disclosureFiles!: NotaryPortalPhotoDto[];
  @ApiProperty({ format: 'uuid', nullable: true }) caseId!: string | null;
  @ApiProperty({ nullable: true }) caseBusinessNo!: string | null;
}

export class NotaryPortalDetailResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() businessNo!: string;
  @ApiProperty({
    enum: ['WAITING_UNBOX', 'UNBOX_REVIEW', 'WAITING_CERTIFICATE', 'ARCHIVED'],
  })
  stage!: 'WAITING_UNBOX' | 'UNBOX_REVIEW' | 'WAITING_CERTIFICATE' | 'ARCHIVED';
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty() disclosureRequired!: boolean;
  @ApiProperty({ type: NotaryPortalEvidenceDto, nullable: true })
  evidence!: NotaryPortalEvidenceDto | null;
  @ApiProperty({ type: NotaryPortalOpeningDto, nullable: true })
  opening!: NotaryPortalOpeningDto | null;
  @ApiProperty({ type: NotaryPortalIssuanceDecisionDto, nullable: true })
  issuanceDecision!: NotaryPortalIssuanceDecisionDto | null;
  @ApiProperty({ type: NotaryPortalCertificateDto, nullable: true })
  certificate!: NotaryPortalCertificateDto | null;
  @ApiProperty({ type: NotaryPortalCapabilitiesDto })
  capabilities!: NotaryPortalCapabilitiesDto;
}

class NotaryPortalRecordedPhotoDto {
  @ApiProperty({ format: 'uuid' }) materialId!: string;
  @ApiProperty({ format: 'uuid' }) contentVersionId!: string;
}

class NotaryPortalRecordedOpeningDto {
  @ApiProperty({ type: String, nullable: true }) senderName!: string | null;
  @ApiProperty({ type: String, nullable: true }) senderPhone!: string | null;
  @ApiProperty({ type: String, nullable: true }) senderAddress!: string | null;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
  @ApiProperty({ format: 'uuid' }) recordedByUserId!: string;
  @ApiProperty({ type: [NotaryPortalRecordedPhotoDto] })
  photos!: NotaryPortalRecordedPhotoDto[];
}

export class NotaryPortalOpeningResultDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['UNBOX_REVIEW'] }) stage!: 'UNBOX_REVIEW';
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiProperty({ type: NotaryPortalRecordedOpeningDto })
  opening!: NotaryPortalRecordedOpeningDto;
}
