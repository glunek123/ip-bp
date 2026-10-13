import { ApiProperty } from '@nestjs/swagger';

class CalendarMetricDto {
  @ApiProperty({ enum: ['AVAILABLE', 'NOT_CONNECTED', 'FORBIDDEN'] })
  state!: 'AVAILABLE' | 'NOT_CONNECTED' | 'FORBIDDEN';
  @ApiProperty({ type: Number, nullable: true })
  count!: number | null;
  @ApiProperty({ type: String, nullable: true, example: '2026-10-13' })
  nearestDate!: string | null;
}

class CalendarWindowDto {
  @ApiProperty({ example: '2026-10-13' }) from!: string;
  @ApiProperty({ example: '2026-11-12' }) through!: string;
}

class CalendarMetricsDto {
  @ApiProperty({ type: CalendarMetricDto }) next30!: CalendarMetricDto;
  @ApiProperty({ type: CalendarMetricDto }) court!: CalendarMetricDto;
  @ApiProperty({ type: CalendarMetricDto }) pay!: CalendarMetricDto;
  @ApiProperty({ type: CalendarMetricDto }) contract!: CalendarMetricDto;
  @ApiProperty({ type: CalendarMetricDto }) other!: CalendarMetricDto;
}

export class CalendarSummaryResponseDto {
  @ApiProperty({ example: '2026-10-13' }) today!: string;
  @ApiProperty({ enum: ['Asia/Shanghai'] }) timeZone!: 'Asia/Shanghai';
  @ApiProperty({ type: CalendarWindowDto }) window!: CalendarWindowDto;
  @ApiProperty({ type: CalendarMetricsDto }) metrics!: CalendarMetricsDto;
}

class CourtDetailsDto {
  @ApiProperty({ type: String, nullable: true }) party!: string | null;
  @ApiProperty({ type: String, nullable: true }) defendant!: string | null;
  @ApiProperty({ type: String, nullable: true }) reason!: string | null;
  @ApiProperty({ type: String, nullable: true }) time!: string | null;
  @ApiProperty({ type: String, nullable: true }) place!: string | null;
  @ApiProperty({ type: String, nullable: true }) judge!: string | null;
}

class CaseDetailsDto {
  @ApiProperty({ type: String, nullable: true }) customer!: string | null;
  @ApiProperty({ type: String, nullable: true }) rightsHolder!: string | null;
  @ApiProperty({ type: String, nullable: true }) defendant!: string | null;
  @ApiProperty({ type: String, nullable: true }) caseNumber!: string | null;
  @ApiProperty({ type: String, nullable: true }) amount!: string | null;
}

class CalendarDateEventDto {
  @ApiProperty() eventKey!: string;
  @ApiProperty({
    enum: [
      'FIRST_INSTANCE_HEARING',
      'SECOND_INSTANCE_HEARING',
      'CUSTOMER_AGREEMENT_EXPIRY',
    ],
  })
  sourceType!: string;
  @ApiProperty() sourceId!: string;
  @ApiProperty({ example: '2026-10-13' }) date!: string;
  @ApiProperty({ enum: ['court', 'contract'] }) type!: 'court' | 'contract';
  @ApiProperty() title!: string;
  @ApiProperty({ type: String, nullable: true }) sub!: string | null;
  @ApiProperty({ type: String, nullable: true }) caseId!: string | null;
  @ApiProperty({ type: String, nullable: true }) customerId!: string | null;
  @ApiProperty({ type: CourtDetailsDto, nullable: true })
  courtDetails!: CourtDetailsDto | null;
  @ApiProperty({ type: CaseDetailsDto, nullable: true })
  caseDetails!: CaseDetailsDto | null;
}

export class CalendarSnapshotResponseDto extends CalendarSummaryResponseDto {
  @ApiProperty({ example: '2026-10' }) month!: string;
  @ApiProperty({ type: CalendarDateEventDto, isArray: true })
  events!: CalendarDateEventDto[];
}
