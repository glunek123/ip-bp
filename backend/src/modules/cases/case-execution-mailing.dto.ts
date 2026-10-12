import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class MailCaseExecutionDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ minLength: 1, maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') expectedConfirmationId!: string;
  @ApiProperty({ format: 'date' }) @IsDateString() mailedAt!: string;
  @ApiProperty({ type: [String], format: 'uuid', minItems: 1, maxItems: 10 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  mailReceiptContentVersionIds!: string[];
}

export class MailCaseExecutionResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) mailingId!: string;
  @ApiProperty({ format: 'uuid' }) confirmationId!: string;
  @ApiProperty({ enum: ['WAITING_EXECUTION_FILING'] })
  stage!: 'WAITING_EXECUTION_FILING';
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date' }) mailedAt!: string;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
}
