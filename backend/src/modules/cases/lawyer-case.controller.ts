import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ActorContext } from '../../access-control/actor-context';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { CasePageQueryDto } from './case-read.dto';
import { CaseReadService } from './case-read.service';
import { CaseComplaintService } from './case-complaint.service';
import { CaseComplaintConfirmationService } from './case-complaint-confirmation.service';
import { CaseComplaintMailingService } from './case-complaint-mailing.service';
import { CaseFilingService } from './case-filing.service';
import { CaseAcceptanceService } from './case-acceptance.service';
import { CaseHearingService } from './case-hearing.service';
import { CaseJudgmentService } from './case-judgment.service';
import { RegisterCaseJudgmentDto } from './case-judgment.dto';
import { SaveCaseHearingDto } from './case-hearing.dto';
import { RegisterCaseAcceptanceDto } from './case-acceptance.dto';
import { FilingCourtService } from './filing-court.service';
import { SubmitCaseComplaintDto } from './case-complaint.dto';
import { ConfirmCaseComplaintDto } from './case-complaint-confirmation.dto';
import { MailCaseComplaintDto } from './case-complaint-mailing.dto';
import { CreateFilingCourtDto, SubmitCaseFilingDto } from './case-filing.dto';

@ApiTags('lawyer-cases')
@ApiBearerAuth()
@Controller('lawyer/cases')
@UseGuards(ActorContextGuard, CsrfGuard)
export class LawyerCaseController {
  constructor(
    private readonly cases: CaseReadService,
    private readonly complaint: CaseComplaintService,
    private readonly confirmation: CaseComplaintConfirmationService,
    private readonly mailing: CaseComplaintMailingService,
    private readonly filing: CaseFilingService,
    private readonly acceptance: CaseAcceptanceService,
    private readonly hearing: CaseHearingService,
    private readonly judgment: CaseJudgmentService,
    private readonly courts: FilingCourtService,
  ) {}

  private lawyer(actor: ActorContext) {
    if (
      actor.lawyerAccountId !== actor.userId ||
      actor.clientCustomerId ||
      actor.notaryOfficeId
    )
      throw new ForbiddenException({
        code: 'ACTION_FORBIDDEN',
        message: '仅承办律师可访问',
      });
  }

  @Get()
  @ApiOkResponse({ description: '本人当前承办案件及阶段计数' })
  list(@CurrentActor() actor: ActorContext, @Query() query: CasePageQueryDto) {
    this.lawyer(actor);
    return this.cases.list(
      actor,
      query.page,
      query.pageSize,
      'department',
      query.stage,
    );
  }

  @Get(':id')
  get(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    this.lawyer(actor);
    return this.cases.get(actor, id);
  }

  @Post(':id/complaint-submit')
  submitComplaint(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: SubmitCaseComplaintDto,
  ) {
    this.lawyer(actor);
    return this.complaint.submit(actor, id, body);
  }

  @Post(':id/complaint-confirm')
  confirmComplaint(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ConfirmCaseComplaintDto,
  ) {
    this.lawyer(actor);
    return this.confirmation.confirm(actor, id, body);
  }

  @Post(':id/complaint-mail')
  mailComplaint(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: MailCaseComplaintDto,
  ) {
    this.lawyer(actor);
    return this.mailing.mail(actor, id, body);
  }

  @Get(':id/filing-courts')
  filingCourts(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    this.lawyer(actor);
    return this.courts.list(actor, id);
  }

  @Post(':id/filing-courts')
  createFilingCourt(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: CreateFilingCourtDto,
  ) {
    this.lawyer(actor);
    return this.courts.create(actor, id, body);
  }

  @Post(':id/filing-submit')
  submitFiling(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: SubmitCaseFilingDto,
  ) {
    this.lawyer(actor);
    return this.filing.submit(actor, id, body);
  }

  @Post(':id/acceptance-register')
  registerAcceptance(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: RegisterCaseAcceptanceDto,
  ) {
    this.lawyer(actor);
    return this.acceptance.register(actor, id, body);
  }

  @Post(':id/hearing-schedule')
  scheduleHearing(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: SaveCaseHearingDto,
  ) {
    this.lawyer(actor);
    return this.hearing.schedule(actor, id, body);
  }

  @Post(':id/judgment-register')
  registerJudgment(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: RegisterCaseJudgmentDto,
  ) {
    this.lawyer(actor);
    return this.judgment.register(actor, id, body);
  }
}
