import { ApiProperty } from '@nestjs/swagger';

export class CaseListExportCapabilityDto {
  @ApiProperty()
  canExport!: boolean;
}
