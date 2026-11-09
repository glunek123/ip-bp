import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class MailCaseComplaintDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ minLength: 1, maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;
  @ApiProperty({ format: 'date' }) @IsDateString() mailedAt!: string;
  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remark?: string;
  @ApiProperty({ type: [String], format: 'uuid', maxItems: 10 })
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  mailReceiptContentVersionIds!: string[];
}

export class MailCaseComplaintResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['WAITING_FILING'] }) stage!: 'WAITING_FILING';
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date' }) mailedAt!: string;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
}
