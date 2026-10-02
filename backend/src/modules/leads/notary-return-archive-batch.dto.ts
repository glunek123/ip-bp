import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import {
  ArchiveNotaryReturnDto,
  NotaryReturnArchiveResponseDto,
} from './notary-return-archive.dto';

export class ArchiveNotaryReturnBatchItemDto extends ArchiveNotaryReturnDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  matterId!: string;
}

export class ArchiveNotaryReturnBatchDto {
  @ApiProperty({
    type: ArchiveNotaryReturnBatchItemDto,
    isArray: true,
    minItems: 1,
    maxItems: 50,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ArchiveNotaryReturnBatchItemDto)
  items!: ArchiveNotaryReturnBatchItemDto[];
}

export class NotaryReturnArchiveBatchResponseDto {
  @ApiProperty({ format: 'uuid' }) batchId!: string;
  @ApiProperty({ type: NotaryReturnArchiveResponseDto, isArray: true })
  items!: NotaryReturnArchiveResponseDto[];
}
