import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  ArrayMinSize,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateNotaryOfficeDto {
  @ApiProperty({ minLength: 1, maxLength: 200 })
  @IsString()
  name!: string;
}

export class SetNotaryOfficeStatusDto {
  @ApiProperty({ enum: ['INACTIVE'] })
  @IsIn(['INACTIVE'])
  status!: 'INACTIVE';
}

export class TransferLeadToNotaryDto {
  @ApiProperty({ type: [String], format: 'uuid', minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  selectedProductIds!: string[];

  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @IsUUID('4', { each: true })
  selectedContentVersionIds!: string[];

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  notaryOfficeId!: string;

  @ApiProperty({ enum: ['ONLINE_PURCHASE'] })
  @IsIn(['ONLINE_PURCHASE'])
  evidenceMode!: 'ONLINE_PURCHASE';

  @ApiProperty({ minLength: 1, maxLength: 500 })
  @IsString()
  batchPurpose!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiPropertyOptional({ description: '后续明确新建取证批次时设置为 true' })
  @IsOptional()
  @IsBoolean()
  createNewBatch?: boolean;
}
