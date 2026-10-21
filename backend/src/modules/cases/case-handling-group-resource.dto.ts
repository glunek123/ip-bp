import { ApiProperty } from '@nestjs/swagger';
import {
  MaterialCategory,
  NotarySampleFeeState,
} from '../../generated/prisma/enums';
import { CaseHandlingGroupPageQueryDto } from './case-handling-group.dto';

export class CaseHandlingGroupResourcePageQueryDto extends CaseHandlingGroupPageQueryDto {}

export class CaseHandlingGroupResourceSnapshotDto {
  @ApiProperty({ format: 'uuid' }) groupId!: string;
  @ApiProperty({ minimum: 1 }) revision!: number;
  @ApiProperty({ enum: ['ACTIVE', 'DISSOLVED'] }) status!:
    'ACTIVE' | 'DISSOLVED';
}

export class CaseHandlingGroupMaterialRowDto {
  @ApiProperty({ format: 'uuid' }) caseId!: string;
  @ApiProperty() businessNo!: string;
  @ApiProperty({ format: 'uuid' }) materialId!: string;
  @ApiProperty({ format: 'uuid' }) contentVersionId!: string;
  @ApiProperty() originalFilename!: string;
  @ApiProperty() mimeType!: string;
  @ApiProperty({ type: String, pattern: '^(0|[1-9][0-9]*)$' })
  sizeBytes!: string;
  @ApiProperty({ pattern: '^[a-f0-9]{64}$' }) sha256!: string;
  @ApiProperty({
    enum: Object.values(MaterialCategory).filter(
      (value) => value !== 'FEE_PROOF',
    ),
  })
  category!: Exclude<MaterialCategory, 'FEE_PROOF'>;
  @ApiProperty() purpose!: string;
  @ApiProperty() isCurrent!: boolean;
}

export class CaseHandlingGroupMaterialsDto extends CaseHandlingGroupResourceSnapshotDto {
  @ApiProperty({ type: [CaseHandlingGroupMaterialRowDto] })
  items!: CaseHandlingGroupMaterialRowDto[];
  @ApiProperty({ minimum: 0 }) total!: number;
  @ApiProperty({ minimum: 1 }) page!: number;
  @ApiProperty({ minimum: 1, maximum: 100 }) pageSize!: number;
}

export class CaseHandlingGroupNotarySummaryDto {
  @ApiProperty({ format: 'uuid' }) caseId!: string;
  @ApiProperty() businessNo!: string;
  @ApiProperty({
    enum: ['NOTARY_CERTIFICATE_FEE', 'NOTARY_MATTER_EVIDENCE'],
    description:
      'SAMPLE uses NOTARY_MATTER_EVIDENCE with the original matter ID; other categories use NOTARY_CERTIFICATE_FEE with the original certificate ID',
  })
  sourceType!: 'NOTARY_CERTIFICATE_FEE' | 'NOTARY_MATTER_EVIDENCE';
  @ApiProperty({
    format: 'uuid',
    description:
      'Original certificate ID or notary matter ID; category completes source identity',
  })
  sourceId!: string;
  @ApiProperty({ enum: ['NOTARY', 'INVESTIGATION', 'DISCLOSURE', 'SAMPLE'] })
  category!: 'NOTARY' | 'INVESTIGATION' | 'DISCLOSURE' | 'SAMPLE';
  @ApiProperty({ enum: NotarySampleFeeState }) state!: NotarySampleFeeState;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Original decimal amount: PENDING stays null and a known zero stays "0.00"',
  })
  amount!: string | null;
}

export class CaseHandlingGroupFeeRecordDto {
  @ApiProperty({ format: 'uuid' }) feeId!: string;
  @ApiProperty({ format: 'uuid' }) caseId!: string;
  @ApiProperty() businessNo!: string;
  @ApiProperty() type!: string;
  @ApiProperty({ enum: ['收入', '支出'] }) direction!: '收入' | '支出';
  @ApiProperty() status!: string;
  @ApiProperty() amount!: string;
  @ApiProperty({ format: 'date' }) feeDate!: string;
  @ApiProperty() source!: string;
  @ApiProperty({ type: String, nullable: true }) sourceKind!: string | null;
  @ApiProperty({ type: String, nullable: true }) sourceId!: string | null;
  @ApiProperty({ type: String, nullable: true }) note!: string | null;
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  proofMaterialId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  proofContentVersionId!: string | null;
  @ApiProperty({ type: String, nullable: true }) proofOriginalFilename!:
    string | null;
}

export class CaseHandlingGroupFeeLedgerDto {
  @ApiProperty({ type: [CaseHandlingGroupFeeRecordDto] })
  items!: CaseHandlingGroupFeeRecordDto[];
  @ApiProperty({ minimum: 0 }) total!: number;
  @ApiProperty({ minimum: 1 }) page!: number;
  @ApiProperty({ minimum: 1, maximum: 100 }) pageSize!: number;
}

export class CaseHandlingGroupFeesDto extends CaseHandlingGroupResourceSnapshotDto {
  @ApiProperty({
    type: [CaseHandlingGroupNotarySummaryDto],
    description:
      'All original source summaries for currently readable members, independent of page/pageSize and ledger total; amounts are not added to the ledger',
  })
  notarySummaries!: CaseHandlingGroupNotarySummaryDto[];
  @ApiProperty({
    description: 'Requires the existing fee.read permission independently',
  })
  canReadLedger!: boolean;
  @ApiProperty({
    type: CaseHandlingGroupFeeLedgerDto,
    nullable: true,
    description:
      'Null when canReadLedger is false; otherwise page/pageSize apply only to original FeeRecord rows of currently readable members',
  })
  ledger!: CaseHandlingGroupFeeLedgerDto | null;
}
