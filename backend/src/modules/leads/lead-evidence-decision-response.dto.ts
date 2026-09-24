import { ApiProperty } from '@nestjs/swagger';

export class LeadEvidenceDecisionResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) leadId!: string;
  @ApiProperty({ enum: ['ARCHIVED'] }) status!: 'ARCHIVED';
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiProperty({ enum: ['NO_EVIDENCE'] }) result!: 'NO_EVIDENCE';
  @ApiProperty({ maxLength: 5000 }) reason!: string;
  @ApiProperty() decidedByDisplayName!: string;
  @ApiProperty({ format: 'date-time' }) decidedAt!: string;
  @ApiProperty({ enum: ['NO_EVIDENCE'] }) archiveType!: 'NO_EVIDENCE';
  @ApiProperty({ format: 'date-time' }) archivedAt!: string;
}
