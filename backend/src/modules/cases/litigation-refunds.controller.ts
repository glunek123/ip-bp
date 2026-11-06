import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import type { ActorContext } from '../../access-control/actor-context';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import {
  CorrectLitigationRefundInput,
  FollowLitigationRefundInput,
  LitigationRefundListQuery,
  RegisterLitigationRefundInput,
} from './litigation-refunds.dto';
import { LitigationRefundsService } from './litigation-refunds.service';
import { createLitigationRefundWorkbook } from './litigation-refunds-workbook';

@ApiTags('cases')
@ApiBearerAuth()
@Controller('cases/litigation-refunds')
@UseGuards(ActorContextGuard, CsrfGuard)
export class LitigationRefundsController {
  constructor(private readonly refunds: LitigationRefundsService) {}

  @Get('context')
  context(@CurrentActor() actor: ActorContext) {
    return this.refunds.context(actor);
  }

  @Get('export')
  @ApiProduces(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @ApiOkResponse({
    description: 'Filtered litigation refunds, nine XLSX columns',
  })
  async export(
    @CurrentActor() actor: ActorContext,
    @Query() query: LitigationRefundListQuery,
    @Res() response: Response,
  ) {
    const result = await this.refunds.list(actor, query, true);
    const bytes = createLitigationRefundWorkbook(result.items);
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader(
      'Content-Disposition',
      "attachment; filename*=UTF-8''%E8%AF%89%E8%AE%BC%E9%80%80%E8%B4%B9.xlsx",
    );
    response.send(Buffer.from(bytes));
  }

  @Get(':caseId/workspace')
  workspace(
    @CurrentActor() actor: ActorContext,
    @Param('caseId', new ParseUUIDPipe()) caseId: string,
  ) {
    return this.refunds.workspace(actor, caseId);
  }

  @Get(':caseId/items/:itemId')
  item(
    @CurrentActor() actor: ActorContext,
    @Param('caseId', new ParseUUIDPipe()) caseId: string,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
  ) {
    return this.refunds.item(actor, caseId, itemId);
  }

  @Get(':caseId/requests/:key')
  request(
    @CurrentActor() actor: ActorContext,
    @Param('caseId', new ParseUUIDPipe()) caseId: string,
    @Param('key') key: string,
  ) {
    return this.refunds.request(actor, caseId, key);
  }

  @Get()
  list(
    @CurrentActor() actor: ActorContext,
    @Query() query: LitigationRefundListQuery,
  ) {
    return this.refunds.list(actor, query);
  }

  @Post(':caseId/items')
  @ApiBody({ type: RegisterLitigationRefundInput })
  register(
    @CurrentActor() actor: ActorContext,
    @Param('caseId', new ParseUUIDPipe()) caseId: string,
    @Body() input: RegisterLitigationRefundInput,
  ) {
    return this.refunds.register(actor, caseId, input);
  }

  @Post(':caseId/items/:itemId/corrections')
  @ApiBody({ type: CorrectLitigationRefundInput })
  correct(
    @CurrentActor() actor: ActorContext,
    @Param('caseId', new ParseUUIDPipe()) caseId: string,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
    @Body() input: CorrectLitigationRefundInput,
  ) {
    return this.refunds.correct(actor, caseId, itemId, input);
  }

  @Patch(':caseId/items/:itemId/follow-up')
  @ApiBody({ type: FollowLitigationRefundInput })
  follow(
    @CurrentActor() actor: ActorContext,
    @Param('caseId', new ParseUUIDPipe()) caseId: string,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
    @Body() input: FollowLitigationRefundInput,
  ) {
    return this.refunds.follow(actor, caseId, itemId, input);
  }
}
