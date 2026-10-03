import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, Max, Min } from 'class-validator';

export class ClientCasePageQueryDto {
  @ApiPropertyOptional({ enum: ['PENDING', 'RECORDED'], default: 'PENDING' })
  @IsIn(['PENDING', 'RECORDED'])
  view: 'PENDING' | 'RECORDED' = 'PENDING';
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

export class ClientCaseFileDto {
  @ApiProperty({ format: 'uuid' }) materialId!: string;
  @ApiProperty({ format: 'uuid' }) contentVersionId!: string;
  @ApiProperty() originalFilename!: string;
  @ApiProperty() mimeType!: string;
}

export class ClientCaseListItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() businessNo!: string;
  @ApiProperty({ enum: ['WAITING_COMPLAINT_STAMP', 'WAITING_FILING'] })
  stage!: 'WAITING_COMPLAINT_STAMP' | 'WAITING_FILING';
  @ApiProperty() version!: number;
  @ApiProperty() canMailComplaint!: boolean;
  @ApiProperty() rightsHolderName!: string;
  @ApiProperty({ type: [String] }) defendantNames!: string[];
}

export class ClientCaseListResponseDto {
  @ApiProperty({ type: [ClientCaseListItemDto] })
  items!: ClientCaseListItemDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class ClientCaseMailingDto {
  @ApiProperty({ format: 'date' }) mailedAt!: string;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
  @ApiProperty({ type: [ClientCaseFileDto] })
  receiptFiles!: ClientCaseFileDto[];
}

export class ClientCaseDetailResponseDto extends ClientCaseListItemDto {
  @ApiProperty({ enum: ['KNOWN', 'PENDING'] }) confirmedAmountState!:
    'KNOWN' | 'PENDING';
  @ApiProperty({ type: String, nullable: true }) confirmedAmount!:
    string | null;
  @ApiProperty({ format: 'date-time' }) confirmedAt!: string;
  @ApiProperty({ type: ClientCaseFileDto, nullable: true })
  complaintFile!: ClientCaseFileDto | null;
  @ApiProperty({ type: [ClientCaseFileDto] })
  authorizationFiles!: ClientCaseFileDto[];
  @ApiProperty({ type: [ClientCaseFileDto] })
  pendingReceiptFiles!: ClientCaseFileDto[];
  @ApiProperty({ type: ClientCaseMailingDto, nullable: true })
  complaintMailing!: ClientCaseMailingDto | null;
}
