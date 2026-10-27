import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  CreateCaseExternalEntryDto,
  CreateCaseExternalEntryResultDto,
} from './case-external-entry.dto';

export class CaseCsvPreviewDto {
  @ApiProperty({
    description: 'Base64 encoded UTF-8 CSV, maximum decoded size 64 KiB',
  })
  @IsString()
  csvBase64!: string;
}
export class CaseCsvCommitDto extends CaseCsvPreviewDto {
  @ApiProperty({ minLength: 1, maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;
  @ApiProperty({ type: [Number], minItems: 1, maxItems: 20 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(2, { each: true })
  @Max(65537, { each: true })
  rowNumbers!: number[];

  @ApiProperty({ type: () => [CaseCsvDuplicateConfirmationDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique((item: CaseCsvDuplicateConfirmationDto) => item?.rowNumber)
  @ValidateNested({ each: true })
  @Type(() => CaseCsvDuplicateConfirmationDto)
  duplicateConfirmations!: CaseCsvDuplicateConfirmationDto[];
}

export class CaseCsvDuplicateConfirmationDto {
  @ApiProperty({ minimum: 2 }) @IsInt() @Min(2) rowNumber!: number;
  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  caseIds!: string[];
  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(2, { each: true })
  rowNumbers!: number[];
}

export class CaseCsvDuplicateCaseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() businessNo!: string;
}

export class CaseCsvDuplicateCandidatesDto {
  @ApiProperty({ type: [CaseCsvDuplicateCaseDto] })
  cases!: CaseCsvDuplicateCaseDto[];
  @ApiProperty({ type: [Number] }) rowNumbers!: number[];
}
export class CaseCsvRowErrorDto {
  @ApiProperty() code!: string;
  @ApiProperty() field!: string;
  @ApiProperty() message!: string;
}
export class CaseCsvPreviewRowDto {
  @ApiProperty() rowNumber!: number;
  @ApiProperty() valid!: boolean;
  @ApiProperty({ type: [CaseCsvRowErrorDto] }) errors!: CaseCsvRowErrorDto[];
  @ApiProperty({ type: CaseCsvDuplicateCandidatesDto })
  duplicateCandidates!: CaseCsvDuplicateCandidatesDto;
  @ApiProperty({ required: false, type: CreateCaseExternalEntryDto })
  input?: CreateCaseExternalEntryDto;
}
export class CaseCsvPreviewResultDto {
  @ApiProperty({ type: [CaseCsvPreviewRowDto] }) rows!: CaseCsvPreviewRowDto[];
  @ApiProperty() validCount!: number;
  @ApiProperty() errorCount!: number;
}
export class CaseCsvCommitItemDto extends CreateCaseExternalEntryResultDto {
  @ApiProperty() rowNumber!: number;
}
export class CaseCsvCommitResultDto {
  @ApiProperty({ type: [CaseCsvCommitItemDto] }) items!: CaseCsvCommitItemDto[];
}
