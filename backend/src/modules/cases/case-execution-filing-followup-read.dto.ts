import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class FollowupVersionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ minimum: 1 }) revision!: number;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
}
export class ExecutionFilingFeedbackVersionDto extends FollowupVersionDto {
  @ApiProperty({ type: String, format: 'date', nullable: true }) feedbackOn!:
    string | null;
  @ApiProperty({ type: String, nullable: true }) courtCaseNo!: string | null;
  @ApiProperty() content!: string;
}
class FeedbackHistoryDto extends ExecutionFilingFeedbackVersionDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Only internal reads include correction reasons; initial version is null.',
  })
  correctionReason?: string | null;
}
class SupplementFileDto {
  @ApiProperty({ format: 'uuid' }) materialId!: string;
  @ApiProperty({ format: 'uuid' }) contentVersionId!: string;
  @ApiProperty() originalFilename!: string;
  @ApiProperty() mimeType!: string;
}
export class ExecutionFilingSupplementVersionDto extends FollowupVersionDto {
  @ApiProperty({ type: String, format: 'date', nullable: true }) submittedOn!:
    string | null;
  @ApiProperty({ type: String, nullable: true }) note!: string | null;
  @ApiProperty({ type: [SupplementFileDto] }) files!: SupplementFileDto[];
}
class SupplementHistoryDto extends ExecutionFilingSupplementVersionDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Only internal reads include correction reasons; initial version is null.',
  })
  correctionReason?: string | null;
}
class FeedbackRootDto {
  @ApiProperty({ format: 'uuid' }) feedbackId!: string;
  @ApiProperty() canCorrect!: boolean;
  @ApiProperty({ type: ExecutionFilingFeedbackVersionDto })
  current!: ExecutionFilingFeedbackVersionDto;
  @ApiProperty({
    type: [FeedbackHistoryDto],
    description:
      'All immutable versions, including current, in ascending revision order.',
  })
  history!: FeedbackHistoryDto[];
}
class SupplementRootDto {
  @ApiProperty({ format: 'uuid' }) supplementId!: string;
  @ApiProperty() canCorrect!: boolean;
  @ApiProperty({ type: ExecutionFilingSupplementVersionDto })
  current!: ExecutionFilingSupplementVersionDto;
  @ApiProperty({
    type: [SupplementHistoryDto],
    description:
      'All immutable versions, including current, in ascending revision order.',
  })
  history!: SupplementHistoryDto[];
}
export class ExecutionFilingFollowupsDto {
  @ApiProperty({ format: 'uuid' }) filingId!: string;
  @ApiProperty() canRecordFeedback!: boolean;
  @ApiProperty() canSubmitSupplement!: boolean;
  @ApiProperty({ type: [FeedbackRootDto] }) feedbacks!: FeedbackRootDto[];
  @ApiProperty({ type: [SupplementRootDto] }) supplements!: SupplementRootDto[];
}
