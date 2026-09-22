import { ApiProperty } from '@nestjs/swagger';

class ClientLeadProductResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ minimum: 1 }) position!: number;
  @ApiProperty({ nullable: true, type: String }) url!: string | null;
  @ApiProperty({ nullable: true, type: String }) title!: string | null;
  @ApiProperty({ minimum: 0 }) quantity!: number;
  @ApiProperty({ pattern: '^(0|[1-9]\\d{0,15})(\\.\\d{1,2})?$' })
  unitPrice!: string;
  @ApiProperty({ minimum: 0 }) commentCount!: number;
  @ApiProperty({ pattern: '^(0|[1-9]\\d{0,15})(\\.\\d{1,2})?$' })
  estimatedAmount!: string;
}

export class ClientLeadReviewDecisionResponseDto {
  @ApiProperty({ enum: ['INFRINGEMENT'] }) result!: 'INFRINGEMENT';
  @ApiProperty() reviewerDisplayName!: string;
  @ApiProperty({ format: 'date-time' }) decidedAt!: string;
}

class ClientLeadCapabilitiesResponseDto {
  @ApiProperty() review!: boolean;
}

export class ClientLeadResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() businessNo!: string;
  @ApiProperty({ enum: ['WAITING_REVIEW', 'WAITING_EVIDENCE_DECISION'] })
  status!: 'WAITING_REVIEW' | 'WAITING_EVIDENCE_DECISION';
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiProperty() caseType!: string;
  @ApiProperty({ type: [String] }) infringementTypes!: string[];
  @ApiProperty() source!: string;
  @ApiProperty() platform!: string;
  @ApiProperty({ format: 'date-time' }) foundAt!: string;
  @ApiProperty() shopName!: string;
  @ApiProperty({ nullable: true, type: String }) shopExternalId!: string | null;
  @ApiProperty() rightsHolderName!: string;
  @ApiProperty({ type: () => [ClientLeadProductResponseDto] })
  products!: ClientLeadProductResponseDto[];
  @ApiProperty({ type: [String], format: 'uuid' })
  leadScreenshotContentVersionIds!: string[];
  @ApiProperty({ format: 'date-time' }) pushedAt!: string;
  @ApiProperty({
    nullable: true,
    type: () => ClientLeadReviewDecisionResponseDto,
  })
  reviewDecision!: ClientLeadReviewDecisionResponseDto | null;
  @ApiProperty({ type: () => ClientLeadCapabilitiesResponseDto })
  capabilities!: ClientLeadCapabilitiesResponseDto;
}

export class ClientLeadListResponseDto {
  @ApiProperty({ type: () => [ClientLeadResponseDto] })
  items!: ClientLeadResponseDto[];
  @ApiProperty({ minimum: 0 }) total!: number;
  @ApiProperty({ minimum: 1 }) page!: number;
  @ApiProperty({ minimum: 1, maximum: 100 }) pageSize!: number;
}
