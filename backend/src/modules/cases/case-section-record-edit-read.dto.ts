import { ApiProperty, IntersectionType, PickType } from '@nestjs/swagger';
import {
  CorrectExecutionMailingRecordDto,
  CorrectExecutionFilingRecordDto,
  CorrectExecutionFinishRecordDto,
  CorrectHearingRecordDto,
  CorrectJudgmentRecordDto,
  CorrectClosureRecordDto,
} from './case-section-record-edit.dto';
export class SectionRecordFileDto {
  @ApiProperty({ format: 'uuid' }) materialId!: string;
  @ApiProperty({ format: 'uuid' }) contentVersionId!: string;
  @ApiProperty() originalFilename!: string;
  @ApiProperty() mimeType!: string;
}
class SectionRecordCorrectionHistoryMetadataDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  priorCorrectionId!: string | null;
  @ApiProperty() fromRevision!: number;
  @ApiProperty() toRevision!: number;
  @ApiProperty() correctionReason!: string;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
  @ApiProperty({ format: 'uuid' }) recordedByUserId!: string;
}
export class ExecutionMailingRecordValuesDto extends PickType(
  CorrectExecutionMailingRecordDto,
  ['mailedAt', 'mailReceiptContentVersionIds'] as const,
) {
  @ApiProperty({ type: [SectionRecordFileDto] }) files!: SectionRecordFileDto[];
}
export class ExecutionMailingRecordHistoryDto extends IntersectionType(
  ExecutionMailingRecordValuesDto,
  SectionRecordCorrectionHistoryMetadataDto,
) {}
export class ExecutionMailingRecordEditsDto {
  @ApiProperty({ format: 'uuid' }) mailingId!: string;
  @ApiProperty() mailingRevision!: number;
  @ApiProperty() canEdit!: boolean;
  @ApiProperty({ type: ExecutionMailingRecordValuesDto })
  original!: ExecutionMailingRecordValuesDto;
  @ApiProperty({ type: ExecutionMailingRecordValuesDto })
  effective!: ExecutionMailingRecordValuesDto;
  @ApiProperty({ type: [ExecutionMailingRecordHistoryDto] })
  history!: ExecutionMailingRecordHistoryDto[];
}
export class ExecutionFilingRecordValuesDto extends PickType(
  CorrectExecutionFilingRecordDto,
  ['submittedAt', 'executionFilingProofContentVersionIds'] as const,
) {
  @ApiProperty({ type: [SectionRecordFileDto] }) files!: SectionRecordFileDto[];
}
export class ExecutionFilingRecordHistoryDto extends IntersectionType(
  ExecutionFilingRecordValuesDto,
  SectionRecordCorrectionHistoryMetadataDto,
) {}
export class ExecutionFilingRecordEditsDto {
  @ApiProperty({ format: 'uuid' }) filingId!: string;
  @ApiProperty() filingRevision!: number;
  @ApiProperty() canEdit!: boolean;
  @ApiProperty({ type: ExecutionFilingRecordValuesDto })
  original!: ExecutionFilingRecordValuesDto;
  @ApiProperty({ type: ExecutionFilingRecordValuesDto })
  effective!: ExecutionFilingRecordValuesDto;
  @ApiProperty({ type: [ExecutionFilingRecordHistoryDto] })
  history!: ExecutionFilingRecordHistoryDto[];
}
export class ExecutionFinishRecordValuesDto extends PickType(
  CorrectExecutionFinishRecordDto,
  ['finishedAt', 'reason', 'basisNote', 'basisContentVersionIds'] as const,
) {
  @ApiProperty({ type: [SectionRecordFileDto] }) files!: SectionRecordFileDto[];
}
export class ExecutionFinishRecordHistoryDto extends IntersectionType(
  ExecutionFinishRecordValuesDto,
  SectionRecordCorrectionHistoryMetadataDto,
) {}
export class ExecutionFinishRecordEditsDto {
  @ApiProperty({ format: 'uuid' }) finishId!: string;
  @ApiProperty() finishRevision!: number;
  @ApiProperty() canEdit!: boolean;
  @ApiProperty({ type: ExecutionFinishRecordValuesDto })
  original!: ExecutionFinishRecordValuesDto;
  @ApiProperty({ type: ExecutionFinishRecordValuesDto })
  effective!: ExecutionFinishRecordValuesDto;
  @ApiProperty({ type: [ExecutionFinishRecordHistoryDto] })
  history!: ExecutionFinishRecordHistoryDto[];
}
export class HearingRecordValuesDto extends PickType(CorrectHearingRecordDto, [
  'hearingAt',
  'hearingPlace',
  'judgeName',
] as const) {}
export class HearingRecordHistoryDto extends IntersectionType(
  HearingRecordValuesDto,
  SectionRecordCorrectionHistoryMetadataDto,
) {}
export class HearingRecordEditsDto {
  @ApiProperty({ format: 'uuid' }) arrangementId!: string;
  @ApiProperty({ format: 'uuid' }) trialRoundId!: string;
  @ApiProperty() hearingRevision!: number;
  @ApiProperty() canEdit!: boolean;
  @ApiProperty({ type: HearingRecordValuesDto })
  original!: HearingRecordValuesDto;
  @ApiProperty({ type: HearingRecordValuesDto })
  effective!: HearingRecordValuesDto;
  @ApiProperty({ type: [HearingRecordHistoryDto] })
  history!: HearingRecordHistoryDto[];
}
export class JudgmentRecordValuesDto extends PickType(
  CorrectJudgmentRecordDto,
  [
    'judgmentReceivedAt',
    'judgmentAmountState',
    'judgmentAmount',
    'paidLitigationFeeState',
    'paidLitigationFee',
    'judgmentContentVersionIds',
  ] as const,
) {
  @ApiProperty({ type: [SectionRecordFileDto] }) files!: SectionRecordFileDto[];
}
export class JudgmentRecordHistoryDto extends IntersectionType(
  JudgmentRecordValuesDto,
  SectionRecordCorrectionHistoryMetadataDto,
) {}
export class JudgmentRecordEditsDto {
  @ApiProperty({ format: 'uuid' }) judgmentId!: string;
  @ApiProperty({ format: 'uuid' }) trialRoundId!: string;
  @ApiProperty() judgmentRevision!: number;
  @ApiProperty() canEdit!: boolean;
  @ApiProperty({ type: JudgmentRecordValuesDto })
  original!: JudgmentRecordValuesDto;
  @ApiProperty({ type: JudgmentRecordValuesDto })
  effective!: JudgmentRecordValuesDto;
  @ApiProperty({ type: [JudgmentRecordHistoryDto] })
  history!: JudgmentRecordHistoryDto[];
}
export class ClosureRecordValuesDto extends PickType(CorrectClosureRecordDto, [
  'closeAt',
  'closeAmountState',
  'closeAmt',
  'note',
  'closeContentVersionIds',
] as const) {
  @ApiProperty({ type: [SectionRecordFileDto] }) files!: SectionRecordFileDto[];
}
export class ClosureRecordHistoryDto extends IntersectionType(
  ClosureRecordValuesDto,
  SectionRecordCorrectionHistoryMetadataDto,
) {}
export class ClosureRecordEditsDto {
  @ApiProperty({ format: 'uuid' }) closureId!: string;
  @ApiProperty() closureRevision!: number;
  @ApiProperty() canEdit!: boolean;
  @ApiProperty({ type: ClosureRecordValuesDto })
  original!: ClosureRecordValuesDto;
  @ApiProperty({ type: ClosureRecordValuesDto })
  effective!: ClosureRecordValuesDto;
  @ApiProperty({ type: [ClosureRecordHistoryDto] })
  history!: ClosureRecordHistoryDto[];
}
