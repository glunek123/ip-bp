import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsUUID,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
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

  @ApiProperty({
    type: [Object],
    required: false,
    description: '各商品组的待下载截图链接，编号与商品位置一一对应',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => LeadImportScreenshotsDto)
  remoteScreenshots?: LeadImportScreenshotsDto[];

  @ApiProperty({
    required: false,
    maxLength: 200,
    description: '模板运营列，须唯一匹配当前实际操作人',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  operatorText?: string;
}

export class LeadImportScreenshotsDto {
  @ApiProperty({ minimum: 1, maximum: 100 })
  @IsInt()
  @Min(1)
  @Max(100)
  productNumber!: number;

  @ApiProperty({ minimum: 1, maximum: 100 })
  @IsInt()
  @Min(1)
  @Max(100)
  sourceGroupNumber!: number;

  @ApiProperty({ type: [String], maxItems: 20 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @IsUrl(
    {
      protocols: ['http', 'https'],
      require_protocol: true,
      require_valid_protocol: true,
    },
    { each: true },
  )
  urls!: string[];
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
