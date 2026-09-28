import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CertificateFeeDto {
  @ApiProperty({ enum: ['KNOWN', 'PENDING'] })
  @IsIn(['KNOWN', 'PENDING'])
  state!: 'KNOWN' | 'PENDING';
  @ApiProperty({ type: String, nullable: true })
  @ValidateIf((_, amount: unknown) => amount !== null)
  @IsString()
  amount!: string | null;
}
export class CertificateFeesDto {
  @ApiProperty({ type: CertificateFeeDto })
  @ValidateNested()
  @Type(() => CertificateFeeDto)
  notary!: CertificateFeeDto;
  @ApiProperty({ type: CertificateFeeDto })
  @ValidateNested()
  @Type(() => CertificateFeeDto)
  investigation!: CertificateFeeDto;
  @ApiProperty({ type: CertificateFeeDto })
  @ValidateNested()
  @Type(() => CertificateFeeDto)
  disclosure!: CertificateFeeDto;
}
export class IssueNotaryCertificateDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  certificateNo!: string;
  @ApiProperty({ format: 'date' }) @IsString() certificateDate!: string;
  @ApiProperty({ type: [String], format: 'uuid', minItems: 1, maxItems: 20 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  contentVersionIds!: string[];
  @ApiProperty() @IsBoolean() needDisclose!: boolean;
  @ApiProperty({ type: [String], format: 'uuid', maxItems: 20 })
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  disclosureContentVersionIds!: string[];
  @ApiProperty({ type: CertificateFeesDto })
  @ValidateNested()
  @Type(() => CertificateFeesDto)
  fees!: CertificateFeesDto;
}

class CertificateFileDto {
  @ApiProperty({ format: 'uuid' }) materialId!: string;
  @ApiProperty({ format: 'uuid' }) contentVersionId!: string;
  @ApiProperty() originalFilename!: string;
  @ApiProperty() mimeType!: string;
}
export class CertificateSummaryDto {
  @ApiProperty() certificateNo!: string;
  @ApiProperty({ format: 'date' }) certificateDate!: string;
  @ApiProperty({ format: 'date-time' }) issuedAt!: string;
  @ApiProperty({ type: [CertificateFileDto] }) files!: CertificateFileDto[];
  @ApiProperty() needDisclose!: boolean;
  @ApiProperty({ type: [CertificateFileDto] })
  disclosureFiles!: CertificateFileDto[];
}
class CreatedCaseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() businessNo!: string;
  @ApiProperty({ enum: ['PENDING_MATCH'] }) stage!: 'PENDING_MATCH';
}
export class IssueNotaryCertificateResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['ARCHIVED'] }) stage!: 'ARCHIVED';
  @ApiProperty() version!: number;
  @ApiProperty({ type: CertificateSummaryDto })
  certificate!: CertificateSummaryDto;
  @ApiProperty({ type: CreatedCaseDto }) case!: CreatedCaseDto;
}

export class NotaryPortalQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
  @ApiPropertyOptional({
    enum: ['WAITING_UNBOX', 'WAITING_CERTIFICATE', 'ARCHIVED'],
  })
  @IsOptional()
  @IsIn(['WAITING_UNBOX', 'WAITING_CERTIFICATE', 'ARCHIVED'])
  stage?: 'WAITING_UNBOX' | 'WAITING_CERTIFICATE' | 'ARCHIVED';
}
