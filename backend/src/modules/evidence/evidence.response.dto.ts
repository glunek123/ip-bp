import { ApiProperty } from '@nestjs/swagger';
import {
  EVIDENCE_STATUSES,
  PAPER_STATUSES,
  type EvidenceStatus,
  type PaperStatus,
} from './evidence-rules';

export class EvidenceElectronicFileResponseDto {
  @ApiProperty({ format: 'uuid' })
  materialId!: string;

  @ApiProperty({ format: 'uuid' })
  contentVersionId!: string;

  @ApiProperty({})
  filename!: string;
}

export class EvidencePaperResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, nullable: true })
  number!: string | null;

  @ApiProperty({ enum: PAPER_STATUSES })
  status!: PaperStatus;

  @ApiProperty({ type: String, nullable: true, format: 'date' })
  issuedOn!: string | null;

  @ApiProperty({ type: String, nullable: true })
  officeName!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  pages!: number | null;

  @ApiProperty({ type: String, nullable: true })
  contentVersionId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  contentMaterialId!: string | null;

  @ApiProperty({ type: [EvidenceElectronicFileResponseDto] })
  electronicFiles!: EvidenceElectronicFileResponseDto[];
}

export class EvidenceCaseResponseDto {
  @ApiProperty({ type: String, nullable: true })
  id!: string | null;

  @ApiProperty({ type: String, nullable: true })
  platform!: string | null;

  @ApiProperty({ type: String, nullable: true })
  shopName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  caseNo!: string | null;

  @ApiProperty({ type: String, nullable: true })
  stage!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lawyerName!: string | null;
}

export class EvidenceItemResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, nullable: true })
  caseId!: string | null;

  @ApiProperty({ format: 'uuid' })
  groupId!: string;

  @ApiProperty({ type: String, nullable: true })
  displayCode!: string | null;

  @ApiProperty({ type: String, nullable: true })
  shelfLocation!: string | null;

  @ApiProperty({ type: String, nullable: true })
  remark!: string | null;

  @ApiProperty({ type: String, nullable: true })
  provenance!: string | null;

  @ApiProperty({ type: String, nullable: true })
  name!: string | null;

  @ApiProperty({ type: String, nullable: true })
  kind!: string | null;

  @ApiProperty({ type: String, nullable: true })
  collectedOn!: string | null;

  @ApiProperty({ type: String, nullable: true })
  keeperName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  platform!: string | null;

  @ApiProperty({ type: String, nullable: true })
  shopName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  caseNo!: string | null;

  @ApiProperty({ type: String, nullable: true })
  stage!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lawyerName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  hearingOn!: string | null;

  @ApiProperty({ type: String, nullable: true })
  closedOn!: string | null;

  @ApiProperty({ enum: EVIDENCE_STATUSES })
  status!: EvidenceStatus;

  @ApiProperty({ type: [EvidencePaperResponseDto] })
  paperCertificates!: EvidencePaperResponseDto[];
}

export class EvidenceGroupResponseDto {
  @ApiProperty({ type: String, nullable: true })
  groupId!: string | null;

  @ApiProperty({ minimum: 0 })
  groupVersion!: number;

  @ApiProperty({ enum: ['CASE', 'NOTARY_MATTER'] })
  sourceKind!: 'CASE' | 'NOTARY_MATTER';

  @ApiProperty({ format: 'uuid' })
  sourceId!: string;

  @ApiProperty({ minimum: 1 })
  sourceVersion!: number;

  @ApiProperty({ type: EvidenceCaseResponseDto })
  case!: EvidenceCaseResponseDto;

  @ApiProperty({ type: [EvidenceItemResponseDto] })
  items!: EvidenceItemResponseDto[];

  @ApiProperty({ type: [EvidencePaperResponseDto] })
  paperCertificates!: EvidencePaperResponseDto[];
}

export class EvidenceGroupSummaryResponseDto {
  @ApiProperty({ type: String, nullable: true })
  groupId!: string | null;

  @ApiProperty({ minimum: 0 })
  groupVersion!: number;

  @ApiProperty({ enum: ['CASE', 'NOTARY_MATTER'] })
  sourceKind!: 'CASE' | 'NOTARY_MATTER';

  @ApiProperty({ format: 'uuid' })
  sourceId!: string;

  @ApiProperty({ minimum: 1 })
  sourceVersion!: number;

  @ApiProperty({ type: String, nullable: true })
  caseId!: string | null;

  @ApiProperty({})
  businessNo!: string;

  @ApiProperty({ type: String, nullable: true })
  shopName!: string | null;

  @ApiProperty({ minimum: 0 })
  activeItemCount!: number;
}

export class EvidenceCountsResponseDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'integer', minimum: 0 },
  })
  statuses!: Record<EvidenceStatus | 'ALL', number>;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'integer', minimum: 0 },
  })
  stages!: Record<string, number>;

  @ApiProperty({ minimum: 0 })
  allStageCases!: number;
}

export class EvidencePageResponseDto {
  @ApiProperty({ type: [EvidenceItemResponseDto] })
  items!: EvidenceItemResponseDto[];

  @ApiProperty({ minimum: 0 })
  total!: number;

  @ApiProperty({ minimum: 1 })
  page!: number;

  @ApiProperty({ minimum: 1, maximum: 100 })
  pageSize!: number;

  @ApiProperty({ type: EvidenceCountsResponseDto })
  counts!: EvidenceCountsResponseDto;
}

export class EvidenceGroupPageResponseDto {
  @ApiProperty({ type: [EvidenceGroupSummaryResponseDto] })
  items!: EvidenceGroupSummaryResponseDto[];

  @ApiProperty({ minimum: 0 })
  total!: number;

  @ApiProperty({ minimum: 1 })
  page!: number;

  @ApiProperty({ minimum: 1, maximum: 100 })
  pageSize!: number;
}

export class EvidenceGroupCommandResponseDto {
  @ApiProperty({})
  changed!: boolean;

  @ApiProperty({ type: EvidenceGroupResponseDto })
  group!: EvidenceGroupResponseDto;
}

export class EvidenceBulkResponseDto {
  @ApiProperty({ minimum: 0 })
  changedEvidence!: number;

  @ApiProperty({ minimum: 0 })
  changedPaperCertificates!: number;
}

export class EvidenceExportResponseDto {
  @ApiProperty({})
  filename!: string;

  @ApiProperty({})
  csv!: string;
}

export class EvidenceMatchingIdsResponseDto {
  @ApiProperty({ type: [String], format: 'uuid' })
  ids!: string[];
}
