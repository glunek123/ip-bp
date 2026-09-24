import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
  @ApiProperty({ enum: ['INFRINGEMENT', 'NO_INFRINGEMENT'] })
  result!: 'INFRINGEMENT' | 'NO_INFRINGEMENT';
  @ApiProperty() reviewerDisplayName!: string;
  @ApiProperty({ format: 'date-time' }) decidedAt!: string;
  @ApiPropertyOptional({ maxLength: 5000 }) reason?: string;
  @ApiPropertyOptional({ enum: ['NO_INFRINGEMENT'] })
  archiveType?: 'NO_INFRINGEMENT';
  @ApiPropertyOptional({ format: 'date-time' }) archivedAt?: string;
}

export class ClientLeadEvidenceDecisionResponseDto {
  @ApiProperty({ enum: ['NO_EVIDENCE'] }) result!: 'NO_EVIDENCE';
  @ApiProperty({ maxLength: 5000 }) reason!: string;
  @ApiProperty() decidedByDisplayName!: string;
  @ApiProperty({ format: 'date-time' }) decidedAt!: string;
  @ApiProperty({ enum: ['NO_EVIDENCE'] }) archiveType!: 'NO_EVIDENCE';
  @ApiProperty({ format: 'date-time' }) archivedAt!: string;
}

class ClientLeadCapabilitiesResponseDto {
  @ApiProperty() review!: boolean;
  @ApiProperty() confirmWithdrawal!: boolean;
}

export class ClientLeadPendingWithdrawalResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ maxLength: 5000 }) reason!: string;
  @ApiProperty() applicantDisplayName!: string;
  @ApiProperty({ format: 'date-time' }) appliedAt!: string;
}

export class ClientLeadHistoryResponseDto {
  @ApiProperty({
    enum: [
      'REVIEW_DECISION',
      'WITHDRAWAL_APPLICATION',
      'WITHDRAWAL_CONFIRMATION',
      'EVIDENCE_DECISION',
    ],
  })
  kind!: string;
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ minimum: 1 }) fromVersion!: number;
  @ApiProperty({ minimum: 1 }) toVersion!: number;
  @ApiProperty({ format: 'date-time' }) occurredAt!: string;
  @ApiPropertyOptional() result?: string;
  @ApiPropertyOptional({ nullable: true, type: String }) reason?: string | null;
  @ApiPropertyOptional() reviewerDisplayName?: string;
  @ApiPropertyOptional() applicantDisplayName?: string;
  @ApiPropertyOptional() decidedByDisplayName?: string;
  @ApiPropertyOptional({ format: 'uuid' }) applicationId?: string;
  @ApiPropertyOptional({
    enum: ['NO_INFRINGEMENT', 'NO_EVIDENCE'],
    nullable: true,
  })
  archiveType?: 'NO_INFRINGEMENT' | 'NO_EVIDENCE' | null;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) archivedAt?:
    string | null;
}

export class ClientLeadResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() businessNo!: string;
  @ApiProperty({
    enum: [
      'WAITING_REVIEW',
      'WAITING_EVIDENCE_DECISION',
      'TRANSFERRED_TO_NOTARY',
      'ARCHIVED',
    ],
  })
  status!:
    | 'WAITING_REVIEW'
    | 'WAITING_EVIDENCE_DECISION'
    | 'TRANSFERRED_TO_NOTARY'
    | 'ARCHIVED';
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
  @ApiProperty({
    nullable: true,
    type: () => ClientLeadEvidenceDecisionResponseDto,
  })
  evidenceDecision!: ClientLeadEvidenceDecisionResponseDto | null;
  @ApiProperty({
    nullable: true,
    type: () => ClientLeadPendingWithdrawalResponseDto,
  })
  pendingWithdrawalApplication!: ClientLeadPendingWithdrawalResponseDto | null;
  @ApiProperty({ type: () => [ClientLeadHistoryResponseDto] })
  history!: ClientLeadHistoryResponseDto[];
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

export class ClientLeadReviewResultDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() businessNo!: string;
  @ApiProperty({ enum: ['WAITING_EVIDENCE_DECISION', 'ARCHIVED'] })
  status!: 'WAITING_EVIDENCE_DECISION' | 'ARCHIVED';
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiProperty({ type: () => ClientLeadReviewDecisionResponseDto })
  reviewDecision!: ClientLeadReviewDecisionResponseDto;
}

export class ClientLeadWithdrawalConfirmationResultDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) applicationId!: string;
  @ApiProperty({ format: 'uuid' }) leadId!: string;
  @ApiProperty({ enum: ['WAITING_REVIEW'] }) status!: 'WAITING_REVIEW';
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiProperty() confirmedByDisplayName!: string;
  @ApiProperty({ format: 'date-time' }) confirmedAt!: string;
}
