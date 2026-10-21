import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, ValidateIf } from 'class-validator';
import type { ReportView } from '../../access-control/access-control.service';

export class ReportsCenterQueryDto {
  @ApiPropertyOptional({ enum: ['mine', 'department'] })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsIn(['mine', 'department'])
  view?: ReportView;
}
