import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

class CaseCertificateFileDto {
  @ApiProperty({ format: 'uuid' }) materialId!: string;
  @ApiProperty({ format: 'uuid' }) contentVersionId!: string;
  @ApiProperty() originalFilename!: string;
  @ApiProperty() mimeType!: string;
}
class CaseCertificateSummaryDto {
  @ApiProperty() certificateNo!: string;
  @ApiProperty({ format: 'date' }) certificateDate!: string;
  @ApiProperty({ format: 'date-time' }) issuedAt!: string;
  @ApiProperty() needDisclose!: boolean;
  @ApiProperty({ type: [CaseCertificateFileDto] })
  files!: CaseCertificateFileDto[];
  @ApiProperty({ type: [CaseCertificateFileDto] })
  disclosureFiles!: CaseCertificateFileDto[];
}

export class CasePageQueryDto {
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
}
class CaseSourceDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() businessNo!: string;
}
class CaseNamedDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
}
class CaseOwnerDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
}
class CaseListItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() businessNo!: string;
  @ApiProperty({ enum: ['PENDING_MATCH'] }) stage!: 'PENDING_MATCH';
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: CaseSourceDto }) sourceLead!: CaseSourceDto;
  @ApiProperty({ type: CaseSourceDto }) sourceNotaryMatter!: CaseSourceDto;
}
export class CaseListResponseDto {
  @ApiProperty({ type: [CaseListItemDto] }) items!: CaseListItemDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
class CaseFeeDto {
  @ApiProperty({ enum: ['NOTARY', 'SAMPLE', 'INVESTIGATION', 'DISCLOSURE'] })
  category!: 'NOTARY' | 'SAMPLE' | 'INVESTIGATION' | 'DISCLOSURE';
  @ApiProperty({ enum: ['KNOWN', 'PENDING'] }) state!: 'KNOWN' | 'PENDING';
  @ApiProperty({ type: String, nullable: true }) amount!: string | null;
  @ApiProperty({ enum: ['NOTARY_CERTIFICATE_FEE', 'NOTARY_MATTER_EVIDENCE'] })
  sourceType!: 'NOTARY_CERTIFICATE_FEE' | 'NOTARY_MATTER_EVIDENCE';
  @ApiProperty({ format: 'uuid' }) sourceId!: string;
}
export class CaseDetailResponseDto extends CaseListItemDto {
  @ApiProperty({ type: String, nullable: true }) courtCaseNo!: string | null;
  @ApiProperty({ type: CaseNamedDto }) department!: CaseNamedDto;
  @ApiProperty({ type: CaseNamedDto }) customer!: CaseNamedDto;
  @ApiProperty({ type: CaseNamedDto }) rightsHolder!: CaseNamedDto;
  @ApiProperty({ type: CaseOwnerDto }) owner!: CaseOwnerDto;
  @ApiProperty({ type: CaseCertificateSummaryDto })
  certificate!: CaseCertificateSummaryDto;
  @ApiProperty({ type: [CaseFeeDto] }) fees!: CaseFeeDto[];
}
