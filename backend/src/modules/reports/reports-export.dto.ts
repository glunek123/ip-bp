import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import type { ReportView } from '../../access-control/access-control.service';

export class ReportsExportDto {
  @ApiProperty({ enum: ['mine', 'department'] })
  @IsIn(['mine', 'department'])
  view!: ReportView;
}
