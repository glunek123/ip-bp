import {
  Body,
  Controller,
  ForbiddenException,
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
@Controller('cases')
@UseGuards(ActorContextGuard, CsrfGuard)
export class CaseExecutionFilingFollowupController {
  constructor(private readonly followups: CaseExecutionFilingFollowupService) {}

  private internal(actor: ActorContext) {
    if (
      actor.clientCustomerId !== undefined ||
      actor.notaryOfficeId !== undefined ||
      actor.lawyerAccountId !== undefined
    )
      throw new ForbiddenException({
        code: 'ACTION_FORBIDDEN',
        message: '无权办理执行申请后续资料',
      });
  }

  @Post(':id/execution-filings/:filingId/feedbacks')
  @ApiCreatedResponse({ type: ExecutionFilingFeedbackResultDto })
  recordFeedback(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) caseId: string,
    @Param('filingId', new ParseUUIDPipe({ version: '4' })) filingId: string,
    @Body() body: RecordExecutionFilingFeedbackDto,
  ): Promise<ExecutionFilingFeedbackResultDto> {
    this.internal(actor);
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
    this.internal(actor);
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
    this.internal(actor);
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
    this.internal(actor);
    return this.followups.correctSupplement(actor, caseId, {
      ...body,
      filingId,
      supplementId,
    });
  }
}

@ApiTags('cases')
@ApiBearerAuth()
@Controller('lawyer/cases')
@UseGuards(ActorContextGuard, CsrfGuard)
export class LawyerCaseExecutionFilingFollowupController {
  constructor(private readonly followups: CaseExecutionFilingFollowupService) {}

  private lawyer(actor: ActorContext) {
    if (
      actor.lawyerAccountId !== actor.userId ||
      actor.clientCustomerId !== undefined ||
      actor.notaryOfficeId !== undefined
    )
      throw new ForbiddenException({
        code: 'ACTION_FORBIDDEN',
        message: '无权办理执行申请后续资料',
      });
  }

  @Post(':id/execution-filings/:filingId/feedbacks')
  @ApiCreatedResponse({ type: ExecutionFilingFeedbackResultDto })
  recordFeedback(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) caseId: string,
    @Param('filingId', new ParseUUIDPipe({ version: '4' })) filingId: string,
    @Body() body: RecordExecutionFilingFeedbackDto,
  ): Promise<ExecutionFilingFeedbackResultDto> {
    this.lawyer(actor);
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
    this.lawyer(actor);
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
    this.lawyer(actor);
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
    this.lawyer(actor);
    return this.followups.correctSupplement(actor, caseId, {
      ...body,
      filingId,
      supplementId,
    });
  }
}
