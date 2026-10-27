import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
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
  CaseCsvCommitDto,
  CaseCsvCommitResultDto,
  CaseCsvPreviewDto,
  CaseCsvPreviewResultDto,
} from './case-csv-import.dto';
import { CaseCsvImportService } from './case-csv-import.service';

@ApiTags('cases')
@ApiBearerAuth()
@Controller('cases/csv-import')
@UseGuards(ActorContextGuard, CsrfGuard)
export class CaseCsvImportController {
  constructor(private readonly service: CaseCsvImportService) {}

  @Get('template')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiProduces('text/csv')
  template(@Res() response: Response): void {
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="case-external-entry-template.csv"',
    );
    response.send(this.service.template());
  }

  @Post('preview')
  @HttpCode(200)
  @ApiBody({ type: CaseCsvPreviewDto })
  @ApiOkResponse({ type: CaseCsvPreviewResultDto })
  preview(
    @CurrentActor() actor: ActorContext,
    @Body() input: CaseCsvPreviewDto,
  ): Promise<CaseCsvPreviewResultDto> {
    return this.service.preview(actor, input);
  }

  @Post('commit')
  @HttpCode(200)
  @ApiBody({ type: CaseCsvCommitDto })
  @ApiOkResponse({ type: CaseCsvCommitResultDto })
  commit(
    @CurrentActor() actor: ActorContext,
    @Body() input: CaseCsvCommitDto,
  ): Promise<CaseCsvCommitResultDto> {
    return this.service.commit(actor, input);
  }
}
