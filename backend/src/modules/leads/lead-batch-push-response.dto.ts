import { ApiProperty } from '@nestjs/swagger';
import { LeadPushResponseDto } from './lead-push-response.dto';

export class LeadBatchPushResponseDto {
  @ApiProperty({ type: [LeadPushResponseDto], minItems: 1, maxItems: 20 })
  items!: LeadPushResponseDto[];
}
