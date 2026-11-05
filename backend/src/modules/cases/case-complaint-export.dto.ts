import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class ComplaintExportPreviewDto {
  @ApiProperty({ type: [String], minItems: 1, maxItems: 20 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Matches(uuid, { each: true })
  caseIds!: string[];
}
export class ComplaintExportSelectionDto {
  @ApiProperty({ format: 'uuid' }) @IsString() @Matches(uuid) caseId!: string;
  @ApiProperty({ format: 'uuid' })
  @IsString()
  @Matches(uuid)
  materialId!: string;
  @ApiProperty({ format: 'uuid' })
  @IsString()
  @Matches(uuid)
  contentVersionId!: string;
}
export class ComplaintExportDownloadDto {
  @ApiProperty({
    type: [ComplaintExportSelectionDto],
    minItems: 1,
    maxItems: 100,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ComplaintExportSelectionDto)
  selections!: ComplaintExportSelectionDto[];
}
export type ComplaintExportCandidate = {
  materialId: string;
  contentVersionId: string;
  filename: string;
  sizeBytes: number;
  tags: Array<'UPLOADED' | 'SUBMITTED' | 'CONFIRMED'>;
};
export type ComplaintExportPreviewItem = {
  caseId: string;
  businessNo?: string;
  status: 'READY' | 'MISSING' | 'UNAVAILABLE';
  candidates: ComplaintExportCandidate[];
  reason?: string;
};
export type ComplaintExportResultItem = {
  caseId: string;
  successCount: number;
  failCount: number;
  errorCode?: string;
};
