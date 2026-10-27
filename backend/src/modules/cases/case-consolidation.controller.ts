import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import type { ActorContext } from '../../access-control/actor-context';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { CaseConsolidationService } from './case-consolidation.service';
import {
  CreateCaseConsolidationDto,
  PreviewCaseConsolidationDto,
  CaseConsolidationResultDto,
} from './case-consolidation.dto';

@ApiTags('cases')
@ApiBearerAuth()
@Controller('cases')
@UseGuards(ActorContextGuard, CsrfGuard)
export class CaseConsolidationController {
  constructor(private readonly consolidation: CaseConsolidationService) {}

  @Post('consolidations/preview')
  @HttpCode(200)
  @ApiOkResponse()
  preview(
    @CurrentActor() actor: ActorContext,
    @Body() body: PreviewCaseConsolidationDto,
  ) {
    return this.consolidation.preview(actor, body);
  }

  @Post('consolidations')
  @ApiCreatedResponse({ type: CaseConsolidationResultDto })
  create(
    @CurrentActor() actor: ActorContext,
    @Body() body: CreateCaseConsolidationDto,
  ) {
    return this.consolidation.create(actor, body);
  }

  @Get(':id/consolidation')
  @ApiOkResponse()
  async read(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Res() response: Response,
  ): Promise<void> {
    response.status(200).json(await this.consolidation.read(actor, id));
  }
}
