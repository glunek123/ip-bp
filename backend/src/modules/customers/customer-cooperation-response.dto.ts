import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CustomerMaintenanceResultDto {
  @ApiProperty({ format: 'uuid' })
  customerId!: string;

  @ApiProperty({
    enum: ['responsible-transfer', 'pause', 'terminate', 'resume'],
  })
  action!: 'responsible-transfer' | 'pause' | 'terminate' | 'resume';

  @ApiProperty({ minimum: 2 })
  resultVersion!: number;

  @ApiProperty({ format: 'date-time' })
  occurredAt!: string;

  @ApiProperty()
  canReadAfter!: boolean;
}

export class EligibleOperatorDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  displayName!: string;

  @ApiPropertyOptional({ nullable: true })
  teamName!: string | null;
}

export class EligibleOperatorPageDto {
  @ApiProperty({ type: [EligibleOperatorDto] })
  items!: EligibleOperatorDto[];

  @ApiProperty({ minimum: 0 })
  total!: number;

  @ApiProperty({ minimum: 1 })
  page!: number;

  @ApiProperty({ minimum: 1, maximum: 100 })
  pageSize!: number;
}
