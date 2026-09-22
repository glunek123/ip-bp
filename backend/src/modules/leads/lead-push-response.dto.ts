import { ApiProperty } from '@nestjs/swagger';

export class LeadPushResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() businessNo!: string;
  @ApiProperty({ enum: ['WAITING_REVIEW'] }) status!: 'WAITING_REVIEW';
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiProperty({ format: 'date-time' }) pushedAt!: string;
  @ApiProperty({ format: 'uuid' }) pushedByUserId!: string;
}
