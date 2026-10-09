import { ApiProperty } from '@nestjs/swagger';

export class CustomerSettlementCapabilitiesDto {
  @ApiProperty() read!: boolean;
  @ApiProperty() register!: boolean;
  @ApiProperty() correct!: boolean;
}

export class CustomerSettlementVersionResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) recordId!: string;
  @ApiProperty({ format: 'uuid' }) customerId!: string;
  @ApiProperty({ format: 'uuid' }) departmentId!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ enum: ['REGISTER', 'CORRECT'] }) action!:
    'REGISTER' | 'CORRECT';
  @ApiProperty({ format: 'date' }) settlementDate!: string;
  @ApiProperty() settlementAmount!: string;
  @ApiProperty({ type: String, nullable: true }) invoiceAmount!: string | null;
  @ApiProperty({ type: String, nullable: true }) receivedAmount!: string | null;
  @ApiProperty({ type: String, format: 'date', nullable: true }) receivedDate!:
    string | null;
  @ApiProperty({ type: String, nullable: true }) correctionReason!:
    string | null;
  @ApiProperty({ format: 'uuid' }) recordedByUserId!: string;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
  @ApiProperty({ format: 'uuid' }) auditEventId!: string;
}

export class CustomerSettlementRecordResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ type: () => CustomerSettlementVersionResponseDto })
  currentVersion!: CustomerSettlementVersionResponseDto;
}

export class CustomerSettlementStatsResponseDto {
  @ApiProperty() recordCount!: number;
  @ApiProperty() totalSettlement!: string;
  @ApiProperty() invoiceKnownSubtotal!: string;
  @ApiProperty() invoiceUnknownCount!: number;
  @ApiProperty() receivedKnownSubtotal!: string;
  @ApiProperty() receivedUnknownCount!: number;
  @ApiProperty({ type: String, nullable: true }) pendingAmount!: string | null;
  @ApiProperty({ type: String, nullable: true }) recoveryRate!: string | null;
}

export class CustomerSettlementListResponseDto {
  @ApiProperty({ type: () => [CustomerSettlementRecordResponseDto] })
  items!: CustomerSettlementRecordResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty({ type: () => CustomerSettlementStatsResponseDto })
  stats!: CustomerSettlementStatsResponseDto;
  @ApiProperty({ type: () => CustomerSettlementCapabilitiesDto })
  capabilities!: CustomerSettlementCapabilitiesDto;
  @ApiProperty() customerVersion!: number;
}

export class CustomerSettlementDetailResponseDto {
  @ApiProperty({ type: () => CustomerSettlementRecordResponseDto })
  record!: CustomerSettlementRecordResponseDto;
  @ApiProperty({ type: () => CustomerSettlementCapabilitiesDto })
  capabilities!: CustomerSettlementCapabilitiesDto;
  @ApiProperty() customerVersion!: number;
}

export class CustomerSettlementVersionListResponseDto {
  @ApiProperty({ type: () => [CustomerSettlementVersionResponseDto] })
  items!: CustomerSettlementVersionResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class CustomerSettlementCommandResponseDto {
  @ApiProperty({ format: 'uuid' }) recordId!: string;
  @ApiProperty() version!: number;
  @ApiProperty() customerVersion!: number;
  @ApiProperty({ type: () => CustomerSettlementVersionResponseDto })
  snapshot!: CustomerSettlementVersionResponseDto;
}
