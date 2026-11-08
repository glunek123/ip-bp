import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LeadProxyEvidenceConfirmationResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) leadId!: string;
  @ApiProperty({ enum: ['WAITING_EVIDENCE_DECISION', 'ARCHIVED'] }) status!:
    'WAITING_EVIDENCE_DECISION' | 'ARCHIVED';
  @ApiProperty() version!: number;
  @ApiProperty({ enum: ['EVIDENCE', 'NO_EVIDENCE'] }) result!:
    'EVIDENCE' | 'NO_EVIDENCE';
  @ApiProperty({ enum: ['INTERNAL_PROXY'] }) actorKind!: 'INTERNAL_PROXY';
  @ApiProperty() actorDisplayName!: string;
  @ApiProperty({ format: 'date-time' }) decidedAt!: string;
  @ApiProperty({ nullable: true }) reason!: string | null;
  @ApiPropertyOptional({
    enum: ['LINK_REMOVED', 'NO_INFRINGEMENT_INFORMATION', 'NO_EVIDENCE'],
  })
  archiveType?: 'LINK_REMOVED' | 'NO_INFRINGEMENT_INFORMATION' | 'NO_EVIDENCE';
  @ApiPropertyOptional({ format: 'date' }) archiveDate?: string;
}
