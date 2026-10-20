import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class LeadNoEvidenceBatchItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  leadId!: string;

  @ApiProperty({ minimum: 1, maximum: 2147483646 })
  @IsInt()
  @Min(1)
  @Max(2147483646)
  expectedVersion!: number;

  @ApiProperty({
    minLength: 1,
    maxLength: 5000,
    description: 'Trimmed Unicode reason; length is counted in code points',
  })
  @IsString()
  reason!: string;
}

export class LeadNoEvidenceBatchDto {
  @ApiProperty({
    type: [LeadNoEvidenceBatchItemDto],
    minItems: 1,
    maxItems: 20,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique((item: LeadNoEvidenceBatchItemDto | null | undefined) =>
    typeof item?.leadId === 'string' ? item.leadId.toLowerCase() : Symbol(),
  )
  @ValidateNested({ each: true })
  @Type(() => LeadNoEvidenceBatchItemDto)
  items!: LeadNoEvidenceBatchItemDto[];
}
