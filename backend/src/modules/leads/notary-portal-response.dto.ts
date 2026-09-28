import { ApiProperty } from '@nestjs/swagger';

class NotaryPortalListItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() businessNo!: string;
  @ApiProperty({ enum: ['WAITING_UNBOX'] }) stage!: 'WAITING_UNBOX';
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
}

export class NotaryPortalDetailResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() businessNo!: string;
  @ApiProperty({ enum: ['WAITING_UNBOX', 'UNBOX_REVIEW'] }) stage!:
    'WAITING_UNBOX' | 'UNBOX_REVIEW';
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: NotaryPortalEvidenceDto, nullable: true })
  evidence!: NotaryPortalEvidenceDto | null;
  @ApiProperty({ type: NotaryPortalOpeningDto, nullable: true })
  opening!: NotaryPortalOpeningDto | null;
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
