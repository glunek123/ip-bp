import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ActorContext } from '../../access-control/actor-context';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { MailCaseComplaintDto, MailCaseComplaintResponseDto } from './case-complaint-mailing.dto';
import { CaseComplaintMailingService } from './case-complaint-mailing.service';
import { ClientCasePageQueryDto, ClientCaseListResponseDto, ClientCaseDetailResponseDto } from './client-case.response.dto';
import { ClientCaseService } from './client-case.service';

@ApiTags('client-cases')
@ApiBearerAuth()
@Controller('client/cases')
@UseGuards(ActorContextGuard, CsrfGuard)
export class ClientCaseController {
  constructor(private readonly cases: ClientCaseService,
    private readonly mailing: CaseComplaintMailingService) {}

  @Get()
  @ApiOkResponse({ type: ClientCaseListResponseDto })
  list(@CurrentActor() actor: ActorContext, @Query() query: ClientCasePageQueryDto) {
    return this.cases.list(actor, query.view, query.page, query.pageSize);
  }

  @Get(':id')
  @ApiOkResponse({ type: ClientCaseDetailResponseDto })
  get(@CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string) {
    return this.cases.get(actor, id);
  }

  @Post(':id/complaint-mail')
  @ApiOkResponse({ type: MailCaseComplaintResponseDto })
  mailComplaint(@CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: MailCaseComplaintDto) {
    return this.mailing.mail(actor, id, body);
  }
}
