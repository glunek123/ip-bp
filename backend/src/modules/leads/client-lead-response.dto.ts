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

export class ClientLeadResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() businessNo!: string;
  @ApiProperty({ enum: ['WAITING_REVIEW'] }) status!: 'WAITING_REVIEW';
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
}

export class ClientLeadListResponseDto {
  @ApiProperty({ type: () => [ClientLeadResponseDto] })
  items!: ClientLeadResponseDto[];
  @ApiProperty({ minimum: 0 }) total!: number;
  @ApiProperty({ minimum: 1 }) page!: number;
  @ApiProperty({ minimum: 1, maximum: 100 }) pageSize!: number;
}
