import { ApiProperty } from '@nestjs/swagger';

export class LeadCsvImportResultItemDto {
  @ApiProperty({ minimum: 2, maximum: 2097153 }) rowNumber!: number;
  @ApiProperty({ type: Object }) lead!: object;
}

export class LeadCsvImportResponseDto {
  @ApiProperty({
    type: [LeadCsvImportResultItemDto],
    minItems: 1,
    maxItems: 20,
  })
  items!: LeadCsvImportResultItemDto[];
}
