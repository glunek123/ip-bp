import { OmitType } from '@nestjs/swagger';
import { CasePageQueryDto } from './case-read.dto';
import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsUUID,
} from 'class-validator';

export class CaseListExportInput extends OmitType(CasePageQueryDto, [
  'page',
  'pageSize',
] as const) {}

export class CaseSelectionExportInput {
  @ApiProperty({ enum: ['mine', 'department'] })
  @IsIn(['mine', 'department'])
  view!: 'mine' | 'department';

  @ApiProperty({ type: [String], format: 'uuid', minItems: 1, maxItems: 1000 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  ids!: string[];
}
