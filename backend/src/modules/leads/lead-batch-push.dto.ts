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

export class LeadBatchPushItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  leadId!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  expectedVersion!: number;
}

export class LeadBatchPushDto {
  @ApiProperty({ type: [LeadBatchPushItemDto], minItems: 1, maxItems: 20 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique((item: LeadBatchPushItemDto | null | undefined) =>
    typeof item?.leadId === 'string' ? item.leadId.toLowerCase() : Symbol(),
  )
  @ValidateNested({ each: true })
  @Type(() => LeadBatchPushItemDto)
  items!: LeadBatchPushItemDto[];
}
