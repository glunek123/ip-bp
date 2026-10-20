import { ApiProperty } from '@nestjs/swagger';
import { LeadEvidenceDecisionResponseDto } from './lead-evidence-decision-response.dto';

export class LeadNoEvidenceBatchResponseDto {
  @ApiProperty({
    type: [LeadEvidenceDecisionResponseDto],
    minItems: 1,
    maxItems: 20,
  })
  items!: LeadEvidenceDecisionResponseDto[];
}
