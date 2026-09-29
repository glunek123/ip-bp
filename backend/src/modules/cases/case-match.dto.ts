import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CaseMatchDefendantDto {
  @ApiProperty({ enum: ['PERSON', 'ORGANIZATION'] })
  @IsIn(['PERSON', 'ORGANIZATION'])
  kind!: 'PERSON' | 'ORGANIZATION';
  @ApiProperty({ maxLength: 200 }) @IsString() @MaxLength(200) name!: string;
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  idNo?: string;
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  phone?: string;
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;
}

export class CaseMatchLawyerDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  fullName!: string;
  @ApiProperty({ maxLength: 200 }) @IsString() @MaxLength(200) lawFirm!: string;
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  phone?: string;
}

export class MatchCaseDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ maxLength: 128 })
  @IsString()
  @MaxLength(128)
  idempotencyKey!: string;
  @ApiProperty({ type: [CaseMatchDefendantDto], minItems: 1, maxItems: 20 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CaseMatchDefendantDto)
  defendants!: CaseMatchDefendantDto[];
  @ApiProperty({ type: CaseMatchLawyerDto })
  @ValidateNested()
  @Type(() => CaseMatchLawyerDto)
  lawyer!: CaseMatchLawyerDto;
}

export class MatchCaseResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['WAITING_COMPLAINT'] }) stage!: 'WAITING_COMPLAINT';
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date-time' }) matchedAt!: string;
}
