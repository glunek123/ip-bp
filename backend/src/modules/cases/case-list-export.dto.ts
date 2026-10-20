import { OmitType } from '@nestjs/swagger';
import { CasePageQueryDto } from './case-read.dto';

export class CaseListExportInput extends OmitType(CasePageQueryDto, [
  'page',
  'pageSize',
] as const) {}
