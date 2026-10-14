import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsDefined,
  IsInt,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class MailCaseExecutionDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ minLength: 1, maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  @IsDefined()
  @ValidateIf((_input, value) => value !== null)
  @IsUUID('4')
  expectedConfirmationId!: string | null;
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
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  confirmationId!: string | null;
  @ApiProperty({ enum: ['WAITING_EXECUTION_FILING'] })
  stage!: 'WAITING_EXECUTION_FILING';
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date' }) mailedAt!: string;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
}
