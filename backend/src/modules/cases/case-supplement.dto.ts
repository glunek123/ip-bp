import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { CaseSupplementKind } from '../../generated/prisma/client';

export class CreateCaseSupplementDto {
  @IsEnum(CaseSupplementKind)
  kind!: CaseSupplementKind;

  @IsOptional()
  @IsUUID('4')
  trialRoundId?: string;

  @IsOptional()
  @Matches(/^(0|[1-9]\d{0,13})\.\d{2}$/u)
  amount?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  text?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/u)
  eventDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  courtCaseNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  sourceType?: string;

  @IsOptional()
  @IsUUID('4')
  sourceId?: string;

  @IsOptional()
  @IsUUID('4')
  inventoryVersionId?: string;

  @IsOptional()
  @IsUUID('4')
  inventoryItemId?: string;

  @IsOptional()
  @IsUUID('4')
  materialId?: string;

  @IsOptional()
  @IsUUID('4')
  contentVersionId?: string;

  @IsString()
  @MaxLength(1000)
  reason!: string;

  @IsString()
  @MaxLength(128)
  idempotencyKey!: string;

  @IsOptional()
  @IsUUID('4')
  expectedHeadId?: string;
}
