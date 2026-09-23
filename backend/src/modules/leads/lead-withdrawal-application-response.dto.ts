import { ApiProperty } from '@nestjs/swagger';

export class LeadWithdrawalApplicationResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) leadId!: string;
  @ApiProperty({ enum: ['ARCHIVED'] }) status!: 'ARCHIVED';
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiProperty({ maxLength: 5000 }) reason!: string;
  @ApiProperty() applicantDisplayName!: string;
  @ApiProperty({ format: 'date-time' }) appliedAt!: string;
}
