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
import { CaseHearingService } from './case-hearing.service';
import { CaseJudgmentService } from './case-judgment.service';
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
    private readonly hearing: CaseHearingService,
    private readonly judgment: CaseJudgmentService,
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
}
