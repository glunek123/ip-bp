import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class ConsolidationDefendantDto {
  @ApiProperty({ enum: ['PERSON', 'ORGANIZATION'] })
  @IsIn(['PERSON', 'ORGANIZATION'])
  kind!: 'PERSON' | 'ORGANIZATION';
  @ApiProperty({ minLength: 1, maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;
  @ApiProperty({ minLength: 1, maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  idNo!: string;
}

export class ConsolidationMemberInputDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') caseId!: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ enum: [true] }) @Equals(true) confirmed!: true;
  @ApiProperty({ type: ConsolidationDefendantDto })
  @ValidateNested()
  @Type(() => ConsolidationDefendantDto)
  defendant!: ConsolidationDefendantDto;
}

export class PreviewCaseConsolidationDto {
  @ApiProperty({
    type: [ConsolidationMemberInputDto],
    minItems: 2,
    maxItems: 20,
  })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ConsolidationMemberInputDto)
  members!: ConsolidationMemberInputDto[];
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  mainCaseId?: string;
}

export class CreateCaseConsolidationDto extends PreviewCaseConsolidationDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  declare mainCaseId: string;
  @ApiProperty({ minLength: 1, maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;
}

export class CaseConsolidationResultDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) mainCaseId!: string;
  @ApiProperty() mainBusinessNo!: string;
  @ApiProperty() caseCount!: number;
  @ApiProperty({ type: [String] }) caseIds!: string[];
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
