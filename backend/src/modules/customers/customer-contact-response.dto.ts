import { ApiProperty } from '@nestjs/swagger';

export class ContactSummaryResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) customerId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) phone!: string | null;
  @ApiProperty({ type: String, nullable: true }) email!: string | null;
  @ApiProperty({ type: String, nullable: true }) duty!: string | null;
  @ApiProperty() isPrimary!: boolean;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) endedAt!:
    string | null;
  @ApiProperty({ type: String, nullable: true }) endReason!: string | null;
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiProperty({
    enum: ['LEGACY_BACKFILL', 'LEGACY_CREATE', 'ADMISSION_FREEFORM', 'MANUAL'],
  })
  origin!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class ContactCommandResultResponseDto {
  @ApiProperty({ type: ContactSummaryResponseDto })
  contact!: ContactSummaryResponseDto;
  @ApiProperty({ minimum: 1 }) customerVersion!: number;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  primaryContactId!: string | null;
}

export class ContactListResponseDto {
  @ApiProperty({ type: [ContactSummaryResponseDto] })
  items!: ContactSummaryResponseDto[];
  @ApiProperty({ minimum: 0 }) total!: number;
  @ApiProperty({ minimum: 1 }) page!: number;
  @ApiProperty({ minimum: 1, maximum: 100 }) pageSize!: number;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  primaryContactId!: string | null;
}

export class ContactVersionSnapshotResponseDto {
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) phone!: string | null;
  @ApiProperty({ type: String, nullable: true }) email!: string | null;
  @ApiProperty({ type: String, nullable: true }) duty!: string | null;
  @ApiProperty() isPrimary!: boolean;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) endedAt!:
    string | null;
  @ApiProperty({ type: String, nullable: true }) endReason!: string | null;
}

export class ContactVersionActorResponseDto {
  @ApiProperty({ enum: ['HUMAN', 'LEGACY_MIGRATION'] }) kind!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) userId!:
    string | null;
}

export class ContactVersionResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) contactId!: string;
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiProperty({
    enum: ['CREATED', 'UPDATED', 'PRIMARY_SET', 'PRIMARY_UNSET', 'ENDED'],
  })
  action!: string;
  @ApiProperty({
    type: ContactVersionSnapshotResponseDto,
    nullable: true,
  })
  before!: ContactVersionSnapshotResponseDto | null;
  @ApiProperty({ type: ContactVersionSnapshotResponseDto })
  after!: ContactVersionSnapshotResponseDto;
  @ApiProperty({ type: ContactVersionActorResponseDto })
  actor!: ContactVersionActorResponseDto;
  @ApiProperty({ format: 'date-time' }) occurredAt!: string;
}

export class ContactVersionListResponseDto {
  @ApiProperty({ type: [ContactVersionResponseDto] })
  items!: ContactVersionResponseDto[];
  @ApiProperty({ minimum: 0 }) total!: number;
  @ApiProperty({ minimum: 1 }) page!: number;
  @ApiProperty({ minimum: 1, maximum: 100 }) pageSize!: number;
}
