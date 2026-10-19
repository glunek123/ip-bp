import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { LeadBusinessFieldsDto } from './lead.dto';

export class LeadCsvImportInputDto extends LeadBusinessFieldsDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') customerId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') rightsHolderId!: string;

  // CSV never imports material. The inherited property must be present and empty.
  @ApiProperty({ type: [String], maxItems: 0 })
  @IsArray()
  @ArrayMaxSize(0)
  declare leadScreenshotContentVersionIds: [];
}

export class LeadCsvImportItemDto {
  @ApiProperty({ minimum: 2, maximum: 2097153 })
  @IsInt()
  @Min(2)
  @Max(2097153)
  rowNumber!: number;

  @ApiProperty({ type: LeadCsvImportInputDto })
  @ValidateNested()
  @Type(() => LeadCsvImportInputDto)
  input!: LeadCsvImportInputDto;
}

export class LeadCsvImportDto {
  @ApiProperty({ type: [LeadCsvImportItemDto], minItems: 1, maxItems: 20 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique((item: LeadCsvImportItemDto | null | undefined) =>
    item && Number.isInteger(item.rowNumber) ? item.rowNumber : Symbol(),
  )
  @ValidateNested({ each: true })
  @Type(() => LeadCsvImportItemDto)
  items!: LeadCsvImportItemDto[];
}
