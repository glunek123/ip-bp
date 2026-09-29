import { ApiProperty } from '@nestjs/swagger';

class ClientNotaryListItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() businessNo!: string;
  @ApiProperty({
    enum: [
      'UNBOX_REVIEW',
      'ISSUANCE_DECISION',
      'WAITING_CERTIFICATE',
      'WAITING_RETURN',
      'ARCHIVED',
    ],
  })
  stage!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty() sourceLeadBusinessNo!: string;
}

export class ClientNotaryListResponseDto {
  @ApiProperty({ type: [ClientNotaryListItemDto] })
  items!: ClientNotaryListItemDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

class ClientNotaryLeadDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() businessNo!: string;
}

class ClientNotaryProductDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() position!: number;
  @ApiProperty({ nullable: true }) title!: string | null;
  @ApiProperty({ nullable: true }) url!: string | null;
  @ApiProperty() quantity!: number;
  @ApiProperty() unitPrice!: string;
  @ApiProperty() commentCount!: number;
  @ApiProperty() estimatedAmount!: string;
}

class ClientNotaryPhotoDto {
  @ApiProperty({ format: 'uuid' }) materialId!: string;
  @ApiProperty({ format: 'uuid' }) contentVersionId!: string;
  @ApiProperty() originalFilename!: string;
  @ApiProperty() mimeType!: string;
}

class ClientNotaryOpeningDto {
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
  @ApiProperty({ type: [ClientNotaryPhotoDto] })
  photos!: ClientNotaryPhotoDto[];
}

class ClientNotaryDecisionDto {
  @ApiProperty({ enum: ['INFRINGEMENT', 'NO_INFRINGEMENT'] }) result!: string;
  @ApiProperty({ nullable: true }) reason!: string | null;
  @ApiProperty({ enum: ['INTERNAL', 'CLIENT'] }) actorKind!: string;
  @ApiProperty() actorDisplayName!: string;
  @ApiProperty({ format: 'date-time' }) decidedAt!: string;
  @ApiProperty({ nullable: true, format: 'date-time' }) archivedAt!:
    string | null;
}

class ClientNotaryIssuanceDecisionDto {
  @ApiProperty({ enum: ['ISSUE', 'NO_ISSUE'] }) decision!: string;
  @ApiProperty({ format: 'date-time' }) decidedAt!: string;
}

class ClientNotaryReturnArchiveDto {
  @ApiProperty({ enum: ['RETURN', 'KEEP', 'REFUND_ONLY'] })
  returnChoice!: string;
  @ApiProperty() archiveReason!: string;
  @ApiProperty({ format: 'date-time' }) archivedAt!: string;
}

class ClientNotaryCapabilitiesDto {
  @ApiProperty() reviewOpening!: boolean;
}

export class ClientNotaryDetailResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() businessNo!: string;
  @ApiProperty({
    enum: [
      'UNBOX_REVIEW',
      'ISSUANCE_DECISION',
      'WAITING_CERTIFICATE',
      'WAITING_RETURN',
      'ARCHIVED',
    ],
  })
  stage!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: ClientNotaryLeadDto }) sourceLead!: ClientNotaryLeadDto;
  @ApiProperty({ type: [ClientNotaryProductDto] })
  selectedProducts!: ClientNotaryProductDto[];
  @ApiProperty({ type: ClientNotaryOpeningDto })
  opening!: ClientNotaryOpeningDto;
  @ApiProperty({ type: ClientNotaryDecisionDto, nullable: true })
  reviewDecision!: ClientNotaryDecisionDto | null;
  @ApiProperty({ type: ClientNotaryIssuanceDecisionDto, nullable: true })
  issuanceDecision!: ClientNotaryIssuanceDecisionDto | null;
  @ApiProperty({ type: ClientNotaryReturnArchiveDto, nullable: true })
  returnArchive!: ClientNotaryReturnArchiveDto | null;
  @ApiProperty({ type: ClientNotaryCapabilitiesDto })
  capabilities!: ClientNotaryCapabilitiesDto;
}
