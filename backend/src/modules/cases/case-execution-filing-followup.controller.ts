import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import { ActorContext } from '../../access-control/actor-context';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { CaseExecutionFilingFollowupService } from './case-execution-filing-followup.service';
import {
  RecordExecutionFilingFeedbackDto,
  CorrectExecutionFilingFeedbackDto,
  SubmitExecutionFilingSupplementDto,
  CorrectExecutionFilingSupplementDto,
  ExecutionFilingFeedbackResultDto,
  ExecutionFilingSupplementResultDto,
} from './case-execution-filing-followup.dto';

@ApiTags('cases')
@ApiBearerAuth()
@Controller(['cases', 'lawyer/cases'])
@UseGuards(ActorContextGuard, CsrfGuard)
export class CaseExecutionFilingFollowupController {
  constructor(private readonly followups: CaseExecutionFilingFollowupService) {}

  @Post(':id/execution-filings/:filingId/feedbacks')
  @ApiCreatedResponse({ type: ExecutionFilingFeedbackResultDto })
  recordFeedback(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) caseId: string,
    @Param('filingId', new ParseUUIDPipe({ version: '4' })) filingId: string,
    @Body() body: RecordExecutionFilingFeedbackDto,
  ): Promise<ExecutionFilingFeedbackResultDto> {
    return this.followups.recordFeedback(actor, caseId, { ...body, filingId });
  }

  @Post(':id/execution-filings/:filingId/feedbacks/:feedbackId/corrections')
  @ApiCreatedResponse({ type: ExecutionFilingFeedbackResultDto })
  correctFeedback(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) caseId: string,
    @Param('filingId', new ParseUUIDPipe({ version: '4' })) filingId: string,
    @Param('feedbackId', new ParseUUIDPipe({ version: '4' }))
    feedbackId: string,
    @Body() body: CorrectExecutionFilingFeedbackDto,
  ): Promise<ExecutionFilingFeedbackResultDto> {
    return this.followups.correctFeedback(actor, caseId, {
      ...body,
      filingId,
      feedbackId,
    });
  }

  @Post(':id/execution-filings/:filingId/supplements')
  @ApiCreatedResponse({ type: ExecutionFilingSupplementResultDto })
  submitSupplement(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) caseId: string,
    @Param('filingId', new ParseUUIDPipe({ version: '4' })) filingId: string,
    @Body() body: SubmitExecutionFilingSupplementDto,
  ): Promise<ExecutionFilingSupplementResultDto> {
    return this.followups.submitSupplement(actor, caseId, {
      ...body,
      filingId,
    });
  }

  @Post(':id/execution-filings/:filingId/supplements/:supplementId/corrections')
  @ApiCreatedResponse({ type: ExecutionFilingSupplementResultDto })
  correctSupplement(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) caseId: string,
    @Param('filingId', new ParseUUIDPipe({ version: '4' })) filingId: string,
    @Param('supplementId', new ParseUUIDPipe({ version: '4' }))
    supplementId: string,
    @Body() body: CorrectExecutionFilingSupplementDto,
  ): Promise<ExecutionFilingSupplementResultDto> {
    return this.followups.correctSupplement(actor, caseId, {
      ...body,
      filingId,
      supplementId,
    });
  }
}
