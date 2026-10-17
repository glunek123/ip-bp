import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CreateFeeDto } from './fee.dto';
export class CreateCaseFeeEntriesDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') caseId!: string;
  @ApiProperty({ type: () => [CreateFeeDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateFeeDto)
  rows!: CreateFeeDto[];
  @ApiProperty({ maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;
}
