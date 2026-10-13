import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class CalendarMonthQueryDto {
  @ApiProperty({
    example: '2026-10',
    pattern: '^(?!0000)\\d{4}-(0[1-9]|1[0-2])$',
  })
  @IsString()
  @Matches(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/)
  month!: string;
}

// Global ValidationPipe forbids every unknown query key on this route.
export class CalendarSummaryQueryDto {}
