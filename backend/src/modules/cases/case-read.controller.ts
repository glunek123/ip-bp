import { CaseArchiveService } from './case-archive.service';
import {
  ArchiveCaseInput,
  CorrectCaseArchiveInput,
  CaseArchiveResult,
} from './case-archive.dto';
import { CaseClosureService } from './case-closure.service';
import {
  RecordCaseClosureInput,
  CorrectCaseClosureInput,
  CaseClosureResult,
} from './case-closure.dto';
import {
  FinishCaseExecutionDto,
  FinishCaseExecutionResponseDto,
} from './case-execution-finish.dto';
import { CaseExecutionFinishService } from './case-execution-finish.service';
import { CaseExecutionMailingService } from './case-execution-mailing.service';
import { CaseExecutionFilingService } from './case-execution-filing.service';
import {
  MailCaseExecutionDto,
  MailCaseExecutionResponseDto,
} from './case-execution-mailing.dto';
import {
  SubmitCaseExecutionFilingDto,
  SubmitCaseExecutionFilingResponseDto,
} from './case-execution-filing.dto';
import {
  Controller,
  Body,
  ForbiddenException,
  Get,
  Post,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ActorContext } from '../../access-control/actor-context';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import {
  CaseDetailResponseDto,
  CaseListResponseDto,
  CasePageQueryDto,
} from './case-read.dto';
import { CaseReadService } from './case-read.service';
import { CaseMatchService } from './case-match.service';
import { MatchCaseDto, MatchCaseResponseDto } from './case-match.dto';
import { CaseComplaintService } from './case-complaint.service';
import { CaseComplaintConfirmationService } from './case-complaint-confirmation.service';
import { CaseComplaintMailingService } from './case-complaint-mailing.service';
import { CaseFilingService } from './case-filing.service';
import { CaseAcceptanceService } from './case-acceptance.service';
import { CaseRecordEditService } from './case-record-edit.service';
import {
  AcceptanceCorrectionResultDto,
  CorrectCaseAcceptanceDto,
  DefendantContactUpdateResultDto,
  SaveSecondInstanceAcceptanceDto,
  SaveSecondInstanceAcceptanceResultDto,
  UpdateDefendantContactDto,
} from './case-record-edit.dto';
import { CaseHearingService } from './case-hearing.service';
import { CaseJudgmentService } from './case-judgment.service';
import { CaseJudgmentNextStepService } from './case-judgment-next-step.service';
import { CaseSecondInstanceService } from './case-second-instance.service';
import { CaseExecutionSubmissionService } from './case-execution-submission.service';
import { CaseExecutionConfirmationService } from './case-execution-confirmation.service';
import {
  ConfirmExecutionRequestDto,
  ConfirmExecutionResultDto,
} from './case-execution-confirmation.dto';
import {
  SubmitExecutionRequestDto,
  SubmitExecutionResultDto,
} from './case-execution-submission.dto';
import {
  RegisterSecondInstanceResultDto,
  RevokeSecondInstanceResultDto,
  SaveSecondInstanceDto,
  SecondInstanceCommandResultDto,
} from './case-second-instance.dto';
import {
  ChooseJudgmentNextStepDto,
  JudgmentNextStepResultDto,
  RevokeJudgmentNextStepDto,
  RevokeJudgmentNextStepResultDto,
} from './case-judgment-next-step.dto';
import {
  CaseJudgmentCommandResultDto,
  CorrectCaseJudgmentDto,
  RegisterCaseJudgmentDto,
} from './case-judgment.dto';
import {
  CaseHearingCommandResultDto,
  CorrectCaseHearingDto,
  SaveCaseHearingDto,
} from './case-hearing.dto';
import {
  RegisterCaseAcceptanceDto,
  RegisterCaseAcceptanceResponseDto,
} from './case-acceptance.dto';
import { FilingCourtService } from './filing-court.service';
import {
  CreateFilingCourtDto,
  FilingCourtDto,
  FilingCourtListDto,
  SubmitCaseFilingDto,
  SubmitCaseFilingResponseDto,
} from './case-filing.dto';
import {
  MailCaseComplaintDto,
  MailCaseComplaintResponseDto,
} from './case-complaint-mailing.dto';
import {
  ConfirmCaseComplaintDto,
  ConfirmCaseComplaintResponseDto,
} from './case-complaint-confirmation.dto';
import {
  SubmitCaseComplaintDto,
  SubmitCaseComplaintResponseDto,
} from './case-complaint.dto';

@ApiTags('cases')
@ApiBearerAuth()
@Controller('cases')
@UseGuards(ActorContextGuard, CsrfGuard)
export class CaseReadController {
  constructor(
    private readonly cases: CaseReadService,
    private readonly matching: CaseMatchService,
    private readonly complaint: CaseComplaintService,
    private readonly confirmation: CaseComplaintConfirmationService,
    private readonly mailing: CaseComplaintMailingService,
    private readonly filing: CaseFilingService,
    private readonly acceptance: CaseAcceptanceService,
    private readonly recordEdit: CaseRecordEditService,
    private readonly hearing: CaseHearingService,
    private readonly judgment: CaseJudgmentService,
    private readonly judgmentNextStep: CaseJudgmentNextStepService,
    private readonly secondInstance: CaseSecondInstanceService,
    private readonly executionSubmission: CaseExecutionSubmissionService,
    private readonly executionConfirmation: CaseExecutionConfirmationService,
    private readonly executionMailing: CaseExecutionMailingService,
    private readonly executionFiling: CaseExecutionFilingService,
    private readonly executionFinish: CaseExecutionFinishService,
    private readonly closure: CaseClosureService,
    private readonly archive: CaseArchiveService,
    private readonly courts: FilingCourtService,
  ) {}

  @Get()
  @ApiOkResponse({ type: CaseListResponseDto })
  list(@CurrentActor() actor: ActorContext, @Query() query: CasePageQueryDto) {
    return this.cases.list(
      actor,
      query.page,
      query.pageSize,
      query.view,
      query.stage,
      query.stageGroup,
    );
  }

  @Get(':id')
  @ApiOkResponse({ type: CaseDetailResponseDto })
  get(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.cases.get(actor, id);
  }

  @Post(':id/defendant-contact-update')
  @ApiCreatedResponse({ type: DefendantContactUpdateResultDto })
  updateDefendantContact(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: UpdateDefendantContactDto,
  ) {
    return this.recordEdit.updateContact(actor, id, body);
  }

  @Post(':id/acceptance-correction')
  @ApiCreatedResponse({ type: AcceptanceCorrectionResultDto })
  correctAcceptance(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: CorrectCaseAcceptanceDto,
  ) {
    return this.recordEdit.correctAcceptance(actor, id, body);
  }

  @Post(':id/second-instance-acceptance-save')
  @ApiCreatedResponse({ type: SaveSecondInstanceAcceptanceResultDto })
  saveSecondInstanceAcceptance(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: SaveSecondInstanceAcceptanceDto,
  ) {
    return this.recordEdit.saveSecondInstanceAcceptance(actor, id, body);
  }

  @Post(':id/execution-mail')
  @ApiCreatedResponse({ type: MailCaseExecutionResponseDto })
  mailExecution(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: MailCaseExecutionDto,
  ) {
    if (
      actor.clientCustomerId !== undefined ||
      actor.notaryOfficeId !== undefined
    )
      throw new ForbiddenException({
        code: 'ACTION_FORBIDDEN',
        message: '无权登记执行邮寄',
      });
    return this.executionMailing.mail(actor, id, body);
  }

  @Post(':id/archive')
  @ApiCreatedResponse({ type: CaseArchiveResult })
  archiveCase(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: ArchiveCaseInput,
  ) {
    return this.archive.archive(actor, id, body);
  }
  @Post(':id/archive-correction')
  @ApiCreatedResponse({ type: CaseArchiveResult })
  correctArchive(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: CorrectCaseArchiveInput,
  ) {
    return this.archive.correct(actor, id, body);
  }
  @Post(':id/closure')
  @ApiCreatedResponse({ type: CaseClosureResult })
  recordClosure(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: RecordCaseClosureInput,
  ) {
    return this.closure.record(actor, id, body);
  }

  @Post(':id/closure-correction')
  @ApiCreatedResponse({ type: CaseClosureResult })
  correctClosure(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: CorrectCaseClosureInput,
  ) {
    return this.closure.correct(actor, id, body);
  }

  @Post(':id/execution-finish')
  @ApiCreatedResponse({ type: FinishCaseExecutionResponseDto })
  finishExecution(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: FinishCaseExecutionDto,
  ) {
    return this.executionFinish.finish(actor, id, body);
  }
  @Post(':id/execution-filing-submit')
  @ApiCreatedResponse({ type: SubmitCaseExecutionFilingResponseDto })
  submitExecutionFiling(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: SubmitCaseExecutionFilingDto,
  ) {
    return this.executionFiling.submit(actor, id, body);
  }
  @Post(':id/execution-submit')
  @ApiCreatedResponse({ type: SubmitExecutionResultDto })
  submitExecution(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: SubmitExecutionRequestDto,
  ) {
    return this.executionSubmission.submit(actor, id, body);
  }

  @Post(':id/execution-confirm')
  @ApiCreatedResponse({ type: ConfirmExecutionResultDto })
  confirmExecution(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ConfirmExecutionRequestDto,
  ) {
    return this.executionConfirmation.confirm(actor, id, body);
  }

  @Post(':id/match')
  @ApiOkResponse({ type: MatchCaseResponseDto })
  match(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: MatchCaseDto,
  ) {
    return this.matching.match(actor, id, body);
  }

  @Post(':id/complaint-submit')
  @ApiOkResponse({ type: SubmitCaseComplaintResponseDto })
  submitComplaint(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: SubmitCaseComplaintDto,
  ) {
    return this.complaint.submit(actor, id, body);
  }

  @Post(':id/complaint-confirm')
  @ApiOkResponse({ type: ConfirmCaseComplaintResponseDto })
  confirmComplaint(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ConfirmCaseComplaintDto,
  ) {
    return this.confirmation.confirm(actor, id, body);
  }

  @Post(':id/complaint-mail')
  @ApiOkResponse({ type: MailCaseComplaintResponseDto })
  mailComplaint(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: MailCaseComplaintDto,
  ) {
    if (
      actor.clientCustomerId !== undefined ||
      actor.notaryOfficeId !== undefined
    )
      throw new ForbiddenException({
        code: 'ACTION_FORBIDDEN',
        message: '无权登记邮寄',
      });
    return this.mailing.mail(actor, id, body);
  }

  @Get(':id/filing-courts')
  @ApiOkResponse({ type: FilingCourtListDto })
  filingCourts(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.courts.list(actor, id);
  }

  @Post(':id/filing-courts')
  @ApiCreatedResponse({ type: FilingCourtDto })
  createFilingCourt(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: CreateFilingCourtDto,
  ) {
    return this.courts.create(actor, id, body);
  }

  @Post(':id/filing-submit')
  @ApiCreatedResponse({ type: SubmitCaseFilingResponseDto })
  submitFiling(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: SubmitCaseFilingDto,
  ) {
    return this.filing.submit(actor, id, body);
  }

  @Post(':id/acceptance-register')
  @ApiCreatedResponse({ type: RegisterCaseAcceptanceResponseDto })
  registerAcceptance(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: RegisterCaseAcceptanceDto,
  ) {
    return this.acceptance.register(actor, id, body);
  }

  @Post(':id/hearing-schedule')
  @ApiCreatedResponse({ type: CaseHearingCommandResultDto })
  scheduleHearing(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: SaveCaseHearingDto,
  ) {
    return this.hearing.schedule(actor, id, body);
  }

  @Post(':id/hearing-correct')
  @ApiCreatedResponse({ type: CaseHearingCommandResultDto })
  correctHearing(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: CorrectCaseHearingDto,
  ) {
    return this.hearing.correct(actor, id, body);
  }

  @Post(':id/judgment-register')
  @ApiCreatedResponse({ type: CaseJudgmentCommandResultDto })
  registerJudgment(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: RegisterCaseJudgmentDto,
  ) {
    return this.judgment.register(actor, id, body);
  }

  @Post(':id/judgment-correct')
  @ApiCreatedResponse({ type: CaseJudgmentCommandResultDto })
  correctJudgment(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: CorrectCaseJudgmentDto,
  ) {
    return this.judgment.correct(actor, id, body);
  }

  @Post(':id/judgment-next-step')
  @ApiCreatedResponse({ type: JudgmentNextStepResultDto })
  chooseJudgmentNextStep(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ChooseJudgmentNextStepDto,
  ) {
    return this.judgmentNextStep.choose(actor, id, body);
  }

  @Post(':id/judgment-next-step-revoke')
  @ApiCreatedResponse({ type: RevokeJudgmentNextStepResultDto })
  revokeJudgmentNextStep(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: RevokeJudgmentNextStepDto,
  ) {
    return this.judgmentNextStep.revoke(actor, id, body);
  }

  @Post(':id/second-instance-save')
  @ApiCreatedResponse({ type: SecondInstanceCommandResultDto })
  saveSecondInstance(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: SaveSecondInstanceDto,
  ) {
    return this.secondInstance.save(actor, id, body);
  }

  @Post(':id/second-instance-result')
  @ApiCreatedResponse({ type: SecondInstanceCommandResultDto })
  registerSecondInstanceResult(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: RegisterSecondInstanceResultDto,
  ) {
    return this.secondInstance.registerResult(actor, id, body);
  }

  @Post(':id/second-instance-result-revoke')
  @ApiCreatedResponse({ type: SecondInstanceCommandResultDto })
  revokeSecondInstanceResult(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: RevokeSecondInstanceResultDto,
  ) {
    return this.secondInstance.revokeResult(actor, id, body);
  }
}
