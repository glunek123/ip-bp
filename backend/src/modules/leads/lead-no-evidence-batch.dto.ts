import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsString,
  IsOptional,
  IsIn,
  Matches,
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

  @ApiPropertyOptional({
    minLength: 1,
    maxLength: 5000,
    description: 'Trimmed Unicode reason; length is counted in code points',
  })
  @IsOptional()
  @IsString()
  reason?: string;
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

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({
    enum: ['LINK_REMOVED', 'NO_INFRINGEMENT_INFORMATION', 'NO_EVIDENCE'],
  })
  @IsOptional()
  @IsIn(['LINK_REMOVED', 'NO_INFRINGEMENT_INFORMATION', 'NO_EVIDENCE'])
  archiveType?: 'LINK_REMOVED' | 'NO_INFRINGEMENT_INFORMATION' | 'NO_EVIDENCE';

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  archiveDate?: string;
}
